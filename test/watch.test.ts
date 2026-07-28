import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { ApiClient } from "../src/api.js";
import { watchEvents } from "../src/watch.js";

async function waitForCursor(path: string, expected: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await readFile(path, "utf8").catch(() => "");
    if (value.trim() === expected) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`Cursor did not reach ${expected}`);
}

describe("event watcher", () => {
  it("rejects a corrupt persisted cursor instead of replaying from zero", async () => {
    const directory = await mkdtemp(join(tmpdir(), "whatsapp-watch-"));
    const cursorFile = join(directory, "cursor");
    await writeFile(cursorFile, "not-a-sequence\n", { mode: 0o600 });

    try {
      await expect(
        watchEvents(
          new ApiClient({
            apiUrl: new URL("http://127.0.0.1:1"),
            sharedSecret: new Uint8Array(Buffer.alloc(32, 3))
          }),
          { cursorFile, persist: true }
        )
      ).rejects.toThrow("Watch cursor file is invalid");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serializes burst output and cursor persistence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "whatsapp-watch-"));
    const cursorFile = join(directory, "cursor");
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const address = server.address();
    if (typeof address === "string" || address == null) {
      throw new Error("WebSocket test server has no TCP address");
    }
    const output: string[] = [];
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: string | Uint8Array, ...args: unknown[]) => {
        output.push(String(chunk));
        const callback = args.find((value) => typeof value === "function") as
          | (() => void)
          | undefined;
        callback?.();
        return true;
      }) as typeof process.stdout.write);
    const controller = new AbortController();

    server.on("connection", (socket) => {
      socket.send(
        JSON.stringify({
          kind: "stream.status",
          requestedAfterSequence: 0,
          earliestSequence: 1,
          latestSequence: 2,
          replayTruncated: false
        })
      );
      for (const sequence of [1, 2]) {
        socket.send(
          JSON.stringify({
            sequence,
            id: `event-${sequence}`,
            type: "message.created",
            occurredAt: "2026-01-01T00:00:00.000Z",
            data: { id: `message-${sequence}` }
          })
        );
      }
    });

    try {
      const watching = watchEvents(
        new ApiClient({
          apiUrl: new URL(`http://127.0.0.1:${address.port}`),
          sharedSecret: new Uint8Array(Buffer.alloc(32, 4))
        }),
        {
          cursorFile,
          persist: true,
          signal: controller.signal
        }
      );
      await waitForCursor(cursorFile, "2");
      controller.abort();
      await watching;

      expect(output.filter((line) => line.includes('"sequence"'))).toEqual([
        expect.stringContaining('"sequence":1'),
        expect.stringContaining('"sequence":2')
      ]);
    } finally {
      controller.abort();
      write.mockRestore();
      await new Promise<void>((resolvePromise) =>
        server.close(() => resolvePromise())
      );
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("stops after a terminal authentication rejection", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(401);
      response.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (typeof address === "string" || address == null) {
      throw new Error("HTTP test server has no TCP address");
    }
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    try {
      await expect(
        watchEvents(
          new ApiClient({
            apiUrl: new URL(`http://127.0.0.1:${address.port}`),
            sharedSecret: new Uint8Array(Buffer.alloc(32, 5))
          }),
          { persist: false }
        )
      ).rejects.toThrow("non-retryable HTTP 401");
    } finally {
      stderr.mockRestore();
      await new Promise<void>((resolvePromise) =>
        server.close(() => resolvePromise())
      );
    }
  });
});
