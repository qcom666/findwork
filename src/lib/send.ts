/** Ссылки для отправки первого сообщения в один клик. Отправляет всегда сам человек: мы только подставляем текст. */

const digits = (phone: string) => phone.replace(/\D/g, "");

/** Номер в формате 79XXXXXXXXX: только мобильные, у городских номеров WhatsApp и Telegram обычно нет. */
export function mobileNumber(phones: string[]): string | null {
  const m = phones.find((p) => /^\+79\d{9}$/.test(p));
  return m ? digits(m) : null;
}

export function whatsappUrl(phones: string[], text: string): string | null {
  const n = mobileNumber(phones);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

/** Ссылка на чат по номеру. Telegram не умеет подставлять текст в такую ссылку, поэтому текст копируется отдельно. */
export function telegramUrl(phones: string[]): string | null {
  const n = mobileNumber(phones);
  return n ? `https://t.me/+${n}` : null;
}

export function mailtoUrl(email: string | null, subject: string, body: string): string | null {
  if (!email) return null;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function telUrl(phones: string[]): string | null {
  const p = phones[0];
  return p ? `tel:${p}` : null;
}
