import type { AuditResult } from "@/lib/audit";
import { isUnlocked } from "@/lib/credits";
import { json, needUser, readJson } from "@/lib/http";
import { makePitch, type Channel, type Profile } from "@/lib/pitch";
import { savePitch } from "@/lib/pitch-store";
import { allow } from "@/lib/ratelimit";
import { getLabels, getLeadsUnlocked } from "@/lib/search";

export const runtime = "nodejs";
export const maxDuration = 60;

const CHANNELS: Channel[] = ["telegram", "whatsapp", "email", "call"];
const cut = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export async function POST(req: Request) {
  const b = await readJson<{
    id?: string; service?: string; channel?: string; profile?: Partial<Profile>; audit?: AuditResult | null;
  }>(req);
  if (!b?.id || typeof b.id !== "string" || !b.service) return json({ error: "Не хватает данных" }, 400);
  const auth = await needUser();
  if ("error" in auth) return auth.error;

  if (!(await isUnlocked(auth.user.id, b.id))) return json({ error: "Сначала откройте контакты заведения" }, 403);
  const lead = (await getLeadsUnlocked([b.id]))[0];
  if (!lead) return json({ error: "Заведение не найдено" }, 404);

  const limit = parseInt(process.env.PITCH_HOURLY_LIMIT ?? "60", 10) || 60;
  if (!(await allow(`pitch:${auth.user.id}`, limit, 3600))) return json({ error: `Лимит ${limit} питчей в час. Попробуйте позже.` }, 429);

  const labels = await getLabels();
  const serviceLabel = labels.services[b.service];
  if (!serviceLabel) return json({ error: "Неизвестная услуга" }, 400);

  const channel = CHANNELS.includes(b.channel as Channel) ? (b.channel as Channel) : "telegram";
  const profile: Profile = {
    name: cut(b.profile?.name, 60),
    skills: cut(b.profile?.skills, 200),
    portfolio: cut(b.profile?.portfolio, 200),
    priceFrom: cut(b.profile?.priceFrom, 40),
  };
  // Аудит приходит от клиента и идёт только в промпт как справка; берём из него лишь текстовые находки.
  const audit: AuditResult | null =
    b.audit && Array.isArray(b.audit.findings)
      ? {
          url: lead.website ?? "",
          reachable: !!b.audit.reachable,
          findings: b.audit.findings.slice(0, 12).map((f) => ({
            level: (["bad", "warn", "ok", "info"] as const).includes(f.level) ? f.level : "info",
            text: cut(f.text, 200),
          })),
        }
      : null;

  const out = await makePitch({
    lead, nicheLabel: labels.niches[lead.niche] ?? lead.niche, serviceLabel, channel, profile, audit,
  });
  await savePitch(auth.user.id, lead.id, { service: b.service, channel, ...out.pitch, source: out.source });
  return json(out);
}
