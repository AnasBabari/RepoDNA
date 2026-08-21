'use client';

import React, { useState } from 'react';
import { trackFeedbackSubmitted } from '../lib/analytics';

const USE_CASES = [
  { id: 'onboarding', label: 'Onboarding to new codebase' },
  { id: 'architecture', label: 'Architectural & system design review' },
  { id: 'refactoring', label: 'Refactoring & change impact analysis' },
  { id: 'documentation', label: 'Codebase documentation & mapping' },
  { id: 'security', label: 'Security & dependency audits' },
  { id: 'other', label: 'Other' },
];

const CAPABILITIES = [
  { id: 'more_languages', label: 'More languages (Go, Rust, Java, C++)' },
  { id: 'pr_analysis', label: 'Pull Request & Git Diff impact analysis' },
  { id: 'diagram_export', label: 'Export diagrams to SVG / PNG' },
  { id: 'db_erd', label: 'Database ERD / Schema Visualizer' },
  { id: 'call_hierarchy', label: 'Deep interactive call hierarchy expander' },
  { id: 'custom_rules', label: 'Custom architectural lint rules' },
];

export function FeedbackModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [rating, setRating] = useState<number>(5);
  const [useCase, setUseCase] = useState<string>('onboarding');
  const [selectedCaps, setSelectedCaps] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (!isOpen) return null;

  function toggleCap(id: string) {
    setSelectedCaps((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usefulnessScore: rating,
          primaryUsecase: useCase,
          missingCapabilities: selectedCaps,
          comments: comment.trim().slice(0, 500),
        }),
      });

      trackFeedbackSubmitted({
        usefulnessScore: rating,
        primaryUsecase: useCase,
        missingCapabilities: selectedCaps,
        hasTextFeedback: comment.trim().length > 0,
      });

      setSubmitted(true);
    } catch {
      // Still show thank you
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog-card"
        style={{ maxWidth: '580px', width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>
            {submitted ? 'Thank You!' : 'RepoDNA Feedback & Beta Survey'}
          </h2>
          <button className="icon-button" onClick={onClose} aria-label="Close survey">
            ✕
          </button>
        </div>

        {submitted ? (
          <div style={{ padding: '24px 0', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>✨</div>
            <p style={{ color: 'var(--text-bright)', fontWeight: 500, marginBottom: '8px' }}>
              Your feedback directly shapes RepoDNA.
            </p>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: '24px' }}>
              Thank you for helping validate the private repository beta.
            </p>
            <button className="primary-button" onClick={onClose} style={{ margin: '0 auto' }}>
              Back to Workspace
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* 1. Rating */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: '8px' }}>
                How useful was this structural analysis? (1 = Low, 5 = High)
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[1, 2, 3, 4, 5].map((score) => (
                  <button
                    key={score}
                    type="button"
                    onClick={() => setRating(score)}
                    style={{
                      flex: 1,
                      padding: '8px 0',
                      borderRadius: '6px',
                      border: '1px solid var(--border-soft)',
                      background: rating === score ? 'var(--cyan-glow)' : 'var(--bg-card)',
                      color: rating === score ? 'var(--cyan-core)' : 'var(--text-bright)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    ★ {score}
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Primary Use Case */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: '8px' }}>
                What is your primary use case today?
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '6px' }}>
                {USE_CASES.map((uc) => (
                  <label
                    key={uc.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      background: useCase === uc.id ? 'rgba(0, 240, 255, 0.08)' : 'transparent',
                      border: `1px solid ${useCase === uc.id ? 'var(--cyan-border)' : 'transparent'}`,
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      color: useCase === uc.id ? 'var(--cyan-core)' : 'var(--text-dim)',
                    }}
                  >
                    <input
                      type="radio"
                      name="useCase"
                      value={uc.id}
                      checked={useCase === uc.id}
                      onChange={() => setUseCase(uc.id)}
                      style={{ accentColor: 'var(--cyan-core)' }}
                    />
                    {uc.label}
                  </label>
                ))}
              </div>
            </div>

            {/* 3. Missing Capabilities */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: '8px' }}>
                Which capabilities would you most like to see next?
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {CAPABILITIES.map((cap) => {
                  const isSelected = selectedCaps.includes(cap.id);
                  return (
                    <button
                      key={cap.id}
                      type="button"
                      onClick={() => toggleCap(cap.id)}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        border: `1px solid ${isSelected ? 'var(--cyan-border)' : 'var(--border-soft)'}`,
                        background: isSelected ? 'rgba(0, 240, 255, 0.12)' : 'var(--bg-surface)',
                        color: isSelected ? 'var(--cyan-core)' : 'var(--text-dim)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {isSelected ? '✓ ' : '+ '}
                      {cap.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4. Text Comments with Privacy Warning */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                  Optional feedback or feature request (max 500 chars)
                </label>
                <span style={{ fontSize: '0.75rem', color: comment.length > 480 ? '#f87171' : 'var(--text-dim)' }}>
                  {comment.length}/500
                </span>
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="What worked well? What felt confusing?"
                className="filter-input"
                style={{ width: '100%', resize: 'none', fontFamily: 'inherit', fontSize: '0.85rem' }}
              />
              <p
                style={{
                  fontSize: '0.75rem',
                  color: 'rgba(255, 180, 50, 0.9)',
                  marginTop: '6px',
                  lineHeight: 1.3,
                }}
              >
                🔒 <strong>Privacy Caution:</strong> Please do not include code snippets, passwords, or confidential company secrets.
              </p>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
              <button className="chip-button" type="button" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button className="primary-button" type="submit" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit Feedback'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
