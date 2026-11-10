import { ForgotForm } from "@/components/ForgotForm";

export const metadata = { title: "Сброс пароля", robots: { index: false, follow: false } };

export default function Forgot() {
  return <ForgotForm supportEmail={process.env.SUPPORT_EMAIL?.trim() || null} />;
}
