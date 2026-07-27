import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createAccessToken } from "./auth.js";
import type { ClientConfig } from "./config.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(
      typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "object" &&
        body.error !== null &&
        "message" in body.error
        ? String(body.error.message)
        : `API request failed with HTTP ${status}`
    );
  }
}

function withQuery(
  path: string,
  values: Record<string, string | number | boolean | undefined>
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `${path}?${encoded}` : path;
}

export class ApiClient {
  constructor(readonly config: ClientConfig) {}

  async request(
    path: string,
    init: RequestInit = {}
  ): Promise<Response> {
    const token = await createAccessToken(this.config.sharedSecret);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    headers.set("accept", "application/json");
    const response = await fetch(new URL(path, this.config.apiUrl), {
      ...init,
      headers
    });
    if (!response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      const body = contentType.includes("application/json")
        ? await response.json()
        : await response.text();
      throw new ApiError(response.status, body);
    }
    return response;
  }

  async json(path: string, init?: RequestInit): Promise<unknown> {
    return this.request(path, init).then((response) => response.json());
  }

  status(): Promise<unknown> {
    return this.json("/v1/status");
  }

  chats(options: { limit?: number; cursor?: string }): Promise<unknown> {
    return this.json(
      withQuery("/v1/chats", {
        limit: options.limit,
        cursor: options.cursor
      })
    );
  }

  messages(options: {
    chat?: string;
    sender?: string;
    direction?: string;
    type?: string;
    from?: string;
    to?: string;
    limit?: number;
    cursor?: string;
    includeDeleted?: boolean;
  }): Promise<unknown> {
    return this.json(
      withQuery("/v1/messages", {
        chat_id: options.chat,
        sender_id: options.sender,
        direction: options.direction,
        type: options.type,
        from: options.from,
        to: options.to,
        limit: options.limit,
        cursor: options.cursor,
        include_deleted: options.includeDeleted
      })
    );
  }

  search(
    query: string,
    options: {
      chat?: string;
      sender?: string;
      direction?: string;
      type?: string;
      from?: string;
      to?: string;
      sort?: string;
      limit?: number;
      cursor?: string;
      includeDeleted?: boolean;
    }
  ): Promise<unknown> {
    return this.json(
      withQuery("/v1/messages/search", {
        q: query,
        chat_id: options.chat,
        sender_id: options.sender,
        direction: options.direction,
        type: options.type,
        from: options.from,
        to: options.to,
        sort: options.sort,
        limit: options.limit,
        cursor: options.cursor,
        include_deleted: options.includeDeleted
      })
    );
  }

  message(id: string): Promise<unknown> {
    return this.json(`/v1/messages/${encodeURIComponent(id)}`);
  }

  events(after: number, limit?: number): Promise<unknown> {
    return this.json(
      withQuery("/v1/events", {
        after_sequence: after,
        limit
      })
    );
  }

  async downloadMedia(id: string, output: string): Promise<void> {
    const response = await this.request(
      `/v1/messages/${encodeURIComponent(id)}/media`
    );
    if (!response.body) throw new Error("Media response had no body");
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
      createWriteStream(output, { flags: "wx" })
    );
  }

  sendText(
    recipient: string,
    text: string,
    idempotencyKey = randomUUID()
  ): Promise<unknown> {
    return this.json("/v1/messages/text", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      },
      body: JSON.stringify({ recipient, text })
    });
  }

  async sendMedia(options: {
    recipient: string;
    file: string;
    caption?: string;
    mimetype?: string;
    idempotencyKey?: string;
  }): Promise<unknown> {
    const fileInfo = await stat(options.file);
    if (!fileInfo.isFile()) throw new Error("Media path is not a regular file");
    const bytes = await readFile(options.file);
    const form = new FormData();
    form.set("recipient", options.recipient);
    if (options.caption) form.set("caption", options.caption);
    form.set(
      "file",
      new Blob([bytes], {
        type: options.mimetype ?? "application/octet-stream"
      }),
      basename(options.file)
    );
    return this.json("/v1/messages/media", {
      method: "POST",
      headers: {
        "idempotency-key": options.idempotencyKey ?? randomUUID()
      },
      body: form
    });
  }
}
