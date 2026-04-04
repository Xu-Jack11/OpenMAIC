import type { ExportableDocument, DocumentSection } from './types';

function buildHeading(text: string, level: number): string {
  return `${'#'.repeat(level)} ${text}`;
}

function buildTable(headers: string[], rows: string[][]): string {
  const header = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return `${header}\n${separator}\n${body}`;
}

function buildSection(section: DocumentSection): string {
  const parts: string[] = [];

  parts.push(buildHeading(section.heading, section.level));

  if (section.paragraphs) {
    for (const p of section.paragraphs) {
      parts.push(p);
    }
  }

  if (section.bulletPoints) {
    for (const bp of section.bulletPoints) {
      parts.push(`- ${bp}`);
    }
  }

  if (section.numberedItems) {
    section.numberedItems.forEach((item, i) => {
      parts.push(`${i + 1}. ${item}`);
    });
  }

  if (section.table) {
    parts.push(buildTable(section.table.headers, section.table.rows));
  }

  if (section.children) {
    for (const child of section.children) {
      parts.push(buildSection(child));
    }
  }

  return parts.join('\n\n');
}

export function buildMarkdown(doc: ExportableDocument): string {
  const parts: string[] = [];

  parts.push(`# ${doc.meta.title}`);

  if (doc.meta.subtitle) {
    parts.push(`*${doc.meta.subtitle}*`);
  }

  if (doc.meta.date) {
    parts.push(`> ${doc.meta.date}`);
  }

  for (const section of doc.sections) {
    parts.push(buildSection(section));
  }

  return parts.join('\n\n') + '\n';
}
