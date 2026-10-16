'use client';

import { useEffect, useState } from 'react';
import { createRepositoryStatsRefresher } from '../lib/stats/client';

type CounterState =
  | { status: 'loading' }
  | { status: 'ready'; count: number; updatedAt: string }
  | { status: 'unavailable' };

const POLL_INTERVAL_MS = 30_000;

function formatCount(value: number): string {
  return Intl.NumberFormat('en-GB').format(value);
}

export function ScannedRepositoryCounter() {
  const [state, setState] = useState<CounterState>({ status: 'loading' });

  useEffect(() => {
    const refresher = createRepositoryStatsRefresher(
      (stats) => setState({ status: 'ready', count: stats.scannedRepositories, updatedAt: stats.updatedAt }),
      () => setState((prev) => (prev.status === 'ready' ? prev : { status: 'unavailable' })),
    );
    const startFetch = () => {
      void refresher.refresh();
    };

    startFetch();

    const intervalId = window.setInterval(() => {
      startFetch();
    }, POLL_INTERVAL_MS);

    const handleFocus = () => {
      startFetch();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        handleFocus();
      }
    };

    const handleAnalysisComplete = () => {
      startFetch();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('repodna:analysis-complete' as never, handleAnalysisComplete as EventListener);

    return () => {
      refresher.dispose();
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('repodna:analysis-complete' as never, handleAnalysisComplete as EventListener);
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="hero-scan-counter" aria-live="polite" aria-busy="true" data-testid="scan-counter-loading">
        <span className="hero-scan-counter-label">RepoDNA has scanned</span>{' '}
        <span className="hero-scan-counter-skeleton" aria-hidden="true">
          —
        </span>{' '}
        <span className="hero-scan-counter-label">public repositories</span>
      </div>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <div
        className="hero-scan-counter hero-scan-counter-unavailable"
        aria-live="polite"
        data-testid="scan-counter-unavailable"
        title="Unique public repositories successfully analyzed by RepoDNA."
      >
        <span className="hero-scan-counter-label">RepoDNA has scanned</span>{' '}
        <span className="hero-scan-counter-unavailable-text">—</span>{' '}
        <span className="hero-scan-counter-label">public repositories</span>{' '}
        <span className="hero-scan-counter-hint" aria-hidden="true">
          · live count unavailable
        </span>
      </div>
    );
  }

  return (
    <div
      className="hero-scan-counter"
      aria-live="polite"
      data-testid="scan-counter"
      title="Unique public repositories successfully analyzed by RepoDNA."
    >
      <span className="hero-scan-counter-label">RepoDNA has scanned</span>{' '}
      <strong className="hero-scan-counter-count" data-testid="scan-counter-count">
        {formatCount(state.count)}
      </strong>{' '}
      <span className="hero-scan-counter-label">public repositories</span>
    </div>
  );
}
