/** What a server action returns to its form. Messages are already translated. Shared by server and client code. */
export interface FormState {
  ok: boolean;
  /** Field name → message. */
  errors: Record<string, string>;
  /** Form-level message: an error, or a confirmation after success. */
  message: string | null;
  /** Bumped on every success so forms can reset. */
  savedAt?: number;
  /** Extra data for the page, e.g. an invite link that is shown once. */
  data?: Record<string, string>;
}

export const initialFormState: FormState = { ok: false, errors: {}, message: null };
