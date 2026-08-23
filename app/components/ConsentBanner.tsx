'use client';

import React, { useState, useSyncExternalStore } from 'react';
import { getConsentStatus, setConsentStatus } from '../lib/analytics';

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

function getSnapshot(): boolean {
  return getConsentStatus() === 'pending';
}

function getServerSnapshot(): boolean {
  return false;
}

export function ConsentBanner() {
  const isPending = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [dismissed, setDismissed] = useState(false);

  if (!isPending || dismissed) return null;

  function handleAccept() {
    setConsentStatus('granted');
    setDismissed(true);
  }

  function handleDecline() {
    setConsentStatus('denied');
    setDismissed(true);
  }

  return (
    <aside
      aria-label="Privacy and analytics consent"
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        maxWidth: '420px',
        width: 'calc(100% - 32px)',
        zIndex: 9999,
        background: 'rgba(13, 17, 23, 0.95)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(0, 240, 255, 0.3)',
        borderRadius: '10px',
        padding: '14px 16px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      <div style={{ fontSize: '0.82rem', color: 'var(--text-bright)', lineHeight: 1.4 }}>
        🛡️ <strong>Privacy-First Analytics:</strong> RepoDNA uses privacy-safe, anonymized analytics (EU-hosted) to validate beta demand. We <strong>never</strong> collect repository code, file paths, or symbol names.
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
        <button
          className="chip-button"
          onClick={handleDecline}
          style={{ fontSize: '0.78rem', padding: '4px 10px' }}
        >
          Decline
        </button>
        <button
          className="primary-button"
          onClick={handleAccept}
          style={{ fontSize: '0.78rem', padding: '4px 14px' }}
        >
          Accept
        </button>
      </div>
    </aside>
  );
}
