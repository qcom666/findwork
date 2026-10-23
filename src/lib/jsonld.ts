/**
 * JSON для <script type="application/ld+json">. JSON.stringify не экранирует «<», и строка «</script>» в названии из
 * открытых данных закрыла бы тег и дала вставить свой скрипт. Экранируем <, >, & и разделители строк.
 */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
