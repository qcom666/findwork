import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.APP_URL || "https://findwork-rouge.vercel.app";
  return ["/", "/leads", "/pricing", "/about", "/terms", "/privacy"].map((p) => ({
    url: base + p,
    changeFrequency: p === "/leads" ? "daily" : "monthly",
    priority: p === "/" ? 1 : 0.6,
  }));
}
