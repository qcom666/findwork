import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARTICLES, getArticle, readingMinutes } from "../src/content/articles";

const STATIC = ["/", "/leads", "/my", "/about", "/pricing", "/signup", "/login", "/terms", "/privacy", "/refund", "/contacts", "/consent", "/blog"];

function textsOf(a: (typeof ARTICLES)[number]): string[] {
  const out: string[] = [a.description, a.cta.text];
  for (const b of a.blocks) {
    if ("text" in b) out.push(b.text);
    if ("items" in b) out.push(...b.items);
    if (b.t === "callout") out.push(b.title);
  }
  return out;
}

describe("статьи блога", () => {
  it("достаточно статей, слаги уникальны и подходят для адреса", () => {
    assert.ok(ARTICLES.length >= 8);
    const slugs = ARTICLES.map((a) => a.slug);
    assert.equal(new Set(slugs).size, slugs.length);
    for (const s of slugs) assert.match(s, /^[a-z0-9-]+$/);
  });

  it("у каждой статьи есть заголовок, описание нужной длины, дата, теги и содержательный текст", () => {
    for (const a of ARTICLES) {
      assert.ok(a.title.length >= 20 && a.title.length <= 110, `заголовок: ${a.slug}`);
      assert.ok(a.description.length >= 60 && a.description.length <= 230, `описание (${a.description.length}): ${a.slug}`);
      assert.match(a.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(a.tags.length >= 2, a.slug);
      assert.ok(a.blocks.filter((b) => b.t === "h2").length >= 3, `мало разделов: ${a.slug}`);
      assert.ok(readingMinutes(a) >= 2, `слишком короткая: ${a.slug}`);
    }
  });

  it("ссылки «читайте также» и ссылки внутри текста ведут на существующие страницы", () => {
    for (const a of ARTICLES) {
      for (const r of a.related) assert.ok(getArticle(r), `${a.slug}: нет статьи ${r}`);
      assert.ok(!a.related.includes(a.slug), `${a.slug} ссылается сам на себя`);
      const links = [a.cta.href, ...textsOf(a).flatMap((t) => [...t.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]))];
      for (const href of links) {
        const path = href.split("?")[0].split("#")[0];
        const ok = STATIC.includes(path) || (path.startsWith("/blog/") && !!getArticle(path.slice(6)));
        assert.ok(ok, `${a.slug}: ссылка ${href} никуда не ведёт`);
      }
    }
  });

  it("в тексте нет выдуманных цифр результатов и обещаний", () => {
    const banned = [/гарантир/i, /в \d+ раз(а)? больше/i, /конверси[яи] \d+/i, /\d+\s?%\s+(ответ|клиент)/i];
    for (const a of ARTICLES) for (const t of textsOf(a)) for (const re of banned) assert.ok(!re.test(t), `${a.slug}: «${t.slice(0, 60)}…» подпадает под ${re}`);
  });

  it("статья про закон содержит оговорку, что это не юридическая консультация", () => {
    const law = getArticle("holodnye-soobsheniya-i-zakon")!;
    assert.ok(law.blocks.some((b) => b.t === "callout" && /не юридическая консультация/i.test(b.title)));
  });
});
