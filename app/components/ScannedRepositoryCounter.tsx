'use client';

import { useEffect, useRef, useState } from 'react';

type StatsSuccess = {
  scannedRepositories: number;
  updatedAt: string;
};

type StatsUnavailable = {
  scannedRepositories: null;
  unavailable: true;
  reason?: string;
  updatedAt: string;
};

type StatsResponse = StatsSuccess | StatsUnavailable;

type CounterState =
  | { status: 'loading' }
  | { status: 'ready'; count: number; updatedAt: string }
  | { status: 'unavailable' };

const POLL_INTERVAL_MS = 30_000;

function formatCount(value: number): string {
  return Intl.NumberFormat('en-GB').format(value);
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

export function ScannedRepositoryCounter() {
  const [state, setState] = useState<CounterState>({ status: 'loading' });
  const abortRef = useRef<AbortController | null>(null);
  const intervalRef = useRef<number | null>(null);

  const fetchStats = async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/stats', {
        method: 'GET',
        cache: 'no-store',
        signal,
        headers: { Accept: 'application/json' },
      });

      // Controlled unavailable response uses 503 with JSON body
      const data = (await response.json()) as StatsResponse;

      if (
        typeof (data as StatsSuccess).scannedRepositories === 'number' &&
        Number.isFinite((data as StatsSuccess).scannedRepositories)
      ) {
        const success = data as StatsSuccess;
        setState({ status: 'ready', count: success.scannedRepositories, updatedAt: success.updatedAt });
        return;
      }

      if ((data as StatsUnavailable).unavailable === true || (data as StatsUnavailable).scannedRepositories === null) {
        setState({ status: 'unavailable' });
        return;
      }

      // Fallback: treat non-success as unavailable without inventing a number
      setState({ status: 'unavailable' });
    } catch (error) {
      if (isAbortError(error)) return;
      // Network error or parse failure — keep last known good value if present, otherwise show unavailable after initial load fails
      setState((prev) => (prev.status === 'ready' ? prev : { status: 'unavailable' }));
    }
  };

  useEffect(() => {
    let disposed = false;
    const startFetch = () => {
      if (disposed) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      void fetchStats(controller.signal);
    };

    startFetch();

    const intervalId = window.setInterval(() => {
      startFetch();
    }, POLL_INTERVAL_MS);
    intervalRef.current = intervalId as unknown as number;

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
      disposed = true;
      abortRef.current?.abort();
      abortRef.current = null;
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('repodna:analysis-complete' as never, handleAnalysisComplete as EventListener);
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="hero-scan-counter" aria-live="polite" aria-busy="true" data-testid="scan-counter-loading">
        <span className="hero-scan-counter-label">RepoDNA has scanned</span>
        <span className="hero-scan-counter-skeleton" aria-hidden="true">
          —
        </span>
        <span className="hero-scan-counter-label">unique public repositories</span>
      </div>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <div
        className="hero-scan-counter hero-scan-counter-unavailable"
        aria-live="polite"
        data-testid="scan-counter-unavailable"
        title="Unique public repositories successfully analyzed by RepoDNA's server-side analyzers."
      >
        <span className="hero-scan-counter-label">RepoDNA has scanned</span>
        <span className="hero-scan-counter-unavailable-text">—</span>
        <span className="hero-scan-counter-label">unique public repositories</span>
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
      title="Unique public repositories successfully analyzed by RepoDNA's server-side analyzers."
    >
      <span className="hero-scan-counter-label">RepoDNA has scanned</span>
      <strong className="hero-scan-counter-count" data-testid="scan-counter-count">
        {formatCount(state.count)}
      </strong>
      <span className="hero-scan-counter-label">unique public repositories</span>
    </div>
  );
}
