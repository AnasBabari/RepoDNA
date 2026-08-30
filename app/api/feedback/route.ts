import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { auth } from '../../lib/auth';

export const dynamic = 'force-dynamic';

export interface FeedbackPayload {
  usefulnessScore: number;
  primaryUsecase: string;
  missingCapabilities: string[];
  comments?: string;
}

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
  let session = null;
  try {
    session = await auth();
  } catch {}

  let body: Partial<FeedbackPayload>;
  try {
    body = await readBoundedJson<Partial<FeedbackPayload>>(request, MAX_FEEDBACK_BYTES);
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
    const primaryUsecase =
      typeof body.primaryUsecase === 'string' ? body.primaryUsecase.trim().slice(0, 100) : 'unspecified';
    const missingCapabilities = Array.isArray(body.missingCapabilities)
      ? body.missingCapabilities
          .filter((c): c is string => typeof c === 'string')
          .map((c) => c.trim().slice(0, 100))
          .slice(0, 10)
      : [];
    const rawComments = typeof body.comments === 'string' ? body.comments.trim().slice(0, 500) : '';

    if (!usefulnessScore) {
      return NextResponse.json(
        { success: false, error: 'usefulnessScore must be an integer between 1 and 5', requestId },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const entry = {
      requestId,
      timestamp: new Date().toISOString(),
      user: session?.user?.id
        ? crypto.createHash('sha256').update(session.user.id).digest('hex').slice(0, 16)
        : 'anonymous',
      usefulnessScore,
      primaryUsecase,
      missingCapabilities,
      commentLength: rawComments.length,
      hasComment: rawComments.length > 0,
    };

    console.log(`[RepoDNA:Feedback] ${JSON.stringify(entry)}`);

    return NextResponse.json(
      { success: true, message: 'Thank you for your feedback!', requestId },
      { headers: NO_STORE_HEADERS }
    );
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to process feedback submission.', requestId },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
}
