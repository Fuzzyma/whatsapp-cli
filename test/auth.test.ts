import { jwtVerify } from "jose";
import { createAccessToken } from "../src/auth.js";
import { loadClientConfig } from "../src/config.js";

describe("client authentication", () => {
  it("creates a server-compatible 30-second JWT", async () => {
    const secret = new Uint8Array(Buffer.alloc(32, 5));
    const token = await createAccessToken(secret);
    const result = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: "whatsapp-api-client",
      audience: "whatsapp-api",
      subject: "trusted-client"
    });
    expect(result.payload.exp! - result.payload.iat!).toBe(30);
    expect(result.payload.nbf).toBe(result.payload.iat);
  });

  it("validates URL and decoded secret length", () => {
    const valid = loadClientConfig({
      apiUrl: "https://example.test/",
      secret: Buffer.alloc(32, 1).toString("base64")
    });
    expect(valid.apiUrl.toString()).toBe("https://example.test/");
    expect(() =>
      loadClientConfig({ apiUrl: "ftp://example.test", secret: "bad" })
    ).toThrow();
  });
});
