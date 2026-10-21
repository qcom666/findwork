import { LegalDoc } from "@/components/LegalDoc";
import { privacySections } from "@/lib/legal";

export const metadata = { title: "Политика конфиденциальности", description: "Как FindWork обрабатывает и защищает персональные данные пользователей." };

export const dynamic = "force-dynamic";

export default function Privacy() {
  return <LegalDoc title="Политика конфиденциальности" sections={privacySections()} lead="Политика в отношении обработки персональных данных в соответствии с 152-ФЗ." />;
}
