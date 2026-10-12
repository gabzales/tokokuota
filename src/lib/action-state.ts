/** Result of a server action that backs a form: rendered inline AND as a toast. */
export interface ActionState {
  ok?: boolean;
  message?: string;
  error?: string;
  details?: string[];
}
export const okState = (message: string, details?: string[]): ActionState => ({ ok: true, message, details });
export const failState = (error: string): ActionState => ({ ok: false, error });
