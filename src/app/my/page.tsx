import Link from "next/link";
import { redirect } from "next/navigation";
import { BatchPitch } from "@/components/BatchPitch";
import { RowPitch } from "@/components/RowPitch";
import { ScoreRing } from "@/components/ScoreRing";
import { getCurrentUser } from "@/lib/auth";
import { countByStatus, getCrm, isStatus, listUnlockedIdsByStatus, STATUS_LABEL, STATUSES, type StatusId } from "@/lib/crm";
import { SITE_LABEL, formatPhone, plural } from "@/lib/format";
import { getPitches } from "@/lib/pitch-store";
import { SERVICE_IDS, getLabels, getLeadsUnlocked } from "@/lib/search";

export const metadata = { title: "Мои лиды", robots: { index: false, follow: false } };

const LIMIT = 100;
const TONE: Record<string, string> = {
  new: "bg-surface-2 text-muted",
  contacted: "bg-accent-soft text-accent",
  replied: "bg-warn-soft text-warn",
  won: "bg-good-soft text-good",
  lost: "bg-bad-soft text-bad",
};

export default async function MyLeads({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/my");

  const raw = (await searchParams).status;
  const status: StatusId | "" = isStatus(raw) ? raw : "";

  const [counts, ids, labels] = await Promise.all([countByStatus(user.id), listUnlockedIdsByStatus(user.id, status, LIMIT), getLabels()]);
  const [leads, crm, pitches] = await Promise.all([getLeadsUnlocked(ids), getCrm(user.id, ids), getPitches(user.id, ids)]);
  const services = SERVICE_IDS.map((id) => ({ id, label: labels.services[id] ?? id }));
  // Пакетно пишем тем, у кого ещё нет питча и кому мы пока не писали.
  const eligible = leads.filter((l) => !pitches.has(l.id) && (crm.get(l.id)?.status ?? "new") === "new").map((l) => l.id);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const shown = status ? (counts[status] ?? 0) : total;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Мои лиды</h1>
          <p className="text-sm text-muted">
            Открыто {total} {plural(total, "заведение", "заведения", "заведений")}.
            {shown > LIMIT ? ` Показаны последние ${LIMIT}, в CSV попадут все (до 5 000).` : ""}
          </p>
        </div>
        {total > 0 && <a href="/api/export" className="btn btn-ghost btn-sm">Скачать CSV</a>}
      </div>

      {total > 0 && (
        <div className="scroll-x -mx-4 flex gap-2 px-4 pb-1">
          <Link href="/my" className="chip" aria-current={!status ? "true" : undefined}>
            Все <span className="count">{total}</span>
          </Link>
          {STATUSES.map((s) => (
            <Link key={s.id} href={`/my?status=${s.id}`} className="chip" aria-current={status === s.id ? "true" : undefined}>
              {s.label} <span className="count">{counts[s.id] ?? 0}</span>
            </Link>
          ))}
        </div>
      )}

      {leads.length > 0 && <BatchPitch eligible={eligible} services={services} />}

      {leads.length === 0 ? (
        <div className="card border-dashed p-10 text-center text-muted">
          {total === 0 ? (
            <>Пока пусто. <Link href="/leads" className="text-accent hover:underline">Найдите лиды</Link> и откройте контакты.</>
          ) : (
            <>На этом этапе лидов нет.</>
          )}
        </div>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {leads.map((l) => {
            const c = crm.get(l.id);
            const st = c?.status ?? "new";
            return (
              <li key={l.id} className="grid gap-x-6 gap-y-2 px-4 py-4 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.6fr)]">
                <span className="flex min-w-0 items-start gap-3">
                  <ScoreRing score={l.score} size="2.5rem" />
                  <span className="min-w-0">
                    <Link href={`/lead/${encodeURIComponent(l.id)}`} className="block truncate font-semibold hover:text-accent">{l.name}</Link>
                    <span className="block truncate text-muted">{labels.niches[l.niche] ?? l.niche}{l.city ? ` · ${l.city}` : ""}</span>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[st]}`}>{STATUS_LABEL[st]}</span>
                  </span>
                </span>
                <span className="min-w-0">
                  {l.phone ? <a href={`tel:${l.phone}`} className="block text-accent hover:underline">{formatPhone(l.phone)}</a> : <span className="block text-muted">нет телефона</span>}
                  {l.email && <a href={`mailto:${l.email}`} className="block truncate text-accent hover:underline">{l.email}</a>}
                </span>
                <span className="min-w-0 text-muted">
                  {l.website ? <a href={l.website} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-accent hover:underline">{l.website.replace(/^https?:\/\/(www\.)?/, "")}</a> : SITE_LABEL[l.siteKind]}
                  {c?.note && <span className="mt-1 block truncate italic">{c.note}</span>}
                </span>
                {pitches.get(l.id) && (
                  <RowPitch
                    leadId={l.id} status={st} channel={pitches.get(l.id)!.channel} subject={pitches.get(l.id)!.subject}
                    message={pitches.get(l.id)!.message} serviceLabel={labels.services[pitches.get(l.id)!.service] ?? pitches.get(l.id)!.service}
                    source={pitches.get(l.id)!.source} phones={l.phones} email={l.email}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
