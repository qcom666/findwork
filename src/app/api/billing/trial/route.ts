import { startTrial } from "@/lib/autorenew";
import { appBaseUrl, paymentsEnabled } from "@/lib/billing";
import { json, needUser, readJson } from "@/lib/http";
import { allow } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** Пробная неделя за 1 ₽ с автопродлением. Тело: {consent: true} — отдельная отметка согласия на автопродление, без неё не оформляем. */
export async function POST(req: Request) {
  const b = await readJson<{ consent?: boolean }>(req);
  const auth = await needUser();
  if ("error" in auth) return auth.error;
  if (b?.consent !== true) return json({ error: "Отметьте согласие на автопродление" }, 400);
  if (!paymentsEnabled()) return json({ error: "Оплата пока не настроена" }, 503);
  if (!(await allow(`checkout:${auth.user.id}`, 20, 3600))) return json({ error: "Слишком много попыток оплаты, попробуйте позже" }, 429);
  try {
    const r = await startTrial(auth.user, appBaseUrl(req));
    return "error" in r ? json({ error: r.error }, 409) : json({ url: r.url });
  } catch (e) {
    console.error("[billing] trial checkout failed", e);
    return json({ error: "Не удалось создать платёж. Попробуйте ещё раз." }, 502);
  }
}
