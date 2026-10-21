import { claimLead, releaseClaim } from "@/lib/claims";
import { json, needUser, readJson } from "@/lib/http";
import { EXCLUSIVE_COST } from "@/lib/plans";
import { allow } from "@/lib/ratelimit";

export const runtime = "nodejs";

const date = (s: number) => new Date(s * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

/** Взять заведение в эксклюзив (тело {id}) или отпустить раньше срока ({id, release: true}). */
export async function POST(req: Request) {
  const b = await readJson<{ id?: string; release?: boolean }>(req);
  if (!b?.id || typeof b.id !== "string" || b.id.length > 80) return json({ error: "Не указан id" }, 400);
  const auth = await needUser();
  if ("error" in auth) return auth.error;
  if (!(await allow(`exclusive:${auth.user.id}`, 60, 3600))) return json({ error: "Слишком часто, подождите" }, 429);

  if (b.release) return (await releaseClaim(auth.user.id, b.id)) ? json({ ok: true }) : json({ error: "Эксклюзива нет" }, 404);

  const r = await claimLead(auth.user.id, b.id);
  if (r.ok) return json({ ok: true, until: r.until, balance: r.balance });
  switch (r.reason) {
    case "no_plan": return json({ error: "Эксклюзив доступен по подписке", needPlan: true }, 403);
    case "not_opened": return json({ error: "Сначала откройте контакты заведения" }, 400);
    case "mine": return json({ error: `Заведение уже в вашем эксклюзиве до ${date(r.until)}` }, 409);
    case "taken": return json({ error: `Заведение уже в эксклюзиве у другого пользователя до ${date(r.until)}` }, 409);
    case "no_slots": return json({ error: `Заняты все ${r.slots} мест эксклюзива по вашему тарифу. Отпустите одно или дождитесь окончания срока.` }, 409);
    case "insufficient": return json({ error: `Не хватает кредитов: эксклюзив стоит ${EXCLUSIVE_COST}`, needCredits: true, balance: r.balance }, 402);
  }
}
