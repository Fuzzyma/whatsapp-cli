#!/usr/bin/env node
import { Command, Option } from "commander";
import { ApiClient, ApiError } from "./api.js";
import { loadClientConfig } from "./config.js";
import { watchEvents } from "./watch.js";

interface GlobalOptions {
  apiUrl?: string;
  secret?: string;
  compact?: boolean;
}

function clientFor(command: Command): ApiClient {
  const options = command.optsWithGlobals<GlobalOptions>();
  return new ApiClient(
    loadClientConfig({
      ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
      ...(options.secret ? { secret: options.secret } : {})
    })
  );
}

function print(value: unknown, command: Command): void {
  const options = command.optsWithGlobals<GlobalOptions>();
  process.stdout.write(`${JSON.stringify(value, null, options.compact ? 0 : 2)}\n`);
}

function commonMessageOptions(command: Command): Command {
  return command
    .option("--chat <jid>", "filter by chat JID")
    .option("--sender <jid>", "filter by sender JID")
    .addOption(
      new Option("--direction <direction>", "message direction").choices([
        "incoming",
        "outgoing"
      ])
    )
    .option("--type <type>", "filter by WhatsApp message type")
    .option("--from <date>", "earliest ISO-8601 timestamp")
    .option("--to <date>", "latest ISO-8601 timestamp")
    .option("--limit <number>", "result count", (value) => Number(value), 50)
    .option("--cursor <cursor>", "opaque pagination cursor")
    .option("--include-deleted", "include tombstoned messages", false);
}

const program = new Command()
  .name("whatsapp-api")
  .description("Trusted command-line client for the authenticated WhatsApp API")
  .version("1.0.0")
  .option(
    "--api-url <url>",
    "API base URL",
    process.env.WHATSAPP_API_URL ?? "http://127.0.0.1:3000"
  )
  .option(
    "--secret <base64>",
    "API shared secret; prefer API_SHARED_SECRET_B64 instead of command history"
  )
  .option("--compact", "print compact JSON", false);

program
  .command("status")
  .description("show WhatsApp connection and sync state")
  .action(async (_options, command) => {
    print(await clientFor(command).status(), command);
  });

program
  .command("chats")
  .description("list known chats")
  .option("--limit <number>", "result count", (value) => Number(value), 50)
  .option("--cursor <cursor>", "opaque pagination cursor")
  .action(async (options, command) => {
    print(await clientFor(command).chats(options), command);
  });

commonMessageOptions(
  program.command("messages").description("list latest global or per-chat messages")
).action(async (options, command) => {
  print(await clientFor(command).messages(options), command);
});

commonMessageOptions(
  program
    .command("search")
    .description("search synchronized message text and captions")
    .argument("<query>", "web-style search query")
    .addOption(
      new Option("--sort <sort>", "result ordering")
        .choices(["relevance", "newest"])
        .default("relevance")
    )
).action(async (query, options, command) => {
  print(await clientFor(command).search(query, options), command);
});

program
  .command("get")
  .description("get one normalized message")
  .argument("<id>", "API message ID")
  .action(async (id, _options, command) => {
    print(await clientFor(command).message(id), command);
  });

program
  .command("download")
  .description("download a message's media without retaining it on the server")
  .argument("<id>", "API message ID")
  .requiredOption("-o, --output <path>", "new output file path")
  .action(async (id, options, command) => {
    await clientFor(command).downloadMedia(id, options.output);
    print({ output: options.output }, command);
  });

program
  .command("send-text")
  .description("send a text message")
  .argument("<recipient>", "E.164 number without '+' or WhatsApp JID")
  .argument("<text>", "message text")
  .option("--idempotency-key <key>", "stable key for manually retried sends")
  .action(async (recipient, text, options, command) => {
    print(
      await clientFor(command).sendText(
        recipient,
        text,
        options.idempotencyKey
      ),
      command
    );
  });

program
  .command("send-media")
  .description("send an image, video, audio, or document")
  .argument("<recipient>", "E.164 number without '+' or WhatsApp JID")
  .argument("<file>", "local media path")
  .option("--caption <text>", "media caption")
  .option("--mime-type <type>", "override MIME type")
  .option("--idempotency-key <key>", "stable key for manually retried sends")
  .action(async (recipient, file, options, command) => {
    print(
      await clientFor(command).sendMedia({
        recipient,
        file,
        ...(options.caption ? { caption: options.caption } : {}),
        ...(options.mimeType ? { mimetype: options.mimeType } : {}),
        ...(options.idempotencyKey
          ? { idempotencyKey: options.idempotencyKey }
          : {})
      }),
      command
    );
  });

program
  .command("events")
  .description("pull retained events once")
  .option("--after <sequence>", "last processed sequence", (value) => Number(value), 0)
  .option("--limit <number>", "result count", (value) => Number(value), 100)
  .action(async (options, command) => {
    print(await clientFor(command).events(options.after, options.limit), command);
  });

program
  .command("watch")
  .description("continuously print JSONL notifications and reconnect with replay")
  .option("--after <sequence>", "explicit starting sequence", (value) => Number(value))
  .option(
    "--cursor-file <path>",
    "file used to persist the last processed sequence",
    ".whatsapp-api-sequence"
  )
  .option("--no-persist", "do not read or write the cursor file")
  .action(async (options, command) => {
    await watchEvents(clientFor(command), {
      ...(options.after !== undefined ? { after: options.after } : {}),
      cursorFile: options.cursorFile,
      persist: options.persist
    });
  });

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof ApiError) {
    process.stderr.write(
      `${JSON.stringify({ status: error.status, response: error.body }, null, 2)}\n`
    );
  } else {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
  }
  process.exitCode = 1;
}
