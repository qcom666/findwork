import { getCurrentUser } from "@/lib/auth";
import { json, readJson } from "@/lib/http";
import { allow, clientIp } from "@/lib/ratelimit";
import { createLoginRequest } from "@/lib/tg-login";
import { botConfigured } from "@/lib/telegram-bot";

export const runtime = "nodejs";

/** Начинает вход или привязку через бота: отдаёт ссылку на бота с одноразовым секретом. Тело: {mode: "login" | "link"}. */
export async function POST(req: Request) {
  const b = await readJson<{ mode?: string }>(req);
  if (!b) return json({ error: "Некорректный запрос" }, 400);
  if (!botConfigured()) return json({ error: "Вход через Telegram пока не настроен" }, 503);
  const ip = clientIp(req);
  if (!(await allow(`tgbot-start:${ip}`, 10, 900))) return json({ error: "Слишком много попыток, подождите 15 минут" }, 429);

  const mode = b.mode === "link" ? "link" : "login";
  const user = mode === "link" ? await getCurrentUser() : null;
  if (mode === "link" && !user) return json({ error: "Войдите в аккаунт" }, 401);

  const r = await createLoginRequest({ mode, userId: user?.id, ip, ua: req.headers.get("user-agent") ?? "" });
  return json({ token: r.token, url: r.url, ttl: r.ttl });
}
