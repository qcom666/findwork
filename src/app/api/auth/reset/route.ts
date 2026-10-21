import { startSession } from "@/lib/auth";
import { json, readJson } from "@/lib/http";
import { allow, clientIp } from "@/lib/ratelimit";
import { resetPassword } from "@/lib/reset";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await readJson<{ token?: string; password?: string }>(req);
  if (!b || typeof b.token !== "string" || typeof b.password !== "string") return json({ error: "Некорректный запрос" }, 400);
  if (!(await allow(`reset-ip:${clientIp(req)}`, 20, 900))) return json({ error: "Слишком много попыток. Подождите 15 минут." }, 429);

  const r = await resetPassword(b.token.slice(0, 200), b.password);
  if (!r.ok) return json({ error: r.error }, 400);
  await startSession(r.userId); // после смены пароля сразу входим
  return json({ ok: true });
}
