import { describe, expect, it } from 'vitest';
import {
  AppClaims,
  canEnterSurface,
  DomainEventEnvelope,
  hasPermission,
  homeSurface,
  ORG_ROLES,
  PhoneE164,
  toE164IL,
} from '../src';

describe('surfaces', () => {
  it('lets only owner/admin into the admin surface', () => {
    expect(canEnterSurface('owner', 'admin')).toBe(true);
    expect(canEnterSurface('admin', 'admin')).toBe(true);
    expect(canEnterSurface('instructor', 'admin')).toBe(false);
    expect(canEnterSurface('parent', 'admin')).toBe(false);
  });
  it('keeps staff out of the parent portal', () => {
    expect(canEnterSurface('parent', 'parent')).toBe(true);
    expect(canEnterSurface('owner', 'parent')).toBe(false);
  });
  it('maps every role to a home surface', () => {
    const homes = Object.fromEntries(ORG_ROLES.map((r) => [r, homeSurface(r)]));
    expect(homes).toEqual({
      owner: 'admin',
      admin: 'admin',
      instructor: 'instructor',
      escort: 'transport',
      accountant: 'accountant',
      parent: 'parent',
      institution_contact: null,
    });
  });
});

describe('hasPermission', () => {
  it('grants everything to owners and only listed permissions to others', () => {
    expect(hasPermission('owner', [], 'payroll.write')).toBe(true);
    expect(hasPermission('admin', ['billing.read'], 'billing.read')).toBe(true);
    expect(hasPermission('admin', ['billing.read'], 'payroll.read')).toBe(false);
  });
});

describe('AppClaims', () => {
  it('parses hook output and defaults permissions', () => {
    const c = AppClaims.parse({
      sub: '0190a3a0-0000-7000-8000-000000000001',
      org_id: '0190a3a0-0000-7000-8000-000000000002',
      app_role: 'instructor',
    });
    expect(c.permissions).toEqual([]);
    expect(c.is_platform_admin).toBe(false);
  });
  it('rejects unknown roles', () => {
    expect(() =>
      AppClaims.parse({
        sub: '0190a3a0-0000-7000-8000-000000000001',
        org_id: null,
        app_role: 'god',
      }),
    ).toThrow();
  });
});

describe('DomainEventEnvelope', () => {
  it('requires dotted event types', () => {
    const base = {
      id: '0190a3a0-0000-7000-8000-000000000001',
      organizationId: '0190a3a0-0000-7000-8000-000000000002',
      payload: {},
      idempotencyKey: 'k',
      occurredAt: '2026-10-01T10:00:00+03:00',
    };
    expect(DomainEventEnvelope.safeParse({ ...base, type: 'core.ping' }).success).toBe(true);
    expect(DomainEventEnvelope.safeParse({ ...base, type: 'ping' }).success).toBe(false);
  });
});

describe('phones', () => {
  it('normalises Israeli formats to E.164', () => {
    expect(toE164IL('050-123-4567')).toBe('+972501234567');
    expect(toE164IL('972501234567')).toBe('+972501234567');
    expect(toE164IL('+972 50 123 4567')).toBe('+972501234567');
    expect(toE164IL('02-6123456')).toBe('+97226123456');
    expect(toE164IL('12345')).toBeNull();
  });
  it('validates with a Hebrew error', () => {
    expect(PhoneE164.parse('0501234567')).toBe('+972501234567');
    const r = PhoneE164.safeParse('abc');
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('מספר טלפון לא תקין');
  });
});
