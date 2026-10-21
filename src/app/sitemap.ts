import type { MetadataRoute } from "next";
import { baseUrl } from "@/lib/brand";
import { ARTICLES } from "@/content/articles";
import { dbReady } from "@/lib/db";
import { getAllCities, getSitemapPairs, MIN_PAGE } from "@/lib/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = baseUrl();
  const pages: MetadataRoute.Sitemap = ["/", "/leads", "/pricing", "/blog", "/about", "/terms", "/refund", "/contacts", "/privacy", "/consent"].map((p) => ({
    url: base + p,
    changeFrequency: p === "/leads" ? "daily" : "monthly",
    priority: p === "/" ? 1 : 0.6,
  }));

  for (const a of ARTICLES) pages.push({ url: `${base}/blog/${a.slug}`, lastModified: a.date, changeFrequency: "monthly", priority: 0.7 });

  // Страницы городов и ниш: только там, где есть что показать.
  if (await dbReady()) {
    try {
      const cities = (await getAllCities()).filter((c) => c.nNeed >= MIN_PAGE).slice(0, 80);
      for (const c of cities) pages.push({ url: `${base}/city/${c.slug}`, changeFrequency: "weekly", priority: 0.7 });
      for (const p of await getSitemapPairs(60)) pages.push({ url: `${base}/city/${p.city.slug}/${p.niche}`, changeFrequency: "weekly", priority: 0.5 });
    } catch {
      // без базы отдаём хотя бы основные страницы
    }
  }
  return pages;
}
