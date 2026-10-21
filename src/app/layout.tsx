import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Logo } from "@/components/Logo";
import { MobileMenu, NavLinks, type NavItem } from "@/components/NavLinks";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getCurrentUser } from "@/lib/auth";
import { dbReady } from "@/lib/db";
import { plural } from "@/lib/format";
import { getMeta } from "@/lib/search";

const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-inter", display: "swap" });

const SITE = "https://findwork-rouge.vercel.app";
const DESCRIPTION = "Кафе, салоны, клиники и магазины России без сайта или со слабым сайтом. Оценка лида, проверка сайта и готовый питч для фрилансеров.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || SITE),
  title: { default: "FindWork — клиенты для фрилансеров среди заведений России", template: "%s — FindWork" },
  description: DESCRIPTION,
  openGraph: { title: "FindWork", description: DESCRIPTION, siteName: "FindWork", locale: "ru_RU", type: "website" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0f12" },
  ],
};

// Ставит тему до первой отрисовки, чтобы страница не мигала белым.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('fw-theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})()`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const meta = (await dbReady()) ? await getMeta().catch(() => null) : null;
  const user = await getCurrentUser();

  const nav: NavItem[] = [
    { href: "/leads", label: "Лиды" },
    { href: "/pricing", label: "Тарифы" },
    { href: "/blog", label: "Блог" },
    { href: "/about", label: "О данных" },
    ...(user ? [{ href: "/my", label: "Мои лиды" }] : []),
  ];

  return (
    <html lang="ru" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink">
          Перейти к содержимому
        </a>
        <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
            <Link href="/" aria-label="FindWork, на главную">
              <Logo />
            </Link>
            <nav className="hidden items-center gap-1 text-sm font-medium md:flex">
              <NavLinks items={nav} />
            </nav>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              {user ? (
                <Link href="/account" className="btn btn-ghost btn-sm" title={user.email}>
                  <span className="text-accent">{user.balance}</span> {plural(user.balance, "кредит", "кредита", "кредитов")}
                </Link>
              ) : (
                <>
                  <Link href="/login" className="hidden px-2 text-sm font-medium text-muted hover:text-ink sm:inline">Войти</Link>
                  <Link href="/signup" className="btn btn-primary btn-sm">Регистрация</Link>
                </>
              )}
              <MobileMenu items={nav} />
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>

        <footer className="border-t border-line">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-[1.4fr_1fr_1fr]">
            <div className="space-y-3">
              <Logo />
              <p className="max-w-sm text-muted">Клиенты для фрилансеров среди заведений России. Открытые данные, честная оценка и готовый первый текст.</p>
            </div>
            <div className="space-y-2">
              <p className="font-semibold">Сервис</p>
              <ul className="space-y-1.5 text-muted">
                <li><Link href="/leads" className="hover:text-ink">Каталог лидов</Link></li>
                <li><Link href="/pricing" className="hover:text-ink">Тарифы</Link></li>
                <li><Link href="/blog" className="hover:text-ink">Блог</Link></li>
                <li><Link href="/about" className="hover:text-ink">О данных</Link></li>
              </ul>
            </div>
            <div className="space-y-2">
              <p className="font-semibold">Документы</p>
              <ul className="space-y-1.5 text-muted">
                <li><Link href="/terms" className="hover:text-ink">Оферта</Link></li>
                <li><Link href="/refund" className="hover:text-ink">Оплата и возврат</Link></li>
                <li><Link href="/privacy" className="hover:text-ink">Политика конфиденциальности</Link></li>
                <li><Link href="/contacts" className="hover:text-ink">Контакты и реквизиты</Link></li>
              </ul>
            </div>
            <p className="border-t border-line pt-5 text-xs leading-relaxed text-muted sm:col-span-3">
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
