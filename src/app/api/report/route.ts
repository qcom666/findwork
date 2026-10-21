import { auditSite } from "@/lib/audit";
import { isUnlocked } from "@/lib/credits";
import { json, needUser, readJson } from "@/lib/http";
import { allow } from "@/lib/ratelimit";
import { cleanProfile, createReport } from "@/lib/reports";
import { getLeadsUnlocked } from "@/lib/search";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Создаёт отчёт о проверке сайта для владельца заведения. Тело: {id, profile, publish: true}.
 * Адрес сайта берём из базы, а не из запроса, а проверку выполняем заново: отчёту нельзя подсунуть выдуманные находки.
 * publish: автор подтвердил, что разрешает показать своё имя и контакты на публичной странице отчёта.
 */
export async function POST(req: Request) {
  const b = await readJson<{ id?: string; profile?: Record<string, unknown>; publish?: boolean }>(req);
  if (!b?.id || typeof b.id !== "string") return json({ error: "Не указан id" }, 400);
  const auth = await needUser();
  if ("error" in auth) return auth.error;
  if (b.publish !== true) return json({ error: "Подтвердите, что разрешаете показать своё имя и контакты на странице отчёта" }, 400);

  if (!(await isUnlocked(auth.user.id, b.id))) return json({ error: "Сначала откройте контакты заведения" }, 403);
  const lead = (await getLeadsUnlocked([b.id]))[0];
  if (!lead) return json({ error: "Заведение не найдено" }, 404);
  if (!lead.website) return json({ error: "У заведения нет сайта для проверки" }, 400);

  const profile = cleanProfile(b.profile);
  if (!profile.name || !profile.contact) return json({ error: "Заполните имя и контакт в профиле: их увидит владелец заведения" }, 400);

  if (!(await allow(`report:${auth.user.id}`, 60, 3600))) return json({ error: "Слишком много отчётов, попробуйте позже" }, 429);
  const audit = await auditSite(lead.website);

  const r = await createReport(auth.user.id, { leadId: lead.id, leadName: lead.name, siteUrl: lead.website, findings: audit.findings, profile });
  if (r.ok) return json({ ok: true, token: r.token, charged: r.charged, balance: r.balance });
  if (r.reason === "insufficient") return json({ error: "Не хватает кредитов для отчёта", needCredits: true, balance: r.balance }, 402);
  return json({ error: r.error }, 400);
}
