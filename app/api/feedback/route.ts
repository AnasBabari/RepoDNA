import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { parseAggregateFeedback } from '../../lib/feedback-contract';
import { storeAggregateFeedback } from '../../lib/feedback-store';

export const dynamic = 'force-dynamic';

import type { AggregateFeedback } from '../../lib/feedback-contract';

const MAX_FEEDBACK_BYTES = 16 * 1024;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

async function readBoundedJson<T>(request: NextRequest, maxBytes: number): Promise<T> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new Error('PAYLOAD_TOO_LARGE');
  }

  if (!request.body) {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > maxBytes) {
      throw new Error('PAYLOAD_TOO_LARGE');
    }
    return JSON.parse(text) as T;
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel('PAYLOAD_TOO_LARGE');
          throw new Error('PAYLOAD_TOO_LARGE');
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const decoder = new TextDecoder('utf-8');
  let text = '';
  for (const chunk of chunks) {
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text) as T;
}

export async function POST(request: NextRequest) {
  const requestId = `req_fb_${crypto.randomUUID().slice(0, 12)}`;
  let body: Partial<AggregateFeedback>;
  try {
    body = await readBoundedJson<Partial<AggregateFeedback>>(request, MAX_FEEDBACK_BYTES);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json(
        { success: false, error: 'Request body exceeds 16 KB limit', requestId },
        { status: 413, headers: NO_STORE_HEADERS }
      );
    }
    return NextResponse.json(
      { success: false, error: 'Invalid or malformed JSON body.', requestId },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const usefulnessScore =
      typeof body.usefulnessScore === 'number' &&
      Number.isInteger(body.usefulnessScore) &&
      body.usefulnessScore >= 1 &&
      body.usefulnessScore <= 5
        ? body.usefulnessScore
        : 0;
    if (!usefulnessScore) {
      return NextResponse.json(
        { success: false, error: 'usefulnessScore must be an integer between 1 and 5', requestId },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const payload = parseAggregateFeedback(body);
    if (!payload) return NextResponse.json(
      { success: false, error: 'Only the listed survey choices and a submission UUID are accepted. Free text is not collected.', requestId },
      { status: 400, headers: NO_STORE_HEADERS }
    );
    if (!await storeAggregateFeedback(payload)) return NextResponse.json(
      { success: false, error: 'Feedback is busy. Please retry in a minute.', requestId },
      { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': '60' } }
    );

    return NextResponse.json(
      { success: true, message: 'Survey choices accepted as anonymous daily counts.', requestId },
      { headers: NO_STORE_HEADERS }
    );
  } catch {
    return NextResponse.json(
      { success: false, error: 'Feedback delivery is unavailable. Your selections have not been confirmed. Please retry.', requestId },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }
}
