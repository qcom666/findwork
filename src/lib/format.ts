import type { Lead, SiteKind } from "./search";

export function formatPhone(p: string | null): string {
  if (!p) return "";
  const m = p.match(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+7 (${m[1]}) ${m[2]}-${m[3]}-${m[4]}` : p;
}

export const SITE_LABEL: Record<SiteKind, string> = {
  none: "Сайта нет",
  social: "Только соцсети",
  builder: "Сайт на конструкторе",
  real: "Есть сайт",
};

export function scoreTone(score: number): "good" | "warn" | "muted" {
  return score >= 70 ? "good" : score >= 45 ? "warn" : "muted";
}

export function reasons(l: Lead): { tone: "good" | "warn" | "muted"; text: string }[] {
  const r: { tone: "good" | "warn" | "muted"; text: string }[] = [];
  if (l.siteKind === "none") r.push({ tone: "good", text: "Ссылки на собственный сайт нет в открытых данных" });
  if (l.siteKind === "social") r.push({ tone: "good", text: "Вместо сайта только соцсети или страницы на агрегаторах" });
  if (l.siteKind === "builder") r.push({ tone: "warn", text: "Сайт на бесплатном домене конструктора" });
  if (l.siteKind === "real") r.push({ tone: "muted", text: "Есть собственный сайт: запустите проверку сайта после открытия контактов" });
  if (l.has.phone) r.push({ tone: "good", text: "Есть телефон для связи" });
  if (l.has.email) r.push({ tone: "good", text: "Есть e-mail" });
  if (!l.has.social) r.push({ tone: "warn", text: "Соцсетей в данных нет: можно предложить ведение" });
  if (l.isChain) r.push({ tone: "muted", text: "Похоже на сеть: решения обычно принимает головной офис" });
  return r;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Короткие названия услуг для фильтров. Полные лежат в таблице services. */
export const SERVICE_SHORT: Record<string, string> = {
  site: "Сайты",
  redesign: "Редизайн",
  qr_menu: "QR-меню",
  booking: "Онлайн-запись",
  smm: "Соцсети",
  logo: "Лого и стиль",
  signage: "Вывески",
  seo: "SEO и карты",
  shop: "Интернет-магазины",
};

export function sourceLabel(s: string): string {
  if (s === "osm") return "OpenStreetMap";
  if (s.startsWith("overture:")) return "Overture Maps";
  return s;
}
