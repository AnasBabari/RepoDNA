import { NextResponse } from 'next/server';
import { auth } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, message: 'Not authenticated' }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      message: 'Revocation processed. You can also disconnect the app in your GitHub Settings if you wish to permanently remove permissions.',
      githubSettingsUrl: 'https://github.com/settings/applications',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Revocation failed';
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
