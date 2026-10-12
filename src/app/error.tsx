"use client";
import { ErrorPanel } from "@/components/ErrorPanel";
export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <main id="main" className="mx-auto flex min-h-screen max-w-md items-center p-6"><ErrorPanel {...props} backHref="/" backLabel="Ke beranda" /></main>;
}
