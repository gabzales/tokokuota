import { ForgotPasswordForm } from "@/components/PasswordForms";
import { forgotPasswordAction } from "../actions";

export const metadata = { title: "Lupa password — Toko Kuota" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h2 className="mb-1 text-lg font-semibold">Lupa password</h2>
      <p className="mb-4 text-sm text-muted">Masukkan email akunmu.</p>
      <ForgotPasswordForm action={forgotPasswordAction} />
    </>
  );
}
