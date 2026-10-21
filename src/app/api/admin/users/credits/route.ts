import { adjustCredits, getAdmin } from "@/lib/admin";
import { json, readJson } from "@/lib/http";
import { allow } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await getAdmin();
  if (!admin) return json({ error: "not found" }, 404);
  const b = await readJson<{ userId?: number; delta?: number; note?: string }>(req);
  if (!b || !Number.isInteger(b.userId)) return json({ error: "Не указан пользователь" }, 400);
  if (!(await allow(`admin-credits:${admin.id}`, 120, 3600))) return json({ error: "Слишком часто, подождите" }, 429);
  const r = await adjustCredits(Number(b.userId), Number(b.delta), String(b.note ?? ""));
  return r.ok ? json({ ok: true, balance: r.balance }) : json({ error: r.error }, 400);
}
