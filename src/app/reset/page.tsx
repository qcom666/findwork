import Link from "next/link";
import { ResetForm } from "@/components/ResetForm";

export const metadata = { title: "Новый пароль", robots: { index: false, follow: false } };

export default async function Reset({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = (await searchParams).token;
  const token = typeof t === "string" ? t : "";
  if (!token) {
    return (
      <div className="card mx-auto max-w-sm p-6 text-center">
        <p>В ссылке нет кода для сброса.</p>
        <Link href="/forgot" className="mt-3 inline-block text-accent hover:underline">Запросить новую ссылку</Link>
      </div>
    );
  }
  return <ResetForm token={token} />;
}
