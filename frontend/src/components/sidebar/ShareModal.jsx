import { useState } from 'react';

function ShareModal({ isOpen, onClose, poiName, poiDescription }) {
  const [copied, setCopied] = useState(false);

  const shareUrl = window.location.href;

  const shareText = poiDescription
    ? `${poiName} - ${poiDescription.substring(0, 100)}${poiDescription.length > 100 ? '...' : ''}`
    : `Check out ${poiName} at Roots of The Valley!`;

  const handleCopyLink = async () => {
    const appUrl = window.location.href;
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = appUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareLinks = {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(shareText)}`,
    threads: `https://www.threads.net/intent/post?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
    twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
    mastodon: `https://mastodon.social/share?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`,
    email: `mailto:?subject=${encodeURIComponent(poiName + ' | Roots of The Valley')}&body=${encodeURIComponent(shareText + '\n\n' + window.location.href)}`,
  };

  if (!isOpen) return null;

  return (
    <div className="share-modal-overlay" onClick={onClose}>
      <div className="share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="share-modal-header">
          <h3>Share &quot;{poiName}&quot;</h3>
          <button className="share-modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="share-modal-content">
          <div className="share-platforms">
            <a
              href={shareLinks.facebook}
              target="_blank"
              rel="noopener noreferrer"
              className="share-platform-btn facebook"
              title="Share on Facebook"
            >
              <svg viewBox="0 0 24 24" width="24" height="24">
                <path fill="currentColor" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
              <span>Facebook</span>
            </a>

            <a
              href={shareLinks.threads}
              target="_blank"
              rel="noopener noreferrer"
              className="share-platform-btn threads"
              title="Share on Threads"
            >
              <svg viewBox="0 0 24 24" width="24" height="24">
                <path fill="currentColor" d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.96-.065-1.182.408-2.256 1.332-3.023.88-.73 2.082-1.147 3.476-1.207.856-.036 1.672.015 2.446.137V8.928c0-.63-.152-1.083-.45-1.344-.326-.285-.822-.43-1.474-.43-.614 0-1.085.14-1.402.414-.282.245-.452.625-.511 1.14l-2.082-.203c.101-.977.475-1.824 1.113-2.517.786-.853 1.916-1.305 3.362-1.345h.106c1.414.025 2.476.416 3.16 1.164.653.716.984 1.71.984 2.955v4.27c.014.577.095 1.01.244 1.306.158.312.41.515.77.62l-.792 1.973c-.78-.174-1.403-.545-1.857-1.107-.348-.431-.589-.975-.723-1.63-.549.396-1.168.71-1.855.939-.906.302-1.9.46-2.958.472zm.306-6.99c-.937.04-1.665.272-2.166.69-.464.387-.68.864-.645 1.422.033.517.268.943.7 1.267.478.36 1.133.54 1.947.54h.077c1.077-.054 1.918-.462 2.498-1.217.47-.61.753-1.401.843-2.36-.715-.16-1.478-.27-2.28-.312-.33-.017-.655-.03-.974-.03z"/>
              </svg>
              <span>Threads</span>
            </a>

            <a
              href={shareLinks.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="share-platform-btn linkedin"
              title="Share on LinkedIn"
            >
              <svg viewBox="0 0 24 24" width="24" height="24">
                <path fill="currentColor" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
              <span>LinkedIn</span>
            </a>

            <a
              href={shareLinks.twitter}
              target="_blank"
              rel="noopener noreferrer"
              className="share-platform-btn twitter"
              title="Share on X"
            >
              <svg viewBox="0 0 24 24" width="24" height="24">
                <path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
              <span>X</span>
            </a>

            <a
              href={shareLinks.mastodon}
              target="_blank"
              rel="noopener noreferrer"
              className="share-platform-btn mastodon"
              title="Share on Mastodon"
            >
              <svg viewBox="0 0 24 24" width="24" height="24">
                <path fill="currentColor" d="M23.268 5.313c-.35-2.578-2.617-4.61-5.304-5.004C17.51.242 15.792 0 11.813 0h-.03c-3.98 0-4.835.242-5.288.309C3.882.692 1.496 2.518.917 5.127.64 6.412.61 7.837.661 9.143c.074 1.874.088 3.745.26 5.611.118 1.24.325 2.47.62 3.68.55 2.237 2.777 4.098 4.96 4.857 2.336.792 4.849.923 7.256.38.265-.061.527-.132.786-.213.585-.184 1.27-.39 1.774-.753a.057.057 0 0 0 .023-.043v-1.809a.052.052 0 0 0-.02-.041.053.053 0 0 0-.046-.01 20.282 20.282 0 0 1-4.709.545c-2.73 0-3.463-1.284-3.674-1.818a5.593 5.593 0 0 1-.319-1.433.053.053 0 0 1 .066-.054c1.517.363 3.072.546 4.632.546.376 0 .75 0 1.125-.01 1.57-.044 3.224-.124 4.768-.422.038-.008.077-.015.11-.024 2.435-.464 4.753-1.92 4.989-5.604.008-.145.03-1.52.03-1.67.002-.512.167-3.63-.024-5.545zm-3.748 9.195h-2.561V8.29c0-1.309-.55-1.976-1.67-1.976-1.23 0-1.846.79-1.846 2.35v3.403h-2.546V8.663c0-1.56-.617-2.35-1.848-2.35-1.112 0-1.668.668-1.668 1.977v6.218H4.822V8.102c0-1.31.337-2.35 1.011-3.12.696-.77 1.608-1.164 2.74-1.164 1.311 0 2.302.5 2.962 1.498l.638 1.06.638-1.06c.66-.999 1.65-1.498 2.96-1.498 1.13 0 2.043.395 2.74 1.164.675.77 1.012 1.81 1.012 3.12z"/>
              </svg>
              <span>Mastodon</span>
            </a>

            <a
              href={shareLinks.email}
              className="share-platform-btn email"
              title="Share via Email"
            >
              <svg viewBox="0 0 24 24" width="24" height="24">
                <path fill="currentColor" d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
              </svg>
              <span>Email</span>
            </a>
          </div>

          <div className="share-link-section">
            <label>Or copy link:</label>
            <div className="share-link-input-group">
              <input
                type="text"
                value={shareUrl}
                readOnly
                className="share-link-input"
              />
              <button
                className={`share-copy-btn ${copied ? 'copied' : ''}`}
                onClick={handleCopyLink}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ShareModal;
