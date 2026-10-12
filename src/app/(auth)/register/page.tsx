import { AuthForm } from "@/components/AuthForm";
import { registerAction } from "../actions";

export const metadata = { title: "Daftar — Toko Kuota" };

export default function RegisterPage() {
  return (
    <>
      <h2 className="mb-4 text-lg font-semibold">Buat akun</h2>
      <AuthForm mode="register" action={registerAction} />
    </>
  );
}
