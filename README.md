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
cp .env.example .env
chmod 600 .env
```

Set `WHATSAPP_API_URL` and `API_SHARED_SECRET_B64` in `.env`. The secret is
never accepted as a command-line argument. Use `--env-file /secure/path/file`
or set `WHATSAPP_ENV_FILE` when the file is not `.env` in the current
directory. `--api-url` may override only the non-secret URL.

Install the binary locally with `npm link` and use `whatsapp-api`:

```sh
npm link
whatsapp-api status
```

## Codex skill

The repository includes a global Codex skill describing safe read, search,
download, notification, and send workflows:

```sh
whatsapp-api install-skill
```

The command installs to `${CODEX_HOME:-~/.codex}/skills/whatsapp-cli` and
refuses to replace an existing skill. Use `install-skill --force` only when
you intentionally want to update that installation. Interactive CLI use
prints a hint until the skill is installed; JSON and WebSocket output remain
clean when redirected or piped.

## Commands

```sh
whatsapp-api status
whatsapp-api chats --limit 50
whatsapp-api messages --limit 20
whatsapp-api messages --chat 15551234567@s.whatsapp.net
whatsapp-api search 'project update' --sort newest
whatsapp-api get MESSAGE_UUID
whatsapp-api download MESSAGE_UUID --output ./attachment.bin
whatsapp-api send-text 15551234567 'hello'
whatsapp-api send-media 15551234567 ./photo.jpg --mime-type image/jpeg
whatsapp-api events --after 0
whatsapp-api install-skill
```

Use `whatsapp-api <command> --help` for all filters and options. Finite commands
print JSON; add `--compact` for single-line output.

## Long-running notifications

```sh
whatsapp-api watch
```

`watch` prints one JSON event per line, reconnects with exponential backoff,
and asks the API to replay events after the last processed sequence. By
default it stores that sequence in `.whatsapp-api-sequence` using mode `0600`.
Use `--cursor-file /secure/path/sequence` to choose another location,
`--after N` to override the initial sequence, or `--no-persist` for an
ephemeral consumer.

Event delivery is at least once. Downstream consumers should also deduplicate
by event `id` or `sequence`. Events older than the server's retention window
cannot be recovered.

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
