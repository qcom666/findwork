import { LEGAL_DATE, LEGAL_VERSION, type LegalSection } from "@/lib/legal";
import { seller } from "@/lib/seller";

/** Страница юридического документа: заголовок, версия, оглавление и разделы. */
export function LegalDoc({ title, sections, lead, toc = true }: { title: string; sections: LegalSection[]; lead?: string; toc?: boolean }) {
  return (
    <article className="max-w-3xl space-y-8 leading-relaxed">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-muted">Редакция {LEGAL_VERSION} от {LEGAL_DATE}</p>
        {lead && <p className="mt-3 text-muted">{lead}</p>}
      </header>

      {toc && sections.length > 3 && (
        <nav aria-label="Содержание" className="card p-4 text-sm">
          <ol className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {sections.map((s) => (
              <li key={s.id}><a href={`#${s.id}`} className="text-muted hover:text-accent hover:underline">{s.title}</a></li>
            ))}
          </ol>
        </nav>
      )}

      {sections.map((s) => (
        <section key={s.id} id={s.id} className="scroll-mt-20 space-y-2.5">
          <h2 className="text-lg font-semibold">{s.title}</h2>
          {s.body.map((b, i) =>
            typeof b === "string" ? (
              <p key={i} className="text-muted">{b}</p>
            ) : (
              <ul key={i} className="list-disc space-y-1.5 pl-5 text-muted">
                {b.map((li, j) => <li key={j}>{li}</li>)}
              </ul>
            ),
          )}
        </section>
      ))}

      {!seller.configured() && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          Реквизиты продавца ещё не заполнены. Перед приёмом платежей задайте SELLER_NAME, SELLER_INN и SUPPORT_EMAIL.
        </p>
      )}
    </article>
  );
}
