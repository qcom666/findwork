import { appBaseUrl } from "@/lib/billing";
import { emailConfigured } from "@/lib/email";
import { json, readJson } from "@/lib/http";
import { allow, clientIp } from "@/lib/ratelimit";
import { requestPasswordReset } from "@/lib/reset";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await readJson<{ email?: string }>(req);
  if (!b) return json({ error: "Некорректный запрос" }, 400);
  if (!emailConfigured()) return json({ ok: true, configured: false });

  const email = String(b.email ?? "").trim().toLowerCase().slice(0, 254);
  // Лимит и по адресу, и по e-mail: нельзя ни забить чужой ящик письмами, ни перебирать адреса.
  const okIp = await allow(`forgot-ip:${clientIp(req)}`, 8, 3600);
  const okMail = await allow(`forgot-mail:${email}`, 3, 3600);
  if (!okIp || !okMail) return json({ error: "Слишком много запросов. Попробуйте через час." }, 429);

  try {
    await requestPasswordReset(email, appBaseUrl(req));
  } catch (e) {
    console.error("[reset] не удалось отправить письмо", e);
    return json({ error: "Не удалось отправить письмо. Попробуйте позже." }, 502);
  }
  // Ответ одинаковый, есть такой e-mail или нет.
  return json({ ok: true, configured: true });
}
