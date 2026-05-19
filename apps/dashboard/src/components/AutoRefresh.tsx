'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Re-runs router.refresh() on an interval so the current server-rendered
// page re-fetches its data. Skips refresh while the tab is in the
// background, and pauses while the user is typing in a form (focus
// inside an input/textarea) to avoid losing in-progress edits.
export default function AutoRefresh({ intervalSeconds = 30 }: { intervalSeconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      const active = document.activeElement as HTMLElement | null;
      if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;
      router.refresh();
    };
    const id = window.setInterval(tick, intervalSeconds * 1000);
    return () => window.clearInterval(id);
  }, [router, intervalSeconds]);
  return null;
}
