#!/usr/bin/env node
import { Command, Option } from "commander";
import { ApiClient, ApiError } from "./api.js";
import { loadClientConfig } from "./config.js";
import {
  codexSkillPath,
  installCodexSkill,
  isCodexSkillInstalled
} from "./skill.js";
import { watchEvents } from "./watch.js";

interface GlobalOptions {
  apiUrl?: string;
  envFile?: string;
  compact?: boolean;
}

function clientFor(command: Command): ApiClient {
  const options = command.optsWithGlobals<GlobalOptions>();
  return new ApiClient(
    loadClientConfig({
      ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
      ...(options.envFile ? { envFile: options.envFile } : {})
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
  .name("whatsapp")
  .description("Trusted command-line client for the authenticated WhatsApp API")
  .version("1.0.0")
  .option(
    "--api-url <url>",
    "override the API base URL from the env file"
  )
  .option(
    "--env-file <path>",
    "environment file containing API_SHARED_SECRET_B64",
    process.env.WHATSAPP_ENV_FILE ?? ".env"
  )
  .option("--compact", "print compact JSON", false)
  .addHelpText(
    "after",
    '\nCodex integration:\n  Run "whatsapp install-skill" to install the bundled global skill.\n'
  );

program
  .command("install-skill")
  .description("install the bundled global Codex skill")
  .option("--force", "replace an existing whatsapp-cli skill", false)
  .action(async (options, command) => {
    print(await installCodexSkill({ force: options.force }), command);
  });

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

program
  .command("recipients")
  .description("search contacts and groups by name")
  .argument("<query>", "saved, notify, username, verified, or group name")
  .option("--limit <number>", "result count", (value) => Number(value), 20)
  .action(async (query, options, command) => {
    print(await clientFor(command).recipients(query, options.limit), command);
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
    ".whatsapp-sequence"
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
  if (
    process.stderr.isTTY &&
    !process.argv.includes("install-skill") &&
    !isCodexSkillInstalled()
  ) {
    process.stderr.write(
      `Tip: install the Codex WhatsApp skill with "whatsapp install-skill" (${codexSkillPath()}).\n`
    );
  }
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
