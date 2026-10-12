import { ResetPasswordForm } from "@/components/PasswordForms";
import { requireUser } from "@/lib/auth/require-user";
import { resetPasswordAction } from "../actions";

export const metadata = { title: "Atur ulang password — Toko Kuota" };

export default async function ResetPasswordPage() {
  await requireUser(); // needs the session created by the e-mailed link
  return (
    <>
      <h2 className="mb-4 text-lg font-semibold">Atur password baru</h2>
      <ResetPasswordForm action={resetPasswordAction} />
    </>
  );
}
