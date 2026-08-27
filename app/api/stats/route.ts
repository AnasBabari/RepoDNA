import { NextResponse } from 'next/server';

import { getScannedPublicRepositoryCount } from '../../lib/stats/scanned-repositories';

export const dynamic = 'force-dynamic';

export async function GET() {
  const count = await getScannedPublicRepositoryCount();
  const updatedAt = new Date().toISOString();

  const headers = {
    'Cache-Control': 'no-store',
  };

  if (count === null) {
    return NextResponse.json(
      {
        scannedRepositories: null,
        unavailable: true,
        reason: 'STATS_UNAVAILABLE',
        updatedAt,
      },
      { status: 503, headers }
    );
  }

  return NextResponse.json(
    {
      scannedRepositories: count,
      updatedAt,
    },
    { headers }
  );
}
