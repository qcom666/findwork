import type { Metadata } from "next";
import Link from "next/link";
import { ARTICLES, formatDate, readingMinutes } from "@/content/articles";

export const metadata: Metadata = {
  title: "Блог: как фрилансеру найти клиентов среди местного бизнеса",
  description: "Практические статьи про поиск клиентов: первое сообщение, напоминания, проверка сайта, SMM, вывески и закон о рекламе.",
  alternates: { canonical: "/blog" },
};

export default function BlogIndex() {
  return (
    <div className="space-y-8">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">Блог</h1>
        <p className="mt-2 text-lg text-muted">Как найти клиентов среди местного бизнеса, написать им так, чтобы ответили, и не нарушить закон.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {ARTICLES.map((a) => (
          <Link key={a.slug} href={`/blog/${a.slug}`} className="card group flex flex-col p-5 transition-colors hover:border-accent">
            <div className="flex flex-wrap gap-2 text-xs text-muted">
              {a.tags.slice(0, 2).map((t) => (
                <span key={t} className="rounded-full bg-surface-2 px-2.5 py-0.5">{t}</span>
              ))}
            </div>
            <h2 className="mt-3 text-lg font-bold leading-snug tracking-tight group-hover:text-accent">{a.title}</h2>
            <p className="mt-2 flex-1 text-sm text-muted">{a.description}</p>
            <p className="mt-4 text-xs text-muted">{formatDate(a.date)} · {readingMinutes(a)} мин чтения</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
