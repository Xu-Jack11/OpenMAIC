'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCourseAuthStore } from '@/lib/store/course-auth';
import { getClientTranslation } from '@/lib/i18n';
import { CreateClassroomDialog } from '@/components/course/create-classroom-dialog';

interface ClassroomItem {
  id: string;
  name: string;
  description: string | null;
  sceneCount: number;
  language: string | null;
  status: 'ready' | 'generating' | 'failed';
  creator: { id: string; name: string; avatar: string | null };
  createdAt: string;
}

interface MemberItem {
  id: string;
  role: 'TEACHER' | 'STUDENT';
  joinedAt: string;
  user: { id: string; name: string; avatar: string | null };
}

interface DocumentItem {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploader: { id: string; name: string };
  createdAt: string;
}

interface InviteItem {
  id: string;
  code: string;
  role: 'TEACHER' | 'STUDENT';
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  isActive: boolean;
}

type Tab = 'classrooms' | 'members' | 'documents';

export default function CourseDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const courseId = params?.courseId as string;
  const { user, currentCourse, isTeacher } = useCourseAuthStore();
  const t = (k: string) => getClientTranslation(k);

  const [tab, setTab] = useState<Tab>('classrooms');
  const [classrooms, setClassrooms] = useState<ClassroomItem[]>([]);
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [invitations, setInvitations] = useState<InviteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const loadClassrooms = useCallback(async () => {
    const res = await fetch(`/api/course/${courseId}/classrooms`);
    const json = await res.json();
    if (json.success) setClassrooms(json.classrooms);
  }, [courseId]);

  const loadMembers = useCallback(async () => {
    const res = await fetch(`/api/course/${courseId}/members`);
    const json = await res.json();
    if (json.success) setMembers(json.members);
  }, [courseId]);

  const loadDocuments = useCallback(async () => {
    const res = await fetch(`/api/course/${courseId}/documents`);
    const json = await res.json();
    if (json.success) setDocuments(json.documents);
  }, [courseId]);

  const loadInvitations = useCallback(async () => {
    if (!isTeacher()) return;
    const res = await fetch(`/api/course/${courseId}/invitations`);
    const json = await res.json();
    if (json.success) setInvitations(json.invitations);
  }, [courseId, isTeacher]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading gate is intentional before parallel fetches
    setLoading(true);
    Promise.all([loadClassrooms(), loadMembers(), loadDocuments(), loadInvitations()])
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [courseId, loadClassrooms, loadMembers, loadDocuments, loadInvitations]);

  function handleOpenCreateDialog() {
    setShowCreateDialog(true);
  }

  async function handleCreateInvite(role: 'TEACHER' | 'STUDENT') {
    const res = await fetch(`/api/course/${courseId}/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    const json = await res.json();
    if (json.success) {
      await loadInvitations();
    }
  }

  async function handleDeleteClassroom(classroomId: string) {
    if (!confirm('Delete this classroom?')) return;
    await fetch(`/api/course/${courseId}/classrooms/${classroomId}`, {
      method: 'DELETE',
    });
    await loadClassrooms();
  }

  async function handleDeleteDocument(docId: string) {
    if (!confirm('Delete this document?')) return;
    await fetch(`/api/course/${courseId}/documents/${docId}`, {
      method: 'DELETE',
    });
    await loadDocuments();
  }

  async function handleRemoveMember(memberId: string) {
    if (!confirm('Remove this member?')) return;
    await fetch(`/api/course/${courseId}/members/${memberId}`, {
      method: 'DELETE',
    });
    await loadMembers();
  }

  async function handleUploadDocument(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    await fetch(`/api/course/${courseId}/documents`, {
      method: 'POST',
      body: formData,
    });
    await loadDocuments();
    e.target.value = '';
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">{t('common.loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Course title */}
        <h1 className="text-xl font-semibold mb-6">{currentCourse?.name}</h1>

        <CreateClassroomDialog
          courseId={courseId}
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
        />

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
          {(['classrooms', 'members', 'documents'] as Tab[]).map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === tabKey
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(`course.dashboard${tabKey.charAt(0).toUpperCase() + tabKey.slice(1)}`)}
            </button>
          ))}
        </div>

        {/* Classrooms Tab */}
        {tab === 'classrooms' && (
          <div>
            {isTeacher() && (
              <div className="mb-4 flex justify-end gap-2">
                <button
                  onClick={handleOpenCreateDialog}
                  data-testid="open-create-classroom-dialog"
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
                >
                  {t('course.dashboardCreateClassroom')}
                </button>
              </div>
            )}
            <div className="grid gap-3">
              {classrooms.map((c) => (
                <div
                  key={c.id}
                  className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between"
                >
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {c.sceneCount} scenes &middot; {c.creator.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        c.status === 'ready'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : c.status === 'generating'
                            ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}
                    >
                      {t(`course.classroom${c.status.charAt(0).toUpperCase() + c.status.slice(1)}`)}
                    </span>
                    {c.status === 'ready' && (
                      <button
                        onClick={() => router.push(`/course/${courseId}/classroom/${c.id}`)}
                        className="text-sm px-3 py-1 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                      >
                        {t('course.enterClassroom')}
                      </button>
                    )}
                    {isTeacher() && (
                      <button
                        onClick={() => handleDeleteClassroom(c.id)}
                        className="text-sm text-muted-foreground hover:text-destructive"
                      >
                        {t('course.deleteClassroom')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {classrooms.length === 0 && (
                <p className="text-center text-muted-foreground py-12">No classrooms yet.</p>
              )}
            </div>
          </div>
        )}

        {/* Members Tab */}
        {tab === 'members' && (
          <div>
            {isTeacher() && (
              <div className="mb-4 flex gap-2 justify-end">
                {(['STUDENT', 'TEACHER'] as const).map((role) => (
                  <button
                    key={role}
                    onClick={() => handleCreateInvite(role)}
                    className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    + Invite{' '}
                    {role === 'TEACHER' ? t('course.roleTeacher') : t('course.roleStudent')}
                  </button>
                ))}
              </div>
            )}
            {isTeacher() && invitations.filter((i) => i.isActive).length > 0 && (
              <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm">
                <p className="font-medium mb-2">Active invitation codes:</p>
                {invitations
                  .filter((i) => i.isActive)
                  .map((inv) => (
                    <div key={inv.id} className="flex items-center gap-2 mb-1">
                      <code className="font-mono font-bold tracking-widest">{inv.code}</code>
                      <span className="text-muted-foreground">
                        (
                        {inv.role === 'TEACHER' ? t('course.roleTeacher') : t('course.roleStudent')}
                        ){inv.maxUses ? ` · ${inv.usedCount}/${inv.maxUses}` : ''}
                      </span>
                      <button
                        onClick={() => navigator.clipboard.writeText(inv.code)}
                        className="text-primary hover:underline text-xs"
                      >
                        {t('course.inviteCodeCopy')}
                      </button>
                    </div>
                  ))}
              </div>
            )}
            <div className="space-y-2">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm font-medium">
                      {m.user.name[0]?.toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium">{m.user.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.role === 'TEACHER' ? t('course.roleTeacher') : t('course.roleStudent')}
                      </p>
                    </div>
                  </div>
                  {isTeacher() && m.user.id !== user?.id && (
                    <button
                      onClick={() => handleRemoveMember(m.id)}
                      className="text-sm text-muted-foreground hover:text-destructive"
                    >
                      {t('course.removeMember')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Documents Tab */}
        {tab === 'documents' && (
          <div>
            {isTeacher() && (
              <div className="mb-4 flex justify-end">
                <label className="cursor-pointer px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
                  {t('course.uploadDocument')}
                  <input
                    type="file"
                    accept=".pdf,.docx,.pptx,.md,.txt,.png,.jpg,.jpeg,.webp"
                    onChange={handleUploadDocument}
                    className="hidden"
                  />
                </label>
              </div>
            )}
            <div className="space-y-2">
              {documents.map((d) => (
                <div
                  key={d.id}
                  className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between"
                >
                  <div>
                    <p className="font-medium">{d.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(d.sizeBytes / 1024).toFixed(1)} KB &middot; {d.uploader.name}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={`/api/course/${courseId}/documents/${d.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline"
                    >
                      {t('files.download')}
                    </a>
                    {isTeacher() && (
                      <button
                        onClick={() => handleDeleteDocument(d.id)}
                        className="text-sm text-muted-foreground hover:text-destructive"
                      >
                        {t('course.deleteDocument')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {documents.length === 0 && (
                <p className="text-center text-muted-foreground py-12">No documents yet.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
