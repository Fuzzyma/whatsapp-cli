import { readFile, rename, writeFile } from "node:fs/promises";
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

async function readCursor(path: string): Promise<number> {
  try {
    const value = Number((await readFile(path, "utf8")).trim());
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
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
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${sequence}\n`, { mode: 0o600 });
  await rename(temporary, target);
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

export async function watchEvents(
  client: ApiClient,
  options: {
    after?: number;
    cursorFile?: string;
    persist: boolean;
  }
): Promise<void> {
  let lastSequence =
    options.after ??
    (options.persist && options.cursorFile
      ? await readCursor(options.cursorFile)
      : 0);
  let stopping = false;
  let active: WebSocket | null = null;
  let attempts = 0;

  const stop = () => {
    stopping = true;
    active?.close(1000, "Client stopping");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    while (!stopping) {
      const token = await createAccessToken(client.config.sharedSecret);
      const url = websocketUrl(client.config.apiUrl, lastSequence);
      const socket = new WebSocket(url, {
        headers: { authorization: `Bearer ${token}` }
      });
      active = socket;

      const outcome = await new Promise<"closed" | "failed">((resolvePromise) => {
        let opened = false;
        socket.once("open", () => {
          opened = true;
          attempts = 0;
        });
        socket.on("message", (bytes) => {
          void (async () => {
            const event = JSON.parse(bytes.toString("utf8")) as StreamEvent;
            if (
              !Number.isSafeInteger(event.sequence) ||
              event.sequence <= lastSequence
            ) {
              return;
            }
            process.stdout.write(`${JSON.stringify(event)}\n`);
            lastSequence = event.sequence;
            if (options.persist && options.cursorFile) {
              await persistCursor(options.cursorFile, lastSequence);
            }
          })().catch((error) => {
            process.stderr.write(
              `Failed to process event: ${
                error instanceof Error ? error.message : String(error)
              }\n`
            );
            socket.close(1011, "Event processing failed");
          });
        });
        socket.once("unexpected-response", (_request, response) => {
          process.stderr.write(
            `WebSocket rejected with HTTP ${response.statusCode ?? "unknown"}\n`
          );
        });
        socket.once("error", (error) => {
          if (!opened) {
            process.stderr.write(`WebSocket connection failed: ${error.message}\n`);
          }
          resolvePromise("failed");
        });
        socket.once("close", () => resolvePromise("closed"));
      });
      active = null;
      if (stopping) break;
      attempts += 1;
      const base = Math.min(30_000, 1_000 * 2 ** Math.min(attempts - 1, 5));
      const delay = base + Math.floor(Math.random() * Math.min(1_000, base / 4));
      process.stderr.write(
        `Notification stream ${outcome}; reconnecting after ${delay}ms from sequence ${lastSequence}\n`
      );
      await wait(delay);
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    active?.terminate();
  }
}
