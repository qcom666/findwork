import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/auth";
import { SIGNUP_BONUS } from "@/lib/credits";
import { safeNext } from "@/lib/nav";

export const metadata = { title: "Вход — FindWork" };

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = safeNext((await searchParams).next);
  if (await getCurrentUser()) redirect(next);
  return <AuthForm mode="login" next={next} bonus={SIGNUP_BONUS} />;
}
