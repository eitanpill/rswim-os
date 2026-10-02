/** Who a service call acts for. Services trust it because the transaction already runs as that user (asUser / withOrg). */
export interface ServiceContext {
  orgId: string;
  userId: string | null;
}

/**
 * A rule the user broke, carrying an i18n key (e.g. "venues.errors.laneOverlap") and values for the message.
 * Server actions turn it into a Hebrew message on the form; anything else is a bug and surfaces as an error page.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly params: Record<string, string | number> = {},
  ) {
    super(code);
    this.name = 'DomainError';
  }
}

export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;

/**
 * Translates the database errors a user can cause into DomainErrors: a locked version (our triggers), a duplicate
 * (unique key), a check constraint, or RLS refusing the write. Drizzle wraps the driver error in `cause`.
 */
export function toDomainError(e: unknown): DomainError | null {
  if (isDomainError(e)) return e;
  const pg = findPgError(e);
  if (!pg) return null;
  if (pg.code === '23514' && /new version|cannot be deleted|cannot move/.test(pg.message)) {
    return new DomainError('settings.errors.versionLocked');
  }
  if (pg.code === '23505') return new DomainError('forms.errors.duplicate');
  if (pg.code === '23514' || pg.code === '23503') return new DomainError('forms.errors.invalid');
  if (pg.code === '42501') return new DomainError('common.errors.forbidden');
  return null;
}

function findPgError(e: unknown): { code: string; message: string } | null {
  for (let cur = e, depth = 0; cur && typeof cur === 'object' && depth < 5; depth++) {
    const c = cur as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof c.code === 'string' && /^[0-9A-Z]{5}$/.test(c.code)) {
      return { code: c.code, message: String(c.message) };
    }
    cur = c.cause;
  }
  return null;
}
