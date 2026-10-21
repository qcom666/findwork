import { getCurrentUser } from "@/lib/auth";
import { json, readJson } from "@/lib/http";
import { isAdminEmail } from "@/lib/metrics";
import { createPromo } from "@/lib/promo";

export const runtime = "nodejs";

/** Создание промокода. Для всех, кроме владельца, этой ручки не существует. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) return json({ error: "not found" }, 404);
  const b = await readJson<{ code?: string; credits?: number; maxUses?: number | null; days?: number | null; note?: string }>(req);
  if (!b) return json({ error: "Некорректный запрос" }, 400);
  const r = await createPromo({ code: b.code, credits: Number(b.credits), maxUses: b.maxUses ?? null, days: b.days ?? null, note: b.note });
  return r.ok ? json({ ok: true, code: r.code }) : json({ error: r.error }, 400);
}
