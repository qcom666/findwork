import { NextResponse } from "next/server";
import { getCurrentUser, type User } from "./auth";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

/**
 * Защита от CSRF для POST-ручек: куки с SameSite=Lax плюс проверка, что запрос пришёл со страницы нашего же сайта.
 * Запросы без заголовка Origin (curl, серверные вызовы) пропускаем: они не несут куки браузера жертвы.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function readJson<T>(req: Request): Promise<T | null> {
  if (!sameOrigin(req)) return null;
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return null;
  return (await req.json().catch(() => null)) as T | null;
}

/** Пользователь или готовый ответ 401. */
export async function needUser(): Promise<{ user: User } | { error: NextResponse }> {
  const user = await getCurrentUser();
  return user ? { user } : { error: json({ error: "Войдите в аккаунт" }, 401) };
}
