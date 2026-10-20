/** Реквизиты продавца для оферты. Заполняются переменными окружения; пока пусто, на странице видны заглушки. */
const val = (v: string | undefined, hint: string) => (v && v.trim() ? v.trim() : `[${hint}]`);

export const seller = {
  name: () => val(process.env.SELLER_NAME, "укажите ФИО самозанятого, ИП или название ООО в SELLER_NAME"),
  inn: () => val(process.env.SELLER_INN, "укажите ИНН в SELLER_INN"),
  email: () => val(process.env.SUPPORT_EMAIL, "укажите почту поддержки в SUPPORT_EMAIL"),
  configured: () => !!(process.env.SELLER_NAME && process.env.SELLER_INN && process.env.SUPPORT_EMAIL),
};
