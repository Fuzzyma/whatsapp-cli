import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jwtVerify } from "jose";
import { createAccessToken } from "../src/auth.js";
import { loadClientConfig } from "../src/config.js";

describe("client authentication", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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
    const directory = mkdtempSync(join(tmpdir(), "whatsapp-cli-config-"));
    const envFile = join(directory, ".env");
    try {
      writeFileSync(
        envFile,
        [
          "WHATSAPP_API_URL=https://example.test/",
          `API_SHARED_SECRET_B64=${Buffer.alloc(32, 1).toString("base64")}`
        ].join("\n")
      );
      const valid = loadClientConfig({ envFile });
      expect(valid.apiUrl.toString()).toBe("https://example.test/");

      writeFileSync(envFile, "API_SHARED_SECRET_B64=bad\n");
      expect(() =>
        loadClientConfig({ apiUrl: "ftp://example.test", envFile })
      ).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("loads the default config from the user config directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "whatsapp-cli-home-config-"));
    const configDirectory = join(directory, "whatsapp-cli");
    const envFile = join(configDirectory, ".env");
    try {
      mkdirSync(configDirectory);
      writeFileSync(
        envFile,
        [
          "WHATSAPP_API_URL=https://home-config.example.test",
          `API_SHARED_SECRET_B64=${Buffer.alloc(32, 2).toString("base64")}`
        ].join("\n")
      );
      vi.stubEnv("XDG_CONFIG_HOME", directory);
      vi.stubEnv("WHATSAPP_ENV_FILE", undefined);
      vi.stubEnv("WHATSAPP_API_URL", undefined);
      vi.stubEnv("API_SHARED_SECRET_B64", undefined);

      const config = loadClientConfig({});

      expect(config.apiUrl.toString()).toBe(
        "https://home-config.example.test/"
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses process environment without requiring a config file", () => {
    const directory = mkdtempSync(join(tmpdir(), "whatsapp-cli-env-only-"));
    try {
      vi.stubEnv("XDG_CONFIG_HOME", directory);
      vi.stubEnv("WHATSAPP_ENV_FILE", undefined);
      vi.stubEnv("WHATSAPP_API_URL", "https://environment.example.test");
      vi.stubEnv(
        "API_SHARED_SECRET_B64",
        Buffer.alloc(32, 6).toString("base64")
      );

      const config = loadClientConfig({});

      expect(config.apiUrl.toString()).toBe(
        "https://environment.example.test/"
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
