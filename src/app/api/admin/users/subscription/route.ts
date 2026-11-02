import { getAdmin, giftSubscription, revokeGifts } from "@/lib/admin";
import { json, readJson } from "@/lib/http";
import { allow } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** Подписка в подарок: {who, planId, months}, где who — e-mail, @username или №; снять подаренные: {userId, revoke: true}. */
export async function POST(req: Request) {
  const admin = await getAdmin();
  if (!admin) return json({ error: "not found" }, 404);
  const b = await readJson<{ who?: string; planId?: string; months?: number; userId?: number; revoke?: boolean }>(req);
  if (!b) return json({ error: "Укажите пользователя" }, 400);
  if (!(await allow(`admin-sub:${admin.id}`, 60, 3600))) return json({ error: "Слишком часто, подождите" }, 429);

  if (b.revoke === true) {
    if (!Number.isInteger(b.userId)) return json({ error: "Укажите пользователя" }, 400);
    const r = await revokeGifts(Number(b.userId));
    return r.ok ? json({ ok: true, revoked: r.revoked }) : json({ error: r.error }, 400);
  }
  if (typeof b.who !== "string" || typeof b.planId !== "string") return json({ error: "Укажите пользователя и тариф" }, 400);
  const r = await giftSubscription(b.who, b.planId, Number(b.months));
  return r.ok ? json(r) : json({ error: r.error }, 400);
}
