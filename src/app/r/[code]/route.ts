import { NextResponse } from "next/server";
import { baseUrl } from "@/lib/brand";
import { REF_RE } from "@/lib/users";

export const runtime = "nodejs";

/** Ссылка-приглашение: запоминаем код на 30 дней и ведём на регистрацию. Неподходящий код просто игнорируется. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  // Адрес сайта берём из настроек: за nginx req.url указывает на внутренний localhost:3000.
  const res = NextResponse.redirect(new URL("/signup", process.env.APP_URL ? baseUrl() : req.url));
  if (REF_RE.test(code)) {
    res.cookies.set("fw_ref", code, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 30 * 86400 });
  }
  return res;
}
