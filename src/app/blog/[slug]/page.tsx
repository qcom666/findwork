import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleBody } from "@/components/ArticleBody";
import { ARTICLES, formatDate, getArticle, readingMinutes } from "@/content/articles";

type Props = { params: Promise<{ slug: string }> };

// Статьи лежат в коде, поэтому страницы собираются заранее и отдаются мгновенно.
export function generateStaticParams() {
  return ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = getArticle((await params).slug);
  if (!a) return { title: "Статья не найдена" };
  return {
    title: a.title,
    description: a.description,
    alternates: { canonical: `/blog/${a.slug}` },
    openGraph: { type: "article", title: a.title, description: a.description, publishedTime: a.date, tags: a.tags, locale: "ru_RU" },
  };
}

export default async function ArticlePage({ params }: Props) {
  const a = getArticle((await params).slug);
  if (!a) notFound();

  const base = process.env.APP_URL || "https://findwork-rouge.vercel.app";
  const related = a.related.map((s) => getArticle(s)).filter((x): x is NonNullable<typeof x> => !!x);
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: a.title,
      description: a.description,
      datePublished: a.date,
      dateModified: a.date,
      inLanguage: "ru",
      mainEntityOfPage: `${base}/blog/${a.slug}`,
      author: { "@type": "Organization", name: "FindWork" },
      publisher: { "@type": "Organization", name: "FindWork" },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "FindWork", item: base },
        { "@type": "ListItem", position: 2, name: "Блог", item: `${base}/blog` },
        { "@type": "ListItem", position: 3, name: a.title },
      ],
    },
  ];

  return (
    <article className="mx-auto max-w-2xl">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav className="text-sm text-muted" aria-label="Навигация">
        <Link href="/" className="hover:text-ink">FindWork</Link> › <Link href="/blog" className="hover:text-ink">Блог</Link>
      </nav>

      <header className="mt-4">
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{a.title}</h1>
        <p className="mt-3 text-lg text-muted">{a.description}</p>
        <p className="mt-3 text-sm text-muted">{formatDate(a.date)} · {readingMinutes(a)} мин чтения</p>
      </header>

      <div className="mt-8">
        <ArticleBody blocks={a.blocks} />
      </div>

      <section className="card mt-12 p-6 text-center">
        <p className="text-lg font-semibold">{a.cta.text}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <Link href={a.cta.href} className="btn btn-primary">{a.cta.label}</Link>
          <Link href="/signup" className="btn btn-ghost">Получить кредиты в подарок</Link>
        </div>
      </section>

      {related.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-bold">Читайте также</h2>
          <ul className="mt-3 space-y-2">
            {related.map((r) => (
              <li key={r.slug}>
                <Link href={`/blog/${r.slug}`} className="text-accent underline-offset-2 hover:underline">{r.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
