export const DEFAULT_MAX_JSON_BODY_BYTES = 16 * 1024;

export class BoundedJsonError extends Error {
  constructor(public readonly code: 'PAYLOAD_TOO_LARGE' | 'INVALID_JSON') {
    super(code);
    this.name = 'BoundedJsonError';
  }
}

/** Read and parse a small JSON request without buffering an unbounded body. */
export async function readBoundedJson<T>(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BODY_BYTES
): Promise<T> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new BoundedJsonError('PAYLOAD_TOO_LARGE');
    }
  }

  if (!request.body) throw new BoundedJsonError('INVALID_JSON');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('PAYLOAD_TOO_LARGE');
        throw new BoundedJsonError('PAYLOAD_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new BoundedJsonError('INVALID_JSON');
  }
}

export function isJsonBodyTooLarge(error: unknown): boolean {
  return error instanceof BoundedJsonError && error.code === 'PAYLOAD_TOO_LARGE';
}
