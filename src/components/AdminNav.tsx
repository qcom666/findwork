"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin", label: "Обзор" },
  { href: "/admin/promo", label: "Промокоды" },
  { href: "/admin/users", label: "Пользователи" },
  { href: "/admin/activity", label: "Активность" },
  { href: "/admin/subscriptions", label: "Подписки" },
  { href: "/admin/receipts", label: "Чеки" },
  { href: "/admin/telegram", label: "Telegram" },
];

/**
 * Ссылки в админке без предзагрузки (prefetch={false}): каждая страница админки строится заново и тяжёлая, а лента активности
 * со своими сотнями ссылок за секунду упиралась в лимит запросов nginx, и владелец получал 429.
 */
export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Разделы админки">
      {ITEMS.map((i) => (
        <Link prefetch={false} key={i.href} href={i.href} className="chip" aria-current={path === i.href ? "true" : undefined}>{i.label}</Link>
      ))}
    </nav>
  );
}
