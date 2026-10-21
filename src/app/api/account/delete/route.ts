import { deleteAccount } from "@/lib/account-delete";
import { logOut } from "@/lib/auth";
import { appDb } from "@/lib/db";
import { json, needUser, readJson } from "@/lib/http";
import { verifyPassword } from "@/lib/password";
import { allow } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * Удаление своего аккаунта. Тело: {confirm: "удалить", password?}. Аккаунту с почтой нужен пароль,
 * аккаунту Telegram достаточно текущего входа и слова подтверждения.
 */
export async function POST(req: Request) {
  const b = await readJson<{ confirm?: string; password?: string }>(req);
  if (!b) return json({ error: "Некорректный запрос" }, 400);
  const auth = await needUser();
  if ("error" in auth) return auth.error;
  if (!(await allow(`acct-delete:${auth.user.id}`, 5, 3600))) return json({ error: "Слишком много попыток, подождите" }, 429);

  if (String(b.confirm ?? "").trim().toLowerCase() !== "удалить") return json({ error: "Напишите слово «удалить» для подтверждения" }, 400);
  if (auth.user.hasPassword) {
    const row = (await (await appDb()).execute({ sql: "SELECT pass_hash FROM users WHERE id = ?", args: [auth.user.id] })).rows[0];
    if (!row || !(await verifyPassword(String(b.password ?? "").slice(0, 200), String(row.pass_hash)))) return json({ error: "Неверный пароль" }, 403);
  }

  const r = await deleteAccount(auth.user.id);
  if (!r.ok) {
    if (r.reason === "subscription") return json({ error: "У вас действует подписка. Дождитесь её окончания или напишите в поддержку, чтобы вернуть деньги за неиспользованное, и потом удалите аккаунт." }, 409);
    if (r.reason === "admin") return json({ error: "Аккаунт владельца удалить нельзя" }, 409);
    return json({ error: "Аккаунт не найден" }, 404);
  }
  await logOut();
  return json({ ok: true, forfeited: r.forfeited });
}
