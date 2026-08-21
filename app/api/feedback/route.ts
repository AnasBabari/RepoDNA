import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../lib/auth';

export const dynamic = 'force-dynamic';

export interface FeedbackPayload {
  usefulnessScore: number;
  primaryUsecase: string;
  missingCapabilities: string[];
  comments?: string;
}

export async function POST(request: NextRequest) {
  let session = null;
  try {
    session = await auth();
  } catch {}

  try {
    const body = (await request.json()) as Partial<FeedbackPayload>;

    const usefulnessScore = typeof body.usefulnessScore === 'number' ? Math.min(5, Math.max(1, body.usefulnessScore)) : 0;
    const primaryUsecase = typeof body.primaryUsecase === 'string' ? body.primaryUsecase.slice(0, 100) : 'unspecified';
    const missingCapabilities = Array.isArray(body.missingCapabilities)
      ? body.missingCapabilities.filter((c): c is string => typeof c === 'string').slice(0, 10)
      : [];
    const rawComments = typeof body.comments === 'string' ? body.comments.slice(0, 500) : '';

    if (!usefulnessScore) {
      return NextResponse.json(
        { success: false, error: 'usefulnessScore (1-5) is required' },
        { status: 400 }
      );
    }

    const entry = {
      timestamp: new Date().toISOString(),
      user: session?.user?.id || 'anonymous',
      usefulnessScore,
      primaryUsecase,
      missingCapabilities,
      commentLength: rawComments.length,
      hasComment: rawComments.length > 0,
    };

    console.log(`[RepoDNA:Feedback] ${JSON.stringify(entry)}`);

    return NextResponse.json({ success: true, message: 'Thank you for your feedback!' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to submit feedback';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
