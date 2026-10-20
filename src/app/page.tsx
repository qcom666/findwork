import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { SIGNUP_BONUS } from "@/lib/credits";
import { dbReady } from "@/lib/db";
import { SITE_LABEL, plural, scoreTone } from "@/lib/format";
import {
  PAGE_SIZE, getCities, getLabels, getMeta, getNiches, parseParams, searchLeads, toQuery, type Lead, type Params,
} from "@/lib/search";

type SP = Promise<Record<string, string | string[] | undefined>>;

const TONE = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  muted: "bg-line/60 text-muted",
} as const;

const SITE_TONE = {
  none: "bg-good-soft text-good",
  social: "bg-good-soft text-good",
  builder: "bg-warn-soft text-warn",
  real: "bg-line/60 text-muted",
} as const;

export default async function Home({ searchParams }: { searchParams: SP }) {
  if (!(await dbReady())) return <NoDb />;

  const p = parseParams(await searchParams);
  const user = await getCurrentUser();
  const [{ leads, total }, cities, niches, labels, meta] = await Promise.all([
    searchLeads(p, user?.id),
    getCities(250),
    getNiches(),
    getLabels(),
    getMeta(),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <section className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Заведения, которым нужен сайт</h1>
        <p className="mt-2 text-muted">
          Открытые данные по России: находим бизнесы без сайта, оцениваем, насколько им нужна ваша услуга, и пишем
          первое сообщение. В базе {Number(meta.total).toLocaleString("ru-RU")} заведений.
        </p>
        {!user && (
          <p className="mt-3 text-sm">
            <Link href="/signup" className="font-medium text-accent hover:underline">Зарегистрируйтесь</Link>
            {SIGNUP_BONUS > 0 ? `, ${SIGNUP_BONUS} кредитов в подарок` : ""}: контакты открываются за кредит.
          </p>
        )}
      </section>

      <form method="GET" className="rounded-2xl border border-line bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Labeled label="Город">
            <select name="city" defaultValue={p.city} className="field">
              <option value="">Вся Россия</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>{c.label} · {c.nNeed.toLocaleString("ru-RU")}</option>
              ))}
            </select>
          </Labeled>
          <Labeled label="Ниша">
            <select name="niche" defaultValue={p.niche} className="field">
              <option value="">Любая</option>
              {niches.map((n) => (
                <option key={n.id} value={n.id}>{n.label}</option>
              ))}
            </select>
          </Labeled>
          <Labeled label="Сайт">
            <select name="site" defaultValue={p.site} className="field">
              <option value="need">Нужен сайт (нет, соцсети, конструктор)</option>
              <option value="none">Сайта нет совсем</option>
              <option value="social">Только соцсети</option>
              <option value="builder">Сайт на конструкторе</option>
              <option value="real">Есть свой сайт</option>
              <option value="any">Любой</option>
            </select>
          </Labeled>
          <Labeled label="Название">
            <input name="q" defaultValue={p.q} placeholder="Например, «стом»" className="field" />
          </Labeled>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Check name="phone" label="Только с телефоном" defaultChecked={p.phone} />
          <Check name="email" label="Только с e-mail" defaultChecked={p.email} />
          <Check name="chains" label="Показывать сети" defaultChecked={p.chains} />
          <button type="submit" className="ml-auto rounded-lg bg-accent px-5 py-2 text-sm font-medium text-accent-ink hover:opacity-90">
            Найти
          </button>
        </div>
      </form>

      <div className="text-sm text-muted">
        Найдено <b className="text-ink">{total.toLocaleString("ru-RU")}</b> {plural(total, "заведение", "заведения", "заведений")}
        {pages > 1 ? ` · страница ${p.page} из ${pages.toLocaleString("ru-RU")}` : ""}
      </div>

      {leads.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-10 text-center text-muted">
          Ничего не нашлось. Попробуйте убрать часть фильтров.
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
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
        className="grid grid-cols-[2.75rem_1fr] items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-bg sm:grid-cols-[2.75rem_1fr_11.5rem_11rem]"
      >
        <span className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold ${TONE[scoreTone(l.score)]}`} title="Оценка лида, 0–100">
          {l.score}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{l.name}</span>
          <span className="block truncate text-sm text-muted">
            {niche}{l.city ? ` · ${l.city}` : ""}{l.address ? ` · ${l.address}` : ""}
          </span>
        </span>
        <span className="col-start-2 sm:col-start-auto">
          <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${SITE_TONE[l.siteKind]}`}>{SITE_LABEL[l.siteKind]}</span>
        </span>
        <span className="col-start-2 flex flex-wrap items-center gap-1.5 text-xs sm:col-start-auto sm:justify-end">
          <Chip on={l.has.phone}>тел</Chip>
          <Chip on={l.has.email}>e-mail</Chip>
          <Chip on={l.has.social}>соцсети</Chip>
          {l.unlocked && <span className="whitespace-nowrap rounded-md bg-accent-soft px-1.5 py-0.5 text-accent">открыт</span>}
        </span>
      </Link>
    </li>
  );
}

function Chip({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span className={`whitespace-nowrap rounded-md border px-1.5 py-0.5 ${on ? "border-line text-ink" : "border-transparent text-muted/50 line-through"}`}>
      {children}
    </span>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} value="1" defaultChecked={defaultChecked} className="h-4 w-4 accent-[var(--accent)]" />
      {label}
    </label>
  );
}

function Pager({ p, pages }: { p: Params; pages: number }) {
  const href = (page: number) => `/?${toQuery({ ...p, page })}`;
  const cls = "rounded-lg border border-line bg-surface px-4 py-2 text-sm hover:border-accent";
  return (
    <nav className="flex items-center justify-between">
      {p.page > 1 ? <Link href={href(p.page - 1)} className={cls}>← Назад</Link> : <span />}
      {p.page < pages ? <Link href={href(p.page + 1)} className={cls}>Дальше →</Link> : <span />}
    </nav>
  );
}

function NoDb() {
  if (process.env.VERCEL) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-line bg-surface p-6">
        <h1 className="text-xl font-semibold">Сайт настраивается</h1>
        <p className="mt-2 text-muted">База заведений ещё не подключена. Загляните чуть позже.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-line bg-surface p-6">
      <h1 className="text-xl font-semibold">База лидов ещё не собрана</h1>
      <p className="mt-2 text-muted">Выполните три шага из папки проекта, затем обновите страницу:</p>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-bg p-3 text-sm">{`python3 -m venv ingest/.venv
ingest/.venv/bin/pip install -r ingest/requirements.txt
ingest/.venv/bin/python ingest/overture.py
ingest/.venv/bin/python ingest/build_db.py`}</pre>
    </div>
  );
}
