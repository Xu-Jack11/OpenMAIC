'use client';

import { useState, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Loader2,
  Trash2,
  Upload,
  Wand2,
  PenLine,
  FileUp,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useUserSkillStore } from '@/lib/store/user-skills';
import { resolveIcon, SKILL_ICON_OPTIONS } from '@/lib/plugins/icon-resolver';
import { USER_SKILL_VARIABLE_OPTIONS } from '@/lib/plugins/user-skill';
import { getModelHeaders } from '@/lib/utils/model-config';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { UserSkill, UserSkillVariable } from '@/lib/plugins/user-skill';
import type { ExportFormat } from '@/lib/export/document/types';

type CreationMode = 'manual' | 'ai' | 'template';

interface CustomSkillEditorProps {
  open: boolean;
  onClose: () => void;
  /** Pass an existing skill to edit. null = create new. */
  editSkill?: UserSkill | null;
}

const DEFAULT_FORMATS: ExportFormat[] = ['docx', 'pdf', 'markdown'];

export function CustomSkillEditor({ open, onClose, editSkill }: CustomSkillEditorProps) {
  const { t, locale } = useI18n();
  const addSkill = useUserSkillStore((s) => s.addSkill);
  const updateSkill = useUserSkillStore((s) => s.updateSkill);
  const deleteSkill = useUserSkillStore((s) => s.deleteSkill);

  const isEdit = !!editSkill;

  // Mode
  const [mode, setMode] = useState<CreationMode>('manual');

  // Form state
  const [name, setName] = useState(editSkill?.name ?? '');
  const [description, setDescription] = useState(editSkill?.description ?? '');
  const [icon, setIcon] = useState(editSkill?.icon ?? 'Sparkles');
  const [systemPrompt, setSystemPrompt] = useState(editSkill?.systemPrompt ?? '');
  const [userPrompt, setUserPrompt] = useState(editSkill?.userPrompt ?? '');
  const [variables, setVariables] = useState<UserSkillVariable[]>(
    editSkill?.variables ?? USER_SKILL_VARIABLE_OPTIONS.map((v) => ({ templateVar: v.templateVar, source: v.source })),
  );
  const [responseKey, setResponseKey] = useState(editSkill?.responseKey ?? '');
  const [supportedFormats] = useState<ExportFormat[]>(editSkill?.supportedFormats ?? DEFAULT_FORMATS);
  const [guidance, setGuidance] = useState(editSkill?.guidance ?? '');

  // UI state
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // AI mode state
  const [aiDescription, setAiDescription] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);

  // Template mode state
  const [templateStep, setTemplateStep] = useState<'idle' | 'parsing' | 'analyzing' | 'done'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const userPromptRef = useRef<HTMLTextAreaElement>(null);

  // Toggle a variable
  const toggleVariable = useCallback((source: UserSkillVariable['source'], templateVar: string) => {
    setVariables((prev) => {
      const exists = prev.some((v) => v.source === source);
      if (exists) return prev.filter((v) => v.source !== source);
      return [...prev, { templateVar, source }];
    });
  }, []);

  // Insert variable tag into user prompt at cursor
  const insertVariable = useCallback((templateVar: string) => {
    const tag = `{{${templateVar}}}`;
    const textarea = userPromptRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newVal = userPrompt.slice(0, start) + tag + userPrompt.slice(end);
      setUserPrompt(newVal);
      // Restore cursor after tag
      requestAnimationFrame(() => {
        textarea.focus();
        const pos = start + tag.length;
        textarea.setSelectionRange(pos, pos);
      });
    } else {
      setUserPrompt((prev) => prev + tag);
    }
  }, [userPrompt]);

  // Apply AI-generated definition to form
  const applyDefinition = useCallback((def: Record<string, unknown>) => {
    if (typeof def.name === 'string') setName(def.name);
    if (typeof def.description === 'string') setDescription(def.description);
    if (typeof def.icon === 'string') setIcon(def.icon);
    if (typeof def.systemPrompt === 'string') setSystemPrompt(def.systemPrompt);
    if (typeof def.userPrompt === 'string') setUserPrompt(def.userPrompt);
    if (typeof def.responseKey === 'string') setResponseKey(def.responseKey);
    if (typeof def.guidance === 'string') setGuidance(def.guidance);
    if (Array.isArray(def.variables)) {
      const validSources = new Set(['stage.name', 'stage.description', 'stage.language', 'sceneSummary']);
      const vars = (def.variables as { templateVar?: string; source?: string }[])
        .filter((v) => v.templateVar && v.source && validSources.has(v.source))
        .map((v) => ({ templateVar: v.templateVar!, source: v.source! as UserSkillVariable['source'] }));
      if (vars.length > 0) setVariables(vars);
    }
    setMode('manual');
  }, []);

  // AI generation
  const handleAIGenerate = useCallback(async () => {
    if (!aiDescription.trim()) return;
    setAiGenerating(true);
    try {
      const res = await fetch('/api/generate/skill-definition', {
        method: 'POST',
        headers: getModelHeaders(),
        body: JSON.stringify({
          mode: 'description',
          description: aiDescription,
          language: locale === 'zh-CN' ? 'zh-CN' : 'en-US',
        }),
      });
      const data = await res.json();
      if (!data.definition) throw new Error(data.error || 'Generation failed');
      applyDefinition(data.definition as Record<string, unknown>);
      toast.success(locale === 'zh-CN' ? '技能定义已生成，请检查并调整' : 'Skill definition generated. Please review and adjust.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setAiGenerating(false);
    }
  }, [aiDescription, locale, applyDefinition]);

  // Template upload
  const handleTemplateUpload = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Only PDF files are supported');
      return;
    }
    setTemplateStep('parsing');
    try {
      // Step 1: Parse PDF
      const formData = new FormData();
      formData.append('pdf', file);
      const parseRes = await fetch('/api/parse-pdf', { method: 'POST', body: formData });
      const parseData = await parseRes.json();
      if (!parseData.text) throw new Error(parseData.error || 'PDF parsing failed');

      // Step 2: Analyze template
      setTemplateStep('analyzing');
      const analyzeRes = await fetch('/api/generate/skill-definition', {
        method: 'POST',
        headers: getModelHeaders(),
        body: JSON.stringify({
          mode: 'template',
          templateText: parseData.text.slice(0, 30000), // Limit text length
          language: locale === 'zh-CN' ? 'zh-CN' : 'en-US',
        }),
      });
      const analyzeData = await analyzeRes.json();
      if (!analyzeData.definition) throw new Error(analyzeData.error || 'Template analysis failed');
      applyDefinition(analyzeData.definition as Record<string, unknown>);
      setTemplateStep('done');
      toast.success(locale === 'zh-CN' ? '模板分析完成，请检查并调整' : 'Template analyzed. Please review and adjust.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Template analysis failed');
      setTemplateStep('idle');
    }
  }, [locale, applyDefinition]);

  // Save
  const handleSave = useCallback(async () => {
    if (!name.trim() || !systemPrompt.trim() || !userPrompt.trim()) {
      toast.error(locale === 'zh-CN' ? '请填写名称和提示词' : 'Name and prompts are required');
      return;
    }
    setSaving(true);
    try {
      const skillData = {
        name: name.trim(),
        description: description.trim(),
        icon,
        systemPrompt,
        userPrompt,
        variables,
        responseKey: responseKey.trim(),
        supportedFormats,
        guidance: guidance.trim() || undefined,
      };
      if (isEdit && editSkill) {
        await updateSkill(editSkill.id, skillData);
      } else {
        await addSkill(skillData);
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [name, description, icon, systemPrompt, userPrompt, variables, responseKey, supportedFormats, guidance, isEdit, editSkill, addSkill, updateSkill, onClose, locale]);

  // Delete
  const handleDelete = useCallback(async () => {
    if (!editSkill) return;
    await deleteSkill(editSkill.id);
    onClose();
  }, [editSkill, deleteSkill, onClose]);

  const SelectedIcon = resolveIcon(icon);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <div className="px-6 pt-5 pb-3">
          <DialogTitle>{isEdit ? t('customSkill.edit') : t('customSkill.create')}</DialogTitle>
          <DialogDescription className="text-xs mt-1">
            {t('customSkill.descriptionPlaceholder')}
          </DialogDescription>
        </div>

        {/* Mode tabs (only for new skills) */}
        {!isEdit && (
          <div className="px-6 pb-3 flex gap-1.5">
            {([
              { key: 'manual' as const, label: t('customSkill.modeManual'), icon: PenLine },
              { key: 'ai' as const, label: t('customSkill.modeAI'), icon: Wand2 },
              { key: 'template' as const, label: t('customSkill.modeTemplate'), icon: FileUp },
            ] as const).map(({ key, label, icon: ModeIcon }) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                  mode === key
                    ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                    : 'text-muted-foreground hover:bg-muted/60',
                )}
              >
                <ModeIcon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4 scrollbar-hide">
          {/* AI Generation Mode */}
          {mode === 'ai' && !isEdit && (
            <div className="space-y-3 rounded-xl border border-violet-200/60 dark:border-violet-800/40 bg-violet-50/50 dark:bg-violet-950/20 p-4">
              <label className="text-xs font-medium">{t('customSkill.aiDescriptionLabel')}</label>
              <Textarea
                value={aiDescription}
                onChange={(e) => setAiDescription(e.target.value)}
                placeholder={t('customSkill.aiDescriptionPlaceholder')}
                rows={3}
                className="text-sm"
              />
              <Button
                onClick={handleAIGenerate}
                disabled={aiGenerating || !aiDescription.trim()}
                size="sm"
                className="w-full"
              >
                {aiGenerating ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin mr-1.5" />
                    {t('customSkill.aiGenerating')}
                  </>
                ) : (
                  <>
                    <Wand2 className="size-3.5 mr-1.5" />
                    {t('customSkill.aiGenerate')}
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Template Upload Mode */}
          {mode === 'template' && !isEdit && (
            <div className="space-y-3 rounded-xl border border-blue-200/60 dark:border-blue-800/40 bg-blue-50/50 dark:bg-blue-950/20 p-4">
              {templateStep === 'idle' && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleTemplateUpload(file);
                    }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-blue-300 dark:border-blue-700 rounded-xl p-6 flex flex-col items-center gap-2 text-blue-500 hover:bg-blue-100/40 dark:hover:bg-blue-900/20 transition-colors"
                  >
                    <Upload className="size-6" />
                    <span className="text-xs font-medium">{t('customSkill.templateDragHint')}</span>
                  </button>
                </>
              )}
              {templateStep === 'parsing' && (
                <div className="flex items-center justify-center gap-2 py-6 text-blue-500">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-xs">{t('customSkill.templateParsing')}</span>
                </div>
              )}
              {templateStep === 'analyzing' && (
                <div className="flex items-center justify-center gap-2 py-6 text-violet-500">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-xs">{t('customSkill.templateAnalyzing')}</span>
                </div>
              )}
            </div>
          )}

          {/* Manual Form (always shown in edit mode, shown in manual mode for new) */}
          {(mode === 'manual' || isEdit) && (
            <>
              {/* Basic info row */}
              <div className="flex items-start gap-3">
                {/* Icon picker */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      className="shrink-0 w-11 h-11 rounded-xl border border-border/60 flex items-center justify-center hover:bg-muted/60 transition-colors"
                      title={t('customSkill.icon')}
                    >
                      <SelectedIcon className="size-5 text-violet-500" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-64 p-2">
                    <div className="grid grid-cols-5 gap-1">
                      {SKILL_ICON_OPTIONS.map((iconName) => {
                        const Ic = resolveIcon(iconName);
                        return (
                          <button
                            key={iconName}
                            onClick={() => setIcon(iconName)}
                            className={cn(
                              'p-2 rounded-lg transition-colors flex items-center justify-center',
                              icon === iconName
                                ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600'
                                : 'hover:bg-muted/60 text-muted-foreground',
                            )}
                            title={iconName}
                          >
                            <Ic className="size-4" />
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>

                <div className="flex-1 space-y-2">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('customSkill.namePlaceholder')}
                    className="text-sm h-9"
                  />
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('customSkill.descriptionPlaceholder')}
                    className="text-sm h-9"
                  />
                </div>
              </div>

              {/* Variables */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  {t('customSkill.variables')}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {USER_SKILL_VARIABLE_OPTIONS.map((opt) => {
                    const isActive = variables.some((v) => v.source === opt.source);
                    return (
                      <button
                        key={opt.source}
                        onClick={() => toggleVariable(opt.source, opt.templateVar)}
                        className={cn(
                          'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border',
                          isActive
                            ? 'border-violet-200/60 dark:border-violet-700/50 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                            : 'border-border/50 text-muted-foreground/70 hover:text-foreground',
                        )}
                      >
                        <code className="font-mono text-[10px]">{`{{${opt.templateVar}}}`}</code>
                        <span>{t(opt.i18nKey)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* System prompt */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  {t('customSkill.systemPrompt')}
                </label>
                <Textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder={t('customSkill.systemPromptPlaceholder')}
                  rows={5}
                  className="text-sm font-mono"
                />
              </div>

              {/* User prompt */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t('customSkill.userPrompt')}
                  </label>
                  <span className="text-[10px] text-muted-foreground/50">
                    {t('customSkill.insertVariable')}
                  </span>
                </div>
                {/* Variable insert chips */}
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {variables.map((v) => (
                    <button
                      key={v.templateVar}
                      onClick={() => insertVariable(v.templateVar)}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 hover:bg-violet-200 dark:hover:bg-violet-800/40 transition-colors"
                    >
                      {`{{${v.templateVar}}}`}
                    </button>
                  ))}
                </div>
                <Textarea
                  ref={userPromptRef}
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  placeholder={t('customSkill.userPromptPlaceholder')}
                  rows={4}
                  className="text-sm font-mono"
                />
              </div>

              {/* Advanced options */}
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showAdvanced ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                {t('customSkill.advanced')}
              </button>

              {showAdvanced && (
                <div className="space-y-3 pl-2 border-l-2 border-border/40">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      {t('customSkill.responseKey')}
                    </label>
                    <Input
                      value={responseKey}
                      onChange={(e) => setResponseKey(e.target.value)}
                      placeholder={t('customSkill.responseKeyHint')}
                      className="text-sm h-8"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      {t('customSkill.guidance')}
                    </label>
                    <Textarea
                      value={guidance}
                      onChange={(e) => setGuidance(e.target.value)}
                      placeholder={t('customSkill.guidanceHint')}
                      rows={2}
                      className="text-sm"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-3 border-t border-border/40 flex items-center sm:justify-between">
          <div>
            {isEdit && (
              deleteConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-500">{t('customSkill.deleteConfirm')}</span>
                  <Button variant="destructive" size="sm" onClick={handleDelete}>
                    {t('customSkill.delete')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(false)}>
                    {t('customSkill.cancel')}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteConfirm(true)}
                  className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                >
                  <Trash2 className="size-3.5 mr-1" />
                  {t('customSkill.delete')}
                </Button>
              )
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              {t('customSkill.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || !name.trim() || !systemPrompt.trim() || !userPrompt.trim()}
            >
              {saving && <Loader2 className="size-3.5 animate-spin mr-1" />}
              {t('customSkill.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
