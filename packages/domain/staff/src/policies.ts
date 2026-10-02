/** Pure staff rules. */

/** Certification state for badges: expired, expiring within 60 days, or valid. */
export function certificationStatus(
  expiresOn: string | null,
  today: string,
): 'valid' | 'expiring' | 'expired' {
  if (!expiresOn) return 'valid';
  if (expiresOn < today) return 'expired';
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 60);
  return expiresOn <= soon.toISOString().slice(0, 10) ? 'expiring' : 'valid';
}
