export function safeCsvCell(value: unknown): string {
  const normalized = String(value ?? '').replace(/[\r\n]+/g, ' ');
  const safe = /^\s*[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function csvDocument(rows: unknown[][]): string {
  return '\uFEFF' + rows.map(row => row.map(safeCsvCell).join(',')).join('\r\n') + '\r\n';
}
