import Link from "next/link";
import { ScoreRing } from "@/components/ScoreRing";
import { SITE_LABEL } from "@/lib/format";
import type { Lead } from "@/lib/search";

const SITE_TONE = {
  none: "bg-good-soft text-good",
  social: "bg-good-soft text-good",
  builder: "bg-warn-soft text-warn",
  real: "bg-surface-2 text-muted",
} as const;

/** Строка заведения в списках: каталог, страницы городов и ниш. Контакты здесь не показываются никогда. */
export function LeadRow({ l, niche }: { l: Lead; niche: string }) {
  return (
    <li>
      <Link
        href={`/lead/${encodeURIComponent(l.id)}`}
        className="grid grid-cols-[2.75rem_1fr] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-surface-2 sm:grid-cols-[2.75rem_1fr_11.5rem_12rem]"
      >
        <ScoreRing score={l.score} />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{l.name}</span>
          <span className="block truncate text-sm text-muted">
            {niche}{l.city ? ` · ${l.city}` : ""}{l.address ? ` · ${l.address}` : ""}
          </span>
        </span>
        <span className="col-start-2 sm:col-start-auto">
          <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${SITE_TONE[l.siteKind]}`}>{SITE_LABEL[l.siteKind]}</span>
        </span>
        <span className="col-start-2 flex flex-wrap items-center gap-1.5 text-xs sm:col-start-auto sm:justify-end">
          <Mark on={l.has.phone}>тел</Mark>
          <Mark on={l.has.email}>e-mail</Mark>
          <Mark on={l.has.social}>соцсети</Mark>
          {l.unlocked && <span className="whitespace-nowrap rounded-md bg-accent-soft px-1.5 py-0.5 font-medium text-accent">открыт</span>}
          {l.claimedUntil && <span className="whitespace-nowrap rounded-md bg-warn-soft px-1.5 py-0.5 font-medium text-warn" title="Другой пользователь взял заведение в эксклюзив">эксклюзив</span>}
        </span>
      </Link>
    </li>
  );
}

function Mark({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span className={`whitespace-nowrap rounded-md border px-1.5 py-0.5 ${on ? "border-line" : "border-transparent text-muted/50 line-through"}`}>
      {children}
    </span>
  );
}
