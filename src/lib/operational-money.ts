export function amountToMinor(raw: string): string | null {
  const match = /^(0|[1-9]\d{0,12})(?:[.,](\d{1,2}))?$/.exec(raw.trim());
  return match ? (BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))).toString() : null;
}
