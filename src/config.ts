import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { parseEnv } from "node:util";

export interface ClientConfig {
  apiUrl: URL;
  sharedSecret: Uint8Array;
}

export function defaultEnvFile(): string {
  const configuredHome = process.env.XDG_CONFIG_HOME;
  const configHome =
    configuredHome && isAbsolute(configuredHome)
      ? configuredHome
      : join(homedir(), ".config");
  return join(configHome, "whatsapp-cli", ".env");
}

export function loadClientConfig(options: {
  apiUrl?: string;
  envFile?: string;
}): ClientConfig {
  const requestedEnvFile =
    options.envFile ?? process.env.WHATSAPP_ENV_FILE;
  const envFiles = requestedEnvFile
    ? [requestedEnvFile]
    : [defaultEnvFile(), ".env"];
  let envFile: string | undefined;
  let fileEnvironment: Record<string, string | undefined> = {};
  for (const candidate of envFiles) {
    try {
      fileEnvironment = parseEnv(readFileSync(candidate, "utf8"));
      envFile = candidate;
      break;
    } catch (error) {
      const missing =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT";
      if (!missing || requestedEnvFile) {
        throw error;
      }
    }
  }

  const apiUrlValue =
    options.apiUrl ??
    process.env.WHATSAPP_API_URL ??
    fileEnvironment.WHATSAPP_API_URL ??
    "http://127.0.0.1:3000";
  const secretValue =
    process.env.API_SHARED_SECRET_B64 ??
    fileEnvironment.API_SHARED_SECRET_B64;
  if (!secretValue) {
    throw new Error(
      envFile
        ? `API_SHARED_SECRET_B64 is required in ${envFile}`
        : `API_SHARED_SECRET_B64 is required in the environment or ${envFiles.join(" or ")}`
    );
  }
  const sharedSecret = Buffer.from(secretValue, "base64");
  if (sharedSecret.length !== 32) {
    throw new Error("API shared secret must decode to exactly 32 bytes");
  }
  const apiUrl = new URL(apiUrlValue);
  if (!["http:", "https:"].includes(apiUrl.protocol)) {
    throw new Error("API URL must use http:// or https://");
  }
  apiUrl.pathname = apiUrl.pathname.replace(/\/+$/, "");
  return { apiUrl, sharedSecret: new Uint8Array(sharedSecret) };
}
