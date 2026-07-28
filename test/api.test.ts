import { ApiClient, SendError } from "../src/api.js";

const config = {
  apiUrl: new URL("https://api.example.test"),
  sharedSecret: new Uint8Array(Buffer.alloc(32, 7))
};

describe("send idempotency", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the generated idempotency key with a successful send", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "message-1" }), {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new ApiClient(config).sendText("15551234567", "hello");

    expect(result.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(result.response).toEqual({ id: "message-1" });
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("idempotency-key")
    ).toBe(result.idempotencyKey);
  });

  it("preserves the key and API response when a send fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "SEND_OUTCOME_UNKNOWN",
              message: "unknown",
              request_id: "request-1"
            }
          }),
          {
            status: 502,
            headers: { "content-type": "application/json" }
          }
        )
      )
    );

    const error = await new ApiClient(config)
      .sendText("15551234567", "hello", "stable-request-key")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SendError);
    expect(error).toMatchObject({
      idempotencyKey: "stable-request-key",
      status: 502,
      body: {
        error: {
          code: "SEND_OUTCOME_UNKNOWN",
          request_id: "request-1"
        }
      }
    });
  });
});
