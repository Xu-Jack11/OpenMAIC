import { test as base } from '@playwright/test';
import { MockApi } from './mock-api';

type Fixtures = {
  mockApi: MockApi;
};

/** Fake session token for E2E tests — middleware only checks cookie existence */
const TEST_SESSION_TOKEN = 'e2e-test-session-token-00000000';

export const test = base.extend<Fixtures>({
  mockApi: async ({ page, context }, use) => {
    // Inject session_token cookie so middleware allows access
    await context.addCookies([
      {
        name: 'session_token',
        value: TEST_SESSION_TOKEN,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

    const mockApi = new MockApi(page);
    // Always mock server-providers — called on every page load by root layout
    await mockApi.mockServerProviders();
    // Mock auth /me endpoint so authenticated layout doesn't redirect to login
    await mockApi.mockAuthMe();
    await use(mockApi);
  },
});

export { expect } from '@playwright/test';
