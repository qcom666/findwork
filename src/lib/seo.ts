import { cached } from "./cache";
import { leadsDb } from "./db";

const RU: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Адресная часть из названия города: «Нижний Новгород» -> nizhniy-novgorod. */
export function citySlug(name: string): string {
  return [...name.toLowerCase()]
    .map((c) => RU[c] ?? (/[a-z0-9-]/.test(c) ? c : c === " " ? "-" : ""))
    .join("")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const TTL = 10 * 60 * 1000;
const NEED = "site_kind IN ('none','social','builder') AND is_chain = 0";

export type CityInfo = { name: string; slug: string; n: number; nNeed: number };

export const getAllCities = () =>
  cached<CityInfo[]>("seo:cities", TTL, async () => {
    const rs = await leadsDb().execute("SELECT name, n, n_need FROM cities ORDER BY n_need DESC");
    return rs.rows.map((r) => ({ name: String(r.name), slug: citySlug(String(r.name)), n: Number(r.n), nNeed: Number(r.n_need) }));
  });

export async function findCity(slug: string): Promise<CityInfo | null> {
  return (await getAllCities()).find((c) => c.slug === slug) ?? null;
}

/**
 * Сводка city_niche (ingest/city_niche.sql) заменяет GROUP BY по 400 тысячам строк: страницы города и sitemap открываются за миллисекунды.
 * Если таблицы в базе ещё нет, считаем напрямую, как раньше.
 */
async function summary<T>(fast: () => Promise<T>, slow: () => Promise<T>): Promise<T> {
  try {
    return await fast();
  } catch (e) {
    if (!/no such table/i.test((e as Error).message)) throw e;
    return slow();
  }
}

/** Сколько заведений без своего сайта в каждой нише города. */
export const getCityNicheCounts = (city: string) =>
  cached<{ niche: string; n: number }[]>(`seo:city:${city}`, TTL, () =>
    summary(
      async () => {
        const rs = await leadsDb().execute({ sql: "SELECT niche, n_need AS n FROM city_niche WHERE city = ? ORDER BY n DESC", args: [city] });
        return rs.rows.map((r) => ({ niche: String(r.niche), n: Number(r.n) }));
      },
      async () => {
        const rs = await leadsDb().execute({
          sql: `SELECT niche, count(*) AS n FROM places WHERE city = ? AND ${NEED} GROUP BY niche ORDER BY n DESC`,
          args: [city],
        });
        return rs.rows.map((r) => ({ niche: String(r.niche), n: Number(r.n) }));
      },
    ),
  );

/** В каких городах больше всего заведений этой ниши без сайта. */
export const getNicheTopCities = (niche: string, limit = 8) =>
  cached<{ city: string; n: number }[]>(`seo:niche:${niche}:${limit}`, TTL, () =>
    summary(
      async () => {
        const rs = await leadsDb().execute({ sql: "SELECT city, n_need AS n FROM city_niche WHERE niche = ? ORDER BY n_need DESC LIMIT ?", args: [niche, limit] });
        return rs.rows.map((r) => ({ city: String(r.city), n: Number(r.n) }));
      },
      async () => {
        const rs = await leadsDb().execute({
          sql: `SELECT city, count(*) AS n FROM places WHERE niche = ? AND city IS NOT NULL AND ${NEED} GROUP BY city ORDER BY n DESC LIMIT ?`,
          args: [niche, limit],
        });
        return rs.rows.map((r) => ({ city: String(r.city), n: Number(r.n) }));
      },
    ),
  );

/** Минимум заведений, чтобы страница города или ниши имела смысл для поиска и попадала в sitemap. */
export const MIN_PAGE = 15;

/** Пары город и ниша для sitemap: только крупные города и только где есть что показать. */
export const getSitemapPairs = (topCities = 60) =>
  cached<{ city: CityInfo; niche: string; n: number }[]>(`seo:pairs:${topCities}`, TTL, async () => {
    const cities = (await getAllCities()).slice(0, topCities);
    const bySlug = new Map(cities.map((c) => [c.name, c]));
    const args = [...cities.map((c) => c.name), MIN_PAGE];
    const marks = cities.map(() => "?").join(",");
    const rs = await summary(
      () => leadsDb().execute({ sql: `SELECT city, niche, n_need AS n FROM city_niche WHERE city IN (${marks}) AND n_need >= ?`, args }),
      () =>
        leadsDb().execute({
          sql: `SELECT city, niche, count(*) AS n FROM places WHERE ${NEED} AND city IN (${marks}) GROUP BY city, niche HAVING count(*) >= ?`,
          args,
        }),
    );
    return rs.rows.map((r) => ({ city: bySlug.get(String(r.city))!, niche: String(r.niche), n: Number(r.n) }));
  });
