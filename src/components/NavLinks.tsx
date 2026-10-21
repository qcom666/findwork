"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export type NavItem = { href: string; label: string };

function isActive(path: string, href: string): boolean {
  if (href === "/") return path === "/";
  if (href === "/leads") return path === "/leads" || path.startsWith("/lead/");
  return path === href || path.startsWith(href + "/");
}

export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <>
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={isActive(path, i.href) ? "page" : undefined}
          className="rounded-lg px-3 py-1.5 text-muted transition-colors hover:text-ink aria-[current=page]:bg-surface-2 aria-[current=page]:text-ink"
        >
          {i.label}
        </Link>
      ))}
    </>
  );
}

export function MobileMenu({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  return (
    <div className="relative md:hidden">
      <button className="btn-icon" aria-expanded={open} aria-label="Меню" onClick={() => setOpen((v) => !v)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open && (
        <div className="card absolute right-0 top-full z-40 mt-2 w-56 p-2">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              aria-current={isActive(path, i.href) ? "page" : undefined}
              className="block rounded-lg px-3 py-2.5 text-sm hover:bg-surface-2 aria-[current=page]:bg-surface-2 aria-[current=page]:font-semibold"
            >
              {i.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
