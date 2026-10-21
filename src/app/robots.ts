import type { MetadataRoute } from "next";
import { baseUrl } from "@/lib/brand";

export default function robots(): MetadataRoute.Robots {
  const base = baseUrl();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/account", "/my", "/billing/", "/lead/"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
