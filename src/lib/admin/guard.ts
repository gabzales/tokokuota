/** Pure role check, shared by the page guard and the action guard (unit-tested). */
export function isActiveAdmin(p: { role?: string | null; is_active?: boolean | null } | null | undefined): boolean {
  return Boolean(p && p.role === "admin" && p.is_active === true);
}
