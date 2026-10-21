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
  `CREATE TABLE IF NOT EXISTS lead_notes (
     user_id INTEGER NOT NULL REFERENCES users(id),
     lead_id TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'new',
     note TEXT NOT NULL DEFAULT '',
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, lead_id)
   )`,
  `CREATE TABLE IF NOT EXISTS lead_pitches (
     user_id INTEGER NOT NULL REFERENCES users(id),
     lead_id TEXT NOT NULL,
     service TEXT NOT NULL,
     channel TEXT NOT NULL,
     subject TEXT NOT NULL DEFAULT '',
     message TEXT NOT NULL,
     followup TEXT NOT NULL DEFAULT '',
     angle TEXT NOT NULL DEFAULT '',
     source TEXT NOT NULL DEFAULT 'template',
     created_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, lead_id)
   )`,
  `CREATE TABLE IF NOT EXISTS password_resets (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id),
     expires_at INTEGER NOT NULL,
     used INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_resets_user ON password_resets(user_id)`,
  `CREATE TABLE IF NOT EXISTS promo_codes (
     code TEXT PRIMARY KEY,
     credits INTEGER NOT NULL,
     max_uses INTEGER,
     used INTEGER NOT NULL DEFAULT 0,
     expires_at INTEGER,
     note TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS promo_redemptions (
     user_id INTEGER NOT NULL REFERENCES users(id),
     code TEXT NOT NULL REFERENCES promo_codes(code),
     created_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, code)
   )`,
  `CREATE TABLE IF NOT EXISTS referral_rewards (
     referred_id INTEGER PRIMARY KEY REFERENCES users(id),
     referrer_id INTEGER NOT NULL REFERENCES users(id),
     credits INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_referral_referrer ON referral_rewards(referrer_id)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
     key TEXT PRIMARY KEY,
     n INTEGER NOT NULL,
     reset_at INTEGER NOT NULL
   )`,
  // Подписка оплачивается один раз на months месяцев; кредиты за каждый месяц начисляются по графику (granted: сколько месяцев уже начислено).
  `CREATE TABLE IF NOT EXISTS subscriptions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users(id),
     payment_id TEXT NOT NULL UNIQUE,
     plan_id TEXT NOT NULL,
     months INTEGER NOT NULL,
     credits_per_month INTEGER NOT NULL,
     starts_at INTEGER NOT NULL,
     ends_at INTEGER NOT NULL,
     granted INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_subs_user ON subscriptions(user_id, starts_at)`,
  // Эксклюзив: пока until не наступил, заведение не могут открыть другие пользователи. Одна запись на заведение.
  `CREATE TABLE IF NOT EXISTS lead_claims (
     lead_id TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id),
     created_at INTEGER NOT NULL,
     until INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_claims_user ON lead_claims(user_id, until)`,
  // Отчёт о проверке сайта для клиента по публичной ссылке. profile и findings: JSON. consent_at: когда автор разрешил показать свои контакты на странице.
  `CREATE TABLE IF NOT EXISTS audit_reports (
     token TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id),
     lead_id TEXT NOT NULL,
     lead_name TEXT NOT NULL,
     site_url TEXT NOT NULL,
     findings TEXT NOT NULL,
     profile TEXT NOT NULL,
     charged INTEGER NOT NULL DEFAULT 0,
     views INTEGER NOT NULL DEFAULT 0,
     revoked INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     consent_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_reports_user ON audit_reports(user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_reports_lead ON audit_reports(user_id, lead_id)`,
  // Вход через бота: браузер просит ссылку на бота, человек нажимает Start и подтверждает вход в Telegram, браузер опрашивает состояние.
  // Хранится только хеш секрета. state: pending (ждём Start), asked (бот спросил «это вы?»), confirmed, denied, consumed.
  `CREATE TABLE IF NOT EXISTS tg_login_requests (
     token_hash TEXT PRIMARY KEY,
     mode TEXT NOT NULL,
     user_id INTEGER,
     state TEXT NOT NULL DEFAULT 'pending',
     tg_id INTEGER,
     tg_username TEXT,
     tg_name TEXT,
     ip TEXT NOT NULL DEFAULT '',
     ua TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_tgreq_expires ON tg_login_requests(expires_at)`,
  // След объединения аккаунтов (привязка Telegram к аккаунту с почтой): кого во что влили и что перенесли. Нужен для разбора споров.
  `CREATE TABLE IF NOT EXISTS account_merges (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     source_id INTEGER NOT NULL,
     target_id INTEGER NOT NULL,
     source_email TEXT NOT NULL,
     summary TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
];

/** Колонки, добавленные позже создания таблицы users. Безопасно запускать повторно и из нескольких процессов сразу. */
async function migrate(client: Client): Promise<void> {
  const addColumns = async (table: string, columns: readonly (readonly [string, string])[]) => {
    const have = (await client.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name));
    for (const [name, ddl] of columns) {
      if (have.includes(name)) continue;
      try {
        await client.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
      } catch (e) {
        if (!/duplicate column/i.test((e as Error).message)) throw e;
      }
    }
  };

  // sub_next_at: когда подписке пора начислить следующий месяц (NULL: начислять нечего). consent_*: когда и какую редакцию документов принял пользователь. tg_*: вход через Telegram (почты у такого аккаунта нет, вместо неё служебный адрес).
  await addColumns("users", [["ref_code", "TEXT"], ["referred_by", "INTEGER"], ["sub_next_at", "INTEGER"], ["consent_at", "INTEGER"], ["consent_ver", "TEXT"], ["tg_id", "INTEGER"], ["tg_username", "TEXT"], ["display_name", "TEXT"]]);
  await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_users_ref ON users(ref_code)");
  // Вход через Telegram: tg_id один на аккаунт (у аккаунтов с почтой он пустой, пустые значения в уникальном индексе не конфликтуют).
  await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_users_tg ON users(tg_id)");
  await addColumns("promo_codes", [["revoked", "INTEGER NOT NULL DEFAULT 0"]]);
  // kind: credits (пакет) или subscription (тогда plan_id и months заполнены, а credits: всего кредитов за срок).
  await addColumns("payments", [["kind", "TEXT NOT NULL DEFAULT 'credits'"], ["plan_id", "TEXT"], ["months", "INTEGER"]]);
}

export function appDb(): Promise<Client> {
  g.__fwApp ??= (async () => {
    const client = createClient({
      url: process.env.APP_DB_URL || "file:data/app.db",
      authToken: process.env.APP_DB_AUTH_TOKEN || undefined,
    });
    await client.batch(SCHEMA, "write");
    await migrate(client);
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
  await migrate(client);
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
