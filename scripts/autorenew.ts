/**
 * Один обход автопродлений: напоминания в Telegram за сутки и списания (src/lib/autorenew.ts).
 * На сервере его раз в час запускает таймер lidomap-autorenew (deploy/server), с настройками сайта из /etc/lidomap/env.
 *
 *   npx tsx scripts/autorenew.ts
 */
import { runAutorenewals } from "../src/lib/autorenew";

runAutorenewals()
  .then((r) => {
    console.log(`напоминаний ${r.notified}, списано ${r.charged}, повторов ${r.retries}, отключено ${r.disabled}, ошибок ${r.errors}`);
    process.exit(r.errors > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
