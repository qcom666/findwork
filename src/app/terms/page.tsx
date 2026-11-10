import { LegalDoc } from "@/components/LegalDoc";
import { offerSections } from "@/lib/legal";

export const metadata = { title: "Публичная оферта", description: "Условия оказания услуг сервиса Lidomap: кредиты, подписка, оплата и возврат.", alternates: { canonical: "/terms" } };

// Реквизиты и цены читаются из окружения и кода при запросе.
export const dynamic = "force-dynamic";

export default function Terms() {
  return <LegalDoc title="Публичная оферта" sections={offerSections()} lead="Договор на оказание платных услуг сервиса Lidomap. Он же служит пользовательским соглашением." />;
}
