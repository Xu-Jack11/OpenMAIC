import type { Page, Locator } from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly courseCards: Locator;

  constructor(page: Page) {
    this.page = page;
    this.courseCards = page.locator('button').filter({ hasText: /TEACHER|STUDENT|教师|学生/ });
  }

  async goto() {
    await this.page.goto('/');
  }
}
