import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LeadRow } from "@/components/LeadRow";
import { getCurrentUser } from "@/lib/auth";
import { dbReady } from "@/lib/db";
import { plural } from "@/lib/format";
import { getLabels, parseParams, searchLeads } from "@/lib/search";
import { findCity, getCityNicheCounts, MIN_PAGE } from "@/lib/seo";

type Props = { params: Promise<{ city: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!(await dbReady())) return { title: "Город" };
  const city = await findCity((await params).city);
  if (!city) return { title: "Город" };
  return {
    title: `Заведения без сайта: ${city.name}, ${city.nNeed.toLocaleString("ru-RU")} ${plural(city.nNeed, "лид", "лида", "лидов")} для фрилансеров`,
    description: `${city.nNeed.toLocaleString("ru-RU")} заведений города ${city.name} без собственного сайта: кафе, салоны, клиники, магазины. Оценка лида, проверка сайта и готовый питч.`,
    alternates: { canonical: `/city/${city.slug}` },
    robots: city.nNeed >= MIN_PAGE ? undefined : { index: false, follow: true },
  };
}

export default async function CityPage({ params }: Props) {
  if (!(await dbReady())) notFound();
  const city = await findCity((await params).city);
  if (!city) notFound();

  const user = await getCurrentUser();
  const [counts, labels, top] = await Promise.all([
    getCityNicheCounts(city.name),
    getLabels(),
    searchLeads(parseParams({ city: city.name }), user?.id),
  ]);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Lidomap", item: "/" },
      { "@type": "ListItem", position: 2, name: "Каталог", item: "/leads" },
      { "@type": "ListItem", position: 3, name: city.name },
    ],
  };

  return (
    <div className="space-y-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav className="text-sm text-muted" aria-label="Навигация">
        <Link href="/" className="hover:text-ink">Lidomap</Link> › <Link href="/leads" className="hover:text-ink">Каталог</Link> › {city.name}
      </nav>

      <header className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight">Заведения без сайта: {city.name}</h1>
        <p className="mt-3 text-lg text-muted">
          В каталоге {city.nNeed.toLocaleString("ru-RU")} {plural(city.nNeed, "заведение", "заведения", "заведений")} города {city.name}, у которых нет
          собственного сайта: только соцсети, страница на агрегаторе или сайт на бесплатном конструкторе. Для каждого видна оценка, причины и
          что можно предложить. Контакты открываются за кредит.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={`/leads?city=${encodeURIComponent(city.name)}`} className="btn btn-primary">Смотреть все в каталоге</Link>
          <Link href="/signup" className="btn btn-ghost">Получить кредиты в подарок</Link>
        </div>
      </header>

      <section className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight">Ниши в городе {city.name}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {counts.filter((c) => c.n >= MIN_PAGE).map((c) => (
            <Link key={c.niche} href={`/city/${city.slug}/${c.niche}`} className="card group p-4 transition-colors hover:border-accent">
              <p className="font-semibold group-hover:text-accent">{labels.niches[c.niche] ?? c.niche}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{c.n.toLocaleString("ru-RU")}</p>
              <p className="text-xs text-muted">без своего сайта</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight">Самые горячие лиды</h2>
        <ul className="card divide-y divide-line overflow-hidden">
          {top.leads.slice(0, 12).map((l) => (
            <LeadRow key={l.id} l={l} niche={labels.niches[l.niche] ?? l.niche} />
          ))}
        </ul>
      </section>
    </div>
  );
}
