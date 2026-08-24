'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type { SafeRepositoryItem } from '../api/github/repositories/route';
import { trackAuthFlow } from '../lib/analytics';

export function PrivateRepoPicker({
  isOpen,
  onClose,
  onSelectRepo,
  onSignOut,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelectRepo: (repoFullName: string) => void;
  onSignOut: () => void;
}) {
  const [repos, setRepos] = useState<SafeRepositoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const fetchRepos = useCallback(async (searchQuery: string, pageNum: number) => {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const params = new URLSearchParams({
        page: String(pageNum),
        query: searchQuery,
      });
      const res = await fetch(`/api/github/repositories?${params.toString()}`);
      const data = (await res.json()) as {
        success?: boolean;
        error?: { code?: string; message?: string };
        repositories?: SafeRepositoryItem[];
        hasMore?: boolean;
        page?: number;
      };

      if (!res.ok || !data.success) {
        const code = data.error?.code || (res.status === 401 ? 'UNAUTHORIZED' : res.status === 403 ? 'FORBIDDEN' : res.status === 429 ? 'RATE_LIMITED' : null);
        const err = new Error(data.error?.message || 'Failed to fetch repositories') as Error & { code?: string };
        err.code = code || undefined;
        throw err;
      }

      setRepos(data.repositories || []);
      setHasMore(Boolean(data.hasMore));
      setPage(data.page || pageNum);
    } catch (err) {
      const code = (err as Error & { code?: string }).code || null;
      setErrorCode(code);
      setError(err instanceof Error ? err.message : 'Could not load repositories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      const timeout = setTimeout(() => {
        fetchRepos(query, 1);
      }, query ? 300 : 0);
      return () => clearTimeout(timeout);
    }
  }, [isOpen, query, fetchRepos]);

  if (!isOpen) return null;

  function handleClose() {
    setConfirmingRevoke(false);
    onClose();
  }

  async function handleRevoke() {
    setRevoking(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/revoke', { method: 'POST' });
      const data = (await response.json()) as { success?: boolean; message?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.message || 'GitHub did not confirm token revocation.');
      }
      trackAuthFlow('scope_revoked');
      // Also clear Auth.js session cookie so stale JWT is not reused
      try { await fetch('/api/auth/signout', { method: 'POST' }); } catch {}
      onSignOut();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke GitHub access.');
    } finally {
      setRevoking(false);
      setConfirmingRevoke(false);
    }
  }

  async function handleReconnect() {
    setReconnecting(true);
    try {
      // Clear invalid session before restarting authorization
      try { await fetch('/api/auth/signout', { method: 'POST' }); } catch {}
      try { await fetch('/api/auth/signout?callbackUrl=/', { method: 'POST' }); } catch {}
      onSignOut();
      trackAuthFlow('reconnect_triggered');
      window.location.href = '/api/auth/signin?callbackUrl=/';
    } finally {
      setReconnecting(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={handleClose}>
      <div
        className="dialog-card"
        style={{ maxWidth: '720px', width: '94%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Your GitHub Repositories (Beta)</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '2px' }}>
              Select any private or public repository to analyze.
            </p>
          </div>
          <button className="icon-button" onClick={handleClose} aria-label="Close repository picker">
            ✕
          </button>
        </div>

        {/* Scope Transparency Notice */}
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            background: 'rgba(0, 240, 255, 0.05)',
            border: '1px solid rgba(0, 240, 255, 0.2)',
            fontSize: '0.78rem',
            color: 'var(--text-dim)',
            lineHeight: 1.4,
            marginBottom: '12px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
            <span>
              🔒 <strong>Scope Transparency:</strong> Private access uses GitHub App <code>contents:read</code> + <code>metadata:read</code> (per-repository install, least-privilege). Legacy OAuth App <code>repo</code> scope is fallback only when the App is not configured.
              RepoDNA performs read-only GET requests, parses ASTs transiently in memory, and never modifies or stores code.{' '}
              <a
                href="https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--cyan-core)', textDecoration: 'underline' }}
              >
                Learn about GitHub Apps ↗
              </a>
            </span>
            <button
              type="button"
              onClick={() => setConfirmingRevoke(true)}
              disabled={revoking}
              style={{
                fontSize: '0.75rem',
                color: '#f87171',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                textDecoration: 'underline',
              }}
            >
              {revoking ? 'Revoking...' : 'Disconnect GitHub'}
            </button>
          </div>
          {confirmingRevoke && (
            <div
              role="alertdialog"
              aria-labelledby="disconnect-github-title"
              aria-describedby="disconnect-github-description"
              style={{
                marginTop: '10px',
                paddingTop: '10px',
                borderTop: '1px solid rgba(248, 113, 113, 0.25)',
              }}
            >
              <strong id="disconnect-github-title" style={{ color: '#fca5a5' }}>
                Disconnect RepoDNA from GitHub?
              </strong>
              <p id="disconnect-github-description" style={{ margin: '4px 0 10px' }}>
                This revokes the current GitHub token and signs you out. Your GitHub App installation and selected repositories remain until you remove them in GitHub Settings.
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="chip-button"
                  onClick={() => setConfirmingRevoke(false)}
                  disabled={revoking}
                >
                  Keep connected
                </button>
                <button
                  type="button"
                  className="chip-button"
                  onClick={handleRevoke}
                  disabled={revoking}
                  style={{ color: '#fca5a5', borderColor: 'rgba(248, 113, 113, 0.45)' }}
                >
                  {revoking ? 'Revoking...' : 'Revoke and sign out'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Search input */}
        <div style={{ marginBottom: '12px' }}>
          <input
            type="text"
            className="filter-input"
            style={{ width: '100%' }}
            placeholder="Search your repositories by name or description..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Repository List */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: '260px', paddingRight: '4px' }}>
          {loading && repos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-dim)' }}>
              Connecting to GitHub API...
            </div>
          ) : error ? (
            <div className="dialog-error" style={{ margin: '20px 0' }}>
              <div style={{ marginBottom: errorCode === 'UNAUTHORIZED' || errorCode === 'GITHUB_TOKEN_EXPIRED' ? '10px' : '6px' }}>
                {error}
                {errorCode === 'FORBIDDEN' || errorCode === 'GITHUB_FORBIDDEN' ? (
                  <div style={{ marginTop: '8px', fontSize: '0.78rem' }}>
                    Install the GitHub App on the repositories you want to analyze:{' '}
                    <a href="https://github.com/settings/installations" target="_blank" rel="noreferrer" style={{ color: 'var(--cyan-core)', textDecoration: 'underline' }}>
                      github.com/settings/installations ↗
                    </a>
                  </div>
                ) : null}
              </div>
              <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {errorCode === 'UNAUTHORIZED' || errorCode === 'GITHUB_TOKEN_EXPIRED' ? (
                  <button className="primary-button" onClick={handleReconnect} disabled={reconnecting} type="button" style={{ fontSize: '0.85rem', padding: '6px 14px' }}>
                    {reconnecting ? 'Redirecting…' : 'Reconnect GitHub'}
                  </button>
                ) : errorCode === 'FORBIDDEN' || errorCode === 'GITHUB_FORBIDDEN' ? (
                  <>
                    <button className="primary-button" onClick={handleReconnect} disabled={reconnecting} type="button" style={{ fontSize: '0.85rem', padding: '6px 14px' }}>
                      {reconnecting ? 'Redirecting…' : 'Reconnect GitHub'}
                    </button>
                    <button className="chip-button" onClick={() => fetchRepos(query, 1)} type="button">
                      Retry
                    </button>
                  </>
                ) : errorCode === 'RATE_LIMITED' ? (
                  <button className="chip-button" onClick={() => fetchRepos(query, 1)} type="button">
                    Retry after a minute
                  </button>
                ) : (
                  <button className="chip-button" onClick={() => fetchRepos(query, 1)} type="button">
                    Retry
                  </button>
                )}
              </div>
              {(errorCode === 'UNAUTHORIZED' || errorCode === 'GITHUB_TOKEN_EXPIRED') && (
                <p style={{ marginTop: '8px', fontSize: '0.75rem', opacity: 0.8 }}>
                  Your session was cleared because the token expired. Public repositories remain available without signing in.
                </p>
              )}
            </div>
          ) : repos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-dim)' }}>
              No repositories found matching &ldquo;{query}&rdquo;.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {repos.map((repo) => (
                <div
                  key={repo.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-soft)',
                    gap: '12px',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '0.85rem' }}>{repo.isPrivate ? '🔒' : '🌐'}</span>
                      <strong style={{ fontSize: '0.9rem', color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {repo.fullName}
                      </strong>
                      {repo.isPrivate && (
                        <span
                          style={{
                            fontSize: '0.7rem',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            background: 'rgba(255, 180, 50, 0.15)',
                            color: '#fbbf24',
                            fontWeight: 600,
                          }}
                        >
                          Private
                        </span>
                      )}
                    </div>
                    {repo.description && (
                      <p
                        style={{
                          fontSize: '0.78rem',
                          color: 'var(--text-dim)',
                          marginTop: '2px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {repo.description}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: '10px', marginTop: '4px', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                      {repo.language && <span>● {repo.language}</span>}
                      <span>Branch: {repo.defaultBranch}</span>
                    </div>
                  </div>

                  <button
                    className="primary-button"
                    style={{ fontSize: '0.8rem', padding: '6px 14px', whiteSpace: 'nowrap' }}
                    onClick={() => {
                      onSelectRepo(`https://github.com/${repo.fullName}`);
                      onClose();
                    }}
                  >
                    Analyze Map <span>→</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: '12px',
            borderTop: '1px solid var(--border-soft)',
            marginTop: '8px',
          }}
        >
          <button
            className="chip-button"
            disabled={page <= 1 || loading}
            onClick={() => fetchRepos(query, page - 1)}
          >
            ← Previous
          </button>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Page {page}</span>
          <button
            className="chip-button"
            disabled={!hasMore || loading}
            onClick={() => fetchRepos(query, page + 1)}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
