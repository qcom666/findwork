import { json, needUser, readJson } from "@/lib/http";
import { REDEEM_MESSAGE, redeemPromo } from "@/lib/promo";
import { allow, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await readJson<{ code?: string }>(req);
  if (!b || typeof b.code !== "string") return json({ error: "Введите промокод" }, 400);
  const auth = await needUser();
  if ("error" in auth) return auth.error;

  // Лимит против подбора кодов: и по человеку, и по адресу.
  const okUser = await allow(`promo:${auth.user.id}`, 10, 3600);
  const okIp = await allow(`promo-ip:${clientIp(req)}`, 30, 3600);
  if (!okUser || !okIp) return json({ error: "Слишком много попыток. Попробуйте через час." }, 429);

  const r = await redeemPromo(auth.user.id, b.code);
  if (!r.ok) return json({ error: REDEEM_MESSAGE[r.reason] }, r.reason === "invalid" ? 404 : 400);
  return json({ ok: true, credits: r.credits, balance: r.balance });
}
