/** Название сервиса и адрес сайта в одном месте. Менять название: только здесь и в текстах, адрес: переменная APP_URL (после покупки домена). */
export const BRAND = "Лидомап";
export const BRAND_LATIN = "Lidomap";

/** Адрес по умолчанию, пока не задан APP_URL. Технический, пользователям не показывается, если APP_URL задан. */
const FALLBACK_URL = "https://findwork-rouge.vercel.app";

/** Основной адрес сайта без слеша на конце: APP_URL, затем боевой адрес Vercel, затем запасной. */
export function baseUrl(): string {
  if (process.env.APP_URL?.trim()) return process.env.APP_URL.trim().replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return FALLBACK_URL;
}
