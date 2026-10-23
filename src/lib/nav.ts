/** Безопасный адрес для возврата после входа: только путь внутри сайта. */
export function safeNext(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  // Пробелы и управляющие символы браузер из адреса выбрасывает: «/\t/evil.com» превратился бы в «//evil.com», то есть чужой сайт.
  return s && s.length < 500 && s.startsWith("/") && !s.startsWith("//") && !s.includes("\\") && !/[\s\x00-\x1f\x7f]/.test(s) ? s : "/";
}
