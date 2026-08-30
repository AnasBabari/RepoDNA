import { NextResponse } from 'next/server';

export interface ApiErrorPayload {
  code: string;
  message: string;
  requestId: string;
  retryable?: boolean;
  fallbackAvailable?: boolean;
  retryAfter?: number;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorPayload;
}

export function createApiErrorResponse(
  code: string,
  message: string,
  status = 400,
  options?: {
    requestId?: string;
    retryable?: boolean;
    fallbackAvailable?: boolean;
    retryAfter?: number;
    headers?: Record<string, string>;
  }
): NextResponse<ApiErrorResponse> {
  const requestId = options?.requestId || `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  const payload: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
      requestId,
      ...(options?.retryable !== undefined ? { retryable: options.retryable } : {}),
      ...(options?.fallbackAvailable !== undefined ? { fallbackAvailable: options.fallbackAvailable } : {}),
      ...(options?.retryAfter !== undefined ? { retryAfter: options.retryAfter } : {}),
    },
  };

  return NextResponse.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...options?.headers,
    },
  });
}
