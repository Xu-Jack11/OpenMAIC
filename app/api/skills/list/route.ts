import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { SkillManifest } from '@/lib/plugins/skill-manifest';
import { createLogger } from '@/lib/logger';

const log = createLogger('SkillAPI');

export async function GET() {
  try {
    const SKILLS_DIR = path.join(process.cwd(), 'lib', 'plugins', 'skills');
    const manifests: SkillManifest[] = [];

    if (!fs.existsSync(SKILLS_DIR)) {
      return NextResponse.json({ skills: [] });
    }

    const skillDirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const dir of skillDirs) {
      const yamlPath = path.join(SKILLS_DIR, dir, 'skill.yaml');
      if (!fs.existsSync(yamlPath)) {
        continue;
      }

      const raw = fs.readFileSync(yamlPath, 'utf-8');
      const manifest = yaml.load(raw) as SkillManifest;

      if (manifest && manifest.id && manifest.icon && manifest.generation?.promptId) {
        manifests.push(manifest);
      } else {
        log.warn(`Invalid skill.yaml in ${dir}/: missing required fields`);
      }
    }

    return NextResponse.json({ skills: manifests });
  } catch (error) {
    log.error('Failed to load skills:', error);
    return NextResponse.json({ error: 'Failed to load skills' }, { status: 500 });
  }
}
