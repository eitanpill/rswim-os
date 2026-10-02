/**
 * `prepare` helper for form acceptances: `codes` lists the form's question codes, and each ticked `answer_<code>`
 * checkbox means "yes". Unticked boxes are not posted, so every listed code gets an explicit answer.
 */
export function answersFrom(raw: Record<string, unknown>): Record<string, unknown> {
  const codes = String(raw.codes ?? '')
    .split(',')
    .filter(Boolean);
  const rest = Object.fromEntries(
    Object.entries(raw).filter(([k]) => k !== 'codes' && !k.startsWith('answer_')),
  );
  return {
    ...rest,
    answers: Object.fromEntries(codes.map((c) => [c, raw[`answer_${c}`] === 'on'])),
  };
}
