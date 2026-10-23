/** Превью скрытых контактов: достаточно, чтобы оценить лид, и недостаточно, чтобы позвонить. */

export function maskPhone(p: string | null): string | null {
  if (!p) return null;
  const m = p.match(/^\+7(\d{3})\d{7}$/);
  return m ? `+7 (${m[1]}) •••-••-••` : "+7 •••••••••";
}

// Общие почтовые сервисы: по домену ничего не узнать. Свой домен заведения (info@cafe.ru) выдал бы сайт и почти весь адрес.
const PUBLIC_MAIL = new Set([
  "gmail.com", "mail.ru", "bk.ru", "list.ru", "inbox.ru", "internet.ru", "yandex.ru", "ya.ru", "yandex.com", "rambler.ru",
  "icloud.com", "me.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "proton.me", "protonmail.com",
]);

export function maskEmail(e: string | null): string | null {
  if (!e || !e.includes("@")) return null;
  const domain = e.split("@")[1].toLowerCase();
  if (PUBLIC_MAIL.has(domain)) return "•••@" + domain;
  const tld = domain.split(".").pop();
  return tld ? `•••@•••.${tld}` : "•••@•••";
}

const NAMES: [RegExp, string][] = [
  [/vk\.(com|ru)/, "ВКонтакте"],
  [/instagram\.com/, "Instagram"],
  [/facebook\.com|fb\.(com|me)/, "Facebook"],
  [/t\.me|telegram/, "Telegram"],
  [/wa\.me|whatsapp/, "WhatsApp"],
  [/ok\.ru/, "Одноклассники"],
  [/youtube|youtu\.be/, "YouTube"],
  [/tiktok/, "TikTok"],
  [/dzen/, "Дзен"],
];

export function socialNames(urls: string[]): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    const hit = NAMES.find(([re]) => re.test(u));
    out.add(hit ? hit[1] : "Соцсеть");
  }
  return [...out];
}
