import type { Page } from '@playwright/test';
import { mockOutlines } from './test-data/scene-outlines';
import { mockSceneContentResponse } from './test-data/scene-content';
import { createMockSceneActionsResponse } from './test-data/scene-actions';

/**
 * Wraps Playwright's page.route() to mock OpenMAIC API endpoints.
 * Supports both JSON and SSE (text/event-stream) responses.
 */
export class MockApi {
  constructor(private page: Page) {}

  /** Mock the SSE outline streaming endpoint */
  async mockSceneOutlinesStream(outlines = mockOutlines) {
    await this.page.route('**/api/generate/scene-outlines-stream', (route) => {
      const events = outlines
        .map(
          (outline, i) =>
            `data: ${JSON.stringify({ type: 'outline', data: outline, index: i })}\n\n`,
        )
        .join('');
      const done = `data: ${JSON.stringify({ type: 'done', outlines })}\n\n`;

      route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body: events + done,
      });
    });
  }

  /** Mock the scene content generation endpoint */
  async mockSceneContent(response = mockSceneContentResponse) {
    await this.page.route('**/api/generate/scene-content', (route) => {
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
      });
    });
  }

  /** Mock the scene actions generation endpoint */
  async mockSceneActions(stageId = 'test-stage') {
    await this.page.route('**/api/generate/scene-actions', (route) => {
      const payload = route.request().postDataJSON() as { stageId?: string };
      const resolvedStageId = payload?.stageId || stageId;

      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createMockSceneActionsResponse(resolvedStageId)),
      });
    });
  }

  /** Mock the server providers endpoint (returns empty — client-side config only) */
  async mockServerProviders() {
    await this.page.route('**/api/server-providers', (route) => {
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers: {} }),
      });
    });
  }

  /** Mock the auth /me endpoint — returns a test user with courses */
  async mockAuthMe() {
    await this.page.route('**/api/course/auth/me', (route) => {
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          user: { id: 'e2e-user-1', name: 'E2E Tester', avatar: null },
          courses: [
            {
              id: 'e2e-course-1',
              name: 'E2E Test Course',
              description: null,
              role: 'TEACHER',
            },
          ],
        }),
      });
    });
  }

  /** Mock the classroom import endpoint (generation-preview completion) */
  async mockClassroomImport() {
    await this.page.route('**/api/course/*/classrooms/import', (route) => {
      const payload = route.request().postDataJSON() as {
        stage?: { id?: string };
        scenes?: unknown[];
      };

      if (!payload?.stage?.id || !Array.isArray(payload.scenes) || payload.scenes.length === 0) {
        route.fulfill({
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'stage and scenes are required',
          }),
        });
        return;
      }

      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          classroomId: 'e2e-classroom-1',
          storageId: 'test-stage',
        }),
      });
    });
  }

  /** Mock course dashboard list endpoints */
  async mockCourseDashboardData() {
    await Promise.all([
      this.page.route('**/api/course/*/classrooms', (route) => {
        if (route.request().method() !== 'GET') {
          route.continue();
          return;
        }

        route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, classrooms: [] }),
        });
      }),

      this.page.route('**/api/course/*/members', (route) => {
        route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            members: [
              {
                id: 'e2e-member-1',
                role: 'TEACHER',
                joinedAt: new Date().toISOString(),
                user: {
                  id: 'e2e-user-1',
                  name: 'E2E Tester',
                  avatar: null,
                },
              },
            ],
          }),
        });
      }),

      this.page.route('**/api/course/*/documents', (route) => {
        route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, documents: [] }),
        });
      }),

      this.page.route('**/api/course/*/invitations', (route) => {
        route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, invitations: [] }),
        });
      }),
    ]);
  }

  /** Set up API mocks for the generation flow. Note: server-providers is already mocked by the base fixture. */
  async setupGenerationMocks(stageId = 'test-stage') {
    await this.mockSceneOutlinesStream();
    await this.mockSceneContent();
    await this.mockSceneActions(stageId);
  }
}
