import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
const valid = (t: string) => /^access-sandbox-[a-zA-Z0-9_-]{1,250}$/.test(t);
export function sealPlaid(token: string, key: string, context: string) {
  if (!/^[a-f0-9]{64}$/i.test(key) || !valid(token))
    throw Error("Invalid Sandbox vault configuration");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(Buffer.from(context));
  const bytes = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes]
    .map((v) => v.toString("base64url"))
    .join(".");
}
export function openPlaid(value: string, key: string, context: string) {
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw Error("Invalid Sandbox vault configuration");
  const parts = value.split(".");
  if (parts.length !== 3) throw Error("Invalid bank token record");
  const [iv, tag, bytes] = parts.map((v) => Buffer.from(v, "base64url"));
  if (iv.length !== 12 || tag.length !== 16)
    throw Error("Invalid bank token record");
  const cipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(tag);
  const token = Buffer.concat([cipher.update(bytes), cipher.final()]).toString(
    "utf8",
  );
  if (!valid(token)) throw Error("Invalid Sandbox bank token");
  return token;
}
export const plaidContext = (org: string, id: string) =>
  `plaid:sandbox:v1:${org}:${id}`;
