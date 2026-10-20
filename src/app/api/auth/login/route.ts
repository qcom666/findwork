import { logIn } from "@/lib/auth";
import { json, readJson } from "@/lib/http";
import { allow, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await readJson<{ email?: string; password?: string }>(req);
  if (!b) return json({ error: "Некорректный запрос" }, 400);
  const email = String(b.email ?? "").trim().toLowerCase();
  const password = String(b.password ?? "").slice(0, 200);

  // Лимит и по адресу, и по e-mail: так перебор пароля не обойти сменой IP.
  const okIp = await allow(`login-ip:${clientIp(req)}`, 30, 900);
  const okMail = await allow(`login-mail:${email}`, 10, 900);
  if (!okIp || !okMail) return json({ error: "Слишком много попыток входа. Подождите 15 минут." }, 429);

  return (await logIn(email, password)) ? json({ ok: true }) : json({ error: "Неверный e-mail или пароль" }, 401);
}
