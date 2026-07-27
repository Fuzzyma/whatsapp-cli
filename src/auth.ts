import { SignJWT } from "jose";

export async function createAccessToken(secret: Uint8Array): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("whatsapp-api-client")
    .setAudience("whatsapp-api")
    .setSubject("trusted-client")
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + 30)
    .sign(secret);
}
