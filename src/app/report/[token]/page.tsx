import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { dbReady } from "@/lib/db";
import { getPublicReport, isReportOwner } from "@/lib/reports";
import { seller } from "@/lib/seller";

// Страница для владельца заведения по секретной ссылке: в поиск не отдаём и не кэшируем.
export const metadata: Metadata = { title: "Проверка сайта", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";

const DOT = { bad: "bg-bad", warn: "bg-warn", ok: "bg-good", info: "bg-muted/60" } as const;
// Без «г.» в конце: дату ставим посреди предложений, и точка после неё давала бы «г..».
const date = (s: number) => new Date(s * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }).replace(/\s?г\.$/, "");

/** Превращает контакт автора в ссылку, если похож на Telegram-имя, почту, телефон или адрес сайта. */
function contactHref(c: string): string | null {
  const t = c.trim();
  if (/^@[A-Za-z0-9_]{3,32}$/.test(t)) return `https://t.me/${t.slice(1)}`;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) return `mailto:${t}`;
  if (/^\+?[\d\s().-]{10,18}$/.test(t)) return `tel:${t.replace(/[^\d+]/g, "")}`;
  if (/^https?:\/\/\S+$/i.test(t)) return t;
  return null;
}

export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  if (!(await dbReady())) notFound();
  const { token } = await params;
  // Автор открывает свою страницу сам: такие просмотры не считаем.
  const user = await getCurrentUser();
  const own = user ? await isReportOwner(user.id, token) : false;
  const r = await getPublicReport(token, !own);
  if (!r) notFound();

  if (r.state !== "ok") {
    return (
      <div className="mx-auto max-w-lg card p-6 text-center">
        <h1 className="text-lg font-semibold">{r.state === "expired" ? "Срок действия ссылки закончился" : "Автор отозвал эту страницу"}</h1>
        <p className="mt-2 text-sm text-muted">Попросите автора прислать новую ссылку.</p>
      </div>
    );
  }

  const bad = r.findings.filter((f) => f.level === "bad").length;
  const warn = r.findings.filter((f) => f.level === "warn").length;
  const href = contactHref(r.profile.contact);
  const host = (() => { try { return new URL(r.siteUrl).hostname.replace(/^www\./, ""); } catch { return r.siteUrl; } })();

  return (
    <article className="mx-auto max-w-2xl space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Проверка сайта</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{r.leadName}</h1>
        <p className="mt-1 text-sm text-muted">{host} · проверено {date(r.createdAt)}</p>
      </header>

      <section className="card p-5">
        <h2 className="text-sm font-semibold">
          {bad + warn === 0 ? "Серьёзных замечаний не найдено" : <>Найдено: {bad > 0 && <span className="text-bad">{bad} {bad === 1 ? "проблема" : "проблем"}</span>}{bad > 0 && warn > 0 && ", "}{warn > 0 && <span className="text-warn">{warn} {warn === 1 ? "замечание" : "замечаний"}</span>}</>}
        </h2>
        <ul className="mt-3 space-y-2.5 text-sm">
          {r.findings.map((f, i) => (
            <li key={i} className="flex gap-2.5">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[f.level] ?? DOT.info}`} />
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card !border-accent p-5">
        <h2 className="text-sm font-semibold">Что с этим можно сделать</h2>
        <p className="mt-1 text-sm text-muted">Эту проверку подготовил и может помочь исправить найденное:</p>
        <p className="mt-3 text-lg font-semibold">{r.profile.name}</p>
        {r.profile.skills && <p className="text-sm text-muted">{r.profile.skills}</p>}
        <dl className="mt-3 space-y-1.5 text-sm">
          {r.profile.priceFrom && <div className="flex gap-2"><dt className="text-muted">Работы от</dt><dd>{r.profile.priceFrom}</dd></div>}
          {r.profile.portfolio && (
            <div className="flex gap-2"><dt className="text-muted">Портфолио</dt><dd className="min-w-0 break-all"><a href={r.profile.portfolio} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">{r.profile.portfolio.replace(/^https?:\/\/(www\.)?/, "")}</a></dd></div>
          )}
        </dl>
        <div className="mt-4">
          {href ? (
            <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer nofollow" className="btn btn-primary">Связаться: {r.profile.contact}</a>
          ) : (
            <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm font-medium text-accent">Связаться: {r.profile.contact}</p>
          )}
        </div>
      </section>

      <footer className="space-y-1.5 text-xs text-muted">
        <p>
          Отчёт составлен автоматически по общедоступным данным сайта {date(r.createdAt)}. Это техническая проверка, а не оценка качества бизнеса: часть находок может не относиться к вашей ситуации.
          Страницу подготовил частный специалист через сервис <Link href="/" className="underline">Лидомап</Link>; ссылка действует до {date(r.expiresAt)}.
        </p>
        <p>
          Если вы владелец заведения и хотите, чтобы эта страница была удалена, напишите на{" "}
          <a className="underline" href={`mailto:${seller.email()}?subject=${encodeURIComponent("Удалить страницу отчёта")}&body=${encodeURIComponent(`Ссылка: /report/${token}`)}`}>{seller.email()}</a>.
        </p>
      </footer>
    </article>
  );
}
