/** Блоки статьи. Внутри текста работают ссылки [текст](/путь) и выделение **жирным**. */
export type Block =
  | { t: "p"; text: string }
  | { t: "h2"; text: string }
  | { t: "h3"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "quote"; text: string; note?: string }
  | { t: "callout"; title: string; text: string };

export type Article = {
  slug: string;
  title: string;
  description: string;
  /** Дата публикации, ГГГГ-ММ-ДД. */
  date: string;
  tags: string[];
  /** Куда ведёт блок «Найти такие заведения» в конце статьи. */
  cta: { text: string; href: string; label: string };
  /** Слаги статей для блока «Читайте также». */
  related: string[];
  blocks: Block[];
};

/** Минуты чтения по 200 слов в минуту, не меньше одной. */
export function readingMinutes(a: Article): number {
  const words = a.blocks
    .map((b) => ("text" in b ? b.text : "items" in b ? b.items.join(" ") : ""))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
