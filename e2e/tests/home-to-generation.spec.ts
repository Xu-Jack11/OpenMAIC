import { test, expect } from '../fixtures/base';
import { HomePage } from '../pages/home.page';
import { createSettingsStorage } from '../fixtures/test-data/settings';

const SETTINGS_STORAGE = createSettingsStorage();

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((settings) => {
      localStorage.setItem('settings-storage', settings);
    }, SETTINGS_STORAGE);
  });

  test('dashboard loads with course list from auth', async ({ page }) => {
    const home = new HomePage(page);
    await home.goto();

    // Should show the test course from mockAuthMe
    await expect(page.getByText('E2E Test Course')).toBeVisible({ timeout: 10_000 });

    // Course card should be clickable
    await expect(home.courseCards).toHaveCount(1);
  });
});
