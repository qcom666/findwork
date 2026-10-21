import { unlinkTelegram } from "@/lib/account-link";
import { json, needUser, readJson } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await readJson<Record<string, never>>(req);
  if (!b) return json({ error: "Некорректный запрос" }, 400);
  const auth = await needUser();
  if ("error" in auth) return auth.error;
  const r = await unlinkTelegram(auth.user.id);
  if (r.ok) return json({ ok: true });
  return r.reason === "no_password"
    ? json({ error: "Telegram — единственный способ входа в этот аккаунт, отвязать его нельзя" }, 409)
    : json({ error: "Telegram не привязан" }, 404);
}
