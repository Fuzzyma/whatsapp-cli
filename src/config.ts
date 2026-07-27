export interface ClientConfig {
  apiUrl: URL;
  sharedSecret: Uint8Array;
}

export function loadClientConfig(options: {
  apiUrl?: string;
  secret?: string;
}): ClientConfig {
  const apiUrlValue =
    options.apiUrl ?? process.env.WHATSAPP_API_URL ?? "http://127.0.0.1:3000";
  const secretValue =
    options.secret ?? process.env.API_SHARED_SECRET_B64;
  if (!secretValue) {
    throw new Error(
      "API_SHARED_SECRET_B64 is required (or pass --secret with the base64 value)"
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
