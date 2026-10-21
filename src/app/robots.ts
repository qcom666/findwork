import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL || "https://findwork-rouge.vercel.app";
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/account", "/my", "/billing/", "/lead/"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
