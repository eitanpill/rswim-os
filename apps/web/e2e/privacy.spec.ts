/** The privacy policy opens signed out (Meta's WhatsApp app and the stores link to it), in Hebrew and English. */
import { expect, test } from '@playwright/test';

test('anyone can read the privacy policy without signing in', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole('heading', { name: 'מדיניות פרטיות: Aqua Swim' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Privacy policy: Aqua Swim' })).toBeVisible();
  await expect(page.getByTestId('privacy')).toContainText('support@aqua-swim.co.il');
});
