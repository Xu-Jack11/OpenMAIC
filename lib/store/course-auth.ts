'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CourseUser {
  id: string;
  name: string;
  avatar: string | null;
}

export interface CourseInfo {
  id: string;
  name: string;
  description: string | null;
  role: 'TEACHER' | 'STUDENT';
}

interface CourseAuthState {
  token: string | null; // kept as cache, NOT the source of truth for auth
  user: CourseUser | null;
  currentCourse: CourseInfo | null;
  courses: CourseInfo[];
  _refreshing: boolean;

  setSession: (token: string | null, user: CourseUser, course: CourseInfo) => void;
  setLoginSession: (token: string | null, user: CourseUser, courses: CourseInfo[]) => void;
  switchCourse: (course: CourseInfo) => void;
  removeCourse: (courseId: string) => void;
  clearSession: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
  isTeacher: () => boolean;
  isAuthenticated: () => boolean;
}

export const useCourseAuthStore = create<CourseAuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      currentCourse: null,
      courses: [],
      _refreshing: false,

      setSession: (token, user, course) =>
        set({ token, user, currentCourse: course, courses: [course] }),

      setLoginSession: (token, user, courses) =>
        set({ token, user, courses, currentCourse: courses[0] ?? null }),

      switchCourse: (course) => set({ currentCourse: course }),

      removeCourse: (courseId) => {
        const { courses, currentCourse } = get();
        const next = courses.filter((c) => c.id !== courseId);
        set({
          courses: next,
          currentCourse: currentCourse?.id === courseId ? (next[0] ?? null) : currentCourse,
        });
      },

      clearSession: async () => {
        try {
          await fetch('/api/course/auth/logout', { method: 'POST' });
        } catch {
          // best-effort; cookie may already be cleared
        }
        set({ token: null, user: null, currentCourse: null, courses: [] });
      },

      refreshSession: async () => {
        if (get()._refreshing) return get().user !== null;
        set({ _refreshing: true });
        try {
          const res = await fetch('/api/course/auth/me');
          if (!res.ok) {
            set({ token: null, user: null, currentCourse: null, courses: [], _refreshing: false });
            return false;
          }
          const json = await res.json();
          const user: CourseUser = json.user;
          const courses: CourseInfo[] = json.courses;
          const currentCourse = get().currentCourse;
          // Preserve current course selection if still valid
          const validCurrent = currentCourse && courses.some((c) => c.id === currentCourse.id);
          set({
            user,
            courses,
            currentCourse: validCurrent ? currentCourse : (courses[0] ?? null),
            _refreshing: false,
          });
          return true;
        } catch {
          set({ token: null, user: null, currentCourse: null, courses: [], _refreshing: false });
          return false;
        }
      },

      isTeacher: () => get().currentCourse?.role === 'TEACHER',
      isAuthenticated: () => get().user !== null,
    }),
    {
      name: 'courseSession',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        currentCourse: state.currentCourse,
        courses: state.courses,
      }),
    },
  ),
);
