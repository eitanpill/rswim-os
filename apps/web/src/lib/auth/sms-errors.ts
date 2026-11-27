/**
 * Supabase Auth error codes from phone sign-in, mapped to the login page's error keys. With a real SMS provider
 * (Twilio Verify behind Supabase) a failure is rarely a bad number: it is the hourly SMS limit, the provider refusing,
 * or an expired code, and each needs its own message so the person knows whether to wait, retry or ask the school.
 */
export type SendCodeError = 'phone' | 'sms_wait' | 'sms_failed' | 'not_configured';
export type VerifyCodeError = 'code' | 'code_expired' | 'sms_wait';

const WAIT = new Set(['over_sms_send_rate_limit', 'over_request_rate_limit']);

export function sendCodeError(code: string | undefined): SendCodeError {
  if (code && WAIT.has(code)) return 'sms_wait';
  if (code === 'sms_send_failed') return 'sms_failed';
  if (code === 'phone_provider_disabled') return 'not_configured';
  return 'phone';
}

export function verifyCodeError(code: string | undefined): VerifyCodeError {
  if (code === 'otp_expired') return 'code_expired';
  if (code && WAIT.has(code)) return 'sms_wait';
  return 'code';
}
