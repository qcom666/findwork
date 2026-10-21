import { LegalDoc } from "@/components/LegalDoc";
import { consentSections } from "@/lib/legal";

export const metadata = { title: "Согласие на обработку персональных данных" };

export const dynamic = "force-dynamic";

export default function Consent() {
  return <LegalDoc title="Согласие на обработку персональных данных" sections={consentSections()} toc={false} />;
}
