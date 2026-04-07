import { test, expect } from '../fixtures/base';
import { ClassroomPage } from '../pages/classroom.page';
import { createSettingsStorage } from '../fixtures/test-data/settings';
import { defaultTheme } from '../fixtures/test-data/scene-content';

const TEST_COURSE_ID = 'e2e-course-1';
const TEST_CLASSROOM_ID = 'e2e-classroom-1';
const TEST_STAGE_ID = 'e2e-test-stage';

const SETTINGS_STORAGE = createSettingsStorage({ sidebarCollapsed: false });

/** Mock the classroom content API to return test stage + scenes */
async function mockClassroomContent(page: import('@playwright/test').Page) {
  const now = Date.now();

  const makeSlideContent = (title: string, elId: string) => ({
    type: 'slide',
    canvas: {
      id: `slide-${elId}`,
      viewportSize: 1000,
      viewportRatio: 0.5625,
      theme: defaultTheme,
      elements: [
        {
          type: 'text',
          id: `el-${elId}`,
          content: title,
          left: 50,
          top: 50,
          width: 900,
          height: 100,
        },
      ],
    },
  });

  const classroomData = {
    success: true,
    classroom: {
      id: TEST_CLASSROOM_ID,
      name: '光合作用',
      status: 'ready',
      content: {
        id: TEST_STAGE_ID,
        stage: {
          id: TEST_STAGE_ID,
          name: '光合作用',
          description: '',
          language: 'zh-CN',
          style: 'professional',
          createdAt: now,
          updatedAt: now,
        },
        scenes: [
          {
            id: 'scene-0',
            stageId: TEST_STAGE_ID,
            type: 'slide',
            title: '基本概念',
            order: 0,
            content: makeSlideContent('基本概念', '0'),
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'scene-1',
            stageId: TEST_STAGE_ID,
            type: 'slide',
            title: '光反应',
            order: 1,
            content: makeSlideContent('光反应', '1'),
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'scene-2',
            stageId: TEST_STAGE_ID,
            type: 'slide',
            title: '暗反应',
            order: 2,
            content: makeSlideContent('暗反应', '2'),
            createdAt: now,
            updatedAt: now,
          },
        ],
        createdAt: new Date(now).toISOString(),
      },
    },
  };

  await page.route(
    `**/api/course/${TEST_COURSE_ID}/classrooms/${TEST_CLASSROOM_ID}`,
    (route) => {
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(classroomData),
      });
    },
  );
}

test.describe('Classroom Interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((settings) => {
      localStorage.setItem('settings-storage', settings);
    }, SETTINGS_STORAGE);
    await mockClassroomContent(page);
  });

  test('loads classroom and switches scenes', async ({ page }) => {
    const classroom = new ClassroomPage(page);
    await classroom.goto(TEST_COURSE_ID, TEST_CLASSROOM_ID);
    await classroom.waitForLoaded();

    // Sidebar shows 3 scenes
    await expect(classroom.sidebarScenes).toHaveCount(3, { timeout: 10_000 });

    // First scene title visible
    await expect(classroom.getSceneTitle(0)).toContainText('基本概念');

    // Click second scene
    await classroom.clickScene(1);

    // Verify second scene is now active — heading in the top bar shows the current scene name
    await expect(page.getByRole('heading', { name: '光反应' })).toBeVisible();
  });
});
