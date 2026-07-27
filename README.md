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
export WHATSAPP_API_URL=https://whatsapp-api.example.com
export API_SHARED_SECRET_B64='...'
```

Install the binary locally with `npm link` and use `whatsapp-api`:

```sh
npm link
whatsapp-api status
```

`--api-url` and `--secret` can override the environment for a single command.
Prefer the environment variable for the secret so it does not enter shell
history.

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
