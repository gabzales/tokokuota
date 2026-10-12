export type Aal = "aal1" | "aal2" | null;
export type AdminAccess = "DENY" | "NEEDS_MFA" | "OK";

/** MFA is required for admins unless ADMIN_MFA_REQUIRED is explicitly "false" (local development only). */
export const mfaRequired = (env: Record<string, string | undefined> = process.env) => env.ADMIN_MFA_REQUIRED !== "false";

/**
 * Pure access decision, shared by pages and server actions:
 *   not an active admin            -> DENY (404)
 *   admin, MFA not required        -> OK
 *   admin, session is aal2 (TOTP)  -> OK
 *   admin, session is only aal1    -> NEEDS_MFA (sent to /mfa)
 */
export function adminAccess(p: { isAdmin: boolean; aal: Aal; required: boolean }): AdminAccess {
  if (!p.isAdmin) return "DENY";
  if (!p.required) return "OK";
  return p.aal === "aal2" ? "OK" : "NEEDS_MFA";
}
