"use client";
import { ErrorPanel } from "@/components/ErrorPanel";
export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="mx-auto max-w-5xl px-4 py-10"><ErrorPanel {...props} backHref="/dashboard" backLabel="Ke dashboard" /></main>;
}
