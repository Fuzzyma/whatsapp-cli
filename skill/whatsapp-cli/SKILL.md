---
name: whatsapp-cli
description: Access the user's authenticated WhatsApp account through the whatsapp CLI to inspect connection state, list or resolve chats, retrieve and search message history, download requested media, pull or watch new-message events, and send text or media when explicitly requested. Use whenever Codex needs to answer questions from WhatsApp history, find conversations or attachments, monitor WhatsApp notifications, or deliver a user-authorized WhatsApp message through the locally hosted API.
---

# WhatsApp CLI

Use `whatsapp` as the primary interface. Do not query the server database or
call its HTTP endpoints directly unless diagnosing a CLI failure.

## Configure safely

- Require Node.js 24, a running `whatsapp-server`, and a paired account.
- Store configuration in an env file with mode `0600`:

```dotenv
WHATSAPP_API_URL=http://127.0.0.1:3000
API_SHARED_SECRET_B64=<32-byte-base64-shared-secret>
```

- Let the CLI read `~/.config/whatsapp-cli/.env` (or
  `$XDG_CONFIG_HOME/whatsapp-cli/.env`). It falls back to `.env` in the current
  directory. Pass `--env-file /absolute/path/to/file` before the subcommand to
  override discovery.
- Never print, echo, log, interpolate, or pass the shared secret as a command
  argument. Never enable shell tracing around a CLI invocation.
- Use HTTPS for a non-loopback API URL. The local default is
  `http://127.0.0.1:3000`.

## Choose the operation

Use these read-only commands without additional confirmation when they answer
the user's request:

```sh
whatsapp status
whatsapp chats --limit 100
whatsapp recipients 'contact name' --limit 20
whatsapp messages --limit 20
whatsapp messages --chat CHAT_JID --limit 20
whatsapp search 'project update' --sort newest --limit 20
whatsapp get MESSAGE_UUID
whatsapp events --after SEQUENCE --limit 100
whatsapp send-status IDEMPOTENCY_KEY
```

Apply `--sender`, `--direction`, `--type`, `--from`, and `--to` filters where
they reduce unnecessary disclosure. Add `--include-deleted` only when the
user asks for deleted records.

### Resolve recipients and paginate

- Resolve a person or group with `recipients`, which searches saved names,
  notify names, usernames, verified names, and group names. Prefer an exact
  case-insensitive name match.
- Do not guess when multiple contacts match. Show the minimal disambiguating
  details and ask the user.
- Use the returned `id` as the recipient for `send-text` or `send-media`.
- Use `chats` only when browsing conversations; contacts without an existing
  chat do not appear there. Message search does not search contact names.
- Treat `nextCursor` as opaque. Pass it unchanged with `--cursor` until it is
  null or enough results have been found.
- Message pages are newest first. To find recent media, page through messages
  and select records where `hasMedia` is true.

### Download media

Download only when requested or necessary to complete the user's task:

```sh
whatsapp download MESSAGE_UUID --output /absolute/new/path
```

Choose a new output path; the CLI intentionally refuses to overwrite a file.
Report the saved path. A `410 MEDIA_UNAVAILABLE` response means WhatsApp no
longer provides the media.

### Watch notifications

Use `watch` only for an explicit monitoring or notification request:

```sh
whatsapp watch --cursor-file /secure/state/whatsapp.sequence
```

Keep a durable cursor file for long-running work. The client reconnects with
replay, but delivery is at least once; deduplicate by event `id` or
`sequence`. A replay-truncation warning means the cursor is older than retained
server history and some events cannot be recovered. Stop the watcher cleanly
with SIGINT or SIGTERM. Use a separate cursor file for each watcher process.

### Send messages

Sending is an external side effect. Send only when the user explicitly asks
for it and the recipient, content, and attachment are sufficiently clear.
Do not send a test message merely to verify connectivity.

```sh
whatsapp send-text RECIPIENT 'exact text' --idempotency-key STABLE_UUID
whatsapp send-media RECIPIENT /absolute/file --caption 'caption' \
  --mime-type image/jpeg --idempotency-key STABLE_UUID
```

- Accept an E.164 number without `+` or an exact WhatsApp JID.
- Resolve ambiguous recipients before sending.
- Reuse the same idempotency key when retrying the same intended send. Do not
  blindly retry when the first outcome is uncertain.
- The CLI announces the effective `idempotencyKey` on stderr before dispatch
  and includes it in successful output. Retain that key. A failure marked
  `idempotencyKeyState: released` was rejected before sending and can reuse the
  key after correction. Otherwise run `whatsapp send-status IDEMPOTENCY_KEY`;
  never substitute a new key for an unknown outcome.
- Verify a media path is the intended regular file and keep within the
  server's upload limit.
- Report the API result without exposing unrelated conversation data.

## Handle failures

- Check `status` first for connection problems.
- Treat `401` as env-file or shared-secret configuration failure.
- `watch` treats HTTP 400/401/403 upgrade failures as terminal and does not
  reconnect.
- Treat `503 WHATSAPP_UNAVAILABLE` as a disconnected or logged-out account;
  do not loop sends.
- Preserve the JSON error envelope and request ID when reporting failures.
