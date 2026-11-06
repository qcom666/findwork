import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExclusiveBox } from "@/components/ExclusiveBox";
import { LeadCrm } from "@/components/LeadCrm";
import { LeadTools } from "@/components/LeadTools";
import { ScoreRing } from "@/components/ScoreRing";
import { UnlockPanel } from "@/components/UnlockPanel";
import { getCurrentUser } from "@/lib/auth";
import { activeClaimCount, getClaimInfo } from "@/lib/claims";
import { SIGNUP_BONUS, UNLOCK_COST } from "@/lib/credits";
import { getCrm, STATUSES } from "@/lib/crm";
import { dbReady } from "@/lib/db";
import { getEntitlements } from "@/lib/entitlements";
import { SITE_LABEL, formatPhone, reasons, sourceLabel } from "@/lib/format";
import { getPitches } from "@/lib/pitch-store";
import { EXCLUSIVE_COST, EXCLUSIVE_DAYS } from "@/lib/plans";
import { listReports, reportQuota } from "@/lib/reports";
import { getLabels, getLead } from "@/lib/search";

const DOT = { good: "bg-good", warn: "bg-warn", muted: "bg-muted/50" } as const;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  if (!(await dbReady())) return { title: "Заведение" };
  const lead = await getLead(decodeURIComponent((await params).id));
  // Карточки заведений в поиск не отдаём: это справочные данные, а не страницы для выдачи.
  return { title: lead?.name ?? "Заведение", robots: { index: false, follow: false } };
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await dbReady())) notFound();
  const { id } = await params;
  const user = await getCurrentUser();
  const lead = await getLead(decodeURIComponent(id), user?.id);
  if (!lead) notFound();

  const open = !!user && lead.unlocked;
  const [labels, crm, pitches, claim, ent, slotsUsed, reports, quota] = await Promise.all([
    getLabels(),
    open ? getCrm(user.id, [lead.id]) : Promise.resolve(null),
    open ? getPitches(user.id, [lead.id]) : Promise.resolve(null),
    open ? getClaimInfo(user.id, lead.id) : Promise.resolve(null),
    open ? getEntitlements(user.id) : Promise.resolve(null),
    open ? activeClaimCount(user.id) : Promise.resolve(0),
    open ? listReports(user.id, lead.id) : Promise.resolve([]),
    open ? reportQuota(user.id) : Promise.resolve(null),
  ]);
  const savedPitch = pitches?.get(lead.id) ?? null;
  const services = lead.services.map((s) => ({ id: s, label: labels.services[s] ?? s }));
  const mapQuery = encodeURIComponent(`${lead.name} ${lead.city ?? ""}`.trim());
  const lock = <span className="text-muted" title="Откроется за кредит" aria-label="скрыто">🔒 </span>;
  const mine = crm?.get(lead.id);

  return (
    <div className="space-y-5">
      <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">← К каталогу</Link>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-5">
          <section className="card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-tight">{lead.name}</h1>
                <p className="mt-1 text-sm text-muted">
                  {labels.niches[lead.niche] ?? lead.niche}{lead.city ? ` · ${lead.city}` : ""}
                </p>
                {lead.address && <p className="text-sm text-muted">{lead.address}</p>}
              </div>
              <div className="shrink-0 text-center">
                <ScoreRing score={lead.score} size="3.75rem" />
                <p className="mt-1 text-xs text-muted">оценка</p>
              </div>
            </div>

            <dl className="mt-5 space-y-3 text-sm">
              <Row label="Сайт">
                {lead.unlocked ? (
                  lead.website ? (
                    <a href={lead.website} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent hover:underline">
                      {lead.website}
                    </a>
                  ) : (
                    <span>{SITE_LABEL[lead.siteKind]}</span>
                  )
                ) : lead.has.website ? (
                  <span>{lock}есть, адрес скрыт</span>
                ) : (
                  <span>{SITE_LABEL[lead.siteKind]}</span>
                )}
              </Row>
              <Row label="Телефон">
                {lead.unlocked ? (
                  lead.phones.length ? (
                    <span className="flex flex-col">
                      {lead.phones.map((p) => (
                        <a key={p} href={`tel:${p}`} className="text-accent hover:underline">{formatPhone(p)}</a>
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted">нет</span>
                  )
                ) : lead.preview.phone ? (
                  <span>{lock}{lead.preview.phone}</span>
                ) : (
                  <span className="text-muted">нет</span>
                )}
              </Row>
              <Row label="E-mail">
                {lead.unlocked ? (
                  lead.email ? <a href={`mailto:${lead.email}`} className="break-all text-accent hover:underline">{lead.email}</a> : <span className="text-muted">нет</span>
                ) : lead.preview.email ? (
                  <span>{lock}{lead.preview.email}</span>
                ) : (
                  <span className="text-muted">нет</span>
                )}
              </Row>
              <Row label="Соцсети">
                {lead.unlocked ? (
                  lead.socials.length ? (
                    <span className="flex flex-col">
                      {lead.socials.map((s) => (
                        <a key={s} href={s} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent hover:underline">{s.replace(/^https?:\/\/(www\.)?/, "")}</a>
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted">нет</span>
                  )
                ) : lead.preview.socials.length ? (
                  <span>{lock}{lead.preview.socials.join(", ")}</span>
                ) : (
                  <span className="text-muted">нет</span>
                )}
              </Row>
              <Row label="Источник">
                <span className="text-muted">{lead.sources.map(sourceLabel).join(", ")}</span>
              </Row>
            </dl>

            <div className="mt-5 flex flex-wrap gap-2">
              <a href={`https://yandex.ru/maps/?text=${mapQuery}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                Проверить на Яндекс Картах
              </a>
              {lead.lat != null && lead.lon != null && (
                <a href={`https://www.openstreetmap.org/?mlat=${lead.lat}&mlon=${lead.lon}#map=18/${lead.lat}/${lead.lon}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                  На карте OSM
                </a>
              )}
            </div>
            {(lead.siteKind === "none" || lead.siteKind === "social") && (
              <p className="mt-3 text-xs text-muted">
                «Сайт не найден» означает, что ссылки на сайт нет в открытых данных, в почте и у других записей этого заведения. Перед обращением проверьте на карте и в поиске.
              </p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold">Почему этот лид</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {reasons(lead).map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[r.tone]}`} />
                  <span>{r.text}</span>
                </li>
              ))}
            </ul>
            <h2 className="mt-5 text-sm font-semibold">Что можно предложить</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {services.map((s) => (
                <Link key={s.id} href={`/leads?service=${s.id}`} className="rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-accent hover:brightness-95">{s.label}</Link>
              ))}
            </div>
          </section>

          {lead.unlocked && (
            <LeadCrm leadId={lead.id} statuses={[...STATUSES]} status={mine?.status ?? "new"} note={mine?.note ?? ""} />
          )}

          {user && lead.unlocked && claim && ent && (
            <ExclusiveBox
              leadId={lead.id}
              v={{
                ...claim,
                slots: ent.planId && ent.exclusiveSlots > 0 ? { used: slotsUsed, total: ent.exclusiveSlots } : null,
                planTitle: ent.planTitle, cost: EXCLUSIVE_COST, days: EXCLUSIVE_DAYS, balance: user.balance,
              }}
            />
          )}
        </div>

        {lead.unlocked && quota ? (
          <LeadTools
            leadId={lead.id} hasWebsite={lead.has.website} services={services} phones={lead.phones} email={lead.email} saved={savedPitch}
            reports={reports} quota={{ included: quota.included, left: quota.left, cost: quota.cost, planTitle: quota.planTitle }} balance={user?.balance ?? 0}
          />
        ) : lead.claimedUntil ? (
          <section className="card !border-warn p-5">
            <h2 className="text-sm font-semibold">Заведение в эксклюзиве</h2>
            <p className="mt-1 text-sm text-muted">
              Другой пользователь взял это заведение в эксклюзив до {new Date(lead.claimedUntil * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}.
              Открыть контакты можно будет после окончания срока. Пока посмотрите <Link href="/leads" className="text-accent hover:underline">другие заведения</Link>.
            </p>
          </section>
        ) : (
          <UnlockPanel leadId={lead.id} loggedIn={!!user} balance={user?.balance ?? 0} cost={UNLOCK_COST} bonus={SIGNUP_BONUS} />
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
