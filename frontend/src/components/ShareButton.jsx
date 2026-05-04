import React, { useState } from 'react';

export default function ShareButton({ title, text, url, compact = false }) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const shareUrl = url.startsWith('http') ? url : `${window.location.origin}${url}`;

    if (navigator.share) {
      try {
        await navigator.share({ title, text, url: shareUrl });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }

    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Last resort: select-and-copy via textarea
      const ta = document.createElement('textarea');
      ta.value = shareUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );

  if (compact) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); handleShare(); }}
        title={copied ? 'Link copied!' : 'Share'}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
          color: copied ? '#2e7d32' : '#666', display: 'inline-flex', alignItems: 'center'
        }}
      >
        {copied ? '\u2713' : shareIcon}
      </button>
    );
  }

  return (
    <button
      onClick={handleShare}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '8px 16px', border: '1px solid #ccc', borderRadius: '6px',
        background: copied ? '#e8f5e9' : '#fff', cursor: 'pointer',
        color: copied ? '#2e7d32' : '#333', fontSize: '14px'
      }}
    >
      {copied ? '\u2713 Link copied!' : <>{shareIcon} Share</>}
    </button>
  );
}
