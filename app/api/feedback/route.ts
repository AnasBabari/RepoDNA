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

export async function POST(request: NextRequest) {
  const requestId = `req_fb_${crypto.randomUUID().slice(0, 12)}`;
  let session = null;
  try {
    session = await auth();
  } catch {}

  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > 16 * 1024) {
    return NextResponse.json(
      { success: false, error: 'Request body exceeds 16 KB limit', requestId },
      { status: 413 }
    );
  }

  try {
    const body = (await request.json()) as Partial<FeedbackPayload>;

    const usefulnessScore =
      typeof body.usefulnessScore === 'number' && Number.isInteger(body.usefulnessScore)
        ? Math.min(5, Math.max(1, body.usefulnessScore))
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
        { status: 400 }
      );
    }

    const entry = {
      requestId,
      timestamp: new Date().toISOString(),
      user: session?.user?.id || 'anonymous',
      usefulnessScore,
      primaryUsecase,
      missingCapabilities,
      commentLength: rawComments.length,
      hasComment: rawComments.length > 0,
    };

    console.log(`[RepoDNA:Feedback] ${JSON.stringify(entry)}`);

    return NextResponse.json({ success: true, message: 'Thank you for your feedback!', requestId });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to process feedback submission.', requestId },
      { status: 400 }
    );
  }
}
