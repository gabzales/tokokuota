"use client";
import { ErrorPanel } from "@/components/ErrorPanel";
export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPanel {...props} backHref="/admin" backLabel="Ke dashboard admin" />;
}
