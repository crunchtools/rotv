import React, { useState, useEffect, useMemo } from 'react';
import ImageUploader from './ImageUploader';
import NewsEvents from './NewsEvents';
import CollectionStatus from './CollectionStatus';
import ThumbnailCarousel from './ThumbnailCarousel';
import { formatDateTime } from './NewsEventsShared';

// Sidebar component with tabs: Info, News, Events, History
// Share Modal Component
function ShareModal({ isOpen, onClose, poiName, poiDescription }) {
  const [copied, setCopied] = useState(false);

  // Use the current URL directly - server injects OG tags for ?poi= URLs
  const shareUrl = window.location.href;

  const shareText = poiDescription
    ? `${poiName} - ${poiDescription.substring(0, 100)}${poiDescription.length > 100 ? '...' : ''}`
    : `Check out ${poiName} at Roots of The Valley!`;

  const handleCopyLink = async () => {
    // Copy the regular app URL (not the share endpoint)
    const appUrl = window.location.href;
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback for older browsers
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
          <h3>Share "{poiName}"</h3>
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

function getOwnerClass(owner) {
  if (!owner) return 'owner-other';
  const ownerLower = owner.toLowerCase();
  if (ownerLower.includes('federal') || ownerLower.includes('nps')) return 'owner-federal';
  if (ownerLower.includes('private')) return 'owner-private';
  if (ownerLower.includes('local') || ownerLower.includes('metro') || ownerLower.includes('county')) return 'owner-local';
  return 'owner-other';
}

function formatCoordinate(value, type) {
  if (value === null || value === undefined) return '';
  const num = parseFloat(value);
  if (isNaN(num)) return '';
  const absVal = Math.abs(num).toFixed(4);
  if (type === 'lat') {
    return `${absVal}° ${num >= 0 ? 'N' : 'S'}`;
  } else {
    return `${absVal}° ${num >= 0 ? 'E' : 'W'}`;
  }
}

function CellSignal({ level }) {
  const bars = [1, 2, 3, 4, 5];
  return (
    <div className="cell-signal">
      {bars.map(bar => (
        <div
          key={bar}
          className={`signal-bar ${bar <= level ? 'active' : ''}`}
          style={{ height: `${8 + bar * 3}px` }}
        />
      ))}
    </div>
  );
}

function EditableCellSignal({ level, onChange }) {
  return (
    <select value={level || ''} onChange={(e) => onChange(e.target.value ? parseInt(e.target.value) : null)}>
      <option value="">Unknown</option>
      <option value="1">1 - Very Poor</option>
      <option value="2">2 - Poor</option>
      <option value="3">3 - Fair</option>
      <option value="4">4 - Good</option>
      <option value="5">5 - Excellent</option>
    </select>
  );
}

// Read-only view component - works for both destinations and linear features
function ReadOnlyView({ destination, isLinearFeature, isAdmin, showImage = true, onShare, moreInfoLink, trailStatus = null, showNpsMap, onToggleNpsMap }) {
  // Use thumbnail service for faster loading
  // Include updated_at for cache busting when image changes
  const imageUrl = destination.image_mime_type
    ? `/api/pois/${destination.id}/thumbnail?size=medium&v=${destination.updated_at || Date.now()}`
    : null;

  // Get default thumbnail SVG path based on type
  const getDefaultThumbnail = () => {
    if (isLinearFeature) {
      if (destination.feature_type === 'river') return '/icons/thumbnails/river.svg';
      if (destination.feature_type === 'boundary') return '/icons/thumbnails/boundary.svg';
      return '/icons/thumbnails/trail.svg';
    }
    if (destination.poi_type === 'virtual') return '/icons/thumbnails/virtual.svg';
    // MTB trailheads are point POIs with status_url
    if (destination.poi_type === 'point' && destination.status_url) return '/icons/thumbnails/trail.svg';
    return '/icons/thumbnails/destination.svg';
  };

  // Debug logging for virtual POI detection
  if (destination.poi_type === 'virtual') {
    console.log('[Sidebar View] Virtual POI detected:', destination.name, 'poi_type:', destination.poi_type);
  }

  return (
    <div className="view-container">
      <div className="view-scroll">
        {/* Image section - URL computed from ID (can be hidden if shown elsewhere) */}
        {showImage && (
          <div className={`sidebar-image ${destination.poi_type === 'virtual' ? 'virtual-thumbnail' : ''}`}>
            {imageUrl ? (
              <img src={imageUrl} alt={destination.name} className={destination.poi_type === 'virtual' ? 'logo-image' : ''} />
            ) : (
              <img src={getDefaultThumbnail()} alt={destination.name} className="default-thumbnail" />
            )}
          </div>
        )}

        <div className="sidebar-content">
        <div className="badges-row">
          {/* POI type badge - shows for all POI types */}
          {isLinearFeature ? (
            <span className={`poi-type-badge ${destination.feature_type}`}>
              {destination.feature_type === 'river' ? 'River' :
               destination.feature_type === 'boundary' ? 'Boundary' : 'Trail'}
            </span>
          ) : destination.poi_type === 'virtual' ? (
            <span className="poi-type-badge virtual">
              Organization
            </span>
          ) : destination.poi_type === 'point' && destination.status_url ? (
            <span className="poi-type-badge mtb">
              MTB Trailhead
            </span>
          ) : (
            <span className="poi-type-badge destination">
              Destination
            </span>
          )}
          {/* Difficulty badge for trails */}
          {isLinearFeature && destination.difficulty && (
            <span className={`difficulty-badge ${destination.difficulty.toLowerCase()}`}>
              {destination.difficulty}
            </span>
          )}
          {destination.era_name && destination.poi_type !== 'virtual' && (
            <span className="era-badge-large">{destination.era_name}</span>
          )}
          {(destination.owner_name || destination.property_owner) && destination.poi_type !== 'virtual' && (
            <span className={`owner-badge ${getOwnerClass(destination.owner_name || destination.property_owner)}`}>
              {destination.owner_name || destination.property_owner}
            </span>
          )}
          {destination.status_url && trailStatus && (
            <span className={`trail-status-badge status-${trailStatus.status || 'unknown'}`}>
              {trailStatus.status === 'open' ? 'Open' :
               trailStatus.status === 'closed' ? 'Closed' :
               trailStatus.status === 'limited' ? 'Limited' :
               trailStatus.status === 'maintenance' ? 'Maintenance' : 'Unknown'}
            </span>
          )}
          {/* Share button */}
          {onShare && (
            <button className="share-badge-btn" onClick={onShare} title="Share this location">
              <svg viewBox="0 0 24 24" width="14" height="14">
                <path fill="currentColor" d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
              </svg>
              Share
            </button>
          )}
          {/* NPS Map toggle button */}
          {onToggleNpsMap && (
            <button
              className={`nps-map-toggle-btn ${showNpsMap ? 'active' : ''}`}
              onClick={() => onToggleNpsMap(!showNpsMap)}
              title={showNpsMap ? 'Hide NPS Park Map' : 'Show NPS Park Map'}
            >
              <svg viewBox="0 0 24 24" width="14" height="14">
                <path fill="currentColor" d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/>
              </svg>
              NPS Map
            </button>
          )}
        </div>

        {destination.brief_description && (
          <div className="section">
            <h3>Overview</h3>
            <p>{destination.brief_description}</p>
          </div>
        )}

        <div className="section">
          <h3>Visitor Information</h3>
          <div className="details-grid">
            {/* Trail-specific: length */}
            {isLinearFeature && destination.length_miles && (
              <div className="detail-item">
                <label>Length</label>
                <span>{destination.length_miles} miles</span>
              </div>
            )}
            {destination.primary_activities && (
              <div className="detail-item">
                <label>Activities</label>
                <span>{destination.primary_activities}</span>
              </div>
            )}
            {destination.surface && (
              <div className="detail-item">
                <label>Surface</label>
                <span>{destination.surface}</span>
              </div>
            )}
            {destination.pets && (
              <div className="detail-item">
                <label>Pets Allowed</label>
                <span>{destination.pets}</span>
              </div>
            )}
            {destination.cell_signal !== null && destination.cell_signal !== undefined && (
              <div className="detail-item">
                <label>Cell Signal</label>
                <CellSignal level={destination.cell_signal} />
              </div>
            )}
          </div>
        </div>

        {/* Location - only for point destinations, not linear features */}
        {!isLinearFeature && destination.latitude && destination.longitude && (
          <div className="section">
            <h3>Location</h3>
            <p>{formatCoordinate(destination.latitude, 'lat')}, {formatCoordinate(destination.longitude, 'lng')}</p>
          </div>
        )}
        </div>

        {/* More Information link - at bottom of scrollable content */}
        {moreInfoLink && (
          <div className="more-info-section">
            <a
              href={moreInfoLink}
              target="_blank"
              rel="noopener noreferrer"
              className="more-info-link"
            >
              More Information
              <svg viewBox="0 0 24 24" width="16" height="16" style={{ marginLeft: '8px' }}>
                <path fill="currentColor" d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z" />
              </svg>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// Edit view component - works for both destinations and linear features
function EditView({ destination, editedData, setEditedData, onSave, onCancel, onDelete, saving, deleting, onPreviewCoordsChange, isNewPOI, isNewOrganization, onImageUpdate, isLinearFeature, showImage = true }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [researchSources, setResearchSources] = useState(null);

  // Prompt editor modal state
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [promptType, setPromptType] = useState(null); // 'brief' or 'historical'
  const [editablePrompt, setEditablePrompt] = useState('');
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Research state
  const [researching, setResearching] = useState(false);

  // Pending image state (staging area for image uploads until save)
  const [pendingImage, setPendingImage] = useState(null);

  // Handle save with pending image processing
  const handleSaveWithImage = async () => {
    if (!destination?.id) {
      // For new POIs, just call parent save (image will be handled separately)
      await onSave();
      return;
    }

    try {
      const apiEndpoint = isLinearFeature ? 'linear-features' : 'destinations';

      // Handle pending image if exists
      if (pendingImage) {
        if (pendingImage.deleted) {
          // Delete the image
          await fetch(`/api/admin/${apiEndpoint}/${destination.id}/image`, {
            method: 'DELETE',
            credentials: 'include'
          });
        } else if (pendingImage.data) {
          // Upload new image - always use base64 endpoint for simplicity
          const endpoint = `/api/admin/${apiEndpoint}/${destination.id}/image-base64`;
          await fetch(endpoint, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageData: pendingImage.data,
              mimeType: pendingImage.mimeType
            })
          });
        }
        // Clear pending image after processing
        setPendingImage(null);
      }

      // Now call parent save for other fields
      await onSave();
    } catch (err) {
      alert(`Error processing image: ${err.message}`);
      throw err;
    }
  };

  // Handle cancel - clear pending image
  const handleCancelWithCleanup = () => {
    setPendingImage(null);
    onCancel();
  };

  // Standardized activities list
  const [availableActivities, setAvailableActivities] = useState([]);
  const [showActivityDropdown, setShowActivityDropdown] = useState(false);

  // Standardized eras list
  const [availableEras, setAvailableEras] = useState([]);

  // Standardized surfaces list
  const [availableSurfaces, setAvailableSurfaces] = useState([]);

  // Owner organizations list
  const [availableOwnerOrgs, setAvailableOwnerOrgs] = useState([]);

  // Fetch activities, eras, surfaces, and owner organizations on mount
  useEffect(() => {
    async function fetchActivities() {
      try {
        const response = await fetch('/api/admin/activities', {
          credentials: 'include'
        });
        if (response.ok) {
          const data = await response.json();
          setAvailableActivities(data);
        }
      } catch (err) {
        console.error('Failed to fetch activities:', err);
      }
    }

    async function fetchEras() {
      try {
        const response = await fetch('/api/admin/eras', {
          credentials: 'include'
        });
        if (response.ok) {
          const data = await response.json();
          setAvailableEras(data);
        }
      } catch (err) {
        console.error('Failed to fetch eras:', err);
      }
    }

    async function fetchSurfaces() {
      try {
        const response = await fetch('/api/admin/surfaces', {
          credentials: 'include'
        });
        if (response.ok) {
          const data = await response.json();
          setAvailableSurfaces(data);
        }
      } catch (err) {
        console.error('Failed to fetch surfaces:', err);
      }
    }

    async function fetchOwnerOrgs() {
      try {
        const response = await fetch('/api/owner-organizations', {
          credentials: 'include'
        });
        if (response.ok) {
          const data = await response.json();
          setAvailableOwnerOrgs(data);
        }
      } catch (err) {
        console.error('Failed to fetch owner organizations:', err);
      }
    }

    fetchActivities();
    fetchEras();
    fetchSurfaces();
    fetchOwnerOrgs();
  }, []);

  // Parse current activities from comma-separated string
  const selectedActivities = (editedData.primary_activities || '')
    .split(',')
    .map(a => a.trim())
    .filter(a => a);

  // Toggle activity selection
  const toggleActivity = (activityName) => {
    const current = new Set(selectedActivities);
    if (current.has(activityName)) {
      current.delete(activityName);
    } else {
      current.add(activityName);
    }
    setEditedData(prev => ({
      ...prev,
      primary_activities: Array.from(current).join(', ')
    }));
  };

  // Research with AI - fills all fields
  const handleResearch = async () => {
    setResearching(true);
    setAiError(null);
    setResearchSources(null);

    try {
      const response = await fetch('/api/admin/ai/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ destination: editedData })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Research failed');
      }

      const data = await response.json();

      // Update all fields that have data
      setEditedData(prev => ({
        ...prev,
        property_owner: data.property_owner || prev.property_owner,
        primary_activities: data.primary_activities || prev.primary_activities,
        surface: data.surface || prev.surface,
        pets: data.pets || prev.pets,
        brief_description: data.brief_description || prev.brief_description,
        historical_description: data.historical_description || prev.historical_description
      }));

      // Store sources for display
      if (data.sources && data.sources.length > 0) {
        setResearchSources(data.sources);
      }
    } catch (err) {
      setAiError(err.message);
    } finally {
      setResearching(false);
    }
  };

  // Open prompt editor and fetch the interpolated template
  const handleOpenPromptEditor = async (type) => {
    setPromptType(type);
    setShowPromptEditor(true);
    setLoadingPrompt(true);
    setAiError(null);

    try {
      const response = await fetch('/api/admin/ai/prompt-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          destination: editedData,
          promptType: type
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to load prompt');
      }

      const result = await response.json();
      setEditablePrompt(result.prompt);
    } catch (err) {
      setAiError(err.message);
      setShowPromptEditor(false);
    } finally {
      setLoadingPrompt(false);
    }
  };

  // Generate with the customized prompt
  const handleGenerate = async () => {
    setGenerating(true);
    setAiError(null);

    try {
      const response = await fetch('/api/admin/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          customPrompt: editablePrompt,
          destination: editedData
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Generation failed');
      }

      const result = await response.json();

      // Update the appropriate field based on prompt type
      if (promptType === 'brief') {
        setEditedData(prev => ({ ...prev, brief_description: result.generated_text }));
      } else {
        setEditedData(prev => ({ ...prev, historical_description: result.generated_text }));
      }

      setShowPromptEditor(false);
    } catch (err) {
      setAiError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleClosePromptEditor = () => {
    setShowPromptEditor(false);
    setEditablePrompt('');
    setPromptType(null);
  };

  const handleChange = (field, value) => {
    setEditedData(prev => ({ ...prev, [field]: value }));
  };

  // Handle coordinate changes - also update preview coords for live map sync
  const handleCoordChange = (field, value) => {
    const numValue = value ? parseFloat(value) : null;
    setEditedData(prev => {
      const updated = { ...prev, [field]: numValue };
      // Update preview coords if both lat and lng are valid
      if (onPreviewCoordsChange) {
        const lat = field === 'latitude' ? numValue : parseFloat(prev.latitude);
        const lng = field === 'longitude' ? numValue : parseFloat(prev.longitude);
        if (!isNaN(lat) && !isNaN(lng) && lat && lng) {
          onPreviewCoordsChange({ lat, lng });
        }
      }
      return updated;
    });
  };

  return (
    <div className="edit-view-container">
      <div className="edit-view-scroll">
      {/* Image section at top - matches view mode layout (can be hidden if shown elsewhere) */}
      {showImage && (
        !isNewPOI && destination?.id ? (
          <ImageUploader
            destinationId={destination.id}
            hasImage={!!editedData.image_mime_type}
            pendingImage={pendingImage}
            onPendingImageChange={setPendingImage}
            updatedAt={editedData.updated_at}
            disabled={saving}
            isVirtualPoi={destination?.poi_type === 'virtual'}
          />
        ) : (
          <div className="sidebar-image">
            {(() => {
              const thumbUrl = isLinearFeature
                ? (destination?.feature_type === 'river' ? '/icons/thumbnails/river.svg'
                  : destination?.feature_type === 'boundary' ? '/icons/thumbnails/boundary.svg'
                  : '/icons/thumbnails/trail.svg')
                : '/icons/thumbnails/destination.svg';
              return <img src={thumbUrl} alt={destination?.name || 'New POI'} className="default-thumbnail" />;
            })()}
          </div>
        )
      )}

      {aiError && (
        <div className="ai-error-banner">
          <span>AI Error: {aiError}</span>
          <button onClick={() => setAiError(null)}>Dismiss</button>
        </div>
      )}

      <div className="edit-section">
        <label>Name *</label>
        <input
          type="text"
          value={editedData.name || ''}
          onChange={(e) => handleChange('name', e.target.value)}
          placeholder="Enter POI name..."
        />
      </div>

      {/* Research with AI button - fills all fields */}
      <div className="research-section">
        <button
          className="research-btn"
          onClick={handleResearch}
          disabled={researching || !editedData.name}
          title={!editedData.name ? 'Enter a name first' : 'Research this location and fill all fields'}
        >
          {researching ? 'Researching...' : 'Research with AI'}
        </button>
        <span className="research-hint">Searches the web to fill all fields below</span>
      </div>

      {researchSources && (
        <div className="research-sources">
          <strong>Sources:</strong>
          <ul>
            {researchSources.map((source, i) => (
              <li key={i}>
                {source.startsWith('http') ? (
                  <a href={source} target="_blank" rel="noopener noreferrer">{source}</a>
                ) : source}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="edit-section">
        <label>Brief Description</label>
        <textarea
          value={editedData.brief_description || ''}
          onChange={(e) => {
            handleChange('brief_description', e.target.value);
            // Auto-expand textarea to fit content
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
          style={{ overflow: 'hidden', resize: 'none' }}
          placeholder="A short overview of this location..."
          onInput={(e) => {
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
        />
      </div>

      {/* Hide these fields for organizations/virtual POIs */}
      {!isNewOrganization && destination?.poi_type !== 'virtual' && (
        <>
          <div className="edit-row">
            <div className="edit-section half">
              <label>Era</label>
              <select
                value={editedData.era_id || ''}
                onChange={(e) => {
                  const eraId = e.target.value ? parseInt(e.target.value) : null;
                  handleChange('era_id', eraId);
                }}
                className="era-select"
              >
                <option value="">Select an era...</option>
                {availableEras.map(era => (
                  <option key={era.id} value={era.id}>
                    {era.name}
                    {era.year_start || era.year_end
                      ? ` (${era.year_start || ''}${era.year_start && era.year_end ? '-' : ''}${era.year_end || '+'})`
                      : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="edit-section half">
              <label>Property Owner</label>
              <select
                value={editedData.owner_id || ''}
                onChange={(e) => {
                  const ownerId = e.target.value ? parseInt(e.target.value) : null;
                  const ownerOrg = availableOwnerOrgs.find(o => o.id === ownerId);
                  handleChange('owner_id', ownerId);
                  // Also update property_owner for backward compatibility
                  handleChange('property_owner', ownerOrg ? ownerOrg.name : null);
                }}
              >
                <option value="">-- No Owner --</option>
                {availableOwnerOrgs.map(org => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="edit-section">
            <label>Primary Activities</label>
            <div className="activities-selector">
              <div
                className="activities-toggle"
                onClick={() => setShowActivityDropdown(!showActivityDropdown)}
              >
                <span className="activities-summary">
                  {selectedActivities.length > 0
                    ? selectedActivities.join(', ')
                    : 'Select activities...'}
                </span>
                <span className="activities-arrow">{showActivityDropdown ? '▲' : '▼'}</span>
              </div>
              {showActivityDropdown && (
                <div className="activities-dropdown">
                  {availableActivities.length === 0 ? (
                    <div className="activities-empty">No activities configured. Add them in Settings.</div>
                  ) : (
                    availableActivities.map(activity => (
                      <label key={activity.id} className="activity-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedActivities.includes(activity.name)}
                          onChange={() => toggleActivity(activity.name)}
                        />
                        <span>{activity.name}</span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="edit-row">
            <div className="edit-section half">
              <label>Surface</label>
              <select
                value={editedData.surface || ''}
                onChange={(e) => handleChange('surface', e.target.value)}
              >
                <option value="">Select surface...</option>
                {availableSurfaces.map(surface => (
                  <option key={surface.id} value={surface.name}>
                    {surface.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="edit-section half">
              <label>Pets Allowed</label>
              <select
                value={editedData.pets || ''}
                onChange={(e) => handleChange('pets', e.target.value)}
              >
                <option value="">Unknown</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
                <option value="Leashed">Leashed Only</option>
              </select>
            </div>
          </div>

          <div className="edit-row">
            <div className="edit-section half">
              <label>Cell Signal</label>
              <EditableCellSignal
                level={editedData.cell_signal}
                onChange={(val) => handleChange('cell_signal', val)}
              />
            </div>
          </div>
        </>
      )}

      {/* Linear feature specific fields - trails and rivers */}
      {isLinearFeature && editedData.feature_type !== 'boundary' && (
        <>
          <div className="edit-row">
            <div className="edit-section half">
              <label>Feature Type</label>
              <select
                value={editedData.feature_type || 'trail'}
                onChange={(e) => handleChange('feature_type', e.target.value)}
              >
                <option value="trail">Trail</option>
              </select>
            </div>
            <div className="edit-section half">
              <label>Difficulty</label>
              <select
                value={editedData.difficulty || ''}
                onChange={(e) => handleChange('difficulty', e.target.value)}
              >
                <option value="">Not specified</option>
                <option value="Easy">Easy</option>
                <option value="Moderate">Moderate</option>
                <option value="Difficult">Difficult</option>
              </select>
            </div>
          </div>
          <div className="edit-section">
            <label>Length (miles)</label>
            <input
              type="number"
              step="0.1"
              value={editedData.length_miles || ''}
              onChange={(e) => handleChange('length_miles', e.target.value ? parseFloat(e.target.value) : null)}
              placeholder="e.g., 2.5"
            />
          </div>
        </>
      )}

      {/* Boundary color picker */}
      {isLinearFeature && editedData.feature_type === 'boundary' && (
        <div className="edit-section">
          <label>Boundary Color</label>
          <div className="boundary-color-palette">
            {[
              '#228B22', // Forest Green
              '#2E8B57', // Sea Green
              '#006400', // Dark Green
              '#8B4513', // Saddle Brown
              '#A0522D', // Sienna
              '#CD853F', // Peru
              '#4169E1', // Royal Blue
              '#1E90FF', // Dodger Blue
              '#4682B4', // Steel Blue
              '#8B008B', // Dark Magenta
              '#9932CC', // Dark Orchid
              '#DC143C', // Crimson
              '#FF6347', // Tomato
              '#FF8C00', // Dark Orange
              '#FFD700', // Gold
            ].map(color => (
              <button
                key={color}
                type="button"
                className={`color-swatch ${editedData.boundary_color === color ? 'selected' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => handleChange('boundary_color', color)}
                title={color}
              />
            ))}
          </div>
          <div className="current-color-display">
            Current: <span style={{ backgroundColor: editedData.boundary_color || '#228B22' }} className="color-preview" />
            <span className="color-hex">{editedData.boundary_color || '#228B22'}</span>
          </div>
        </div>
      )}

      {/* Lat/long fields - only for point destinations, not for virtual/organizations */}
      {!isLinearFeature && destination?.poi_type !== 'virtual' && (
        <div className="edit-row">
          <div className="edit-section half">
            <label>Latitude</label>
            <input
              type="number"
              step="0.000001"
              value={editedData.latitude || ''}
              onChange={(e) => handleCoordChange('latitude', e.target.value)}
            />
          </div>
          <div className="edit-section half">
            <label>Longitude</label>
            <input
              type="number"
              step="0.000001"
              value={editedData.longitude || ''}
              onChange={(e) => handleCoordChange('longitude', e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="edit-section">
        <label>More Info Link</label>
        <input
          type="text"
          value={editedData.more_info_link || ''}
          onChange={(e) => handleChange('more_info_link', e.target.value)}
          placeholder="https://..."
        />
      </div>

      <div className="edit-section">
        <label>Events Page URL (for AI Research)</label>
        <input
          type="text"
          value={editedData.events_url || ''}
          onChange={(e) => handleChange('events_url', e.target.value)}
          placeholder="https://example.com/events or /adventures"
        />
      </div>

      <div className="edit-section">
        <label>News Page URL (for AI Research)</label>
        <input
          type="text"
          value={editedData.news_url || ''}
          onChange={(e) => handleChange('news_url', e.target.value)}
          placeholder="https://example.com/news or /blog"
        />
      </div>

      <div className="edit-section">
        <label>MTB Trail Status URL (for AI status collection)</label>
        <input
          type="text"
          value={editedData.status_url || ''}
          onChange={(e) => handleChange('status_url', e.target.value)}
          placeholder="https://example.com/trail-status (leave empty if not an MTB trail)"
        />
        <small style={{ color: '#666', display: 'block', marginTop: '0.5rem' }}>
          If a trail status URL is provided, this trail will appear in MTB status collection
        </small>
      </div>


      </div>

      <div className="edit-buttons-footer">
        {!isNewPOI && !isNewOrganization && (
          <button
            className="delete-btn"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={saving || deleting}
          >
            Delete
          </button>
        )}
        <div className={`edit-buttons-right ${(isNewPOI || isNewOrganization) ? 'full-width' : ''}`}>
          <button className="cancel-btn" onClick={handleCancelWithCleanup} disabled={saving || deleting}>
            Cancel
          </button>
          <button className="save-btn" onClick={handleSaveWithImage} disabled={saving || deleting}>
            {saving ? 'Saving...' : (isNewPOI ? 'Create POI' : isNewOrganization ? 'Create Organization' : 'Save Changes')}
          </button>
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="delete-confirm-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="delete-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Point of Interest?</h3>
            <p className="delete-dest-name">{destination.name}</p>
            <p className="delete-warning">This action cannot be undone.</p>
            <div className="delete-confirm-buttons">
              <button
                className="cancel-btn"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="confirm-delete-btn"
                onClick={() => {
                  onDelete();
                  setShowDeleteConfirm(false);
                }}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPromptEditor && (
        <div className="prompt-editor-overlay" onClick={handleClosePromptEditor}>
          <div className="prompt-editor-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="prompt-editor-header">
              <h3>
                {promptType === 'brief' ? 'Generate Brief Description' : 'Generate Historical Description'}
              </h3>
              <button className="close-btn" onClick={handleClosePromptEditor}>&times;</button>
            </div>

            <p className="prompt-editor-hint">
              Review and customize the prompt below, then click Generate.
            </p>

            {loadingPrompt ? (
              <div className="prompt-loading">Loading prompt template...</div>
            ) : (
              <>
                <textarea
                  className="prompt-editor-textarea"
                  value={editablePrompt}
                  onChange={(e) => setEditablePrompt(e.target.value)}
                  rows={12}
                  disabled={generating}
                />

                {aiError && (
                  <div className="ai-error-inline">{aiError}</div>
                )}

                <div className="prompt-editor-buttons">
                  <button
                    className="cancel-btn"
                    onClick={handleClosePromptEditor}
                    disabled={generating}
                  >
                    Cancel
                  </button>
                  <button
                    className="ai-generate-btn-large"
                    onClick={handleGenerate}
                    disabled={generating || !editablePrompt.trim()}
                  >
                    {generating ? 'Generating...' : 'Generate'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// POI-specific News component
function PoiNews({ poiId, isAdmin, editMode, onCountChange }) {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [collecting, setCollecting] = useState(() => {
    // Check localStorage to see if collection was in progress
    const stored = localStorage.getItem(`news-collecting-${poiId}`);
    return stored === 'true';
  });
  const [collectResult, setCollectResult] = useState(null);
  const [collectionSession, setCollectionSession] = useState(0);
  const [showCompletedStatus, setShowCompletedStatus] = useState(false);

  const fetchNews = async () => {
    if (!poiId) {
      console.log('[fetchNews] No poiId, skipping fetch');
      return;
    }
    console.log(`[fetchNews] Fetching news for POI ${poiId}...`);
    setLoading(true);
    try {
      const response = await fetch(`/api/pois/${poiId}/news?limit=50`);
      console.log(`[fetchNews] Response status: ${response.status} ${response.statusText}`);
      if (response.ok) {
        const data = await response.json();
        console.log(`[fetchNews] Received ${data.length} news items:`, data.map(n => n.title.substring(0, 40)));
        setNews(data);
        if (onCountChange) onCountChange(data.length);
      } else {
        console.error(`[fetchNews] Request failed: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      console.error('[fetchNews] Error fetching POI news:', err);
    } finally {
      setLoading(false);
      console.log(`[fetchNews] Loading complete, news count: ${news.length}`);
    }
  };

  useEffect(() => {
    fetchNews();
    // Clean up collecting state if we're loading fresh data
    if (collecting) {
      // If we were collecting but now mounting fresh, the collection likely completed
      setTimeout(() => {
        localStorage.removeItem(`news-collecting-${poiId}`);
        setCollecting(false);
      }, 2000);
    }
  }, [poiId]);

  // Clear completed status when editMode changes
  useEffect(() => {
    if (!editMode) {
      setShowCompletedStatus(false);
    }
  }, [editMode]);

  // Collect news for this POI and refresh
  const handleCollectNews = async () => {
    if (!poiId) return;
    setCollecting(true);
    setShowCompletedStatus(false); // Clear previous completed status
    setCollectionSession(prev => prev + 1); // Increment session to force timer reset
    localStorage.setItem(`news-collecting-${poiId}`, 'true');
    setCollectResult(null);

    let shouldStopCollecting = false;

    try {
      // Read timezone from localStorage (defaults to America/New_York)
      const timezone = localStorage.getItem('app-timezone') || 'America/New_York';

      const response = await fetch(`/api/admin/pois/${poiId}/news/collect`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ timezone })
      });
      if (response.ok) {
        const result = await response.json();

        // If collection is already running, just attach to it
        if (result.alreadyRunning) {
          console.log('Collection already running, attaching to existing job');
          // The status widget will poll and show the current progress
          // Don't change collecting state - keep it true to show widget
          return;
        }

        console.log('[handleCollectNews] Collection successful, result:', result);
        setCollectResult({
          type: 'success',
          newsFound: result.newsFound,
          newsSaved: result.newsSaved,
          newsDuplicate: result.newsDuplicate || 0
        });
        // Refresh the news list
        console.log('[handleCollectNews] Calling fetchNews to refresh list...');
        await fetchNews();
        console.log('[handleCollectNews] fetchNews completed');
        shouldStopCollecting = true;
      } else {
        const error = await response.json();
        setCollectResult({ type: 'error', message: error.error || 'Collection failed' });
        shouldStopCollecting = true;
      }
    } catch (err) {
      setCollectResult({ type: 'error', message: err.message });
      shouldStopCollecting = true;
    } finally {
      if (shouldStopCollecting) {
        // Give the CollectionStatus widget time to fetch final progress before stopping polling
        setTimeout(() => {
          setCollecting(false);
          setShowCompletedStatus(true); // Keep status widget visible after completion
          localStorage.removeItem(`news-collecting-${poiId}`);
        }, 1500); // 1.5 second delay to ensure final progress is fetched
      }
    }
  };

  const handleCancelCollection = async () => {
    if (!poiId) return;
    try {
      const response = await fetch(`/api/admin/pois/${poiId}/collection-cancel`, {
        method: 'POST',
        credentials: 'include'
      });
      if (response.ok) {
        console.log('[PoiNews] Cancellation requested');
        // The status widget will update to show cancelled state
        setTimeout(() => {
          setCollecting(false);
          setShowCompletedStatus(true);
          localStorage.removeItem(`news-collecting-${poiId}`);
        }, 500);
      }
    } catch (err) {
      console.error('[PoiNews] Error cancelling collection:', err);
    }
  };

  const handleDelete = async (newsId) => {
    setDeleting(newsId);
    try {
      const response = await fetch(`/api/admin/news/${newsId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (response.ok) {
        setNews(prev => prev.filter(n => n.id !== newsId));
      }
    } catch (err) {
      console.error('Error deleting news:', err);
    } finally {
      setDeleting(null);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    // Parse date as local date to avoid timezone conversion
    const [year, month, day] = dateString.split('T')[0].split('-');
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', {
      month: '2-digit', day: '2-digit', year: 'numeric'
    });
  };

  if (loading) return <div className="sidebar-tab-loading">Loading news...</div>;

  return (
    <div className="poi-news-list">
      {isAdmin && editMode && (
        <div className="poi-tab-actions">
          <button
            className="refresh-content-btn"
            onClick={handleCollectNews}
            disabled={collecting}
          >
            {collecting ? '🔄 Searching...' : `🔍 Refresh News${news.length > 0 ? ` (${news.length})` : ''}`}
          </button>
        </div>
      )}

      <div className="poi-news-list-content">
        {isAdmin && editMode && (collecting || showCompletedStatus) && (
          <CollectionStatus
            key={`news-${collectionSession}`}
            poiId={poiId}
            isCollecting={collecting}
            onComplete={(data) => {
              console.log('[Sidebar] Collection completed:', data);
              // Keep showing status even after completion
            }}
            onClose={() => {
              console.log('[Sidebar] User closed status widget');
              setShowCompletedStatus(false);
            }}
            onCancel={handleCancelCollection}
          />
        )}

        {news.length === 0 ? (
          <div className="sidebar-tab-empty">No news for this location.</div>
        ) : news.map(item => (
        <div key={item.id} className={`poi-news-item ${item.news_type || 'general'}`}>
          <div className="poi-news-header">
            <span className="poi-news-title">{item.title}</span>
            {isAdmin && editMode && (
              <button
                className="news-delete-btn"
                onClick={() => handleDelete(item.id)}
                disabled={deleting === item.id}
              >
                {deleting === item.id ? '...' : '×'}
              </button>
            )}
          </div>
          {item.published_at && (
            <div className="poi-event-date">
              {formatDate(item.published_at)}
            </div>
          )}
          {item.summary && <p className="poi-news-summary">{item.summary}</p>}
          <div className="poi-news-meta">
            {item.source_name && <span className="news-source">{item.source_name}</span>}
            {item.source_url && (
              <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="news-link">
                Read more
              </a>
            )}
          </div>
        </div>
        ))}
      </div>
    </div>
  );
}

// POI-specific Events component
function PoiEvents({ poiId, poiName, isAdmin, editMode, onCountChange }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [collecting, setCollecting] = useState(() => {
    // Check localStorage to see if collection was in progress
    const stored = localStorage.getItem(`events-collecting-${poiId}`);
    return stored === 'true';
  });
  const [collectResult, setCollectResult] = useState(null);
  const [collectionSession, setCollectionSession] = useState(0);
  const [showCompletedStatus, setShowCompletedStatus] = useState(false);

  const fetchEvents = async () => {
    if (!poiId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/pois/${poiId}/events?limit=50`);
      if (response.ok) {
        const data = await response.json();
        setEvents(data);
        if (onCountChange) onCountChange(data.length);
      }
    } catch (err) {
      console.error('Error fetching POI events:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    // Clean up collecting state if we're loading fresh data
    if (collecting) {
      // If we were collecting but now mounting fresh, the collection likely completed
      setTimeout(() => {
        localStorage.removeItem(`events-collecting-${poiId}`);
        setCollecting(false);
      }, 2000);
    }
  }, [poiId]);

  // Clear completed status when editMode changes
  useEffect(() => {
    if (!editMode) {
      setShowCompletedStatus(false);
    }
  }, [editMode]);

  // Collect events for this POI and refresh
  const handleCollectEvents = async () => {
    if (!poiId) return;
    setCollecting(true);
    setShowCompletedStatus(false); // Clear previous completed status
    setCollectionSession(prev => prev + 1); // Increment session to force timer reset
    localStorage.setItem(`events-collecting-${poiId}`, 'true');
    setCollectResult(null);

    let shouldStopCollecting = false;

    try {
      // Read timezone from localStorage (defaults to America/New_York)
      const timezone = localStorage.getItem('app-timezone') || 'America/New_York';

      const response = await fetch(`/api/admin/pois/${poiId}/events/collect`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ timezone })
      });
      if (response.ok) {
        const result = await response.json();

        // If collection is already running, just attach to it
        if (result.alreadyRunning) {
          console.log('Collection already running, attaching to existing job');
          // The status widget will poll and show the current progress
          // Don't change collecting state - keep it true to show widget
          return;
        }

        setCollectResult({
          type: 'success',
          eventsFound: result.eventsFound,
          eventsSaved: result.eventsSaved,
          eventsDuplicate: result.eventsDuplicate || 0
        });
        // Refresh the events list
        await fetchEvents();
        shouldStopCollecting = true;
      } else {
        const error = await response.json();
        setCollectResult({ type: 'error', message: error.error || 'Collection failed' });
        shouldStopCollecting = true;
      }
    } catch (err) {
      setCollectResult({ type: 'error', message: err.message });
      shouldStopCollecting = true;
    } finally {
      if (shouldStopCollecting) {
        // Give the CollectionStatus widget time to fetch final progress before stopping polling
        setTimeout(() => {
          setCollecting(false);
          setShowCompletedStatus(true); // Keep status widget visible after completion
          localStorage.removeItem(`events-collecting-${poiId}`);
        }, 1500); // 1.5 second delay to ensure final progress is fetched
      }
    }
  };

  const handleCancelCollection = async () => {
    if (!poiId) return;
    try {
      const response = await fetch(`/api/admin/pois/${poiId}/collection-cancel`, {
        method: 'POST',
        credentials: 'include'
      });
      if (response.ok) {
        console.log('[PoiEvents] Cancellation requested');
        // The status widget will update to show cancelled state
        setTimeout(() => {
          setCollecting(false);
          setShowCompletedStatus(true);
          localStorage.removeItem(`events-collecting-${poiId}`);
        }, 500);
      }
    } catch (err) {
      console.error('[PoiEvents] Error cancelling collection:', err);
    }
  };

  const handleDelete = async (eventId) => {
    setDeleting(eventId);
    try {
      const response = await fetch(`/api/admin/events/${eventId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (response.ok) {
        setEvents(prev => prev.filter(e => e.id !== eventId));
      }
    } catch (err) {
      console.error('Error deleting event:', err);
    } finally {
      setDeleting(null);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    // Parse date as local date to avoid timezone conversion
    const [year, month, day] = dateString.split('T')[0].split('-');
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', {
      weekday: 'short', month: '2-digit', day: '2-digit', year: 'numeric'
    });
  };

  const createGoogleCalendarLink = (event, poiName) => {
    const title = encodeURIComponent(event.title);
    const description = encodeURIComponent(event.description || '');
    const location = encodeURIComponent(event.location_details || poiName || '');

    // Format dates for Google Calendar (YYYYMMDDTHHmmss)
    const formatForGoogle = (dateStr) => {
      if (!dateStr) return '';
      const [year, month, day] = dateStr.split('T')[0].split('-');
      return `${year}${month}${day}`;
    };

    const startDate = formatForGoogle(event.start_date);
    const endDate = formatForGoogle(event.end_date || event.start_date);

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startDate}/${endDate}&details=${description}&location=${location}`;
  };

  if (loading) return <div className="sidebar-tab-loading">Loading events...</div>;

  return (
    <div className="poi-events-list">
      {isAdmin && editMode && (
        <div className="poi-tab-actions">
          <button
            className="refresh-content-btn"
            onClick={handleCollectEvents}
            disabled={collecting}
          >
            {collecting ? '🔄 Searching...' : `🔍 Refresh Events${events.length > 0 ? ` (${events.length})` : ''}`}
          </button>
        </div>
      )}

      <div className="poi-events-list-content">
        {isAdmin && editMode && (collecting || showCompletedStatus) && (
          <CollectionStatus
            key={`events-${collectionSession}`}
            poiId={poiId}
            isCollecting={collecting}
            onComplete={(data) => {
              console.log('[Sidebar] Collection completed:', data);
              // Keep showing status even after completion
            }}
            onClose={() => {
              console.log('[Sidebar] User closed status widget');
              setShowCompletedStatus(false);
            }}
            onCancel={handleCancelCollection}
          />
        )}

        {events.length === 0 ? (
          <div className="sidebar-tab-empty">No upcoming events for this location.</div>
        ) : events.map(item => (
        <div key={item.id} className={`poi-event-item ${item.event_type || 'program'}`}>
          <div className="poi-event-header">
            <span className="poi-event-title">{item.title}</span>
            {isAdmin && editMode && (
              <button
                className="news-delete-btn"
                onClick={() => handleDelete(item.id)}
                disabled={deleting === item.id}
              >
                {deleting === item.id ? '...' : '×'}
              </button>
            )}
          </div>
          <div className="poi-event-date">
            {formatDate(item.start_date)}
            {item.end_date && item.end_date !== item.start_date && (
              <> - {formatDate(item.end_date)}</>
            )}
          </div>
          {item.description && <p className="poi-event-description">{item.description}</p>}
          {item.location_details && (
            <div className="poi-event-location">
              <strong>Location:</strong> {item.location_details}
            </div>
          )}
          <div className="event-links">
            {item.source_url && (
              <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="event-link">
                More info
              </a>
            )}
            <a
              href={createGoogleCalendarLink(item, poiName)}
              target="_blank"
              rel="noopener noreferrer"
              className="event-link calendar-link"
            >
              + Add to Calendar
            </a>
          </div>
        </div>
        ))}
      </div>
    </div>
  );
}

// Associations Modal Component - shows associations in a pop-up
function AssociationsModal({ isOpen, onClose, poi, associations, allDestinations, allLinearFeatures, allVirtualPois, onSelectDestination, onSelectLinearFeature, isAdmin, editMode, onAssociationsChanged }) {
  const [isAdding, setIsAdding] = useState(false);
  const [selectedNewPois, setSelectedNewPois] = useState(new Set());
  const [deleting, setDeleting] = useState(null);

  if (!isOpen || !poi) return null;

  // Find associations for this POI
  const poiAssociations = associations.filter(assoc =>
    assoc.virtual_poi_id === poi.id || assoc.physical_poi_id === poi.id
  );

  // Determine if this is a virtual POI
  const isVirtualPoi = poi.poi_type === 'virtual';

  // Get regular associations
  const regularAssociations = poiAssociations.map(assoc => {
    if (isVirtualPoi) {
      // This is a virtual POI, show associated physical POIs
      const physicalId = assoc.physical_poi_id;
      let associatedPoi = allDestinations?.find(d => d.id === physicalId);
      if (!associatedPoi) {
        associatedPoi = allLinearFeatures?.find(f => f.id === physicalId);
      }
      return associatedPoi ? { ...associatedPoi, _isLinear: !!allLinearFeatures?.find(f => f.id === physicalId), _isVirtual: false, _assocId: assoc.id } : null;
    } else {
      // This is a physical POI, show associated virtual POIs
      const virtualId = assoc.virtual_poi_id;
      const associatedPoi = allVirtualPois?.find(v => v.id === virtualId);
      return associatedPoi ? { ...associatedPoi, _isVirtual: true, _isLinear: false, _assocId: assoc.id } : null;
    }
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));

  // Get owner organization (for physical POIs) - show first in list with Owner badge
  const ownerOrg = !isVirtualPoi && poi.owner_id
    ? allVirtualPois?.find(v => Number(v.id) === Number(poi.owner_id))
    : null;

  // Get owned POIs (for virtual POIs/organizations) - POIs that have this org as their owner
  const ownedPois = isVirtualPoi
    ? [
        ...(allDestinations || []).filter(d => Number(d.owner_id) === Number(poi.id)),
        ...(allLinearFeatures || []).filter(f => Number(f.owner_id) === Number(poi.id))
      ].map(p => ({
        ...p,
        _isLinear: !!(allLinearFeatures || []).find(f => f.id === p.id),
        _isVirtual: false,
        _isOwned: true
      })).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  // Combine: owner first (for physical POIs), owned POIs first (for virtual POIs), then regular associations
  const associatedPoisWithAssocId = [
    ...(ownerOrg ? [{ ...ownerOrg, _isVirtual: true, _isLinear: false, _isOwner: true }] : []),
    ...ownedPois.filter(p => !regularAssociations.some(a => a.id === p.id)),
    ...regularAssociations.filter(a => (!ownerOrg || a.id !== ownerOrg.id) && !ownedPois.some(p => p.id === a.id))
  ];

  // Get available POIs for adding (not currently associated)
  const availablePois = useMemo(() => {
    if (!isVirtualPoi) return []; // Only virtual POIs can add associations

    const currentIds = new Set(associatedPoisWithAssocId.map(p => p.id));
    const allPhysicalPois = [
      ...(allDestinations || []).map(d => ({ ...d, _type: 'point' })),
      ...(allLinearFeatures || []).map(f => ({ ...f, _type: f.feature_type || 'trail' }))
    ];

    return allPhysicalPois.filter(p => !currentIds.has(p.id));
  }, [isVirtualPoi, associatedPoisWithAssocId, allDestinations, allLinearFeatures]);

  const handleDeleteAssociation = async (assocId, poiName) => {
    if (!confirm(`Remove association with "${poiName}"?`)) return;

    setDeleting(assocId);
    try {
      const response = await fetch(`/api/admin/poi-associations/${assocId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete association');
      }

      if (onAssociationsChanged) {
        onAssociationsChanged();
      }
    } catch (error) {
      console.error('Error deleting association:', error);
      alert('Error removing association: ' + error.message);
    } finally {
      setDeleting(null);
    }
  };

  const handleAddAssociations = async () => {
    if (selectedNewPois.size === 0) {
      alert('Please select at least one location to associate');
      return;
    }

    try {
      const response = await fetch('/api/admin/poi-associations/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          virtual_poi_id: poi.id,
          physical_poi_ids: Array.from(selectedNewPois),
          association_type: 'manages'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to add associations');
      }

      setIsAdding(false);
      setSelectedNewPois(new Set());

      if (onAssociationsChanged) {
        onAssociationsChanged();
      }
    } catch (error) {
      console.error('Error adding associations:', error);
      alert('Error adding associations: ' + error.message);
    }
  };

  return (
    <div className="associations-modal-overlay" onClick={onClose}>
      <div className="associations-modal" onClick={(e) => e.stopPropagation()}>
        <div className="associations-modal-header">
          <h3>{isVirtualPoi ? 'Associated Locations' : 'Organizations'}</h3>
          <button className="associations-modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="associations-modal-content">
          <p className="associations-modal-description">
            {isVirtualPoi
              ? 'Physical locations associated with this organization.'
              : 'Organizations associated with this location.'}
          </p>

          {isAdmin && editMode && isVirtualPoi && !isAdding && (
            <button
              onClick={() => setIsAdding(true)}
              className="btn-add-association"
              style={{ marginBottom: '1rem' }}
            >
              + Add Associations
            </button>
          )}

          {associatedPoisWithAssocId.length > 0 ? (
            <div className="associations-modal-list">
              {associatedPoisWithAssocId.map(associatedPoi => {
                // Use thumbnail endpoint for fast, cached small images
                // Include updated_at for cache busting when image changes
                const imageUrl = associatedPoi.image_mime_type
                  ? `/api/pois/${associatedPoi.id}/thumbnail?size=small&v=${associatedPoi.updated_at || Date.now()}`
                  : null;

                // Get default thumbnail SVG path based on type
                const getDefaultThumbnail = () => {
                  if (associatedPoi._isVirtual) return '/icons/thumbnails/virtual.svg';
                  if (associatedPoi._isLinear) {
                    if (associatedPoi.feature_type === 'river') return '/icons/thumbnails/river.svg';
                    if (associatedPoi.feature_type === 'boundary') return '/icons/thumbnails/boundary.svg';
                    return '/icons/thumbnails/trail.svg';
                  }
                  return '/icons/thumbnails/destination.svg';
                };

                const isMtbTrailhead = !associatedPoi._isLinear && !associatedPoi._isVirtual &&
                                      associatedPoi.status_url && associatedPoi.status_url.trim() !== '';
                const poiType = associatedPoi._isVirtual ? 'virtual' :
                                !associatedPoi._isLinear ? (isMtbTrailhead ? 'mtb' : 'destination') :
                                associatedPoi.feature_type || 'trail';

                return (
                  <div
                    key={associatedPoi.id}
                    className="association-item"
                  >
                    <div
                      className="association-item-clickable"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (associatedPoi._isVirtual || (!associatedPoi._isLinear && !associatedPoi._isVirtual)) {
                          onSelectDestination(associatedPoi);
                          onClose();
                        } else if (associatedPoi._isLinear) {
                          onSelectLinearFeature(associatedPoi);
                          onClose();
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className={`association-item-thumbnail ${associatedPoi._isVirtual ? 'virtual-thumbnail' : ''}`}>
                        {imageUrl ? (
                          <img src={imageUrl} alt={associatedPoi.name} loading="lazy" className={associatedPoi._isVirtual ? 'logo-image' : ''} />
                        ) : (
                          <img src={getDefaultThumbnail()} alt={associatedPoi.name} className="default-thumbnail" loading="lazy" />
                        )}
                      </div>
                      <div className="association-item-content">
                        <div className="association-item-name">{associatedPoi.name}</div>
                        <div className="association-item-badges">
                          <span className={`poi-type-icon ${poiType}`}>
                            {associatedPoi._isVirtual ? 'O' :
                             isMtbTrailhead ? 'M' :
                             !associatedPoi._isLinear ? 'D' :
                             associatedPoi.feature_type === 'river' ? 'R' :
                             associatedPoi.feature_type === 'boundary' ? 'B' : 'T'}
                          </span>
                          {associatedPoi._isOwner && (
                            <span className="owner-badge-small">Owner</span>
                          )}
                          {associatedPoi._isOwned && (
                            <span className="owner-badge-small">Owned</span>
                          )}
                          {associatedPoi.era_name && !associatedPoi._isVirtual && (
                            <span className="association-item-era">{associatedPoi.era_name}</span>
                          )}
                        </div>
                        {associatedPoi.brief_description && (
                          <div className="association-item-description">{associatedPoi.brief_description}</div>
                        )}
                      </div>
                    </div>
                    {isAdmin && editMode && isVirtualPoi && !associatedPoi._isOwner && !associatedPoi._isOwned && (
                      <button
                        onClick={() => handleDeleteAssociation(associatedPoi._assocId, associatedPoi.name)}
                        className="btn-delete-association"
                        disabled={deleting === associatedPoi._assocId}
                        title="Remove association"
                      >
                        {deleting === associatedPoi._assocId ? '...' : '×'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="associations-modal-empty">No associations yet.</div>
          )}

          {/* Add associations section */}
          {isAdding && (
            <div className="add-associations-section">
              <h4>Add Associations</h4>
              <div className="available-pois-list">
                {availablePois.length === 0 ? (
                  <div className="empty-message">All locations are already associated</div>
                ) : (
                  availablePois.map(availablePoi => (
                    <label key={availablePoi.id} className="poi-checkbox-item">
                      <input
                        type="checkbox"
                        checked={selectedNewPois.has(availablePoi.id)}
                        onChange={() => {
                          setSelectedNewPois(prev => {
                            const next = new Set(prev);
                            if (next.has(availablePoi.id)) {
                              next.delete(availablePoi.id);
                            } else {
                              next.add(availablePoi.id);
                            }
                            return next;
                          });
                        }}
                      />
                      <span className={`poi-type-badge ${availablePoi._type === 'point' ? 'destination' : availablePoi._type}`}>
                        {availablePoi._type === 'point' ? 'D' :
                         availablePoi._type === 'river' ? 'R' :
                         availablePoi._type === 'boundary' ? 'B' : 'T'}
                      </span>
                      <span className="poi-name">{availablePoi.name}</span>
                    </label>
                  ))
                )}
              </div>
              <div className="add-associations-actions">
                <button onClick={() => {
                  setIsAdding(false);
                  setSelectedNewPois(new Set());
                }} className="btn-cancel">
                  Cancel
                </button>
                <button
                  onClick={handleAddAssociations}
                  className="btn-save"
                  disabled={selectedNewPois.size === 0}
                >
                  Add {selectedNewPois.size > 0 ? `(${selectedNewPois.size})` : ''}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Associations tab content - shows related POIs (virtual or physical)
function AssociationsTabContent({ poi, associations, allDestinations, allLinearFeatures, allVirtualPois, onSelectDestination, onSelectLinearFeature, isAdmin, editMode, onAssociationsChanged, onStartDrawingAssociations }) {
  const [isAdding, setIsAdding] = useState(false);
  const [selectedNewPois, setSelectedNewPois] = useState(new Set());
  const [deleting, setDeleting] = useState(null);
  const [filterText, setFilterText] = useState('');

  // Find associations for this POI
  const poiAssociations = associations.filter(assoc =>
    assoc.virtual_poi_id === poi.id || assoc.physical_poi_id === poi.id
  );

  // Determine if this is a virtual POI
  const isVirtualPoi = poi.poi_type === 'virtual';

  // Get the associated POIs with association IDs (regular associations from table)
  const regularAssociations = poiAssociations.map(assoc => {
    if (isVirtualPoi) {
      // This is a virtual POI, show associated physical POIs
      const physicalId = assoc.physical_poi_id;
      let associatedPoi = allDestinations?.find(d => d.id === physicalId);
      if (!associatedPoi) {
        associatedPoi = allLinearFeatures?.find(f => f.id === physicalId);
      }
      return associatedPoi ? { ...associatedPoi, _isLinear: !!allLinearFeatures?.find(f => f.id === physicalId), _isVirtual: false, _assocId: assoc.id } : null;
    } else {
      // This is a physical POI, show associated virtual POIs
      const virtualId = assoc.virtual_poi_id;
      const associatedPoi = allVirtualPois?.find(v => v.id === virtualId);
      return associatedPoi ? { ...associatedPoi, _isVirtual: true, _isLinear: false, _assocId: assoc.id } : null;
    }
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));

  // Get owner organization (for physical POIs) - show first in list with Owner badge
  const ownerOrg = !isVirtualPoi && poi.owner_id
    ? allVirtualPois?.find(v => Number(v.id) === Number(poi.owner_id))
    : null;

  // Get owned POIs (for virtual POIs/organizations) - POIs that have this org as their owner
  const ownedPois = isVirtualPoi
    ? [
        ...(allDestinations || []).filter(d => Number(d.owner_id) === Number(poi.id)),
        ...(allLinearFeatures || []).filter(f => Number(f.owner_id) === Number(poi.id))
      ].map(p => ({
        ...p,
        _isLinear: !!(allLinearFeatures || []).find(f => f.id === p.id),
        _isVirtual: false,
        _isOwned: true
      })).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  // Combine: owner first (for physical POIs), owned POIs first (for virtual POIs), then regular associations
  const associatedPoisWithAssocId = [
    ...(ownerOrg ? [{ ...ownerOrg, _isVirtual: true, _isLinear: false, _isOwner: true }] : []),
    ...ownedPois.filter(p => !regularAssociations.some(a => a.id === p.id)),
    ...regularAssociations.filter(a => (!ownerOrg || a.id !== ownerOrg.id) && !ownedPois.some(p => p.id === a.id))
  ];

  // Get available POIs for adding (not currently associated)
  const availablePois = useMemo(() => {
    if (!isVirtualPoi) return []; // Only virtual POIs can add associations

    const currentIds = new Set(associatedPoisWithAssocId.map(p => p.id));
    const allPhysicalPois = [
      ...(allDestinations || []).map(d => ({ ...d, _type: 'point' })),
      ...(allLinearFeatures || []).map(f => ({ ...f, _type: f.feature_type || 'trail' }))
    ];

    return allPhysicalPois.filter(p => !currentIds.has(p.id));
  }, [isVirtualPoi, associatedPoisWithAssocId, allDestinations, allLinearFeatures]);

  const handleDeleteAssociation = async (assocId, poiName) => {
    if (!confirm(`Remove association with "${poiName}"?`)) return;

    setDeleting(assocId);
    try {
      const response = await fetch(`/api/admin/poi-associations/${assocId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete association');
      }

      if (onAssociationsChanged) {
        onAssociationsChanged();
      }
    } catch (error) {
      console.error('Error deleting association:', error);
      alert('Error removing association: ' + error.message);
    } finally {
      setDeleting(null);
    }
  };

  const handleAddAssociations = async () => {
    if (selectedNewPois.size === 0) {
      alert('Please select at least one location to associate');
      return;
    }

    try {
      const response = await fetch('/api/admin/poi-associations/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          virtual_poi_id: poi.id,
          physical_poi_ids: Array.from(selectedNewPois),
          association_type: 'manages'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to add associations');
      }

      setIsAdding(false);
      setSelectedNewPois(new Set());
      setFilterText('');

      if (onAssociationsChanged) {
        onAssociationsChanged();
      }
    } catch (error) {
      console.error('Error adding associations:', error);
      alert('Error adding associations: ' + error.message);
    }
  };

  if (poiAssociations.length === 0 && !ownerOrg && ownedPois.length === 0 && !isAdmin) {
    return (
      <div className="sidebar-tab-empty">
        No associated entities for this location.
      </div>
    );
  }

  return (
    <div className="associations-tab-content">
      <div className="section">
        <div className="section-header-with-actions">
          <div>
            <h3>{isVirtualPoi ? 'Associated Locations' : 'Organizations'}</h3>
            <p className="associations-description">
              {isVirtualPoi
                ? 'Physical locations associated with this organization.'
                : 'Organizations associated with this location.'}
            </p>
          </div>
          {isAdmin && editMode && isVirtualPoi && !isAdding && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => {
                  if (onStartDrawingAssociations) {
                    onStartDrawingAssociations(poi.id);
                  }
                }}
                className="btn-add-association"
                title="Draw rectangle on map to select multiple locations"
              >
                Add from Map
              </button>
              <button
                onClick={() => setIsAdding(true)}
                className="btn-add-association"
              >
                Add from List
              </button>
            </div>
          )}
        </div>

        {associatedPoisWithAssocId.length > 0 ? (
          <div className={`associations-list ${isAdding ? 'compact' : ''}`}>
            {associatedPoisWithAssocId.map(associatedPoi => {
              // Use thumbnail endpoint for fast, cached small images
              // Include updated_at for cache busting when image changes
              const imageUrl = associatedPoi.image_mime_type
                ? `/api/pois/${associatedPoi.id}/thumbnail?size=small&v=${associatedPoi.updated_at || Date.now()}`
                : null;

              // Get default thumbnail SVG path based on type
              const getDefaultThumbnail = () => {
                if (associatedPoi._isVirtual) return '/icons/thumbnails/virtual.svg';
                if (associatedPoi._isLinear) {
                  if (associatedPoi.feature_type === 'river') return '/icons/thumbnails/river.svg';
                  if (associatedPoi.feature_type === 'boundary') return '/icons/thumbnails/boundary.svg';
                  return '/icons/thumbnails/trail.svg';
                }
                return '/icons/thumbnails/destination.svg';
              };

              const isMtbTrailhead = !associatedPoi._isLinear && !associatedPoi._isVirtual &&
                                    associatedPoi.status_url && associatedPoi.status_url.trim() !== '';
              const poiType = associatedPoi._isVirtual ? 'virtual' :
                              !associatedPoi._isLinear ? (isMtbTrailhead ? 'mtb' : 'destination') :
                              associatedPoi.feature_type || 'trail';

              return (
                <div
                  key={associatedPoi.id}
                  className="association-item"
                >
                  <div
                    className="association-item-clickable"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (associatedPoi._isVirtual || (!associatedPoi._isLinear && !associatedPoi._isVirtual)) {
                        onSelectDestination(associatedPoi);
                      } else if (associatedPoi._isLinear) {
                        onSelectLinearFeature(associatedPoi);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className={`association-item-thumbnail ${associatedPoi._isVirtual ? 'virtual-thumbnail' : ''}`}>
                      {imageUrl ? (
                        <img src={imageUrl} alt={associatedPoi.name} loading="lazy" className={associatedPoi._isVirtual ? 'logo-image' : ''} />
                      ) : (
                        <img src={getDefaultThumbnail()} alt={associatedPoi.name} className="default-thumbnail" loading="lazy" />
                      )}
                    </div>
                    <div className="association-item-content">
                      <div className="association-item-name">{associatedPoi.name}</div>
                      <div className="association-item-badges">
                        <span className={`poi-type-icon ${poiType}`}>
                          {associatedPoi._isVirtual ? 'O' :
                           isMtbTrailhead ? 'M' :
                           !associatedPoi._isLinear ? 'D' :
                           associatedPoi.feature_type === 'river' ? 'R' :
                           associatedPoi.feature_type === 'boundary' ? 'B' : 'T'}
                        </span>
                        {associatedPoi._isOwner && (
                          <span className="owner-badge-small">Owner</span>
                        )}
                        {associatedPoi._isOwned && (
                          <span className="owner-badge-small">Owned</span>
                        )}
                        {associatedPoi.era && !associatedPoi._isVirtual && (
                          <span className="association-item-era">{associatedPoi.era}</span>
                        )}
                      </div>
                      {associatedPoi.brief_description && (
                        <div className="association-item-description">{associatedPoi.brief_description}</div>
                      )}
                    </div>
                  </div>
                  {isAdmin && editMode && isVirtualPoi && !associatedPoi._isOwned && (
                    <button
                      onClick={() => handleDeleteAssociation(associatedPoi._assocId, associatedPoi.name)}
                      className="btn-delete-association"
                      disabled={deleting === associatedPoi._assocId}
                      title="Remove association"
                    >
                      {deleting === associatedPoi._assocId ? '...' : '×'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="sidebar-tab-empty">No associations yet.</div>
        )}

      </div>

      {/* Add associations modal - pop-up overlay */}
      {isAdding && (
        <div className="add-associations-modal-overlay" onClick={() => {
          setIsAdding(false);
          setFilterText('');
        }}>
          <div className="add-associations-modal" onClick={(e) => e.stopPropagation()}>
            <div className="add-associations-modal-header">
              <h3>Add Associations</h3>
              <button className="add-associations-modal-close" onClick={() => {
                setIsAdding(false);
                setFilterText('');
              }}>&times;</button>
            </div>
            <div className="add-associations-modal-content">
              {availablePois.length > 0 && (
                <div className="filter-input-container">
                  <input
                    type="text"
                    placeholder="Search locations..."
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    className="filter-input"
                  />
                </div>
              )}
              <div className="available-pois-list">
                {availablePois.length === 0 ? (
                  <div className="empty-message">All locations are already associated</div>
                ) : (
                  availablePois
                    .filter(poi => filterText === '' || poi.name.toLowerCase().includes(filterText.toLowerCase()))
                    .map(availablePoi => (
                    <label key={availablePoi.id} className="poi-checkbox-item">
                      <input
                        type="checkbox"
                        checked={selectedNewPois.has(availablePoi.id)}
                        onChange={() => {
                          setSelectedNewPois(prev => {
                            const next = new Set(prev);
                            if (next.has(availablePoi.id)) {
                              next.delete(availablePoi.id);
                            } else {
                              next.add(availablePoi.id);
                            }
                            return next;
                          });
                        }}
                      />
                      <span className={`poi-type-badge ${availablePoi._type === 'point' ? 'destination' : availablePoi._type}`}>
                        {availablePoi._type === 'point' ? 'D' :
                         availablePoi._type === 'river' ? 'R' :
                         availablePoi._type === 'boundary' ? 'B' : 'T'}
                      </span>
                      <span className="poi-name">{availablePoi.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="add-associations-modal-footer">
              <button onClick={() => {
                setIsAdding(false);
                setSelectedNewPois(new Set());
                setFilterText('');
              }} className="btn-cancel">
                Cancel
              </button>
              <button
                onClick={handleAddAssociations}
                className="btn-save"
                disabled={selectedNewPois.size === 0}
              >
                Add {selectedNewPois.size > 0 ? `(${selectedNewPois.size})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// POI-specific Trail Status component
function TrailStatus({ poiId, poiName, isAdmin, editMode, selectedFromMtbList, onBackToMtbList }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);

  const fetchStatus = async () => {
    if (!poiId) {
      console.log('[fetchStatus] No poiId, skipping fetch');
      return;
    }
    console.log(`[fetchStatus] Fetching status for trail ${poiId}...`);
    setLoading(true);
    try {
      const response = await fetch(`/api/pois/${poiId}/status`);
      console.log(`[fetchStatus] Response status: ${response.status} ${response.statusText}`);
      if (response.ok) {
        const data = await response.json();
        console.log(`[fetchStatus] Received status:`, data);
        setStatus(data);
      } else {
        console.error(`[fetchStatus] Request failed: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      console.error('[fetchStatus] Error fetching trail status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [poiId]);

  const handleCollect = async () => {
    if (!poiId) return;
    setCollecting(true);

    try {
      const response = await fetch(`/api/admin/pois/${poiId}/status/collect`, {
        method: 'POST',
        credentials: 'include'
      });

      if (response.ok) {
        const result = await response.json();
        console.log('[handleCollect] Collection successful:', result);

        // Refresh status
        await fetchStatus();
      } else {
        const error = await response.json();
        alert('Collection failed: ' + (error.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('[handleCollect] Error:', err);
      alert('Collection error: ' + err.message);
    } finally {
      setCollecting(false);
    }
  };

  if (loading) {
    return <div className="sidebar-tab-loading">Loading trail status...</div>;
  }

  const statusBadgeClass = status?.status ? `status-${status.status}` : 'status-unknown';

  return (
    <div className="trail-status-tab">
      {isAdmin && editMode && (
        <button
          className="admin-button"
          onClick={handleCollect}
          disabled={collecting}
          style={{ marginBottom: '1rem' }}
        >
          {collecting ? 'Collecting...' : 'Collect Status'}
        </button>
      )}

      {status && status.status !== 'unknown' ? (
        <div className={`trail-status ${statusBadgeClass}`}>
          <div className="status-badge">{(status.status || 'unknown').toUpperCase()}</div>

          {status.conditions && (
            <div className="status-conditions">
              <strong>Conditions:</strong> {status.conditions}
            </div>
          )}

          {status.weather_impact && (
            <div className="status-weather">
              <strong>Weather:</strong> {status.weather_impact}
            </div>
          )}

          {status.last_updated && (
            <div className="status-updated">
              Last updated: {formatDateTime(status.last_updated)}
            </div>
          )}

          {status.source_url && (
            <a
              href={status.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="status-source-link"
            >
              View on {status.source_name || 'Source'} ↗
            </a>
          )}

          {status.seasonal_closure && (
            <div className="status-seasonal">
              ⚠️ Seasonal Closure in Effect
            </div>
          )}
        </div>
      ) : (
        <div className="sidebar-tab-empty">
          No trail status information available.
          {isAdmin && editMode && (
            <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: '#666' }}>
              Use the "Collect Status" button above to gather current trail conditions.
            </p>
          )}
        </div>
      )}

      {selectedFromMtbList && onBackToMtbList && (
        <button
          type="button"
          className="back-to-mtb-list-btn"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onBackToMtbList();
          }}
          style={{ marginTop: '1.5rem' }}
        >
          ← Back to MTB Trails List
        </button>
      )}
    </div>
  );
}

function Sidebar({ destination, isNewPOI, newOrganization, isNewOrganization, onClose, isAdmin, editMode, onDestinationUpdate, onDestinationDelete, onSaveNewPOI, onCancelNewPOI, onSaveNewOrganization, onCancelNewOrganization, previewCoords, onPreviewCoordsChange, linearFeature, onLinearFeatureUpdate, onLinearFeatureDelete, onNavigate, currentIndex, totalCount, poiNavigationList, associations, allDestinations, allLinearFeatures, allVirtualPois, onSelectDestination, onSelectLinearFeature, onAssociationsChanged, onStartDrawingAssociations, isInMtbMode, selectedFromMtbList, mtbTrailsList, currentMtbIndex, onNavigateMtbTrail, onBackToMtbList, showNpsMap, onToggleNpsMap }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('view');
  const [showShareModal, setShowShareModal] = useState(false);
  const [showAssociationsModal, setShowAssociationsModal] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [pendingImage, setPendingImage] = useState(null);
  const [newsCount, setNewsCount] = useState(0);
  const [eventsCount, setEventsCount] = useState(0);
  const [trailStatus, setTrailStatus] = useState(null);

  // State for new organization creation
  const [organizationData, setOrganizationData] = useState({
    name: '',
    brief_description: '',
    property_owner: '',
    more_info_link: ''
  });
  const [selectedPoiIds, setSelectedPoiIds] = useState(new Set());

  // Initialize organization data when newOrganization changes
  useEffect(() => {
    if (newOrganization) {
      setSelectedPoiIds(newOrganization._selectedPoiIds || new Set());
    }
  }, [newOrganization]);

  // Determine which POI we're showing
  const activePoi = destination || linearFeature;

  // Check if this POI has associations
  const hasAssociations = activePoi && associations?.some(assoc =>
    assoc.virtual_poi_id === activePoi.id || assoc.physical_poi_id === activePoi.id
  );

  // Wrapper functions to switch to Info tab when selecting from associations
  const handleSelectDestinationFromAssociations = React.useCallback((poi) => {
    onSelectDestination(poi);
    setSidebarTab('view'); // Switch to Info tab
  }, [onSelectDestination]);

  const handleSelectLinearFeatureFromAssociations = React.useCallback((poi) => {
    onSelectLinearFeature(poi);
    setSidebarTab('view'); // Switch to Info tab
  }, [onSelectLinearFeature]);

  // Touch/swipe handling for mobile navigation
  const touchStartX = React.useRef(null);
  const touchStartY = React.useRef(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwipingHorizontally, setIsSwipingHorizontally] = useState(false);

  // Debounce navigation to prevent race conditions from rapid taps
  const lastNavigationTime = React.useRef(0);
  const NAVIGATION_DEBOUNCE_MS = 300;

  const debouncedNavigate = (direction) => {
    const now = Date.now();
    if (now - lastNavigationTime.current < NAVIGATION_DEBOUNCE_MS) {
      return; // Ignore rapid taps
    }
    lastNavigationTime.current = now;
    onNavigate(direction);
  };

  // Check for mobile on resize
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Swipe gesture handlers
  const handleTouchStart = (e) => {
    // Don't start swipe tracking if touch starts on the thumbnail carousel or navigation buttons
    const target = e.target;
    const isCarousel = target.closest('.thumbnail-carousel-wrapper, .thumbnail-carousel');
    const isNavButton = target.closest('.image-nav-btn');

    if (isCarousel || isNavButton) {
      // Let the carousel handle its own scrolling, and let nav buttons handle their own clicks
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }

    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    setIsSwipingHorizontally(false);
  };

  const handleTouchMove = (e) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    if (!onNavigate) return;

    const touchCurrentX = e.touches[0].clientX;
    const touchCurrentY = e.touches[0].clientY;
    const deltaX = touchCurrentX - touchStartX.current;
    const deltaY = touchCurrentY - touchStartY.current;

    // Determine if this is a horizontal swipe
    if (!isSwipingHorizontally && Math.abs(deltaX) > 10) {
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        setIsSwipingHorizontally(true);
      }
    }

    // Update swipe offset for visual feedback (only if horizontal swipe)
    if (isSwipingHorizontally || Math.abs(deltaX) > Math.abs(deltaY)) {
      // Cap the offset at +/- 100px for visual feedback
      const cappedOffset = Math.max(-100, Math.min(100, deltaX * 0.5));
      setSwipeOffset(cappedOffset);
    }
  };

  const handleTouchEnd = (e) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    if (!onNavigate) return;

    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const deltaX = touchEndX - touchStartX.current;
    const deltaY = touchEndY - touchStartY.current;

    // Only trigger swipe if horizontal movement is greater than vertical
    // and the swipe distance is significant (> 50px)
    const minSwipeDistance = 50;
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > minSwipeDistance) {
      if (deltaX > 0) {
        // Swiping right = go to previous POI
        // Check if not at the first POI
        if (currentIndex > 0) {
          onNavigate('prev');
        }
      } else {
        // Swiping left = go to next POI
        // Check if not at the last POI
        if (poiNavigationList && currentIndex < poiNavigationList.length - 1) {
          onNavigate('next');
        }
      }
    }

    // Reset swipe state
    touchStartX.current = null;
    touchStartY.current = null;
    setSwipeOffset(0);
    setIsSwipingHorizontally(false);
  };

  // Determine what we're displaying
  const displayItem = linearFeature || destination;
  const isLinearFeature = !!linearFeature;

  // Reset edit state and sidebar tab when selection changes
  useEffect(() => {
    if (displayItem) {
      setEditedData({ ...displayItem });
      // Auto-enter edit mode if admin and editMode is on, or if creating new POI
      const shouldEnterEditMode = (isAdmin && editMode) || isNewPOI;
      setIsEditing(shouldEnterEditMode);
      // Stay on view tab if entering edit mode (EditView only renders on view tab)
      // Otherwise: Status tab if selected from MTB list, Info tab otherwise
      setSidebarTab(shouldEnterEditMode ? 'view' : (selectedFromMtbList ? 'status' : 'view'));
    } else {
      setIsEditing(false);
    }
  }, [displayItem, isAdmin, editMode, isNewPOI, selectedFromMtbList]);

  // Sync editedData coords when previewCoords changes (from map drag) - only for destinations
  useEffect(() => {
    if (previewCoords && isEditing && !isLinearFeature) {
      setEditedData(prev => ({
        ...prev,
        latitude: previewCoords.lat,
        longitude: previewCoords.lng
      }));
    }
  }, [previewCoords, isEditing, isLinearFeature]);

  // Handle new organization creation - treat like creating a new POI
  useEffect(() => {
    if (isNewOrganization && newOrganization) {
      setIsEditing(true);
      setSidebarTab('associations'); // Open to Associations tab
      setEditedData({
        name: newOrganization.name || '',
        brief_description: newOrganization.brief_description || '',
        property_owner: newOrganization.property_owner || '',
        more_info_link: newOrganization.more_info_link || '',
        historical_description: '',
        primary_activities: '',
        surface: '',
        pets: '',
        cell_signal: null
      });
    }
  }, [isNewOrganization, newOrganization]);

  // Auto-resize textareas when entering edit mode or data changes
  useEffect(() => {
    if (isEditing) {
      // Small delay to ensure DOM is updated
      setTimeout(() => {
        const textareas = document.querySelectorAll('.edit-section textarea, .history-tab-content textarea');
        textareas.forEach(textarea => {
          textarea.style.height = 'auto';
          textarea.style.height = textarea.scrollHeight + 'px';
        });
      }, 0);
    }
  }, [isEditing, editedData.brief_description, editedData.historical_description]);

  // Fetch trail status if POI has status_url
  useEffect(() => {
    // Clear any existing status first
    setTrailStatus(null);

    // Don't fetch if no displayItem or no ID
    if (!displayItem || !displayItem.id) {
      return;
    }

    // Don't fetch if no status_url
    if (!displayItem.status_url) {
      return;
    }

    // Fetch the trail status
    fetch(`/api/pois/${displayItem.id}/status`)
      .then(response => {
        if (response.ok) {
          return response.json();
        }
        throw new Error('Failed to fetch status');
      })
      .then(data => {
        setTrailStatus(data);
      })
      .catch(err => {
        console.error('Failed to fetch trail status:', err);
      });
  }, [displayItem?.id, displayItem?.status_url]);

  // Handler for saving new organization
  const handleSaveNewOrganization = async () => {
    if (!editedData.name?.trim()) {
      alert('Please enter a name for the organization');
      return;
    }

    if (selectedPoiIds.size === 0) {
      alert('Please select at least one location to associate');
      return;
    }

    setSaving(true);
    try {
      await onSaveNewOrganization(editedData, Array.from(selectedPoiIds));
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      if (errorMsg.includes('duplicate') || errorMsg.includes('already exists')) {
        alert(`An organization with the name "${editedData.name}" already exists. Please choose a different name.`);
      } else {
        alert('Error creating organization: ' + errorMsg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePoi = (poiId) => {
    setSelectedPoiIds(prev => {
      const next = new Set(prev);
      if (next.has(poiId)) {
        next.delete(poiId);
      } else {
        next.add(poiId);
      }
      return next;
    });
  };

  // Save handler for destinations
  const handleSaveDestination = async () => {
    if (!editedData.name || !editedData.name.trim()) {
      alert('Name is required');
      return;
    }

    // Check for new organization creation
    if (isNewOrganization) {
      await handleSaveNewOrganization();
      return;
    }

    setSaving(true);
    try {
      if (isNewPOI) {
        const poiData = {
          ...editedData,
          latitude: previewCoords?.lat || editedData.latitude,
          longitude: previewCoords?.lng || editedData.longitude
        };
        await onSaveNewPOI(poiData);
      } else {
        // Process pending image first
        if (pendingImage) {
          if (pendingImage.deleted) {
            // Delete the image
            await fetch(`/api/admin/destinations/${destination.id}/image`, {
              method: 'DELETE',
              credentials: 'include'
            });
          } else if (pendingImage.data) {
            // Upload new image
            await fetch(`/api/admin/destinations/${destination.id}/image-base64`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                imageData: pendingImage.data,
                mimeType: pendingImage.mimeType
              })
            });
          }
          setPendingImage(null);
        }

        // Then save other fields
        const response = await fetch(`/api/admin/destinations/${destination.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(editedData)
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to save');
        }

        const updated = await response.json();
        if (onDestinationUpdate) {
          onDestinationUpdate(updated);
        }
        setIsEditing(false);
      }
    } catch (err) {
      alert(`Error saving: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Save handler for linear features
  const handleSaveLinearFeature = async () => {
    if (!editedData.name || !editedData.name.trim()) {
      alert('Name is required');
      return;
    }

    setSaving(true);
    try {
      // Process pending image first
      if (pendingImage) {
        if (pendingImage.deleted) {
          // Delete the image
          await fetch(`/api/admin/linear-features/${linearFeature.id}/image`, {
            method: 'DELETE',
            credentials: 'include'
          });
        } else if (pendingImage.data) {
          // Upload new image
          await fetch(`/api/admin/linear-features/${linearFeature.id}/image-base64`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageData: pendingImage.data,
              mimeType: pendingImage.mimeType
            })
          });
        }
        setPendingImage(null);
      }

      // Exclude geometry from save payload - it's not editable via sidebar
      // and including it makes the request too large
      const { geometry, ...dataWithoutGeometry } = editedData;

      // Then save other fields
      const response = await fetch(`/api/admin/linear-features/${linearFeature.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(dataWithoutGeometry)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save');
      }

      const updated = await response.json();
      if (onLinearFeatureUpdate) {
        onLinearFeatureUpdate(updated);
      }
      setIsEditing(false);
    } catch (err) {
      alert(`Error saving: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setPendingImage(null); // Clear pending image on cancel
    if (isNewPOI && onCancelNewPOI) {
      onCancelNewPOI();
    } else if (isNewOrganization && onCancelNewOrganization) {
      onCancelNewOrganization();
    } else {
      setEditedData({ ...displayItem });
      setIsEditing(false);
    }
  };

  // Delete handler for destinations
  const handleDeleteDestination = async () => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/admin/destinations/${destination.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete');
      }

      if (onDestinationDelete) {
        onDestinationDelete(destination.id);
      }
      onClose();
    } catch (err) {
      alert(`Error deleting: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  // Delete handler for linear features
  const handleDeleteLinearFeature = async () => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/admin/linear-features/${linearFeature.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete');
      }

      if (onLinearFeatureDelete) {
        onLinearFeatureDelete(linearFeature.id);
      }
      onClose();
    } catch (err) {
      alert(`Error deleting: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  // If no POI selected, don't show sidebar
  if (!displayItem) {
    return null;
  }

  // Render linear feature view - use same components as destinations with tabs
  if (isLinearFeature) {
    // Use thumbnail service for faster loading
    // Include updated_at for cache busting when image changes
    const linearImageUrl = linearFeature?.image_mime_type
      ? `/api/pois/${linearFeature.id}/thumbnail?size=medium&v=${linearFeature.updated_at || Date.now()}`
      : null;

    // Get default thumbnail SVG path based on type
    const getLinearDefaultThumbnail = () => {
      if (linearFeature.feature_type === 'river') return '/icons/thumbnails/river.svg';
      if (linearFeature.feature_type === 'boundary') return '/icons/thumbnails/boundary.svg';
      return '/icons/thumbnails/trail.svg';
    };

    return (
      <div
        className={`sidebar open ${isEditing ? 'editing' : ''}`}
        onTouchStart={isMobile && onNavigate ? handleTouchStart : undefined}
        onTouchMove={isMobile && onNavigate ? handleTouchMove : undefined}
        onTouchEnd={isMobile && onNavigate ? handleTouchEnd : undefined}
      >
        {/* Mobile navigation carousel - above header so it doesn't move when title wraps */}
        {isMobile && onNavigate && poiNavigationList && poiNavigationList.length > 0 && (
          <ThumbnailCarousel
            pois={poiNavigationList}
            currentIndex={currentIndex}
            onNavigate={onNavigate}
          />
        )}

        {/* Swipe direction indicators */}
        {swipeOffset > 10 && currentIndex > 0 && (
          <div className="swipe-indicator swipe-indicator-left">
            <span className="swipe-arrow">‹</span>
          </div>
        )}
        {swipeOffset < -10 && poiNavigationList && currentIndex < poiNavigationList.length - 1 && (
          <div className="swipe-indicator swipe-indicator-right">
            <span className="swipe-arrow">›</span>
          </div>
        )}

        <div
          className="sidebar-content-wrapper"
          style={{
            transform: swipeOffset !== 0 ? `translateX(${swipeOffset}px)` : 'none',
            opacity: swipeOffset !== 0 ? Math.max(0.5, 1 - Math.abs(swipeOffset) / 200) : 1,
            transition: swipeOffset === 0 ? 'transform 0.3s ease-out, opacity 0.3s ease-out' : 'none'
          }}
        >
        <div className="sidebar-header">
          <h2 title={linearFeature.name}>{isEditing ? 'Edit: ' : ''}{linearFeature.name}</h2>
          <div className="header-buttons">
            {selectedFromMtbList && mtbTrailsList && mtbTrailsList.length > 1 && (
              <>
                <button
                  type="button"
                  className="mtb-nav-btn prev-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onNavigateMtbTrail('prev');
                  }}
                  title="Previous MTB Trail"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="mtb-nav-btn next-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onNavigateMtbTrail('next');
                  }}
                  title="Next MTB Trail"
                >
                  ›
                </button>
              </>
            )}
            {isInMtbMode && linearFeature && (
              <button
                type="button"
                className="back-to-mtb-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onBackToMtbList();
                }}
                title="Back to MTB Trails"
              >
                ←
              </button>
            )}
            <button className="close-btn" onClick={onClose}>&times;</button>
          </div>
        </div>

        {/* Image - always shown at top for all tabs */}
        {isEditing && linearFeature?.id ? (
          <ImageUploader
            destinationId={linearFeature.id}
            hasImage={!!linearFeature.image_mime_type}
            pendingImage={pendingImage}
            onPendingImageChange={setPendingImage}
            updatedAt={linearFeature.updated_at}
            disabled={saving}
            isVirtualPoi={false}
          />
        ) : (
          <div className="sidebar-image">
            {linearImageUrl ? (
              <img src={linearImageUrl} alt={linearFeature?.name} />
            ) : (
              <img src={getLinearDefaultThumbnail()} alt={linearFeature?.name} className="default-thumbnail" />
            )}
            {/* Navigation chevrons on image - mobile only */}
            {isMobile && onNavigate && poiNavigationList && poiNavigationList.length > 1 && (
              <>
                {currentIndex > 0 && (
                  <button
                    className="image-nav-btn image-nav-prev"
                    onTouchEnd={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      debouncedNavigate('prev');
                    }}
                    onClick={(e) => {
                      // Fallback for desktop/non-touch devices
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    aria-label="Previous POI"
                  >
                    <span className="image-nav-chevron">‹</span>
                  </button>
                )}
                {currentIndex < poiNavigationList.length - 1 && (
                  <button
                    className="image-nav-btn image-nav-next"
                    onTouchEnd={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      debouncedNavigate('next');
                    }}
                    onClick={(e) => {
                      // Fallback for desktop/non-touch devices
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    aria-label="Next POI"
                  >
                    <span className="image-nav-chevron">›</span>
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Sidebar Tabs - same as destinations */}
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab ${sidebarTab === 'view' ? 'active' : ''}`}
            onClick={() => !isEditing && setSidebarTab('view')}
            disabled={isEditing && sidebarTab !== 'view'}
          >
            Info
          </button>
          {linearFeature?.status_url && (
            <button
              className={`sidebar-tab ${sidebarTab === 'status' ? 'active' : ''}`}
              onClick={() => !isEditing && setSidebarTab('status')}
              disabled={isEditing}
            >
              Status
            </button>
          )}
          <button
            className={`sidebar-tab ${sidebarTab === 'news' ? 'active' : ''}`}
            onClick={() => !isEditing && setSidebarTab('news')}
            disabled={isEditing}
          >
            News
          </button>
          <button
            className={`sidebar-tab ${sidebarTab === 'events' ? 'active' : ''}`}
            onClick={() => !isEditing && setSidebarTab('events')}
            disabled={isEditing}
          >
            Events
          </button>
          <button
            className={`sidebar-tab ${sidebarTab === 'history' ? 'active' : ''}`}
            onClick={() => !isEditing && setSidebarTab('history')}
            disabled={isEditing}
          >
            History
          </button>
          <button
            className={`sidebar-tab ${sidebarTab === 'associations' ? 'active' : ''}`}
            onClick={() => !isEditing && setSidebarTab('associations')}
            disabled={isEditing}
          >
            Associations
          </button>
        </div>

        {/* Tab Content */}
        <div className="sidebar-tab-content">
          {sidebarTab === 'view' && (
            isEditing ? (
              <EditView
                destination={linearFeature}
                editedData={editedData}
                setEditedData={setEditedData}
                onSave={handleSaveLinearFeature}
                onCancel={handleCancel}
                onDelete={handleDeleteLinearFeature}
                saving={saving}
                deleting={deleting}
                isNewPOI={false}
                isLinearFeature={true}
                showImage={false}
                onImageUpdate={(hasImage, driveFileId) => {
                  if (onLinearFeatureUpdate) {
                    onLinearFeatureUpdate({
                      ...linearFeature,
                      image_mime_type: hasImage ? 'image/jpeg' : null,
                      image_drive_file_id: driveFileId
                    });
                  }
                }}
              />
            ) : (
              <ReadOnlyView
                destination={linearFeature}
                isLinearFeature={true}
                isAdmin={isAdmin}
                showImage={false}
                onShare={() => setShowShareModal(true)}
                moreInfoLink={linearFeature.more_info_link}
                trailStatus={trailStatus}
                showNpsMap={showNpsMap}
                onToggleNpsMap={onToggleNpsMap}
              />
            )
          )}

          {sidebarTab === 'news' && linearFeature && (
            <PoiNews poiId={linearFeature.id} isAdmin={isAdmin} editMode={editMode} onCountChange={setNewsCount} />
          )}

          {sidebarTab === 'events' && linearFeature && (
            <PoiEvents poiId={linearFeature.id} poiName={linearFeature.name} isAdmin={isAdmin} editMode={editMode} onCountChange={setEventsCount} />
          )}

          {sidebarTab === 'status' && linearFeature && linearFeature.status_url && (
            <TrailStatus poiId={linearFeature.id} poiName={linearFeature.name} isAdmin={isAdmin} editMode={editMode} selectedFromMtbList={selectedFromMtbList} onBackToMtbList={onBackToMtbList} />
          )}

          {sidebarTab === 'history' && linearFeature && (
            <div className="history-tab-content">
              {isEditing ? (
                <div className="edit-section">
                  <label>Historical Description</label>
                  <textarea
                    value={editedData.historical_description || ''}
                    onChange={(e) => {
                      setEditedData(prev => ({ ...prev, historical_description: e.target.value }));
                      e.target.style.height = 'auto';
                      e.target.style.height = e.target.scrollHeight + 'px';
                    }}
                    style={{ overflow: 'hidden', resize: 'none' }}
                    placeholder="Detailed historical significance..."
                    onInput={(e) => {
                      e.target.style.height = 'auto';
                      e.target.style.height = e.target.scrollHeight + 'px';
                    }}
                  />
                </div>
              ) : linearFeature.historical_description ? (
                <div className="section">
                  <h3>Historical Significance</h3>
                  <p className="historical-description">{linearFeature.historical_description}</p>
                </div>
              ) : (
                <div className="sidebar-tab-empty">No historical information available for this location.</div>
              )}
            </div>
          )}

          {sidebarTab === 'associations' && linearFeature && associations && (
            <AssociationsTabContent
              poi={linearFeature}
              associations={associations}
              allDestinations={allDestinations}
              allLinearFeatures={allLinearFeatures}
              allVirtualPois={allVirtualPois}
              onSelectDestination={handleSelectDestinationFromAssociations}
              onSelectLinearFeature={handleSelectLinearFeatureFromAssociations}
              isAdmin={isAdmin}
              editMode={editMode}
              onAssociationsChanged={onAssociationsChanged}
              onStartDrawingAssociations={onStartDrawingAssociations}
            />
          )}
        </div>
        </div> {/* End sidebar-content-wrapper */}

        <ShareModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          poiName={linearFeature.name}
          poiDescription={linearFeature.brief_description}
        />

        <AssociationsModal
          isOpen={showAssociationsModal}
          onClose={() => setShowAssociationsModal(false)}
          poi={linearFeature}
          associations={associations}
          allDestinations={allDestinations}
          allLinearFeatures={allLinearFeatures}
          allVirtualPois={allVirtualPois}
          onSelectDestination={onSelectDestination}
          onSelectLinearFeature={onSelectLinearFeature}
          isAdmin={isAdmin}
          editMode={editMode}
          onAssociationsChanged={onAssociationsChanged}
        />
      </div>
    );
  }

  // Use thumbnail service for faster loading
  // Include updated_at for cache busting when image changes
  const imageUrl = destination?.image_mime_type
    ? `/api/pois/${destination.id}/thumbnail?size=medium&v=${destination.updated_at || Date.now()}`
    : null;

  // Render destination view with tabs
  return (
    <div
      className={`sidebar ${destination ? 'open' : ''} ${isEditing ? 'editing' : ''}`}
      onTouchStart={isMobile && onNavigate ? handleTouchStart : undefined}
      onTouchMove={isMobile && onNavigate ? handleTouchMove : undefined}
      onTouchEnd={isMobile && onNavigate ? handleTouchEnd : undefined}
    >
      {/* Mobile navigation carousel - above header so it doesn't move when title wraps */}
      {isMobile && onNavigate && poiNavigationList && poiNavigationList.length > 0 && (
        <ThumbnailCarousel
          pois={poiNavigationList}
          currentIndex={currentIndex}
          onNavigate={onNavigate}
        />
      )}

      {/* Swipe direction indicators */}
      {swipeOffset > 10 && currentIndex > 0 && (
        <div className="swipe-indicator swipe-indicator-left">
          <span className="swipe-arrow">‹</span>
        </div>
      )}
      {swipeOffset < -10 && poiNavigationList && currentIndex < poiNavigationList.length - 1 && (
        <div className="swipe-indicator swipe-indicator-right">
          <span className="swipe-arrow">›</span>
        </div>
      )}

      <div
        className="sidebar-content-wrapper"
        style={{
          transform: swipeOffset !== 0 ? `translateX(${swipeOffset}px)` : 'none',
          opacity: swipeOffset !== 0 ? Math.max(0.5, 1 - Math.abs(swipeOffset) / 200) : 1,
          transition: swipeOffset === 0 ? 'transform 0.3s ease-out, opacity 0.3s ease-out' : 'none'
        }}
      >
      <div className="sidebar-header">
        <h2 title={destination?.name || 'Location Details'}>
          {isNewOrganization ? 'Create Organization' : (isEditing ? 'Edit: ' : '')}{!isNewOrganization && (destination?.name || 'Location Details')}
        </h2>
        <div className="header-buttons">
          {selectedFromMtbList && mtbTrailsList && mtbTrailsList.length > 1 && (
            <>
              <button
                type="button"
                className="mtb-nav-btn prev-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onNavigateMtbTrail('prev');
                }}
                title="Previous MTB Trail"
              >
                ‹
              </button>
              <button
                type="button"
                className="mtb-nav-btn next-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onNavigateMtbTrail('next');
                }}
                title="Next MTB Trail"
              >
                ›
              </button>
            </>
          )}
          {isInMtbMode && !isNewPOI && !isNewOrganization && destination && (
            <button
              type="button"
              className="back-to-mtb-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onBackToMtbList();
              }}
              title="Back to MTB Trails"
            >
              ← MTB Trails
            </button>
          )}
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
      </div>

      {/* Image - always shown at top for all tabs */}
      {isEditing && destination?.id ? (
        <ImageUploader
          destinationId={destination.id}
          hasImage={!!destination.image_mime_type}
          pendingImage={pendingImage}
          onPendingImageChange={setPendingImage}
          updatedAt={destination.updated_at}
          disabled={saving}
          isVirtualPoi={destination?.poi_type === 'virtual'}
        />
      ) : (
        <div className={`sidebar-image ${destination?.poi_type === 'virtual' ? 'virtual-thumbnail' : ''}`}>
          {imageUrl ? (
            <img src={imageUrl} alt={destination?.name} className={destination?.poi_type === 'virtual' ? 'logo-image' : ''} />
          ) : (
            <img src="/icons/thumbnails/destination.svg" alt={destination?.name} className="default-thumbnail" />
          )}
          {/* Navigation chevrons on image - mobile only */}
          {isMobile && onNavigate && poiNavigationList && poiNavigationList.length > 1 && (
            <>
              {currentIndex > 0 && (
                <button
                  className="image-nav-btn image-nav-prev"
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    debouncedNavigate('prev');
                  }}
                  onClick={(e) => {
                    // Fallback for desktop/non-touch devices
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  aria-label="Previous POI"
                >
                  <span className="image-nav-chevron">‹</span>
                </button>
              )}
              {currentIndex < poiNavigationList.length - 1 && (
                <button
                  className="image-nav-btn image-nav-next"
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    debouncedNavigate('next');
                  }}
                  onClick={(e) => {
                    // Fallback for desktop/non-touch devices
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  aria-label="Next POI"
                >
                  <span className="image-nav-chevron">›</span>
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Sidebar Tabs - always shown */}
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${sidebarTab === 'view' ? 'active' : ''}`}
          onClick={() => !isEditing && setSidebarTab('view')}
          disabled={isEditing && sidebarTab !== 'view'}
        >
          Info
        </button>
        {destination?.status_url && (
          <button
            className={`sidebar-tab ${sidebarTab === 'status' ? 'active' : ''}`}
            onClick={() => !isEditing && setSidebarTab('status')}
            disabled={isEditing}
          >
            Status
          </button>
        )}
        <button
          className={`sidebar-tab ${sidebarTab === 'news' ? 'active' : ''}`}
          onClick={() => !isEditing && setSidebarTab('news')}
          disabled={isEditing}
        >
          News
        </button>
        <button
          className={`sidebar-tab ${sidebarTab === 'events' ? 'active' : ''}`}
          onClick={() => !isEditing && setSidebarTab('events')}
          disabled={isEditing}
        >
          Events
        </button>
        <button
          className={`sidebar-tab ${sidebarTab === 'history' ? 'active' : ''}`}
          onClick={() => !isEditing && setSidebarTab('history')}
          disabled={isEditing}
        >
          History
        </button>
        <button
          className={`sidebar-tab ${sidebarTab === 'associations' ? 'active' : ''}`}
          onClick={() => !isEditing && setSidebarTab('associations')}
          disabled={isEditing}
        >
          Associations
        </button>
      </div>

      {/* Tab Content */}
      <div className="sidebar-tab-content">
        {sidebarTab === 'view' && (
          isEditing ? (
            <EditView
              destination={destination}
              editedData={editedData}
              setEditedData={setEditedData}
              onSave={handleSaveDestination}
              onCancel={handleCancel}
              onDelete={handleDeleteDestination}
              saving={saving}
              deleting={deleting}
              onPreviewCoordsChange={onPreviewCoordsChange}
              isNewPOI={isNewPOI}
              isNewOrganization={isNewOrganization}
              showImage={false}
              onImageUpdate={(hasImage, driveFileId) => {
                if (onDestinationUpdate) {
                  onDestinationUpdate({
                    ...destination,
                    image_mime_type: hasImage ? 'image/jpeg' : null,
                    image_drive_file_id: driveFileId
                  });
                }
              }}
            />
          ) : (
            <ReadOnlyView
              destination={destination}
              isAdmin={isAdmin}
              showImage={false}
              onShare={() => setShowShareModal(true)}
              moreInfoLink={destination.more_info_link}
              trailStatus={trailStatus}
              showNpsMap={showNpsMap}
              onToggleNpsMap={onToggleNpsMap}
            />
          )
        )}

        {sidebarTab === 'news' && destination && (
          <PoiNews poiId={destination.id} isAdmin={isAdmin} editMode={editMode} onCountChange={setNewsCount} />
        )}

        {sidebarTab === 'events' && destination && (
          <PoiEvents poiId={destination.id} poiName={destination.name} isAdmin={isAdmin} editMode={editMode} onCountChange={setEventsCount} />
        )}

        {sidebarTab === 'status' && destination && destination.status_url && (
          <TrailStatus poiId={destination.id} poiName={destination.name} isAdmin={isAdmin} editMode={editMode} selectedFromMtbList={selectedFromMtbList} onBackToMtbList={onBackToMtbList} />
        )}

        {sidebarTab === 'history' && destination && (
          <div className="history-tab-content">
            {isEditing ? (
              <div className="edit-section">
                <label>Historical Description</label>
                <textarea
                  value={editedData.historical_description || ''}
                  onChange={(e) => {
                    setEditedData(prev => ({ ...prev, historical_description: e.target.value }));
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  style={{ overflow: 'hidden', resize: 'none' }}
                  placeholder="Detailed historical significance..."
                  onInput={(e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                />
              </div>
            ) : destination.historical_description ? (
              <div className="section">
                <h3>Historical Significance</h3>
                <p className="historical-description">{destination.historical_description}</p>
              </div>
            ) : (
              <div className="sidebar-tab-empty">No historical information available for this location.</div>
            )}
          </div>
        )}

        {sidebarTab === 'associations' && destination && (
          isNewOrganization && newOrganization ? (
            // New organization - show POI selection interface matching existing associations style
            <div className="associations-tab-content" style={{ padding: '1rem' }}>
              <h3 style={{ marginBottom: '1rem' }}>Associated Locations ({selectedPoiIds.size})</h3>

              {selectedPoiIds.size > 0 ? (
                <div className="associations-list">
                  {(newOrganization._poisInBounds || [])
                    .filter(poi => selectedPoiIds.has(poi.id))
                    .map(poi => (
                      <div key={poi.id} className="association-item">
                        <div className="association-item-clickable">
                          <div className={`association-item-badge ${poi._type === 'point' ? 'destination' : poi._type}`}>
                            {poi._type === 'point' ? 'D' :
                             poi._type === 'river' ? 'R' :
                             poi._type === 'boundary' ? 'B' : 'T'}
                          </div>
                          <div className="association-item-content">
                            <div className="association-item-name">{poi.name}</div>
                            {poi.brief_description && (
                              <div className="association-item-description">{poi.brief_description}</div>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleTogglePoi(poi.id)}
                          className="btn-delete-association"
                          title="Remove from organization"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="sidebar-tab-empty">
                  No locations found in the selected area that match your active filters.
                </div>
              )}
            </div>
          ) : associations ? (
            // Existing POI - show normal associations
            <AssociationsTabContent
              poi={destination}
              associations={associations}
              allDestinations={allDestinations}
              allLinearFeatures={allLinearFeatures}
              allVirtualPois={allVirtualPois}
              onSelectDestination={handleSelectDestinationFromAssociations}
              onSelectLinearFeature={handleSelectLinearFeatureFromAssociations}
              isAdmin={isAdmin}
              editMode={editMode}
              onAssociationsChanged={onAssociationsChanged}
              onStartDrawingAssociations={onStartDrawingAssociations}
            />
          ) : null
        )}
      </div>
      </div> {/* End sidebar-content-wrapper */}

      <ShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        poiName={destination?.name || ''}
        poiDescription={destination?.brief_description}
      />

      <AssociationsModal
        isOpen={showAssociationsModal}
        onClose={() => setShowAssociationsModal(false)}
        poi={destination}
        associations={associations}
        allDestinations={allDestinations}
        allLinearFeatures={allLinearFeatures}
        allVirtualPois={allVirtualPois}
        onSelectDestination={onSelectDestination}
        onSelectLinearFeature={onSelectLinearFeature}
        isAdmin={isAdmin}
        editMode={editMode}
        onAssociationsChanged={onAssociationsChanged}
      />
    </div>
  );
}

export default Sidebar;
