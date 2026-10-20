import { auditSite, type AuditResult } from "@/lib/audit";
import { isUnlocked } from "@/lib/credits";
import { json, needUser, readJson } from "@/lib/http";
import { allow } from "@/lib/ratelimit";
import { getLeadsUnlocked } from "@/lib/search";

export const runtime = "nodejs";
export const maxDuration = 30;

const cache = new Map<string, { at: number; result: AuditResult }>();

export async function POST(req: Request) {
  const body = await readJson<{ id?: string }>(req);
  if (!body?.id || typeof body.id !== "string") return json({ error: "Не указан id" }, 400);
  const auth = await needUser();
  if ("error" in auth) return auth.error;

  if (!(await isUnlocked(auth.user.id, body.id))) return json({ error: "Сначала откройте контакты заведения" }, 403);

  // Адрес берём только из базы, а не из запроса: так сервис нельзя использовать как прокси к чужим адресам.
  const lead = (await getLeadsUnlocked([body.id]))[0];
  if (!lead) return json({ error: "Заведение не найдено" }, 404);
  if (!lead.website) return json({ error: "У заведения нет сайта для проверки" }, 400);

  const hit = cache.get(lead.id);
  if (hit && Date.now() - hit.at < 3_600_000) return json(hit.result);

  if (!(await allow(`audit:${auth.user.id}`, 60, 3600))) return json({ error: "Слишком много проверок, попробуйте позже" }, 429);

  const result = await auditSite(lead.website);
  cache.set(lead.id, { at: Date.now(), result });
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  return json(result);
}
