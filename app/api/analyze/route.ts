import { NextRequest, NextResponse } from 'next/server';
import { analyzeGitHubUrl } from '../../lib/analyzer';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing ?url= parameter' }, { status: 400 });
  }

  try {
    const project = await analyzeGitHubUrl(url);
    return NextResponse.json({ success: true, project });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis failed';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { url?: unknown };
    const url = typeof body?.url === 'string' ? body.url : undefined;

    if (!url) {
      return NextResponse.json({ error: 'Missing "url" in JSON request body' }, { status: 400 });
    }

    const project = await analyzeGitHubUrl(url);
    return NextResponse.json({ success: true, project });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis failed';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
