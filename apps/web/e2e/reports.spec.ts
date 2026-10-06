/**
 * Phase 9 reports: the owner reaches every report from "more", sees the closing Gush Etzion pool losing money, the
 * occupancy heatmap, the three demo families leaving after October with their reasons, exports CSV that Excel reads
 * as Hebrew, and builds the weekly digest. Every number comes from the fake demo seed.
 */
import { expect, test } from '@playwright/test';

const RANGE = '?from=2026-09&to=2026-11';

test('the owner reads the reports, exports CSV and builds the weekly digest', async ({ page }) => {
  await page.goto('/dev/login?as=owner');
  await page.goto('/admin/more');
  await page.getByTestId('more-reports').click();
  await expect(page).toHaveURL(/\/admin\/reports$/);
  await expect(page.getByTestId('revenue-months')).toBeVisible();

  await page.goto(`/admin/reports/venues${RANGE}`);
  const gush = page.locator('[data-testid="venue-margin"][data-venue="בריכת הדמו - גוש עציון"]');
  await expect(gush).toContainText(/רווח בטווח: \S*-/);
  await expect(gush.getByTestId('report-row').first()).toContainText('4,500');

  await page.goto('/admin/reports/occupancy?date=2026-10-06');
  await expect(page.getByTestId('heatmap')).toHaveCount(2);
  expect(await page.getByTestId('heat-cell').count()).toBeGreaterThan(3);

  await page.goto(`/admin/reports/churn${RANGE}`);
  await expect(page.getByTestId('churn-places').getByTestId('report-row')).toHaveCount(3);
  await expect(page.getByTestId('churn-table')).toContainText('מים קרים');

  const csv = await page.request.get(`/api/reports/churn${RANGE}`);
  expect(csv.headers()['content-type']).toContain('text/csv');
  const body = await csv.text();
  expect(body.charCodeAt(0)).toBe(0xfeff);
  expect(body).toContain('מים קרים');
  expect((await page.request.get('/api/reports/nothing')).status()).toBe(404);

  await page.goto('/admin/reports/digest');
  await page.getByTestId('build-digest').click();
  const digest = page.getByTestId('digest').first();
  await expect(digest).toBeVisible();
  await expect(digest.getByTestId('digest-happened')).toContainText('מקומות חדשים');
  await expect(digest.getByTestId('digest-attention')).toBeVisible();
});

test('an instructor cannot open the reports', async ({ page }) => {
  await page.goto('/dev/login?as=instructor');
  await page.goto('/admin/reports');
  await expect(page).not.toHaveURL(/\/admin\/reports/);
  const csv = await page.request.get(`/api/reports/revenue${RANGE}`, { maxRedirects: 0 });
  expect(csv.status()).not.toBe(200);
});
