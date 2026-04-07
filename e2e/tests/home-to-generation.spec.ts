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

  test('course dashboard create classroom opens prompt dialog and navigates to preview', async ({
    page,
    mockApi,
  }) => {
    await mockApi.mockCourseDashboardData();

    await page.goto('/course/e2e-course-1');

    const openDialogButton = page.getByTestId('open-create-classroom-dialog');
    await expect(openDialogButton).toBeVisible();
    await openDialogButton.click();

    const requirementInput = page.getByTestId('create-classroom-requirement');
    const submitButton = page.getByTestId('create-classroom-submit');

    await expect(requirementInput).toBeVisible();
    await expect(submitButton).toBeDisabled();

    await requirementInput.fill('讲解牛顿三大定律');
    await expect(submitButton).toBeEnabled();

    await submitButton.click();
    await expect(page).toHaveURL(/\/generation-preview/);
  });
});
