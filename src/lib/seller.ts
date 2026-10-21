/** Реквизиты продавца для оферты и политики. Заполняются переменными окружения; пока пусто, на странице видны заглушки. */
const val = (v: string | undefined, hint: string) => (v && v.trim() ? v.trim() : `[${hint}]`);
const opt = (v: string | undefined) => (v && v.trim() ? v.trim() : "");

const SELF_EMPLOYED = "самозанятый (плательщик налога на профессиональный доход)";

export const seller = {
  name: () => val(process.env.SELLER_NAME, "укажите ФИО самозанятого, ИП или название ООО в SELLER_NAME"),
  inn: () => val(process.env.SELLER_INN, "укажите ИНН в SELLER_INN"),
  email: () => val(process.env.SUPPORT_EMAIL, "укажите почту поддержки в SUPPORT_EMAIL"),
  /** Правовой статус для оферты. По умолчанию самозанятый: для ИП или ООО задайте SELLER_STATUS, например «индивидуальный предприниматель». */
  status: () => opt(process.env.SELLER_STATUS) || SELF_EMPLOYED,
  selfEmployed: () => !opt(process.env.SELLER_STATUS) || /самозанят|нпд|профессиональн/i.test(opt(process.env.SELLER_STATUS)),
  ogrn: () => opt(process.env.SELLER_OGRN),
  address: () => opt(process.env.SELLER_ADDRESS),
  phone: () => opt(process.env.SELLER_PHONE),
  telegram: () => opt(process.env.SELLER_TELEGRAM),
  /** Где физически лежит база с персональными данными в РФ. Пока не задано, политика честно называет текущего провайдера. */
  ruHost: () => opt(process.env.PD_RU_HOST),
  configured: () => !!(process.env.SELLER_NAME && process.env.SELLER_INN && process.env.SUPPORT_EMAIL),
};
