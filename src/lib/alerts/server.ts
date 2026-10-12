import "server-only";
import { after } from "next/server";
import { sendAlert, type Alert } from "./notify";

/** Fire-and-forget: runs after the response is sent, so alerting never slows a request down. */
export function notify(a: Alert): void {
  try {
    after(() => sendAlert(a));
  } catch {
    void sendAlert(a); // outside a request scope (e.g. scripts)
  }
}

export const adminLabel = (actor: { email: string | null; id: string }) => actor.email ?? actor.id.slice(0, 8);
