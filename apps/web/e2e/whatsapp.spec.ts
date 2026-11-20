/**
 * WhatsApp track W5: the owner connects the business's own number on Meta's Cloud API and gets the webhook address
 * and verify token to paste into Meta; Meta's subscription check answers only with that token, and a webhook body
 * not signed with the business's app secret is refused. The office sees only whether it is connected. Every number,
 * token and secret is fake. W10 adds the going-live steps on the same page.
 */
import { expect, test } from '@playwright/test';

test('the owner connects the business number and Meta can subscribe to it', async ({ page }) => {
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/more');
  await page.getByTestId('more-whatsapp').click();
  await expect(page).toHaveURL(/\/admin\/integrations\/whatsapp$/);
  const form = page.getByTestId('whatsapp-form');
  await form.getByLabel('מספר הטלפון של העסק').fill('+972 2-555-0199');
  await form.getByLabel('Phone number ID').fill('109900000001');
  await form.getByLabel('WhatsApp Business Account ID').fill('209900000001');
  await form.getByLabel('Access token (משתמש מערכת)').fill('fake-e2e-access-token-not-real');
  await form.getByLabel('App secret').fill('0123456789abcdef0123456789abcdef');
  await page.getByTestId('whatsapp-save').click();
  const status = page.getByTestId('whatsapp-status');
  await expect(status).toHaveAttribute('data-status', 'connected');
  await expect(status).not.toContainText('fake-e2e-access-token');

  const hook = new URL((await page.getByTestId('whatsapp-webhook').innerText()).trim());
  const token = (await page.getByTestId('whatsapp-verify-token').innerText()).trim();
  const check = await page.request.get(
    `${hook.pathname}?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=4242`,
  );
  expect(check.status()).toBe(200);
  expect(await check.text()).toBe('4242');
  const wrong = await page.request.get(
    `${hook.pathname}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=4242`,
  );
  expect(wrong.status()).toBe(403);
  const forged = await page.request.post(hook.pathname, {
    data: { object: 'whatsapp_business_account', entry: [] },
    headers: { 'x-hub-signature-256': 'sha256=00' },
  });
  expect(forged.status()).toBe(401);

  // Going live (W10): the check, the templates' review and a test message are asked here; the worker talks to Meta.
  await expect(page.getByTestId('whatsapp-check')).toHaveAttribute('data-ok', 'no');
  await page.getByTestId('whatsapp-check-run').click();
  await expect(page.getByTestId('whatsapp-live')).toContainText('הבדיקה יצאה לדרך');
  await page.getByTestId('whatsapp-templates-run').click();
  await expect(page.getByTestId('whatsapp-templates')).toContainText('ההודעות נשלחות לאישור');
  await expect(page.getByTestId('whatsapp-test-form')).toBeVisible();

  await page.goto('/admin/connections');
  await expect(page.getByTestId('connection-whatsapp')).toHaveAttribute('data-state', 'connected');
  await expect(page.getByTestId('connection-whatsapp-link')).toHaveAttribute(
    'href',
    '/admin/integrations/whatsapp',
  );

  await page.goto('/dev/login?as=admin');
  await page.goto('/admin/integrations/whatsapp');
  await expect(page.getByTestId('whatsapp-owner-only')).toContainText('+972 2-555-0199');
  await expect(page.getByTestId('whatsapp-form')).toHaveCount(0);

  // Leave the demo as it was: the owner switches the number off.
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/integrations/whatsapp');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'ניתוק המספר' }).click();
  await expect(status).toHaveAttribute('data-status', 'disconnected');
});

test('a freediving club connects its own number from its connections screen', async ({ page }) => {
  await page.goto('/dev/login?as=diveOwner');
  await page.goto('/dive/connections');
  await page.getByTestId('connection-whatsapp-link').click();
  await expect(page).toHaveURL(/\/dive\/whatsapp$/);
  const form = page.getByTestId('whatsapp-form');
  await form.getByLabel('מספר הטלפון של העסק').fill('+972 8-555-0188');
  await form.getByLabel('Phone number ID').fill('109900000002');
  await form.getByLabel('WhatsApp Business Account ID').fill('209900000002');
  await form.getByLabel('Access token (משתמש מערכת)').fill('fake-e2e-dive-token-not-real');
  await form.getByLabel('App secret').fill('fedcba9876543210fedcba9876543210');
  await page.getByTestId('whatsapp-save').click();
  const status = page.getByTestId('whatsapp-status');
  await expect(status).toHaveAttribute('data-status', 'connected');
  await expect(page.getByTestId('whatsapp-live')).toBeVisible();
  await page.getByTestId('whatsapp-check-run').click();
  await expect(page.getByTestId('whatsapp-live')).toContainText('הבדיקה יצאה לדרך');

  // The desk has no business on this page.
  await page.goto('/dev/login?as=diveOffice');
  await page.goto('/dive/whatsapp');
  await expect(page).toHaveURL(/\/dive\/office$/);

  // Leave the demo as it was.
  await page.goto('/dev/login?as=diveOwner');
  await page.goto('/dive/whatsapp');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'ניתוק המספר' }).click();
  await expect(status).toHaveAttribute('data-status', 'disconnected');
});
