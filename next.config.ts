import type { NextConfig } from "next";

/** Адреса, с которых уходим на основной: прежний адрес Vercel и www. Вебхуки ЮKassa и Telegram остаются на месте, пока в их настройках не сменят адрес. */
function redirectsToMainHost() {
  const raw = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (!raw) return [];
  let main: URL;
  try { main = new URL(raw); } catch { return []; }
  const stale = ["findwork-rouge.vercel.app", `www.${main.hostname}`].filter((h) => h !== main.hostname);
  return stale.map((host) => ({
    source: "/:path((?!api/billing/yookassa|api/telegram/webhook).*)",
    has: [{ type: "host" as const, value: host }],
    destination: `${main.origin}/:path`,
    permanent: true,
  }));
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "libsql"],
  poweredByHeader: false,
  async redirects() {
    return redirectsToMainHost();
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
