import { createClient, type Client, type Transaction } from "@libsql/client";

/**
 * Две базы на libSQL (SQLite-совместимый протокол).
 *  - leads: каталог заведений, собирается скриптами из ingest/ и только читается приложением;
 *  - app: пользователи, кредиты, платежи. Пишется приложением, пересобирать её нельзя.
 * Локально это файлы (file:data/...), на Vercel это облачные базы Turso (libsql://...).
 */
type G = { __fwLeads?: Client; __fwApp?: Promise<Client>; __fwReady?: boolean };
const g = globalThis as unknown as G;

export function leadsDb(): Client {
  g.__fwLeads ??= createClient({
    url: process.env.LEADS_DB_URL || "file:data/leads.db",
    authToken: process.env.LEADS_DB_AUTH_TOKEN || undefined,
  });
  return g.__fwLeads;
}

export async function dbReady(): Promise<boolean> {
  if (g.__fwReady) return true;
  try {
    await leadsDb().execute("SELECT 1 FROM meta LIMIT 1");
    g.__fwReady = true;
    return true;
  } catch {
    return false;
  }
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     email TEXT NOT NULL UNIQUE,
     pass_hash TEXT NOT NULL,
     balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id),
     expires_at INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS ledger (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users(id),
     delta INTEGER NOT NULL,
     reason TEXT NOT NULL,
     ref TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_ledger_user ON ledger(user_id, id DESC)`,
  `CREATE TABLE IF NOT EXISTS unlocks (
     user_id INTEGER NOT NULL REFERENCES users(id),
     lead_id TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, lead_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_unlocks_user_time ON unlocks(user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS payments (
     id TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id),
     package_id TEXT NOT NULL,
     credits INTEGER NOT NULL,
     amount_kop INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending',
     provider TEXT NOT NULL,
     provider_payment_id TEXT,
     created_at INTEGER NOT NULL,
     paid_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS ix_payments_user ON payments(user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_payments_provider ON payments(provider_payment_id)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
     key TEXT PRIMARY KEY,
     n INTEGER NOT NULL,
     reset_at INTEGER NOT NULL
   )`,
];

export function appDb(): Promise<Client> {
  g.__fwApp ??= (async () => {
    const client = createClient({
      url: process.env.APP_DB_URL || "file:data/app.db",
      authToken: process.env.APP_DB_AUTH_TOKEN || undefined,
    });
    await client.batch(SCHEMA, "write");
    return client;
  })().catch((e) => {
    g.__fwApp = undefined; // не кэшируем неудачу: следующий запрос попробует снова
    throw e;
  });
  return g.__fwApp;
}

/** Только для тестов: подменяет базу приложения на новую по указанному адресу. */
export async function __resetAppDbForTests(url: string): Promise<Client> {
  const client = createClient({ url });
  await client.batch(SCHEMA, "write");
  g.__fwApp = Promise.resolve(client);
  return client;
}

function isBusy(e: unknown): boolean {
  const x = e as { code?: string; message?: string };
  return x?.code === "SQLITE_BUSY" || /SQLITE_BUSY|database is locked/i.test(x?.message ?? "");
}

/**
 * Запись одной транзакцией. Если база занята другой записью (локальный файл или очередь на сервере),
 * ждём и повторяем: без этого два одновременных клика «Открыть» упирались бы в SQLITE_BUSY.
 * fn возвращает значение, а rollback: true отменяет транзакцию (например, не хватило кредитов).
 */
export async function writeTx<T>(fn: (tx: Transaction) => Promise<{ value: T; rollback?: boolean }>): Promise<T> {
  const db = await appDb();
  for (let attempt = 0; ; attempt++) {
    let tx: Transaction;
    try {
      tx = await db.transaction("write");
    } catch (e) {
      if (isBusy(e) && attempt < 40) {
        await new Promise((r) => setTimeout(r, 10 + Math.random() * 30 * Math.min(attempt + 1, 8)));
        continue;
      }
      throw e;
    }
    try {
      const out = await fn(tx);
      if (out.rollback) await tx.rollback();
      else await tx.commit();
      return out.value;
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw e;
    } finally {
      tx.close();
    }
  }
}
