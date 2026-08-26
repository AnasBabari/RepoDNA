function serialize(value: unknown, indent: string, currentIndent: string): string {
  if (value === null || value === undefined) return 'null';
  const kind = typeof value;
  if (kind === 'number') return Number.isFinite(value as number) ? JSON.stringify(value) : 'null';
  if (kind === 'boolean' || kind === 'string') return JSON.stringify(value);
  if (kind === 'bigint') return JSON.stringify((value as bigint).toString());
  if (kind !== 'object') return 'null';

  const childIndent = currentIndent + indent;
  const separator = indent ? `,\n${childIndent}` : ',';
  const open = indent ? `\n${childIndent}` : '';
  const close = indent ? `\n${currentIndent}` : '';

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => serialize(item, indent, childIndent));
    return `[${open}${items.join(separator)}${close}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (keys.length === 0) return '{}';
  const entries = keys.map((key) => `${JSON.stringify(key)}:${indent ? ' ' : ''}${serialize(record[key], indent, childIndent)}`);
  return `{${open}${entries.join(separator)}${close}}`;
}

export function stableStringify(value: unknown, space = 0): string {
  return serialize(value, space > 0 ? ' '.repeat(space) : '', '');
}

export function compactStableStringify(value: unknown): string {
  return stableStringify(value, 0);
}

export function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? utf8Bytes(input) : input;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
