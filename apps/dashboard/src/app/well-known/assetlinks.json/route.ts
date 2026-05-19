import { NextResponse } from 'next/server';

// Serves /.well-known/assetlinks.json (mapped via next.config rewrite).
// Content comes from the ANDROID_ASSETLINKS_JSON env var. Without it the
// route returns an empty array — Android won't verify the TWA but the
// APK still works (just shows a URL bar at the top).
//
// After building an APK via PWABuilder or Bubblewrap, copy the generated
// assetlinks.json contents into the ANDROID_ASSETLINKS_JSON env var
// (Dokploy → dashboard service → Environment), then redeploy.

export const dynamic = 'force-static';

export function GET() {
  const raw = process.env.ANDROID_ASSETLINKS_JSON ?? '[]';
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = [];
  }
  return NextResponse.json(parsed, {
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
