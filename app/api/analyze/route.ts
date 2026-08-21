import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { analyzeGitHubUrl } from '../../lib/analyzer';
import { IngestionError } from '../../lib/analyzer/types';
import { auth } from '../../lib/auth';
import { checkAnalysisRateLimit } from '../../lib/ratelimit';

export const dynamic = 'force-dynamic';

interface StructuredLog {
  requestId: string;
  timestamp: string;
  method: string;
  repo: string | null;
  clientIp: string;
  userType: 'authenticated' | 'public';
  durationMs: number;
  fileCount: number | null;
  status: number;
  resultCode: string;
  failureCategory: string | null;
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip');
  if (realIp) {
    return realIp.trim();
  }
  return '127.0.0.1';
}

function maskIp(ip: string): string {
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.***.***`;
    }
  }
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return `${parts.slice(0, 2).join(':')}:****:****`;
  }
  return '***.***';
}

function logStructured(entry: StructuredLog): void {
  // Never log source content or payload
  console.log(`[RepoDNA:API] ${JSON.stringify(entry)}`);
}

function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

async function handleAnalyze(url: string | null, method: string, request: NextRequest) {
  const requestId = generateRequestId();
  const startTime = Date.now();
  const rawClientIp = getClientIp(request);
  const clientIp = maskIp(rawClientIp);

  // Check Authentication
  let session = null;
  let accessToken: string | undefined;
  try {
    session = await auth();
    const token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET,
    });
    if (token?.accessToken) {
      accessToken = token.accessToken as string;
    }
  } catch {
    // Graceful unauthenticated fallback
  }

  const userId = session?.user?.id;
  const userType: 'authenticated' | 'public' = userId && userId !== 'anonymous' ? 'authenticated' : 'public';

  // 1. Check Rate Limit (Public 5/10m vs Authenticated 20/10m)
  try {
    const rateLimit = await checkAnalysisRateLimit({
      ip: rawClientIp,
      userId,
    });

    if (!rateLimit.allowed) {
      const durationMs = Date.now() - startTime;
      logStructured({
        requestId,
        timestamp: new Date().toISOString(),
        method,
        repo: url,
        clientIp,
        userType,
        durationMs,
        fileCount: null,
        status: 429,
        resultCode: 'RATE_LIMITED',
        failureCategory: 'rate_limit',
      });

      const retryAfter = rateLimit.retryAfter ?? 60;
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: `Too many repository analysis requests (${rateLimit.quotaType} quota). Please wait ${retryAfter} seconds before trying again.`,
            retryAfter,
          },
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(rateLimit.limit),
            'X-RateLimit-Remaining': String(rateLimit.remaining),
            'X-RateLimit-Reset': String(rateLimit.reset),
          },
        }
      );
    }
  } catch {
    const durationMs = Date.now() - startTime;
    logStructured({
      requestId,
      timestamp: new Date().toISOString(),
      method,
      repo: url,
      clientIp,
      userType,
      durationMs,
      fileCount: null,
      status: 503,
      resultCode: 'RATE_LIMIT_UNAVAILABLE',
      failureCategory: 'infrastructure',
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'RATE_LIMIT_UNAVAILABLE',
          message: 'Analysis rate-limiting service is temporarily unavailable. Please try browser-based analysis.',
        },
      },
      { status: 503 }
    );
  }

  // 2. Validate URL Parameter
  if (!url || typeof url !== 'string' || !url.trim()) {
    const durationMs = Date.now() - startTime;
    logStructured({
      requestId,
      timestamp: new Date().toISOString(),
      method,
      repo: null,
      clientIp,
      userType,
      durationMs,
      fileCount: null,
      status: 400,
      resultCode: 'INVALID_REQUEST',
      failureCategory: 'client_validation',
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Missing or empty "url" parameter. Must provide a valid public or private GitHub repository URL.',
        },
      },
      { status: 400 }
    );
  }

  // 3. Execute Static Analysis
  try {
    const project = await analyzeGitHubUrl(url.trim(), undefined, accessToken);
    const durationMs = Date.now() - startTime;

    logStructured({
      requestId,
      timestamp: new Date().toISOString(),
      method,
      repo: project.repository.name,
      clientIp,
      userType,
      durationMs,
      fileCount: project.repository.fileCount,
      status: 200,
      resultCode: 'SUCCESS',
      failureCategory: null,
    });

    return NextResponse.json({ success: true, project }, { status: 200 });
  } catch (error: unknown) {
    const durationMs = Date.now() - startTime;

    if (error instanceof IngestionError) {
      logStructured({
        requestId,
        timestamp: new Date().toISOString(),
        method,
        repo: url,
        clientIp,
        userType,
        durationMs,
        fileCount: null,
        status: error.status,
        resultCode: error.code,
        failureCategory: 'ingestion',
      });

      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            fallbackAvailable:
              error.code === 'UPSTREAM_GITHUB_RATE_LIMITED' ||
              error.code === 'UPSTREAM_GITHUB_ERROR' ||
              error.code === 'FETCH_TIMEOUT',
          },
        },
        { status: error.status }
      );
    }

    const message = error instanceof Error ? error.message : 'Unexpected analysis failure';
    logStructured({
      requestId,
      timestamp: new Date().toISOString(),
      method,
      repo: url,
      clientIp,
      userType,
      durationMs,
      fileCount: null,
      status: 500,
      resultCode: 'ANALYSIS_FAILED',
      failureCategory: 'internal',
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'ANALYSIS_FAILED',
          message,
        },
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url') || searchParams.get('repo');
  return handleAnalyze(url, 'GET', request);
}

export async function POST(request: NextRequest) {
  let url: string | null = null;
  try {
    const body = (await request.json()) as { url?: unknown; repo?: unknown };
    if (typeof body?.url === 'string') {
      url = body.url;
    } else if (typeof body?.repo === 'string') {
      url = body.repo;
    }
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'MALFORMED_JSON',
          message: 'Invalid JSON request body. Expected {"url": "https://github.com/owner/repo"}.',
        },
      },
      { status: 400 }
    );
  }

  return handleAnalyze(url, 'POST', request);
}
