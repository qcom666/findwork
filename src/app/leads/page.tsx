import Link from "next/link";
import type { Metadata } from "next";
import { FilterForm } from "@/components/FilterForm";
import { ScoreRing } from "@/components/ScoreRing";
import { getCurrentUser } from "@/lib/auth";
import { SIGNUP_BONUS } from "@/lib/credits";
import { dbReady } from "@/lib/db";
import { SERVICE_SHORT, SITE_LABEL, plural } from "@/lib/format";
import {
  MIN_SCORES, PAGE_SIZE, SERVICE_IDS, getCities, getLabels, getNiches, parseParams, searchLeads, toQuery, type Lead, type Params,
} from "@/lib/search";

export const metadata: Metadata = {
  title: "Каталог лидов",
  description: "Заведения России без сайта: фильтры по городу, нише и услуге, оценка лида и проверка сайта.",
};

type SP = Promise<Record<string, string | string[] | undefined>>;

const SITE_TONE = {
  none: "bg-good-soft text-good",
  social: "bg-good-soft text-good",
  builder: "bg-warn-soft text-warn",
  real: "bg-surface-2 text-muted",
} as const;

export default async function Leads({ searchParams }: { searchParams: SP }) {
  if (!(await dbReady())) return <NoDb />;

  const p = parseParams(await searchParams);
  const user = await getCurrentUser();
  const [{ leads, total }, cities, niches, labels] = await Promise.all([
    searchLeads(p, user?.id),
    getCities(250),
    getNiches(),
    getLabels(),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (patch: Partial<Params>) => `/leads?${toQuery({ ...p, ...patch, page: 1 })}`;
  const filtered = !!(p.city || p.niche || p.service || p.q || p.minScore || p.phone || p.email || p.social || p.chains || p.site !== "need" || p.sort !== "score");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Каталог лидов</h1>
          <p className="mt-1 text-muted">Выберите, что вы делаете, и нишу. Оценка и причины видны бесплатно, контакты открываются за кредит.</p>
        </div>
        {!user && (
          <Link href="/signup" className="btn btn-primary btn-sm">
            {SIGNUP_BONUS > 0 ? `${SIGNUP_BONUS} кредитов в подарок` : "Регистрация"}
          </Link>
        )}
      </header>

      <section aria-label="Чем вы занимаетесь" className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Что вы делаете</p>
        <div className="scroll-x -mx-4 flex gap-2 px-4 pb-1">
          <Link href={href({ service: "" })} className="chip" aria-current={!p.service ? "true" : undefined}>Всё подряд</Link>
          {SERVICE_IDS.map((id) => (
            <Link key={id} href={href({ service: p.service === id ? "" : id })} className="chip" aria-current={p.service === id ? "true" : undefined}>
              {SERVICE_SHORT[id]}
            </Link>
          ))}
        </div>
      </section>

      <section aria-label="Ниша" className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Ниша</p>
        <div className="scroll-x -mx-4 flex gap-2 px-4 pb-1">
          <Link href={href({ niche: "" })} className="chip" aria-current={!p.niche ? "true" : undefined}>Все ниши</Link>
          {niches.map((n) => (
            <Link key={n.id} href={href({ niche: p.niche === n.id ? "" : n.id })} className="chip" aria-current={p.niche === n.id ? "true" : undefined}>
              {n.label} <span className="count">{n.nNeed.toLocaleString("ru-RU")}</span>
            </Link>
          ))}
        </div>
      </section>

      <FilterForm action="/leads">
        <input type="hidden" name="service" value={p.service} />
        <input type="hidden" name="niche" value={p.niche} />
        <div className="card p-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Labeled label="Город" className="col-span-2 lg:col-span-1">
              <select name="city" defaultValue={p.city} className="field">
                <option value="">Вся Россия</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>{c.label} · {c.nNeed.toLocaleString("ru-RU")}</option>
                ))}
              </select>
            </Labeled>
            <Labeled label="Сайт">
              <select name="site" defaultValue={p.site} className="field">
                <option value="need">Нужен сайт</option>
                <option value="none">Сайта нет совсем</option>
                <option value="social">Только соцсети</option>
                <option value="builder">На конструкторе</option>
                <option value="real">Есть свой сайт</option>
                <option value="any">Любой</option>
              </select>
            </Labeled>
            <Labeled label="Оценка">
              <select name="min" defaultValue={String(p.minScore)} className="field">
                {MIN_SCORES.map((m) => (
                  <option key={m} value={m}>{m === 0 ? "Любая" : `от ${m}`}</option>
                ))}
              </select>
            </Labeled>
            <Labeled label="Порядок">
              <select name="sort" defaultValue={p.sort} className="field">
                <option value="score">Сначала горячие</option>
                <option value="name">По названию</option>
              </select>
            </Labeled>
            <Labeled label="Название" className="col-span-2 lg:col-span-1">
              <input type="search" name="q" defaultValue={p.q} placeholder="Например, стом" className="field" />
            </Labeled>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <Check name="phone" label="Есть телефон" on={p.phone} />
            <Check name="email" label="Есть e-mail" on={p.email} />
            <Check name="social" label="Есть соцсети" on={p.social} />
            <Check name="chains" label="Показывать сети" on={p.chains} />
            {filtered && <Link href="/leads" className="ml-auto text-muted underline-offset-2 hover:text-ink hover:underline">Сбросить всё</Link>}
          </div>
        </div>
      </FilterForm>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>
          Найдено <b className="text-ink">{total.toLocaleString("ru-RU")}</b> {plural(total, "заведение", "заведения", "заведений")}
          {pages > 1 ? ` · страница ${p.page} из ${pages.toLocaleString("ru-RU")}` : ""}
        </span>
      </div>

      {leads.length === 0 ? (
        <div className="card border-dashed p-10 text-center text-muted">
          Ничего не нашлось.{" "}
          {filtered && <Link href="/leads" className="text-accent hover:underline">Сбросить фильтры</Link>}
        </div>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {leads.map((l) => (
            <Row key={l.id} l={l} niche={labels.niches[l.niche] ?? l.niche} />
          ))}
        </ul>
      )}

      {pages > 1 && <Pager p={p} pages={pages} />}
    </div>
  );
}

function Row({ l, niche }: { l: Lead; niche: string }) {
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

function Labeled({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function Check({ name, label, on }: { name: string; label: string; on: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input type="checkbox" name={name} value="1" defaultChecked={on} className="h-4 w-4 accent-[var(--accent)]" />
      {label}
    </label>
  );
}

function Pager({ p, pages }: { p: Params; pages: number }) {
  const href = (page: number) => `/leads?${toQuery({ ...p, page })}`;
  return (
    <nav className="flex items-center justify-between" aria-label="Страницы">
      {p.page > 1 ? <Link href={href(p.page - 1)} className="btn btn-ghost btn-sm">← Назад</Link> : <span />}
      {p.page < pages ? <Link href={href(p.page + 1)} className="btn btn-ghost btn-sm">Дальше →</Link> : <span />}
    </nav>
  );
}

function NoDb() {
  if (process.env.VERCEL) {
    return (
      <div className="card mx-auto max-w-xl p-6">
        <h1 className="text-xl font-semibold">Сайт настраивается</h1>
        <p className="mt-2 text-muted">База заведений ещё не подключена. Загляните чуть позже.</p>
      </div>
    );
  }
  return (
    <div className="card mx-auto max-w-xl p-6">
      <h1 className="text-xl font-semibold">База лидов ещё не собрана</h1>
      <p className="mt-2 text-muted">Выполните шаги из папки проекта, затем обновите страницу:</p>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-bg p-3 text-sm">{`python3 -m venv ingest/.venv
ingest/.venv/bin/pip install -r ingest/requirements.txt
ingest/.venv/bin/python ingest/overture.py
ingest/.venv/bin/python ingest/build_db.py`}</pre>
    </div>
  );
}
