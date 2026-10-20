/** Безопасный адрес для возврата после входа: только путь внутри сайта. */
export function safeNext(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.startsWith("/") && !s.startsWith("//") && !s.includes("\\") ? s : "/";
}
