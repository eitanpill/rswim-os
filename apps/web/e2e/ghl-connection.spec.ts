/**
 * Feature A1 (2026-11-28): any business connects its own GHL sub-account by itself, with a location id and a Private
 * Integration token, and WhatsApp through GHL stays off until the owner turns it on after a passed check. The worker
 * (the check and the survey) does not run here, so the connection waits for its check. The location id and token are
 * fake (the location id is the demo school's own, so the other specs' GHL webhooks still find it).
 */
import { expect, test } from '@playwright/test';

test('a swim school owner connects GHL from the connections screen', async ({ page }) => {
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/connections');
  await expect(page.getByTestId('connection-ghl')).toHaveAttribute('data-state', 'missing');
  await page.getByTestId('connection-ghl-link').click();
  await expect(page).toHaveURL(/\/admin\/integrations\/ghl$/);
  const card = page.getByTestId('ghl-connection');
  await expect(card).toHaveAttribute('data-status', 'none');
  const form = page.getByTestId('ghl-connection-form');
  await form.getByLabel('מזהה החשבון (Location ID)').fill('demo-location-0001');
  await form.getByLabel('טוקן Private Integration').fill('pit-fake-e2e-token-not-real');
  await page.getByTestId('ghl-connection-save').click();
  await expect(card).toHaveAttribute('data-status', 'connected');
  await expect(page.getByTestId('ghl-connection-pending')).toBeVisible();
  await expect(card).not.toContainText('pit-fake-e2e-token');

  // WhatsApp through GHL waits for a passed check, and starts only when the owner turns it on.
  await page.goto('/admin/integrations/whatsapp');
  const bridge = page.getByTestId('ghl-bridge');
  await expect(bridge).toHaveAttribute('data-status', 'linked');
  await expect(page.getByTestId('ghl-bridge-on')).toBeDisabled();

  // The office sees that it is connected, not the form.
  await page.goto('/dev/login?as=admin');
  await page.goto('/admin/integrations/ghl');
  await expect(page.getByTestId('ghl-connection-office')).toContainText('demo-location-0001');
  await expect(page.getByTestId('ghl-connection-form')).toHaveCount(0);

  // Leave the demo as it was.
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/integrations/ghl');
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('ghl-connection-disconnect').click();
  await expect(card).toHaveAttribute('data-status', 'none');
});

test('a freediving club owner has the same connection', async ({ page }) => {
  await page.goto('/dev/login?as=diveOwner');
  await page.goto('/dive/connections');
  await page.getByTestId('connection-ghl-link').click();
  await expect(page).toHaveURL(/\/dive\/ghl$/);
  await expect(page.getByTestId('ghl-connection-form')).toBeVisible();
  await page.goto('/dive/whatsapp');
  await expect(page.getByTestId('ghl-bridge-needs-connection')).toBeVisible();
});
