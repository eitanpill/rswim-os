/**
 * Phase 8 acceptance: parents receive "arrived at the pool" automatically when the escort taps it. The office opens
 * today's run by hand when today is not the route's day, the escort (Dani, on a phone) marks Yoav on board and taps
 * the stages, and the worker's step turns the tap into a WhatsApp message to Yoav's mother. Every person is fake.
 */
import { expect, test } from '@playwright/test';
import { runTransportAutomations } from './worker';

test('AC: the escort taps "arrived at the pool" and the families on board get a message', async ({
  page,
}) => {
  page.on('dialog', (d) => void d.accept());

  // The office makes sure today's run exists (the worker opens it on the route's weekday).
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/transport');
  const open = page.getByTestId('open-run');
  if (await open.isVisible()) {
    await open.getByRole('button').click();
    await expect(page.getByTestId('run-card')).toBeVisible();
  }

  // The escort's phone: today's run with the children.
  await page.goto('/dev/login?as=escort');
  await page.goto('/transport');
  const card = page.getByTestId('run-card').first();
  await expect(card).toBeVisible();
  const yoav = card.getByTestId('run-rider').filter({ hasText: 'יואב' });
  await yoav.getByTestId('mark-boarded').click();
  await expect(yoav.getByTestId('mark-boarded')).toHaveCount(0);
  await expect(yoav).toContainText('עלה/תה');

  await card.getByTestId('stage-left_school').click();
  await expect(card.getByTestId('run-stages')).toContainText('יצאו מבית הספר');
  await card.getByTestId('stage-arrived_pool').click();
  await expect(card.getByTestId('run-stages')).toContainText('הגיעו לבריכה');
  await expect(card.getByTestId('stage-in_water')).toBeVisible();

  // The worker's step: the tap becomes messages, only to the children on board.
  expect(await runTransportAutomations('transport.arrived_pool')).toBe(1);

  // The office sees the message waiting to go out to Yoav's mother.
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/messages/log');
  await expect(page.getByText('הגענו לבריכה').first()).toBeVisible();

  // Yoav's mother sees where he is on his card.
  await page.goto('/dev/login?as=parent');
  await page.goto('/parent');
  await page.getByRole('link', { name: /יואב/ }).first().click();
  await expect(page.getByTestId('child-transport')).toContainText('הגיעו לבריכה');
});
