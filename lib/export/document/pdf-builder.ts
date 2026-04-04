import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ExportableDocument, DocumentSection } from './types';

const PAGE_MARGIN = 20;
const PAGE_WIDTH = 210; // A4 width in mm
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const LINE_HEIGHT = 7;

const HEADING_SIZES: Record<number, number> = {
  1: 18,
  2: 15,
  3: 13,
  4: 11,
};

function addSection(pdf: jsPDF, section: DocumentSection, y: number): number {
  const fontSize = HEADING_SIZES[section.level] ?? 11;

  // Check page break
  if (y > 270) {
    pdf.addPage();
    y = PAGE_MARGIN;
  }

  // Heading
  pdf.setFontSize(fontSize);
  pdf.setFont('helvetica', 'bold');
  const headingLines = pdf.splitTextToSize(section.heading, CONTENT_WIDTH);
  pdf.text(headingLines, PAGE_MARGIN, y);
  y += headingLines.length * (fontSize * 0.4) + 4;

  // Reset to body font
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');

  if (section.paragraphs) {
    for (const p of section.paragraphs) {
      if (y > 270) {
        pdf.addPage();
        y = PAGE_MARGIN;
      }
      const lines = pdf.splitTextToSize(p, CONTENT_WIDTH);
      pdf.text(lines, PAGE_MARGIN, y);
      y += lines.length * LINE_HEIGHT + 3;
    }
  }

  if (section.bulletPoints) {
    for (const bp of section.bulletPoints) {
      if (y > 270) {
        pdf.addPage();
        y = PAGE_MARGIN;
      }
      const lines = pdf.splitTextToSize(bp, CONTENT_WIDTH - 8);
      pdf.text('\u2022', PAGE_MARGIN, y);
      pdf.text(lines, PAGE_MARGIN + 8, y);
      y += lines.length * LINE_HEIGHT + 2;
    }
  }

  if (section.numberedItems) {
    section.numberedItems.forEach((item, i) => {
      if (y > 270) {
        pdf.addPage();
        y = PAGE_MARGIN;
      }
      const prefix = `${i + 1}. `;
      const lines = pdf.splitTextToSize(item, CONTENT_WIDTH - 10);
      pdf.text(prefix, PAGE_MARGIN, y);
      pdf.text(lines, PAGE_MARGIN + 10, y);
      y += lines.length * LINE_HEIGHT + 2;
    });
  }

  if (section.table) {
    autoTable(pdf, {
      startY: y,
      head: [section.table.headers],
      body: section.table.rows,
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
      styles: { fontSize: 9 },
      headStyles: { fillColor: [100, 100, 100] },
    });
    y = (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
  }

  if (section.children) {
    for (const child of section.children) {
      y = addSection(pdf, child, y);
    }
  }

  return y + 3;
}

export function buildPdf(doc: ExportableDocument): Blob {
  const pdf = new jsPDF('p', 'mm', 'a4');
  let y = PAGE_MARGIN;

  // Title
  pdf.setFontSize(22);
  pdf.setFont('helvetica', 'bold');
  const titleLines = pdf.splitTextToSize(doc.meta.title, CONTENT_WIDTH);
  pdf.text(titleLines, PAGE_WIDTH / 2, y, { align: 'center' });
  y += titleLines.length * 10 + 4;

  if (doc.meta.subtitle) {
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'italic');
    pdf.setTextColor(100);
    pdf.text(doc.meta.subtitle, PAGE_WIDTH / 2, y, { align: 'center' });
    y += 8;
    pdf.setTextColor(0);
  }

  if (doc.meta.date) {
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(150);
    pdf.text(doc.meta.date, PAGE_WIDTH / 2, y, { align: 'center' });
    y += 10;
    pdf.setTextColor(0);
  }

  y += 5;

  for (const section of doc.sections) {
    y = addSection(pdf, section, y);
  }

  return pdf.output('blob');
}
