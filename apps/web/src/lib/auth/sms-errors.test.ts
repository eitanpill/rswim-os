import { describe, expect, it } from 'vitest';
import { sendCodeError, verifyCodeError } from './sms-errors';

describe('phone sign-in errors', () => {
  it('tells the person to wait when the SMS limit is reached', () => {
    expect(sendCodeError('over_sms_send_rate_limit')).toBe('sms_wait');
    expect(sendCodeError('over_request_rate_limit')).toBe('sms_wait');
    expect(verifyCodeError('over_request_rate_limit')).toBe('sms_wait');
  });

  it('separates a provider failure and a switched-off provider from a bad number', () => {
    expect(sendCodeError('sms_send_failed')).toBe('sms_failed');
    expect(sendCodeError('phone_provider_disabled')).toBe('not_configured');
    expect(sendCodeError('validation_failed')).toBe('phone');
    expect(sendCodeError(undefined)).toBe('phone');
  });

  it('separates an expired code from a wrong one', () => {
    expect(verifyCodeError('otp_expired')).toBe('code_expired');
    expect(verifyCodeError('invalid_credentials')).toBe('code');
    expect(verifyCodeError(undefined)).toBe('code');
  });
});
