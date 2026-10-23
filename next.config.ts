import type { NextConfig } from "next";

/** Адреса, с которых уходим на основной: прежний адрес Vercel и www. Вебхуки ЮKassa и Telegram и пересылка к Bot API (/api/tg-relay/) остаются на месте. */
function redirectsToMainHost() {
  const raw = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (!raw) return [];
  let main: URL;
  try { main = new URL(raw); } catch { return []; }
  const stale = ["findwork-rouge.vercel.app", `www.${main.hostname}`].filter((h) => h !== main.hostname);
  return stale.map((host) => ({
    source: "/:path((?!api/billing/yookassa|api/telegram/webhook|api/tg-relay/).*)",
    has: [{ type: "host" as const, value: host }],
    destination: `${main.origin}/:path`,
    permanent: true,
  }));
}

/**
 * Сайт работает на сервере в Москве, а копия на Vercel осталась запасной. Уведомления ЮKassa и Telegram, которые ещё
 * приходят на старый адрес, Vercel пересылает на основной сервер (FORWARD_WEBHOOKS_TO задан только на Vercel),
 * иначе они попали бы в старую базу.
 */
function forwardWebhooks() {
  const to = process.env.FORWARD_WEBHOOKS_TO?.trim().replace(/\/+$/, "");
  if (!to) return [];
  return ["/api/billing/yookassa", "/api/telegram/webhook"].map((p) => ({ source: p, destination: `${to}${p}` }));
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "libsql"],
  poweredByHeader: false,
  async redirects() {
    return redirectsToMainHost();
  },
  async rewrites() {
    return { beforeFiles: forwardWebhooks(), afterFiles: [], fallback: [] };
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
          // Сайт ничего не грузит со сторонних адресов: чужой скрипт, внедрённый через данные, не загрузится и не отправит их наружу.
          // Встроенные скрипты Next.js требуют 'unsafe-inline'; 'unsafe-eval' нужен только при разработке.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
