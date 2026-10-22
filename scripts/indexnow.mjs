#!/usr/bin/env node
/**
 * Сообщает Яндексу по протоколу IndexNow о страницах сайта, чтобы робот пришёл за ними быстрее, чем найдёт сам.
 * Ключ публичный по замыслу протокола: файл public/<ключ>.txt лежит на сайте, и Яндекс по нему проверяет, что адреса прислал владелец.
 *
 *   node scripts/indexnow.mjs                      все адреса из https://lidomap.ru/sitemap.xml
 *   node scripts/indexnow.mjs /blog/new-post ...   только перечисленные страницы
 *
 * Запускать после выкладки, когда появились новые страницы (статья, города, ниши). Яндекс принимает до 10 000 адресов за раз.
 */
import { readdirSync } from "node:fs";

const SITE = process.env.SITE_URL || "https://lidomap.ru";
const ENDPOINT = "https://yandex.com/indexnow";
const key = readdirSync(new URL("../public/", import.meta.url)).map((f) => f.match(/^([0-9a-f]{32})\.txt$/)?.[1]).find(Boolean);
if (!key) throw new Error("Нет файла ключа public/<32 hex>.txt");

const headers = { "User-Agent": "Mozilla/5.0 (compatible; LidomapIndexNow/1.0)" };
let urls = process.argv.slice(2).map((p) => new URL(p, SITE).toString());
if (!urls.length) {
  const res = await fetch(`${SITE}/sitemap.xml`, { headers });
  if (!res.ok) throw new Error(`sitemap.xml: HTTP ${res.status}`);
  urls = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}
const host = new URL(SITE).host;
urls = [...new Set(urls)].filter((u) => new URL(u).host === host);
if (!urls.length) throw new Error("Нечего отправлять");

for (let i = 0; i < urls.length; i += 10000) {
  const urlList = urls.slice(i, i + 10000);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key, keyLocation: `${SITE}/${key}.txt`, urlList }),
  });
  const body = (await res.text()).slice(0, 300);
  console.log(`IndexNow: ${urlList.length} адресов → HTTP ${res.status}${body ? ` ${body}` : ""}`);
  if (!res.ok) process.exitCode = 1;
}
