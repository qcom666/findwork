/**
 * Отправка писем через Resend (HTTP API). Включается двумя переменными: RESEND_API_KEY и EMAIL_FROM
 * (например, «FindWork <noreply@ваш-домен>»; домен нужно подтвердить в Resend).
 * Пока их нет, функции, которым нужна почта (сброс пароля), честно говорят, что она не настроена.
 */
export function emailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(m: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  const res = await fetch(process.env.RESEND_API_URL ?? "https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [m.to], subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) }),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
}
