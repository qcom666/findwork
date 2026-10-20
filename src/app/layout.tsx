import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { dbReady } from "@/lib/db";
import { plural } from "@/lib/format";
import { getMeta } from "@/lib/search";

export const metadata: Metadata = {
  title: "FindWork — лиды для фрилансеров",
  description: "Заведения России без сайта: открытые данные, оценка потребности и готовый питч.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const meta = (await dbReady()) ? await getMeta().catch(() => null) : null;
  const user = await getCurrentUser();
  return (
    <html lang="ru">
      <body className="min-h-screen flex flex-col">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tracking-tight">FindWork</span>
              <span className="hidden text-sm text-muted md:inline">лиды для фрилансеров</span>
            </Link>
            <nav className="flex items-center gap-3 text-sm sm:gap-4">
              <Link href="/" className="text-muted hover:text-ink">Лиды</Link>
              <Link href="/pricing" className="text-muted hover:text-ink">Тарифы</Link>
              <Link href="/about" className="hidden text-muted hover:text-ink sm:inline">О данных</Link>
              {user ? (
                <>
                  <Link href="/my" className="text-muted hover:text-ink">Мои лиды</Link>
                  <Link href="/account" className="rounded-full bg-accent-soft px-3 py-1 font-medium text-accent" title={user.email}>
                    {user.balance} {plural(user.balance, "кредит", "кредита", "кредитов")}
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/login" className="text-muted hover:text-ink">Войти</Link>
                  <Link href="/signup" className="rounded-lg bg-accent px-3 py-1.5 font-medium text-accent-ink hover:opacity-90">Регистрация</Link>
                </>
              )}
            </nav>
          </div>
        </header>
        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</div>
        <footer className="border-t border-line">
          <div className="mx-auto max-w-6xl space-y-2 px-4 py-4 text-xs leading-relaxed text-muted">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Link href="/terms" className="hover:text-ink">Оферта</Link>
              <Link href="/privacy" className="hover:text-ink">Политика конфиденциальности</Link>
              <Link href="/about" className="hover:text-ink">О данных</Link>
            </div>
            <p>
              Данные: Overture Maps Foundation (CDLA-Permissive-2.0, CC0, Apache-2.0) и © участники OpenStreetMap (ODbL).
              {meta ? ` База собрана ${meta.built_at}, релиз Overture ${meta.overture_release}.` : ""} Сведения из открытых
              источников могут быть неполными или устаревшими: перед обращением проверьте их.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
