import { cookies } from "next/headers";
import { cache } from "react";
import { SIGNUP_BONUS } from "./credits";
import { appDb, writeTx } from "./db";
import { hashPassword, newToken, sha256, verifyPassword } from "./password";

const COOKIE = "fw_session";
const SESSION_DAYS = 30;
const now = () => Math.floor(Date.now() / 1000);

export type User = { id: number; email: string; balance: number };

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export function validateCredentials(email: string, password: string): string | null {
  if (!EMAIL_RE.test(email) || email.length > 254) return "Проверьте e-mail";
  if (password.length < 8) return "Пароль должен быть не короче 8 символов";
  if (password.length > 200) return "Пароль слишком длинный";
  return null;
}

async function startSession(userId: number): Promise<void> {
  const db = await appDb();
  const { token, hash } = newToken();
  const t = now();
  await db.execute({
    sql: "INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    args: [hash, userId, t + SESSION_DAYS * 86400, t],
  });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function signUp(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const mail = email.trim().toLowerCase();
  const passHash = await hashPassword(password);
  const t = now();
  const created = await writeTx<number | null>(async (tx) => {
    const dup = await tx.execute({ sql: "SELECT 1 FROM users WHERE email = ?", args: [mail] });
    if (dup.rows.length) return { value: null, rollback: true };
    const ins = await tx.execute({
      sql: "INSERT INTO users(email, pass_hash, balance, created_at) VALUES (?, ?, ?, ?)",
      args: [mail, passHash, SIGNUP_BONUS, t],
    });
    const userId = Number(ins.lastInsertRowid);
    if (SIGNUP_BONUS > 0) {
      await tx.execute({
        sql: "INSERT INTO ledger(user_id, delta, reason, ref, created_at) VALUES (?, ?, 'signup_bonus', NULL, ?)",
        args: [userId, SIGNUP_BONUS, t],
      });
    }
    return { value: userId };
  });
  if (created === null) return { ok: false, error: "Этот e-mail уже зарегистрирован" };
  await startSession(created);
  return { ok: true };
}

// Хэш для несуществующего пользователя: чтобы время ответа не выдавало, есть ли такой e-mail.
const DUMMY = hashPassword("dummy-password-for-timing");

export async function logIn(email: string, password: string): Promise<boolean> {
  const db = await appDb();
  const r = await db.execute({ sql: "SELECT id, pass_hash FROM users WHERE email = ?", args: [email.trim().toLowerCase()] });
  const row = r.rows[0];
  const ok = await verifyPassword(password, row ? String(row.pass_hash) : await DUMMY);
  if (!row || !ok) return false;
  await startSession(Number(row.id));
  return true;
}

export async function logOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const db = await appDb();
    await db.execute({ sql: "DELETE FROM sessions WHERE token_hash = ?", args: [sha256(token)] });
  }
  jar.delete(COOKIE);
}

/** Текущий пользователь или null. Кэшируется на время одного запроса. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const db = await appDb();
    const r = await db.execute({
      sql: `SELECT u.id, u.email, u.balance FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at > ?`,
      args: [sha256(token), now()],
    });
    const row = r.rows[0];
    return row ? { id: Number(row.id), email: String(row.email), balance: Number(row.balance) } : null;
  } catch {
    return null;
  }
});
