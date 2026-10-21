/**
 * Небольшой кэш в памяти процесса с временем жизни. Справочники и цифры для главной меняются раз в сборку базы,
 * поэтому нет смысла ходить за ними в удалённую базу при каждом открытии страницы.
 * Хранит обещание, а не значение: одновременные запросы делят один обращение к базе.
 */
type Entry = { at: number; p: Promise<unknown> };
const store = new Map<string, Entry>();

export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p as Promise<T>;

  const p = fn().catch((e) => {
    if (store.get(key)?.p === p) store.delete(key); // ошибку не запоминаем
    throw e;
  });
  store.set(key, { at: Date.now(), p });

  if (store.size > 300) {
    let oldest: string | undefined;
    for (const [k, v] of store) if (!oldest || v.at < store.get(oldest)!.at) oldest = k;
    if (oldest) store.delete(oldest);
  }
  return p;
}

export function clearCache(): void {
  store.clear();
}
