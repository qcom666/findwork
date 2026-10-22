import type { MetadataRoute } from "next";
import { baseUrl } from "@/lib/brand";

export default function robots(): MetadataRoute.Robots {
  const base = baseUrl();
  return {
    // Каталог с фильтрами и страницами (/leads?…) роботам не нужен: это тысячи сочетаний одних и тех же заведений,
    // а для поиска есть страницы городов и ниш. Через прокси такой обход шёл на Vercel с одного адреса и включал его защиту от ботов.
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/account", "/my", "/billing/", "/lead/", "/leads?", "/admin", "/r/", "/report/"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
