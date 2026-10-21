import { adjustCredits, adjustCreditsByEmail, getAdmin } from "@/lib/admin";
import { json, readJson } from "@/lib/http";
import { allow } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = await getAdmin();
  if (!admin) return json({ error: "not found" }, 404);
  const b = await readJson<{ userId?: number; email?: string; delta?: number; note?: string }>(req);
  if (!b || (!Number.isInteger(b.userId) && typeof b.email !== "string")) return json({ error: "Укажите пользователя" }, 400);
  if (!(await allow(`admin-credits:${admin.id}`, 120, 3600))) return json({ error: "Слишком часто, подождите" }, 429);
  const note = String(b.note ?? "");
  const r = typeof b.email === "string" && b.email.trim()
    ? await adjustCreditsByEmail(b.email, Number(b.delta), note)
    : await adjustCredits(Number(b.userId), Number(b.delta), note);
  return r.ok ? json({ ok: true, balance: r.balance }) : json({ error: r.error }, 400);
}
