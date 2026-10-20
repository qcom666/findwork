import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { countUnlocked, listUnlockedIds } from "@/lib/credits";
import { SITE_LABEL, formatPhone, plural } from "@/lib/format";
import { getLabels, getLeadsUnlocked } from "@/lib/search";

export const metadata = { title: "Мои лиды — FindWork" };

const LIMIT = 100;

export default async function MyLeads() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/my");

  const [total, ids, labels] = await Promise.all([countUnlocked(user.id), listUnlockedIds(user.id, LIMIT), getLabels()]);
  const leads = await getLeadsUnlocked(ids);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Мои лиды</h1>
          <p className="text-sm text-muted">
            Открыто {total} {plural(total, "заведение", "заведения", "заведений")}.
            {total > LIMIT ? ` Показаны последние ${LIMIT}, в CSV попадут все (до 5 000).` : ""}
          </p>
        </div>
        {total > 0 && (
          <a href="/api/export" className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:border-accent">Скачать CSV</a>
        )}
      </div>

      {leads.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-10 text-center text-muted">
          Пока пусто. <Link href="/" className="text-accent hover:underline">Найдите лиды</Link> и откройте контакты.
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {leads.map((l) => (
            <li key={l.id} className="grid gap-x-6 gap-y-1 px-4 py-3 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.6fr)]">
              <span className="min-w-0">
                <Link href={`/lead/${encodeURIComponent(l.id)}`} className="block truncate font-medium hover:text-accent">{l.name}</Link>
                <span className="block truncate text-muted">{labels.niches[l.niche] ?? l.niche}{l.city ? ` · ${l.city}` : ""}</span>
              </span>
              <span className="min-w-0">
                {l.phone ? <a href={`tel:${l.phone}`} className="block text-accent hover:underline">{formatPhone(l.phone)}</a> : <span className="block text-muted">нет телефона</span>}
                {l.email && <a href={`mailto:${l.email}`} className="block truncate text-accent hover:underline">{l.email}</a>}
              </span>
              <span className="min-w-0 text-muted">
                {l.website ? <a href={l.website} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-accent hover:underline">{l.website.replace(/^https?:\/\/(www\.)?/, "")}</a> : SITE_LABEL[l.siteKind]}
                <span className="block">Оценка {l.score}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
