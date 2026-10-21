import { getAdmin } from "@/lib/admin";
import { json, readJson } from "@/lib/http";
import { createPromo, createPromoBatch } from "@/lib/promo";
import { allow } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** Создание промокодов (один или пачка). Для всех, кроме владельца, этой ручки не существует. */
export async function POST(req: Request) {
  const admin = await getAdmin();
  if (!admin) return json({ error: "not found" }, 404);
  const b = await readJson<{ code?: string; credits?: number; maxUses?: number | null; days?: number | null; note?: string; count?: number; prefix?: string }>(req);
  if (!b) return json({ error: "Некорректный запрос" }, 400);
  if (!(await allow(`admin-promo:${admin.id}`, 60, 3600))) return json({ error: "Слишком часто, подождите" }, 429);

  const common = { credits: Number(b.credits), maxUses: b.maxUses ?? null, days: b.days ?? null, note: b.note, prefix: b.prefix };
  const count = Number(b.count ?? 1);
  if (count > 1) {
    const r = await createPromoBatch({ ...common, count });
    return r.ok ? json({ ok: true, codes: r.codes }) : json({ error: r.error }, 400);
  }
  const r = await createPromo({ ...common, code: b.code });
  return r.ok ? json({ ok: true, codes: [r.code] }) : json({ error: r.error }, 400);
}
