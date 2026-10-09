import { describe, expect, it } from 'vitest';
import { decideRoute, homePath, surfaceForPath } from './routing';
import type { Session } from './types';

const s = (role: Session['role'], extra: Partial<Session> = {}): Session => ({
  userId: 'u',
  orgId: 'o',
  role,
  permissions: [],
  isPlatformAdmin: false,
  mode: 'dev',
  ...extra,
});

describe('decideRoute', () => {
  it('sends a freediving club to /dive and keeps it out of the swim surfaces', () => {
    const club = (role: Session['role']) => s(role, { vertical: 'freediving' });
    expect(decideRoute('/', club('owner'))).toEqual({ action: 'redirect', to: '/dive' });
    expect(decideRoute('/', club('parent'))).toEqual({ action: 'redirect', to: '/dive' });
    expect(decideRoute('/admin', club('admin'))).toEqual({ action: 'redirect', to: '/dive' });
    expect(decideRoute('/dive/office', club('admin'))).toEqual({ action: 'next' });
    expect(decideRoute('/dive', s('owner', { vertical: 'swim' }))).toEqual({
      action: 'redirect',
      to: '/admin',
    });
  });

  it('lets anyone reach public pages', () => {
    expect(decideRoute('/login', null)).toEqual({ action: 'next' });
    expect(decideRoute('/login/phone', null)).toEqual({ action: 'next' });
    expect(decideRoute('/api/health', null)).toEqual({ action: 'next' });
    expect(decideRoute('/api/webhooks/ghl', null)).toEqual({ action: 'next' });
  });

  it('sends anonymous users to login with a return path', () => {
    expect(decideRoute('/admin/families', null)).toEqual({
      action: 'redirect',
      to: '/login?next=%2Fadmin%2Ffamilies',
    });
  });

  it('sends "/" to the role home', () => {
    expect(decideRoute('/', s('owner'))).toEqual({ action: 'redirect', to: '/admin' });
    expect(decideRoute('/', s('instructor'))).toEqual({ action: 'redirect', to: '/instructor' });
    expect(decideRoute('/', s('parent'))).toEqual({ action: 'redirect', to: '/parent' });
    expect(decideRoute('/', s('escort'))).toEqual({ action: 'redirect', to: '/transport' });
    expect(decideRoute('/', s('accountant'))).toEqual({ action: 'redirect', to: '/accountant' });
  });

  it('keeps each role inside its surfaces', () => {
    expect(decideRoute('/admin', s('parent'))).toEqual({ action: 'redirect', to: '/parent' });
    expect(decideRoute('/admin', s('instructor'))).toEqual({
      action: 'redirect',
      to: '/instructor',
    });
    expect(decideRoute('/parent', s('owner'))).toEqual({ action: 'redirect', to: '/admin' });
    expect(decideRoute('/instructor', s('admin'))).toEqual({ action: 'next' }); // Asaf teaches too
    expect(decideRoute('/accountant', s('admin'))).toEqual({ action: 'redirect', to: '/admin' });
  });

  it('reserves /platform for platform admins', () => {
    expect(decideRoute('/platform', s('owner'))).toEqual({ action: 'redirect', to: '/admin' });
    expect(decideRoute('/platform', s(null, { isPlatformAdmin: true }))).toEqual({
      action: 'next',
    });
    expect(decideRoute('/', s(null, { isPlatformAdmin: true }))).toEqual({
      action: 'redirect',
      to: '/platform',
    });
  });

  it('handles users without a membership and unknown paths', () => {
    expect(homePath(s(null))).toBe('/onboarding');
    expect(homePath(s('institution_contact'))).toBe('/login?error=no_membership');
    expect(decideRoute('/admin', s(null))).toEqual({ action: 'redirect', to: '/onboarding' });
    expect(decideRoute('/onboarding', s(null))).toEqual({ action: 'next' });
    expect(decideRoute('/some/other', s('parent'))).toEqual({ action: 'next' });
  });

  it('does not confuse prefixes', () => {
    expect(surfaceForPath('/administrator')).toBeNull();
    expect(surfaceForPath('/admin/x')).toBe('admin');
  });
});
