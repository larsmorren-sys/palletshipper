import { getDocument, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { detectColumns, isMaterialHeader, normalizeHeader } from '../shared/import-columns.js';

// PDF text often arrives in drawing order, which need not match reading order.
// Work in viewport coordinates so rotated pages use the same row grouping.
function textLines(items, viewport) {
  const parts = items.filter(item => item.str?.trim()).map(item => {
    const transform = Util.transform(viewport.transform, item.transform);
    return { text: item.str.trim(), x: transform[4], y: transform[5], width: Math.abs(item.width * viewport.scale), height: Math.max(1, Math.hypot(transform[2], transform[3])) };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const part of parts) {
    let line = lines.slice(-3).find(line => Math.abs(line.y - part.y) <= Math.max(2, Math.min(line.height, part.height) * .3));
    if (!line) { line = { y: part.y, height: part.height, parts: [] }; lines.push(line); }
    line.parts.push(part);
  }
  return lines.sort((a, b) => a.y - b.y).map(line => {
    const cells = [];
    for (const part of line.parts.sort((a, b) => a.x - b.x)) {
      const previous = cells.at(-1);
      const gap = previous ? part.x - previous.end : Infinity;
      if (previous && gap <= Math.max(9, part.height * .9)) {
        previous.text += (gap > 1.5 ? ' ' : '') + part.text;
        previous.end = Math.max(previous.end, part.x + part.width);
      } else cells.push({ text: part.text, x: part.x, end: part.x + part.width });
    }
    return { ...line, cells };
  });
}

function boundaries(cells) {
  return cells.slice(1).map((cell, index) => (Math.min(cells[index].end, cell.x) + cell.x) / 2);
}
function alignRow(line, splits) {
  const row = Array(splits.length + 1).fill('');
  for (const cell of line.cells) {
    const column = splits.findIndex(split => cell.x < split);
    const index = column < 0 ? splits.length : column;
    row[index] = [row[index], cell.text].filter(Boolean).join(' ');
  }
  return row;
}

export async function extractPdfRows(buffer) {
  const task = getDocument({ data: new Uint8Array(buffer), verbosity: 0, isEvalSupported: false });
  try {
    const document = await task.promise;
    const pages = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(textLines(content.items, page.getViewport({ scale: 1 })));
      page.cleanup();
    }
    const lines = pages.flat();
    const headerIndex = lines.findIndex(line => isMaterialHeader(line.cells.map(cell => cell.text)));
    const hasHeader = headerIndex >= 0;
    // Without a known header, use the most common multi-column row layout.
    const counts = new Map();
    for (const line of lines) if (line.cells.length > 1) counts.set(line.cells.length, (counts.get(line.cells.length) || 0) + 1);
    const dominantCount = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];
    const reference = hasHeader ? lines[headerIndex] : lines.find(line => line.cells.length === dominantCount);
    const columnCount = reference?.cells.length || 1;
    let splits = reference ? boundaries(reference.cells) : [];
    const header = hasHeader ? reference.cells.map(cell => cell.text) : null;
    const columns = header ? detectColumns(header) : { name: 0, code: -1, quantity: -1 };
    if (columns.name < 0) columns.name = 0;
    const rows = hasHeader ? [header] : [];
    let previousLine = null;
    let started = !hasHeader;
    for (const page of pages) {
      previousLine = null;
      for (const line of page) {
        if (!started && line !== reference) continue;
        started = true;
        const values = line.cells.map(cell => cell.text);
        if (hasHeader && values.length === columnCount && values.every((value, i) => normalizeHeader(value) === normalizeHeader(header[i]))) {
          // Repeated page headers are not material. Refresh geometry for this page.
          splits = boundaries(line.cells); previousLine = null; continue;
        }
        if (values.length === 1 && /^(?:pagina|page)\s+\d+(?:\s*(?:\/|van|of)\s*\d+)?$/i.test(values[0])) continue;
        const row = reference ? alignRow(line, splits) : [values.join(' ')];
        const descriptionOnly = hasHeader && line.cells.length === 1 && row[columns.name] && row.every((value, i) => i === columns.name || !value);
        const previous = rows.at(-1);
        const previousIsMaterial = previous && (columns.quantity >= 0 && /^\d+$/.test(previous[columns.quantity]) || columns.code >= 0 && previous[columns.code]);
        if (descriptionOnly && previousLine && previousIsMaterial && line.y - previousLine.y <= Math.max(line.height, previousLine.height) * 1.8) {
          previous[columns.name] += ` ${row[columns.name]}`;
        } else rows.push(row);
        previousLine = line;
      }
    }
    const emptyPages = pages.filter(page => !page.length).length;
    const warning = (columnCount > 1 ? `${columnCount} PDF-kolommen herkend${hasHeader ? ' met kolomnamen' : ' zonder herkenbare kolomnamen'}. Controleer de kolomkeuze, omschrijvingen en aantallen voor je importeert.` : 'Geen duidelijke PDF-kolommen gevonden. De tekst is per regel ingelezen; controleer omschrijvingen en aantallen.') + (emptyPages ? ` ${emptyPages} pagina('s) zonder leesbare tekst zijn niet verwerkt.` : '') + ' Gescande PDF’s worden nog niet ondersteund.';
    return { rows, hasHeader, columns, warning };
  } finally { await task.destroy(); }
}
