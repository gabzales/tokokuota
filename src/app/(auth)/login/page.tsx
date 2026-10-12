import { AuthForm } from "@/components/AuthForm";
import { safeNextPath } from "@/lib/auth/redirect";
import { loginAction } from "../actions";

export const metadata = { title: "Masuk — Toko Kuota" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <>
      <h2 className="mb-4 text-lg font-semibold">Masuk</h2>
      {error === "link" && (
        <p role="alert" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Tautan tidak valid atau sudah kedaluwarsa. Buka tautan di browser yang sama dengan saat kamu memintanya, atau minta tautan baru lewat &ldquo;Lupa password&rdquo;.
        </p>
      )}
      <AuthForm mode="login" action={loginAction} next={safeNextPath(next)} />
    </>
  );
}
