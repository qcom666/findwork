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

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Разделы админки">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} className="chip" aria-current={path === i.href ? "true" : undefined}>{i.label}</Link>
      ))}
    </nav>
  );
}
