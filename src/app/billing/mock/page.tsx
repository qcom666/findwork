import { notFound, redirect } from "next/navigation";
import { MockPay } from "@/components/Small";
import { getCurrentUser } from "@/lib/auth";
import { getPayment, mockMode } from "@/lib/billing";

export const metadata = { title: "Тестовая оплата" };

export default async function MockCheckout({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!mockMode()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  const p = typeof sp.payment === "string" ? await getPayment(user.id, sp.payment) : null;
  if (!p || p.provider !== "mock") notFound();

  return (
    <div className="mx-auto max-w-md card !border-warn p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-warn">Тестовый режим, деньги не списываются</p>
      <h1 className="mt-2 text-xl font-semibold">Оплата {p.credits} кредитов</h1>
      <p className="mt-1 text-muted">К оплате: {p.amountRub.toLocaleString("ru-RU")} ₽</p>
      <div className="mt-5">{p.status === "pending" ? <MockPay paymentId={p.id} /> : <p className="text-sm text-muted">Платёж уже обработан: {p.status}</p>}</div>
    </div>
  );
}
