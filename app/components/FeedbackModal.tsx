'use client';

import React, { useRef, useState } from 'react';
import { trackFeedbackSubmitted } from '../lib/analytics';
import { useModalFocus } from './useModalFocus';

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
  const [submitting, setSubmitting] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const submissionRef = useRef<{ body: string; id: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const dialogRef = useModalFocus<HTMLDivElement>(isOpen, onClose);

  if (!isOpen) return null;

  function toggleCap(id: string) {
    setSelectedCaps((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setDeliveryError(null);

    try {
      const body = JSON.stringify({ usefulnessScore: rating, primaryUsecase: useCase, missingCapabilities: selectedCaps });
      if (submissionRef.current?.body !== body) submissionRef.current = { body, id: crypto.randomUUID() };
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(body), submissionId: submissionRef.current.id }),
      });
      if (!response.ok) throw new Error(response.status === 429 ? 'busy' : 'delivery');
      const acknowledgement = await response.json();
      if (!acknowledgement || typeof acknowledgement !== 'object' || !('success' in acknowledgement) || acknowledgement.success !== true) throw new Error('delivery');

      trackFeedbackSubmitted({
        usefulnessScore: rating,
        primaryUsecase: useCase,
        missingCapabilities: selectedCaps,
        hasTextFeedback: false,
      });

      setSubmitted(true);
    } catch (error) {
      setDeliveryError(error instanceof Error && error.message === 'busy'
        ? 'Feedback is busy. Your selections are preserved; retry in a minute.'
        : 'Your feedback was not confirmed. Your selections are preserved; check your connection and retry.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog-card"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        tabIndex={-1}
        style={{ maxWidth: '580px', width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 id="feedback-title" style={{ fontSize: '1.25rem', fontWeight: 600 }}>
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
                    disabled={submitting}
                    aria-pressed={rating === score}
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
              <span style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: '8px' }}>
                What is your primary use case today?
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '6px' }}>
                {USE_CASES.map((uc) => (
                  <label
                    key={uc.id}
                    htmlFor={`usecase-${uc.id}`}
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
                      id={`usecase-${uc.id}`}
                      type="radio"
                      name="useCase"
                      value={uc.id}
                      checked={useCase === uc.id}
                      disabled={submitting}
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
                      disabled={submitting}
                      aria-pressed={isSelected}
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

            <p className="privacy-note">
              Only these fixed survey choices are collected as anonymous daily counts in Redis for up to 30 days.
              No free text, repository details, credentials, or account identifiers are collected by this survey.
              A random delivery receipt is kept for 24 hours to prevent duplicate retries.
            </p>

            {/* Actions */}
            {deliveryError && <p role="alert">{deliveryError}</p>}
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
