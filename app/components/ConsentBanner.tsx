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
      className="consent-banner"
    >
      <div className="consent-banner-copy">
        🛡️ <strong>Privacy-First Analytics:</strong> RepoDNA uses privacy-safe, anonymized analytics (EU-hosted) to validate beta demand. We <strong>never</strong> collect repository code, file paths, or symbol names.
      </div>
      <div className="consent-banner-actions">
        <button
          className="chip-button consent-banner-decline"
          onClick={handleDecline}
        >
          Decline
        </button>
        <button
          className="primary-button consent-banner-accept"
          onClick={handleAccept}
        >
          Accept
        </button>
      </div>
    </aside>
  );
}
