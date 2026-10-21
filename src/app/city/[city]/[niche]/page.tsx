import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LeadRow } from "@/components/LeadRow";
import { getCurrentUser } from "@/lib/auth";
import { dbReady } from "@/lib/db";
import { plural } from "@/lib/format";
import { getLabels, parseParams, searchLeads } from "@/lib/search";
import { citySlug, findCity, getCityNicheCounts, getNicheTopCities, MIN_PAGE } from "@/lib/seo";

type Props = { params: Promise<{ city: string; niche: string }> };

async function load(p: Props["params"]) {
  const { city: slug, niche } = await p;
  const [city, labels] = await Promise.all([findCity(slug), getLabels()]);
  const label = labels.niches[niche];
  if (!city || !label) return null;
  const counts = await getCityNicheCounts(city.name);
  return { city, niche, label, labels, counts, n: counts.find((c) => c.niche === niche)?.n ?? 0 };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!(await dbReady())) return { title: "Каталог" };
  const d = await load(params);
  if (!d) return { title: "Каталог" };
  return {
    title: `${d.label} без сайта: ${d.city.name}, ${d.n.toLocaleString("ru-RU")} ${plural(d.n, "лид", "лида", "лидов")}`,
    description: `${d.n.toLocaleString("ru-RU")} заведений в нише «${d.label}» города ${d.city.name} без собственного сайта. Оценка лида, причины, что предложить, проверка сайта и питч для фрилансера.`,
    alternates: { canonical: `/city/${d.city.slug}/${d.niche}` },
    robots: d.n >= MIN_PAGE ? undefined : { index: false, follow: true },
  };
}

export default async function CityNichePage({ params }: Props) {
  if (!(await dbReady())) notFound();
  const d = await load(params);
  if (!d) notFound();

  const user = await getCurrentUser();
  const [top, topCities] = await Promise.all([
    searchLeads(parseParams({ city: d.city.name, niche: d.niche }), user?.id),
    getNicheTopCities(d.niche, 9),
  ]);
  const otherNiches = d.counts.filter((c) => c.niche !== d.niche && c.n >= MIN_PAGE).slice(0, 6);
  const catalog = `/leads?city=${encodeURIComponent(d.city.name)}&niche=${d.niche}`;

  return (
    <div className="space-y-8">
      <nav className="text-sm text-muted" aria-label="Навигация">
        <Link href="/" className="hover:text-ink">Лидомап</Link> › <Link href="/leads" className="hover:text-ink">Каталог</Link> ›{" "}
        <Link href={`/city/${d.city.slug}`} className="hover:text-ink">{d.city.name}</Link> › {d.label}
      </nav>

      <header className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight">{d.label} без сайта: {d.city.name}</h1>
        <p className="mt-3 text-lg text-muted">
          {d.n.toLocaleString("ru-RU")} {plural(d.n, "заведение", "заведения", "заведений")} в нише «{d.label}» города {d.city.name} без собственного сайта.
          Оценка показывает, насколько заведению нужна ваша услуга, а контакты, проверка сайта и питч открываются за кредит.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={catalog} className="btn btn-primary">Открыть в каталоге с фильтрами</Link>
          <Link href="/signup" className="btn btn-ghost">Получить кредиты в подарок</Link>
        </div>
      </header>

      <section className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight">Лучшие лиды</h2>
        <ul className="card divide-y divide-line overflow-hidden">
          {top.leads.slice(0, 20).map((l) => (
            <LeadRow key={l.id} l={l} niche={d.label} />
          ))}
        </ul>
        {d.n > 20 && <Link href={catalog} className="text-sm text-accent hover:underline">Ещё {(d.n - 20).toLocaleString("ru-RU")} в каталоге →</Link>}
      </section>

      {otherNiches.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold tracking-tight">Другие ниши в городе {d.city.name}</h2>
          <div className="flex flex-wrap gap-2">
            {otherNiches.map((c) => (
              <Link key={c.niche} href={`/city/${d.city.slug}/${c.niche}`} className="chip">
                {d.labels.niches[c.niche] ?? c.niche} <span className="count">{c.n.toLocaleString("ru-RU")}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {topCities.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold tracking-tight">{d.label} в других городах</h2>
          <div className="flex flex-wrap gap-2">
            {topCities.filter((c) => c.city !== d.city.name).map((c) => (
              <Link key={c.city} href={`/city/${citySlug(c.city)}/${d.niche}`} className="chip">
                {c.city} <span className="count">{c.n.toLocaleString("ru-RU")}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
