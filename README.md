# WhatsApp API CLI

This is a standalone trusted client for the authenticated WhatsApp API. It does
not import server code or need PostgreSQL/Baileys credentials. The matching
server is available at
[`Fuzzyma/whatsapp-server`](https://github.com/Fuzzyma/whatsapp-server).

## Requirements and installation

- Node.js 24
- A running `whatsapp-server` instance
- The server's `API_SHARED_SECRET_B64`

```sh
git clone https://github.com/Fuzzyma/whatsapp-cli.git
cd whatsapp-cli
npm ci
npm run build
mkdir -p ~/.config/whatsapp-cli
cp .env.example ~/.config/whatsapp-cli/.env
chmod 600 ~/.config/whatsapp-cli/.env
```

Set `WHATSAPP_API_URL` and `API_SHARED_SECRET_B64` in
`~/.config/whatsapp-cli/.env`. The CLI honors `XDG_CONFIG_HOME`, then falls
back to `.env` in the current directory for compatibility. The secret is never
accepted as a command-line argument. Use `--env-file /secure/path/file` or set
`WHATSAPP_ENV_FILE` to override config discovery. `--api-url` may override only
the non-secret URL.

Install the `whatsapp` binary locally with `npm link`:

```sh
npm link
whatsapp status
```

## Codex skill

The repository includes a global Codex skill describing safe read, search,
download, notification, and send workflows:

```sh
whatsapp install-skill
```

The command installs to `${CODEX_HOME:-~/.codex}/skills/whatsapp-cli` and
refuses to replace an existing skill. Use `install-skill --force` only when
you intentionally want to update that installation. Interactive CLI use
prints a hint until the skill is installed; JSON and WebSocket output remain
clean when redirected or piped.

## Commands

```sh
whatsapp status
whatsapp chats --limit 50
whatsapp recipients 'contact name' --limit 20
whatsapp messages --limit 20
whatsapp messages --chat 15551234567@s.whatsapp.net
whatsapp search 'project update' --sort newest
whatsapp get MESSAGE_UUID
whatsapp download MESSAGE_UUID --output ./attachment.bin
whatsapp send-text 15551234567 'hello'
whatsapp send-media 15551234567 ./photo.jpg --mime-type image/jpeg
whatsapp send-status IDEMPOTENCY_KEY
whatsapp events --after 0
whatsapp install-skill
```

Use `whatsapp <command> --help` for all filters and options. Finite commands
print JSON; add `--compact` for single-line output.

Before dispatch, the CLI writes the effective idempotency key to stderr so it
survives a killed or interrupted command. Send results also include
`idempotencyKey` and the API `response`. A failure marked `released` was
rejected before sending and may be retried with that key after correction.
Otherwise inspect it with `send-status` before retrying; never switch to a new
key when the prior outcome is unknown.

## Long-running notifications

```sh
whatsapp watch
```

`watch` prints one JSON event per line, reconnects with exponential backoff,
and asks the API to replay events after the last processed sequence. By
default it stores that sequence in `.whatsapp-sequence` using mode `0600`.
Use `--cursor-file /secure/path/sequence` to choose another location,
`--after N` to override the initial sequence, or `--no-persist` for an
ephemeral consumer.

Event delivery is at least once. Downstream consumers should also deduplicate
by event `id` or `sequence`. Events older than the server's retention window
cannot be recovered. The watcher prints a warning to stderr when the server
reports that replay was truncated. Event output and cursor updates are
serialized, and HTTP 400/401/403 upgrade failures are treated as terminal
configuration errors rather than retried. A malformed cursor is rejected
instead of silently replaying from zero; use a separate cursor file for each
watcher process.

## Development

```sh
npm ci
npm run check
npm test
npm run build
npm audit --omit=dev
```

## License

MIT. See [`LICENSE`](LICENSE).
