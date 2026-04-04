import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  Packer,
  BorderStyle,
} from 'docx';
import type { ExportableDocument, DocumentSection } from './types';

const HEADING_MAP: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
};

function buildTableElement(headers: string[], rows: string[][]): Table {
  const headerRow = new TableRow({
    children: headers.map(
      (h) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
          shading: { fill: 'E8E8E8' },
        }),
    ),
  });

  const dataRows = rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: cell })] })],
            }),
        ),
      }),
  );

  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
    },
  });
}

function buildSectionElements(section: DocumentSection): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];

  elements.push(
    new Paragraph({
      heading: HEADING_MAP[section.level] ?? HeadingLevel.HEADING_4,
      children: [new TextRun({ text: section.heading })],
    }),
  );

  if (section.paragraphs) {
    for (const p of section.paragraphs) {
      elements.push(new Paragraph({ children: [new TextRun({ text: p })] }));
    }
  }

  if (section.bulletPoints) {
    for (const bp of section.bulletPoints) {
      elements.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: bp })],
        }),
      );
    }
  }

  if (section.numberedItems) {
    for (const item of section.numberedItems) {
      elements.push(
        new Paragraph({
          numbering: { reference: 'default-numbering', level: 0 },
          children: [new TextRun({ text: item })],
        }),
      );
    }
  }

  if (section.table) {
    elements.push(buildTableElement(section.table.headers, section.table.rows));
  }

  if (section.children) {
    for (const child of section.children) {
      elements.push(...buildSectionElements(child));
    }
  }

  return elements;
}

export async function buildDocx(doc: ExportableDocument): Promise<Blob> {
  const children: (Paragraph | Table)[] = [];

  // Title
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: doc.meta.title, bold: true, size: 48 })],
    }),
  );

  if (doc.meta.subtitle) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: doc.meta.subtitle, italics: true, size: 24, color: '666666' }),
        ],
      }),
    );
  }

  if (doc.meta.date) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: doc.meta.date, size: 20, color: '999999' })],
        spacing: { after: 400 },
      }),
    );
  }

  for (const section of doc.sections) {
    children.push(...buildSectionElements(section));
  }

  const document = new Document({
    numbering: {
      config: [
        {
          reference: 'default-numbering',
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [{ children }],
  });

  return Packer.toBlob(document);
}
