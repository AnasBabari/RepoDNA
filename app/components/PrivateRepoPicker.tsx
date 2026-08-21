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
  const [revoking, setRevoking] = useState(false);

  const fetchRepos = useCallback(async (searchQuery: string, pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(pageNum),
        query: searchQuery,
      });
      const res = await fetch(`/api/github/repositories?${params.toString()}`);
      const data = (await res.json()) as {
        success?: boolean;
        error?: { message?: string };
        repositories?: SafeRepositoryItem[];
        hasMore?: boolean;
        page?: number;
      };

      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || 'Failed to fetch repositories');
      }

      setRepos(data.repositories || []);
      setHasMore(Boolean(data.hasMore));
      setPage(data.page || pageNum);
    } catch (err) {
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

  async function handleRevoke() {
    if (!window.confirm('Disconnect GitHub OAuth and revoke RepoDNA access permissions?')) {
      return;
    }
    setRevoking(true);
    try {
      await fetch('/api/auth/revoke', { method: 'POST' });
      trackAuthFlow('scope_revoked');
      onSignOut();
      onClose();
    } catch {
      onSignOut();
      onClose();
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
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
          <button className="icon-button" onClick={onClose} aria-label="Close repository picker">
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
              🔒 <strong>Scope Transparency:</strong> GitHub OAuth requires the <code>repo</code> scope for private repositories.
              RepoDNA performs read-only GET requests, parses ASTs transiently in memory, and never modifies or stores code.{' '}
              <a
                href="https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--cyan-core)', textDecoration: 'underline' }}
              >
                Learn about GitHub scopes ↗
              </a>
            </span>
            <button
              type="button"
              onClick={handleRevoke}
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
              {revoking ? 'Disconnecting...' : 'Disconnect App'}
            </button>
          </div>
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
              {error}
              <div style={{ marginTop: '8px' }}>
                <button className="chip-button" onClick={() => fetchRepos(query, 1)}>
                  Retry
                </button>
              </div>
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
