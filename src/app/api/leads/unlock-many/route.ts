import { unlockMany } from "@/lib/credits";
import { json, needUser, readJson } from "@/lib/http";
import { allow } from "@/lib/ratelimit";
import { existingIds } from "@/lib/search";

export const runtime = "nodejs";

const MAX = 50;

export async function POST(req: Request) {
  const b = await readJson<{ ids?: unknown }>(req);
  if (!Array.isArray(b?.ids) || b.ids.length === 0 || b.ids.length > MAX || !b.ids.every((x) => typeof x === "string" && x.length < 80)) {
    return json({ error: `Передайте от 1 до ${MAX} заведений` }, 400);
  }
  const auth = await needUser();
  if ("error" in auth) return auth.error;
  if (!(await allow(`unlock-many:${auth.user.id}`, 60, 3600))) return json({ error: "Слишком часто, подождите" }, 429);

  // Открываем только то, что есть в каталоге: чужие или выдуманные id не попадут в список открытых.
  const ids = await existingIds(b.ids as string[]);
  if (!ids.length) return json({ error: "Заведения не найдены" }, 404);

  const r = await unlockMany(auth.user.id, ids);
  if (!r.ok) return json({ error: "Не хватает кредитов", need: r.need, balance: r.balance, needCredits: true }, 402);
  return json({ ok: true, opened: r.opened, charged: r.charged, balance: r.balance, skipped: r.skipped ?? 0 });
}
