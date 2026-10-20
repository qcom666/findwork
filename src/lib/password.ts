import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";

const N = 16384, R = 8, P = 1, KEYLEN = 32;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEYLEN, { N, r: R, p: P }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  if (Number(n) !== N || Number(r) !== R || Number(p) !== P) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256(token) };
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
