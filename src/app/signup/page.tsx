import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/auth";
import { SIGNUP_BONUS } from "@/lib/credits";
import { safeNext } from "@/lib/nav";
import { telegramBotUsername, telegramConfigured } from "@/lib/telegram";

export const metadata = { title: "Регистрация" };

export default async function Signup({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = safeNext((await searchParams).next);
  if (await getCurrentUser()) redirect(next);
  const tg = telegramConfigured();
  return <AuthForm mode="signup" next={next} bonus={SIGNUP_BONUS} telegramBot={tg ? telegramBotUsername() : null} telegramHint={!tg && process.env.NODE_ENV !== "production"} />;
}
