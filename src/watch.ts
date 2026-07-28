import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import WebSocket from "ws";
import { createAccessToken } from "./auth.js";
import type { ApiClient } from "./api.js";

interface StreamEvent {
  sequence: number;
  id: string;
  type: string;
  occurredAt: string;
  data: unknown;
}

interface StreamStatus {
  kind: "stream.status";
  requestedAfterSequence: number;
  earliestSequence: number | null;
  latestSequence: number;
  replayTruncated: boolean;
}

async function readCursor(path: string): Promise<number> {
  try {
    const raw = (await readFile(path, "utf8")).trim();
    const value = Number(raw);
    if (raw === "" || !Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Watch cursor file is invalid: ${resolve(path)}`);
    }
    return value;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return 0;
    }
    throw error;
  }
}

async function persistCursor(path: string, sequence: number): Promise<void> {
  const target = resolve(path);
  const temporary = `${target}.${process.pid}.${sequence}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${sequence}\n`, {
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function websocketUrl(apiUrl: URL, after: number): URL {
  const url = new URL("/v1/events/ws", apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("after_sequence", String(after));
  return url;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function writeEvent(event: StreamEvent): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    process.stdout.write(`${JSON.stringify(event)}\n`, (error) => {
      if (error) reject(error);
      else resolvePromise();
    });
  });
}

export async function watchEvents(
  client: ApiClient,
  options: {
    after?: number;
    cursorFile?: string;
    persist: boolean;
    signal?: AbortSignal;
  }
): Promise<void> {
  let lastSequence =
    options.after ??
    (options.persist && options.cursorFile
      ? await readCursor(options.cursorFile)
      : 0);
  if (!Number.isSafeInteger(lastSequence) || lastSequence < 0) {
    throw new Error("Watch sequence must be a non-negative integer");
  }
  let stopping = false;
  let active: WebSocket | null = null;
  let attempts = 0;
  let resolveStopped: () => void = () => {};
  const stopped = new Promise<void>((resolvePromise) => {
    resolveStopped = resolvePromise;
  });

  const stop = () => {
    stopping = true;
    active?.close(1000, "Client stopping");
    resolveStopped();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted) stop();

  try {
    while (!stopping) {
      const token = await createAccessToken(client.config.sharedSecret);
      const url = websocketUrl(client.config.apiUrl, lastSequence);
      const socket = new WebSocket(url, {
        headers: { authorization: `Bearer ${token}` }
      });
      active = socket;

      let processing = Promise.resolve();
      const outcome = await new Promise<{
        kind: "closed" | "failed" | "rejected";
        status?: number;
      }>((resolvePromise) => {
        let opened = false;
        let rejected = false;
        socket.once("open", () => {
          opened = true;
          attempts = 0;
        });
        socket.on("message", (bytes) => {
          processing = processing.then(async () => {
            const frame = JSON.parse(bytes.toString("utf8")) as
              | StreamEvent
              | StreamStatus;
            if ("kind" in frame) {
              if (frame.kind !== "stream.status") {
                throw new Error("Server sent an unknown stream control frame");
              }
              if (frame.replayTruncated) {
                process.stderr.write(
                  `Event replay is truncated: requested sequence ${frame.requestedAfterSequence}, earliest retained sequence ${frame.earliestSequence ?? "none"}.\n`
                );
              }
              return;
            }
            const event = frame;
            if (
              !Number.isSafeInteger(event.sequence) ||
              event.sequence < 1
            ) {
              throw new Error("Server sent an invalid event sequence");
            }
            if (event.sequence <= lastSequence) return;
            await writeEvent(event);
            if (options.persist && options.cursorFile) {
              await persistCursor(options.cursorFile, event.sequence);
            }
            lastSequence = event.sequence;
          });
          void processing.catch((error) => {
            process.stderr.write(
              `Failed to process event: ${
                error instanceof Error ? error.message : String(error)
              }\n`
            );
            socket.close(1011, "Event processing failed");
          });
        });
        socket.once("unexpected-response", (_request, response) => {
          rejected = true;
          response.resume();
          process.stderr.write(
            `WebSocket rejected with HTTP ${response.statusCode ?? "unknown"}\n`
          );
          resolvePromise({
            kind: "rejected",
            ...(response.statusCode == null
              ? {}
              : { status: response.statusCode })
          });
        });
        socket.once("error", (error) => {
          if (!opened && !rejected) {
            process.stderr.write(`WebSocket connection failed: ${error.message}\n`);
          }
          resolvePromise({ kind: "failed" });
        });
        socket.once("close", () => resolvePromise({ kind: "closed" }));
      });
      await processing.catch(() => {});
      if (outcome.kind === "rejected") socket.terminate();
      active = null;
      if (stopping) break;
      if (
        outcome.kind === "rejected" &&
        outcome.status != null &&
        [400, 401, 403].includes(outcome.status)
      ) {
        throw new Error(
          `WebSocket rejected with non-retryable HTTP ${outcome.status}`
        );
      }
      attempts += 1;
      const base = Math.min(30_000, 1_000 * 2 ** Math.min(attempts - 1, 5));
      const delay = base + Math.floor(Math.random() * Math.min(1_000, base / 4));
      process.stderr.write(
        `Notification stream ${outcome.kind}; reconnecting after ${delay}ms from sequence ${lastSequence}\n`
      );
      await Promise.race([wait(delay), stopped]);
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    options.signal?.removeEventListener("abort", stop);
    active?.terminate();
  }
}
