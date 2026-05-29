import React, { useState, useEffect } from 'react';

export default function McpSettings() {
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    fetch('/api/user/settings/mcp-token', { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setToken(data.token))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerate = async () => {
    if (!confirm('Rotate your MCP key? Your current URL will stop working immediately.')) return;
    setRegenerating(true);
    try {
      const res = await fetch('/api/user/settings/mcp-token/regenerate', {
        method: 'POST', credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setToken(data.token);
        setRevealed(false);
      }
    } finally {
      setRegenerating(false);
    }
  };

  const mcpUrl = token ? `${window.location.origin}/mcp/${token}` : '';
  const maskedUrl = token
    ? `${window.location.origin}/mcp/${'•'.repeat(8)}${token.slice(-5)}`
    : '';

  if (loading) return <div className="settings-section"><p className="field-hint">Loading…</p></div>;

  return (
    <div className="settings-section">
      <h3>MCP</h3>
      <p className="settings-description">
        Connect AI assistants to Roots of The Valley using the{' '}
        <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">Model Context Protocol</a>.
      </p>

      {token ? (
        <>
          <div className="settings-field">
            <label>Connection URL</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                value={revealed ? mcpUrl : maskedUrl}
                readOnly
                style={{ backgroundColor: '#f5f5f5', fontFamily: 'monospace', fontSize: '0.8rem', flex: 1 }}
              />
              <button className="save-settings-btn" style={{ whiteSpace: 'nowrap' }}
                onClick={() => setRevealed(r => !r)}>
                {revealed ? 'Hide' : 'Reveal'}
              </button>
              <button className="save-settings-btn" style={{ whiteSpace: 'nowrap' }}
                onClick={handleCopy}>
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p className="field-hint">
              This URL is unique to your account. Actions taken via MCP are attributed to you.
            </p>
          </div>

          <div className="settings-actions">
            <button className="save-settings-btn" onClick={handleRegenerate} disabled={regenerating}>
              {regenerating ? 'Rotating…' : 'Rotate Key'}
            </button>
          </div>

        </>
      ) : (
        <p className="settings-description">Unable to load your MCP token. Please try again.</p>
      )}
    </div>
  );
}
