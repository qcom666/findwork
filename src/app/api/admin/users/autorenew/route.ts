import { getAdmin } from "@/lib/admin";
import { cancelAutorenewal } from "@/lib/autorenew";
import { json, readJson } from "@/lib/http";

export const runtime = "nodejs";

/** Отключить автопродление пользователю: {userId}. */
export async function POST(req: Request) {
  const admin = await getAdmin();
  if (!admin) return json({ error: "not found" }, 404);
  const b = await readJson<{ userId?: number }>(req);
  if (!b || !Number.isInteger(b.userId)) return json({ error: "Укажите пользователя" }, 400);
  return (await cancelAutorenewal(Number(b.userId), "admin")) ? json({ ok: true }) : json({ error: "Автопродление уже отключено" }, 404);
}
