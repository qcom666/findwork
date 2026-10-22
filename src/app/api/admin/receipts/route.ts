import { getAdmin } from "@/lib/admin";
import { json, readJson } from "@/lib/http";
import { allow } from "@/lib/ratelimit";
import { setReceipt } from "@/lib/receipts";

export const runtime = "nodejs";

/** Ссылка на чек из «Мой налог» для оплаты (пустая ссылка убирает чек). Для всех, кроме владельца, этой ручки не существует. */
export async function POST(req: Request) {
  const admin = await getAdmin();
  if (!admin) return json({ error: "not found" }, 404);
  const b = await readJson<{ paymentId?: string; url?: string }>(req);
  if (!b || typeof b.paymentId !== "string" || typeof b.url !== "string") return json({ error: "Некорректный запрос" }, 400);
  if (!(await allow(`admin-receipt:${admin.id}`, 300, 3600))) return json({ error: "Слишком часто, подождите" }, 429);
  const r = await setReceipt(b.paymentId, b.url);
  return r.ok ? json({ ok: true }) : json({ error: r.error }, 400);
}
