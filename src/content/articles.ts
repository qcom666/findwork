import { articlesA } from "./articles-a";
import { articlesB } from "./articles-b";
import { articlesC } from "./articles-c";
import type { Article } from "./types";

export { readingMinutes } from "./types";
export type { Article } from "./types";

/** Все статьи, новые выше. При равных датах сохраняется порядок, в котором они написаны. */
export const ARTICLES: Article[] = [...articlesA, ...articlesB, ...articlesC].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

export const getArticle = (slug: string): Article | undefined => ARTICLES.find((a) => a.slug === slug);

export const formatDate = (iso: string): string =>
  new Date(iso + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
