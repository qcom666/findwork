/** Превью скрытых контактов: достаточно, чтобы оценить лид, и недостаточно, чтобы позвонить. */

export function maskPhone(p: string | null): string | null {
  if (!p) return null;
  const m = p.match(/^\+7(\d{3})\d{7}$/);
  return m ? `+7 (${m[1]}) •••-••-••` : "+7 •••••••••";
}

export function maskEmail(e: string | null): string | null {
  if (!e || !e.includes("@")) return null;
  return "•••@" + e.split("@")[1];
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
