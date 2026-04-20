import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ImageUploader from './ImageUploader';
import ThumbnailCarousel from './ThumbnailCarousel';
import { formatDateTime, formatPublicationDate } from './NewsEventsShared';
import Mosaic from './Mosaic';
import MediaUploadModal from './MediaUploadModal';

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
    } catch {
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
function ReadOnlyView({ destination, isLinearFeature, isAdmin, editMode, onShare, moreInfoLink, trailStatus = null, _showNpsMap, _onToggleNpsMap, onCollectStatus }) {
  return (
    <div className="view-container">
      <div className="view-scroll">

        <div className="sidebar-content">
        <div className="badges-row">
          {/* POI type badge - shows for all POI types */}
          {isLinearFeature ? (
            <span className={`poi-type-badge ${destination.feature_type}`}>
              {destination.feature_type === 'river' ? 'River' :
               destination.feature_type === 'boundary' ? 'Boundary' : 'Trail'}
            </span>
          ) : destination.poi_roles?.includes('organization') ? (
            <span className="poi-type-badge virtual">
              Organization
            </span>
          ) : destination.poi_roles?.includes('point') && destination.status_url ? (
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
          {destination.era_name && !destination.poi_roles?.includes('organization') && (
            <span className="era-badge-large">{destination.era_name}</span>
          )}
          {(destination.owner_name || destination.property_owner) && !destination.poi_roles?.includes('organization') && (
            <span className={`owner-badge ${getOwnerClass(destination.owner_name || destination.property_owner)}`}>
              {destination.owner_name || destination.property_owner}
            </span>
          )}
          {destination.status_url && trailStatus && trailStatus.status !== 'unknown' && (
            <span className={`trail-status-badge status-${trailStatus.status}`}>
              {trailStatus.status === 'open' ? 'Open' :
               trailStatus.status === 'closed' ? 'Closed' :
               trailStatus.status === 'limited' ? 'Limited' :
               trailStatus.status === 'maintenance' ? 'Maintenance' : 'Unknown'}
            </span>
          )}
          {destination.status_url && trailStatus && trailStatus.source_url && (
            <a href={trailStatus.source_url} target="_blank" rel="noopener noreferrer" className="trail-status-badge source">
              Source
            </a>
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
        </div>

        {/* Trail Status section - matches Overview section styling */}
        {destination.status_url && trailStatus && trailStatus.status !== 'unknown' && (trailStatus.conditions || trailStatus.weather_impact || trailStatus.seasonal_closure || trailStatus.last_updated) && (
          <div className="section">
            <h3>Trail Status {isAdmin && editMode && onCollectStatus && (
              <button className="collect-status-inline-btn" onClick={onCollectStatus} title="Refresh trail status">
                Refresh
              </button>
            )}</h3>
            {trailStatus.conditions && (
              <p className="trail-status-detail">{trailStatus.conditions}</p>
            )}
            {trailStatus.weather_impact && (
              <p className="trail-status-detail">{trailStatus.weather_impact}</p>
            )}
            {trailStatus.seasonal_closure && (
              <p className="trail-status-detail trail-status-seasonal">Seasonal Closure in Effect</p>
            )}
            {trailStatus.last_updated && (
              <p className="trail-status-updated">Updated: {formatDateTime(trailStatus.last_updated)}</p>
            )}
          </div>
        )}

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
function EditView({ destination, editedData, setEditedData, onSave, onCancel, onDelete, saving, deleting, onPreviewCoordsChange, isNewPOI, isNewOrganization, _onImageUpdate, isLinearFeature, showImage }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [aiError, setAiError] = useState(null);

  // Research state
  const [researching, setResearching] = useState(false);

  // Draft approval modal state (multi-pass research v2)
  const [researchDraft, setResearchDraft] = useState(null);
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [draftFieldStates, setDraftFieldStates] = useState({});

  // Pending image state (staging area for image uploads until save)
  const [pendingImage, setPendingImage] = useState(null);

  // User state for admin checks
  const [user, setUser] = useState(null);

  // Check authentication status
  useEffect(() => {
    fetch('/api/auth/status', { credentials: 'include' })
      .then(res => res.ok ? res.json() : null)
      .then(data => setUser(data?.user || null))
      .catch(() => setUser(null));
  }, []);

  // Callback for media updates from ImageUploader (no-op, just for consistency)
  const handleMediaUpdate = () => {
    // In edit mode, media updates will be handled by the parent refresh
    // This is just a placeholder for the ImageUploader interface
  };

  // Handle save with pending image processing
  const handleSaveWithImage = async () => {
    if (!destination?.id) {
      // For new POIs, just call parent save (image will be handled separately)
      await onSave();
      return;
    }

    try {
      // Handle pending image if exists
      if (pendingImage) {
        if (pendingImage.deleted) {
          // Delete the image
          await fetch(`/api/admin/pois/${destination.id}/image`, {
            method: 'DELETE',
            credentials: 'include'
          });
        } else if (pendingImage.data) {
          // Upload new image - always use base64 endpoint for simplicity
          const endpoint = `/api/admin/pois/${destination.id}/image-base64`;
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

  // Research with AI v2 - multi-pass with draft approval
  const handleResearch = async () => {
    setResearching(true);
    setAiError(null);

    try {
      const response = await fetch('/api/admin/ai/research-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          destination: editedData,
          adminContext: editedData.research_context || ''
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Research failed');
      }

      const result = await response.json();

      // Show draft modal for approval instead of directly applying
      setResearchDraft(result.data);
      // Initialize all fields as accepted by default
      const fields = ['era_id', 'property_owner', 'primary_activities', 'surface', 'pets', 'brief_description', 'historical_description'];
      const initialStates = {};
      for (const field of fields) {
        initialStates[field] = result.data[field] != null;
      }
      setDraftFieldStates(initialStates);
      setShowDraftModal(true);

    } catch (err) {
      setAiError(err.message);
    } finally {
      setResearching(false);
    }
  };

  // Accept research draft — apply selected fields to editedData, optionally save hero image
  const handleAcceptDraft = async () => {
    const updates = {};
    if (draftFieldStates.era_id && researchDraft.era_id) updates.era_id = researchDraft.era_id;
    if (draftFieldStates.property_owner && researchDraft.property_owner) updates.property_owner = researchDraft.property_owner;
    if (draftFieldStates.primary_activities && researchDraft.primary_activities) updates.primary_activities = researchDraft.primary_activities;
    if (draftFieldStates.surface && researchDraft.surface) updates.surface = researchDraft.surface;
    if (draftFieldStates.pets && researchDraft.pets) updates.pets = researchDraft.pets;
    if (draftFieldStates.brief_description && researchDraft.brief_description) updates.brief_description = researchDraft.brief_description;
    if (draftFieldStates.historical_description && researchDraft.historical_description) updates.historical_description = researchDraft.historical_description;

    setEditedData(prev => ({ ...prev, ...updates }));

    setShowDraftModal(false);
    setResearchDraft(null);
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
            hasImage={!!editedData.has_primary_image}
            pendingImage={pendingImage}
            onPendingImageChange={setPendingImage}
            updatedAt={editedData.updated_at}
            disabled={saving}
            isVirtualPoi={destination?.poi_roles?.includes('organization') && !destination?.geometry && !destination?.latitude}
            user={user}
            poiId={destination.id}
            onMediaUpdate={handleMediaUpdate}
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

      {/* Research with AI — top of Info tab, right under image */}
      <div className="research-section">
        <button
          className="research-btn"
          onClick={handleResearch}
          disabled={researching || !editedData.name}
          title={!editedData.name ? 'Enter a name first' : 'Research this location and fill all fields'}
        >
          {researching ? 'Researching...' : 'Research with AI'}
        </button>
        <span className="research-hint">Multi-pass research with draft approval</span>
      </div>

      <div className="edit-section">
        <label>Research Context <span className="field-hint">(optional notes for AI)</span></label>
        <textarea
          value={editedData.research_context || ''}
          onChange={(e) => handleChange('research_context', e.target.value)}
          placeholder="Add context to guide AI research (e.g., 'This is a historic gristmill built in 1810, focus on canal era connections')"
          rows={2}
          style={{ resize: 'vertical' }}
        />
      </div>

      <div className="edit-section">
        <label>Name *</label>
        <input
          type="text"
          value={editedData.name || ''}
          onChange={(e) => handleChange('name', e.target.value)}
          placeholder="Enter POI name..."
        />
      </div>

      <div className="edit-section">
        <label>Overview</label>
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
      {!isNewOrganization && !destination?.poi_roles?.includes('organization') && (
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
      {!isLinearFeature && !destination?.poi_roles?.includes('organization') && (
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
          <button className="save-btn" onClick={handleSaveWithImage} disabled={saving || deleting || researching}>
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

      {/* Draft Approval Modal — multi-pass research results */}
      {showDraftModal && researchDraft && (
        <div className="prompt-editor-overlay" onClick={() => { setShowDraftModal(false); setResearchDraft(null); }}>
          <div className="draft-approval-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="prompt-editor-header">
              <h3>Research Draft</h3>
              <button className="close-btn" onClick={() => { setShowDraftModal(false); setResearchDraft(null); }}>&times;</button>
            </div>
            <p className="prompt-editor-hint">Review AI research results. Toggle fields to accept or skip.</p>

            <div className="draft-fields">
              {[
                { key: 'era_id', label: 'Era', display: researchDraft.era, short: true },
                { key: 'property_owner', label: 'Property Owner', display: researchDraft.property_owner, short: true },
                { key: 'primary_activities', label: 'Activities', display: researchDraft.primary_activities, short: true },
                { key: 'surface', label: 'Surface', display: researchDraft.surface, short: true },
                { key: 'pets', label: 'Pets', display: researchDraft.pets, short: true },
                { key: 'brief_description', label: 'Brief Description', display: researchDraft.brief_description },
                { key: 'historical_description', label: 'Historical Description', display: researchDraft.historical_description },
              ].filter(f => f.display != null).map(field => (
                <div key={field.key} className={`draft-field ${draftFieldStates[field.key] ? 'accepted' : 'rejected'}`}>
                  <div className="draft-field-header">
                    <label>
                      <input
                        type="checkbox"
                        checked={draftFieldStates[field.key] || false}
                        onChange={(e) => setDraftFieldStates(prev => ({ ...prev, [field.key]: e.target.checked }))}
                      />
                      {field.label}
                    </label>
                  </div>
                  {field.short ? (
                    <input
                      type="text"
                      className="draft-field-input"
                      value={researchDraft[field.key === 'era_id' ? 'era' : field.key] || ''}
                      onChange={(e) => {
                        const dataKey = field.key === 'era_id' ? 'era' : field.key;
                        setResearchDraft(prev => ({ ...prev, [dataKey]: e.target.value }));
                      }}
                    />
                  ) : (
                    <textarea
                      className="draft-field-textarea"
                      value={researchDraft[field.key] || ''}
                      onChange={(e) => setResearchDraft(prev => ({ ...prev, [field.key]: e.target.value }))}
                      rows={field.key === 'historical_description' ? 8 : 4}
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="prompt-editor-buttons">
              <button className="reject-btn" onClick={() => { setShowDraftModal(false); setResearchDraft(null); }}>
                Reject
              </button>
              <button className="research-btn" onClick={handleAcceptDraft}>
                Accept
              </button>
            </div>

            {researchDraft.sources && researchDraft.sources.length > 0 && (
              <div className="draft-sources">
                <strong>Sources:</strong>
                <ul>
                  {researchDraft.sources.map((source, i) => (
                    <li key={i}>
                      {source.startsWith('http') ? (
                        <a href={source} target="_blank" rel="noopener noreferrer">{source}</a>
                      ) : source}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

// POI-specific News component
function PoiNews({ poiId, isAdmin, editMode, onCountChange }) {
  const navigate = useNavigate();
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [collecting, setCollecting] = useState(false);

  const fetchNews = async () => {
    if (!poiId) {
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/pois/${poiId}/news?limit=50`);
      if (response.ok) {
        const data = await response.json();
        setNews(data);
        if (onCountChange) onCountChange(data.length);
      } else {
        console.error(`[fetchNews] Request failed: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      console.error('[fetchNews] Error fetching POI news:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poiId]);

  // Collect news for this POI and redirect to Jobs dashboard
  const handleCollectNews = async () => {
    if (!poiId) return;
    setCollecting(true);

    try {
      const timezone = localStorage.getItem('app-timezone') || 'America/New_York';
      const response = await fetch(`/api/admin/pois/${poiId}/news/collect`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone })
      });

      if (response.ok) {
        const result = await response.json();
        const targetUrl = `/admin/jobs?job=${result.jobId}&type=${result.jobType}&poi=${result.poiId || result.jobId}`;
        // Redirect to Jobs dashboard with job identifier
        navigate(targetUrl);
      } else {
        const error = await response.json();
        alert(`Collection failed: ${error.error || 'Unknown error'}`);
        setCollecting(false);
      }
    } catch (err) {
      alert(`Collection failed: ${err.message}`);
      setCollecting(false);
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
          {item.publication_date && (
            <div className="poi-event-date">
              {formatPublicationDate(item.publication_date)}
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
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [collecting, setCollecting] = useState(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poiId]);

  // Collect events for this POI and redirect to Jobs dashboard
  const handleCollectEvents = async () => {
    if (!poiId) return;
    setCollecting(true);

    try {
      const timezone = localStorage.getItem('app-timezone') || 'America/New_York';
      const response = await fetch(`/api/admin/pois/${poiId}/events/collect`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone })
      });

      if (response.ok) {
        const result = await response.json();
        const targetUrl = `/admin/jobs?job=${result.jobId}&type=${result.jobType}&poi=${result.poiId || result.jobId}`;
        // Redirect to Jobs dashboard with job identifier
        navigate(targetUrl);
      } else {
        const error = await response.json();
        alert(`Collection failed: ${error.error || 'Unknown error'}`);
        setCollecting(false);
      }
    } catch (err) {
      alert(`Collection failed: ${err.message}`);
      setCollecting(false);
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
            {formatPublicationDate(item.start_date)}
            {item.end_date && item.end_date !== item.start_date && (
              <> - {formatPublicationDate(item.end_date)}</>
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

  // Get available POIs for adding (must be before early return to satisfy Rules of Hooks)
  const availablePois = useMemo(() => {
    if (!isOpen || !poi) return [];

    const isVirtualPoi = poi.poi_roles?.includes('organization');
    if (!isVirtualPoi) return [];

    // Find associations for this POI
    const poiAssociations = (associations || []).filter(assoc =>
      assoc.virtual_poi_id === poi.id || assoc.physical_poi_id === poi.id
    );

    // Calculate currently associated POI IDs
    const currentIds = new Set();

    // Add associated POIs from associations
    poiAssociations.forEach(assoc => {
      if (isVirtualPoi) {
        currentIds.add(assoc.physical_poi_id);
      } else {
        currentIds.add(assoc.virtual_poi_id);
      }
    });

    // Add owned POIs
    (allDestinations || []).forEach(d => {
      if (Number(d.owner_id) === Number(poi.id)) {
        currentIds.add(d.id);
      }
    });
    (allLinearFeatures || []).forEach(f => {
      if (Number(f.owner_id) === Number(poi.id)) {
        currentIds.add(f.id);
      }
    });

    // Add owner org (if this POI is owned by someone)
    if (poi.owner_id) {
      currentIds.add(Number(poi.owner_id));
    }

    const allPhysicalPois = [
      ...(allDestinations || []).map(d => ({ ...d, _type: 'point' })),
      ...(allLinearFeatures || []).map(f => ({ ...f, _type: f.feature_type || 'trail' }))
    ];

    return allPhysicalPois.filter(p => !currentIds.has(p.id));
  }, [isOpen, poi, associations, allDestinations, allLinearFeatures]);

  if (!isOpen || !poi) return null;

  // Find associations for this POI
  const poiAssociations = associations.filter(assoc =>
    assoc.virtual_poi_id === poi.id || assoc.physical_poi_id === poi.id
  );

  // Determine if this is an organization POI
  const isVirtualPoi = poi.poi_roles?.includes('organization');

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
                const imageUrl = associatedPoi.has_primary_image
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
                          <img
                            src={imageUrl}
                            alt={associatedPoi.name}
                            loading="lazy"
                            className={associatedPoi._isVirtual ? 'logo-image' : ''}
                            onError={(e) => {
                              e.target.src = getDefaultThumbnail();
                              e.target.className = 'default-thumbnail';
                            }}
                          />
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

  // Determine if this is an organization POI
  const isVirtualPoi = poi.poi_roles?.includes('organization');

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
  const ownedPois = useMemo(() => {
    return isVirtualPoi
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
  }, [isVirtualPoi, poi.id, allDestinations, allLinearFeatures]);

  // Combine: owner first (for physical POIs), owned POIs first (for virtual POIs), then regular associations
  const associatedPoisWithAssocId = useMemo(() => [
    ...(ownerOrg ? [{ ...ownerOrg, _isVirtual: true, _isLinear: false, _isOwner: true }] : []),
    ...ownedPois.filter(p => !regularAssociations.some(a => a.id === p.id)),
    ...regularAssociations.filter(a => (!ownerOrg || a.id !== ownerOrg.id) && !ownedPois.some(p => p.id === a.id))
  ], [ownerOrg, ownedPois, regularAssociations]);

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
              const imageUrl = associatedPoi.has_primary_image
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
                        <img
                          src={imageUrl}
                          alt={associatedPoi.name}
                          loading="lazy"
                          className={associatedPoi._isVirtual ? 'logo-image' : ''}
                          onError={(e) => {
                            e.target.src = getDefaultThumbnail();
                            e.target.className = 'default-thumbnail';
                          }}
                        />
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
function TrailStatus({ poiId, _poiName, isAdmin, editMode, _selectedFromMtbList, _onBackToMtbList }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);

  const fetchStatus = async () => {
    if (!poiId) {
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/pois/${poiId}/status`);
      if (response.ok) {
        const data = await response.json();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poiId]); // fetchStatus intentionally excluded to avoid re-fetching on function reference changes

  const handleCollect = async () => {
    if (!poiId) return;
    setCollecting(true);

    try {
      const response = await fetch(`/api/admin/pois/${poiId}/status/collect`, {
        method: 'POST',
        credentials: 'include'
      });

      if (response.ok) {
        await response.json(); // Result not used

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
          <div className="status-badges-row">
            <div className="status-badge">{(status.status || 'unknown').toUpperCase()}</div>
            {status.source_url && (
              <a
                href={status.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="source-badge"
              >
                SOURCE
              </a>
            )}
          </div>

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
              Use the &quot;Collect Status&quot; button above to gather current trail conditions.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Sidebar({ destination, isNewPOI, newOrganization, isNewOrganization, onClose, isAdmin, user, editMode, onDestinationUpdate, onDestinationDelete, onSaveNewPOI, onCancelNewPOI, onSaveNewOrganization, onCancelNewOrganization, previewCoords, onPreviewCoordsChange, linearFeature, onLinearFeatureUpdate, onLinearFeatureDelete, onNavigate, currentIndex, totalCount, poiNavigationList, associations, allDestinations, allLinearFeatures, allVirtualPois, onSelectDestination, onSelectLinearFeature, onAssociationsChanged, onStartDrawingAssociations, isInMtbMode, selectedFromMtbList, mtbTrailsList, currentMtbIndex, onNavigateMtbTrail, onBackToMtbList, showNpsMap, onToggleNpsMap }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('view');
  const [showShareModal, setShowShareModal] = useState(false);
  const [showAssociationsModal, setShowAssociationsModal] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [pendingImage, setPendingImage] = useState(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [, setNewsCount] = useState(0);
  const [, setEventsCount] = useState(0);
  const [, setCollectResult] = useState(null);
  const [trailStatus, setTrailStatus] = useState(null);

  /* const [organizationData, setOrganizationData] = useState({
    name: '',
    brief_description: '',
    property_owner: '',
    more_info_link: ''
  }); */
  const [selectedPoiIds, setSelectedPoiIds] = useState(new Set());

  // Initialize organization data when newOrganization changes
  useEffect(() => {
    if (newOrganization) {
      setSelectedPoiIds(newOrganization._selectedPoiIds || new Set());
    }
  }, [newOrganization]);

  // Media state for top-level image/mosaic display
  const [media, setMedia] = useState([]);
  const [allMedia, setAllMedia] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);

  // Fetch media for destination/linear feature
  useEffect(() => {
    const poiId = destination?.id || linearFeature?.id;
    if (!poiId) return;

    setMediaLoading(true);
    fetch(`/api/pois/${poiId}/media`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : { mosaic: [], all_media: [] })
      .then(data => {
        setMedia(data.mosaic || []);
        setAllMedia(data.all_media || []);
        setMediaLoading(false);
      })
      .catch(err => {
        console.error('Failed to load media:', err);
        setMedia([]);
        setAllMedia([]);
        setMediaLoading(false);
      });
  }, [destination?.id, linearFeature?.id]);

  // Listen for media updates from moderation queue
  useEffect(() => {
    const poiId = destination?.id || linearFeature?.id;
    if (!poiId) return;

    const handleMediaUpdateEvent = (event) => {
      if (event.detail.poiId === poiId) {
        console.log('[Sidebar] POI media updated for', poiId, '- refreshing...');
        // Refresh media list
        fetch(`/api/pois/${poiId}/media`, { credentials: 'include' })
          .then(res => res.json())
          .then(data => {
            setMedia(data.mosaic || []);
            setAllMedia(data.all_media || []);
          })
          .catch(err => console.error('[Sidebar] Failed to refresh media:', err));

        // Refresh POI data to update has_primary_image flag
        fetch(`/api/pois/${poiId}`, { credentials: 'include' })
          .then(res => res.json())
          .then(data => {
            if (destination && onDestinationUpdate) {
              onDestinationUpdate(data);
            }
          })
          .catch(err => console.error('[Sidebar] Failed to refresh POI:', err));
      }
    };

    window.addEventListener('poi-media-updated', handleMediaUpdateEvent);
    return () => window.removeEventListener('poi-media-updated', handleMediaUpdateEvent);
  }, [destination?.id, linearFeature?.id]);

  // Callback for media updates from ImageUploader or Mosaic
  const handleMediaUpdate = () => {
    // Refresh media after upload
    const poiId = destination?.id || linearFeature?.id;
    if (!poiId) return;

    // Refresh media list
    fetch(`/api/pois/${poiId}/media`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        setMedia(data.mosaic || []);
        setAllMedia(data.all_media || []);
      })
      .catch(err => console.error('Failed to refresh media:', err));

    // Refresh POI data to update has_primary_image flag
    if (destination && onDestinationUpdate) {
      fetch(`/api/pois/${poiId}`, { credentials: 'include' })
        .then(res => res.json())
        .then(data => onDestinationUpdate(data))
        .catch(err => console.error('Failed to refresh POI:', err));
    }

    // Emit event to refresh moderation count (photo uploads go to pending)
    window.dispatchEvent(new CustomEvent('moderation-count-changed'));
  };

  // Determine which POI we're showing
  const activePoi = destination || linearFeature;

  // Check if this POI has associations
  /* const hasAssociations = activePoi && associations?.some(assoc =>
    assoc.virtual_poi_id === activePoi.id || assoc.physical_poi_id === activePoi.id
  ); */

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
      // Stay on view tab — trail status is now shown inline on the Info tab
      setSidebarTab('view');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayItem?.id, displayItem?.status_url]); // Only depend on specific properties, not whole displayItem object

  // Handler for collecting trail status from the Info tab
  const handleCollectStatusInline = async () => {
    if (!displayItem?.id) return;
    try {
      const response = await fetch(`/api/admin/pois/${displayItem.id}/status/collect`, {
        method: 'POST',
        credentials: 'include'
      });
      if (response.ok) {
        // Refresh status after collection
        const statusResponse = await fetch(`/api/pois/${displayItem.id}/status`);
        if (statusResponse.ok) {
          const data = await statusResponse.json();
          setTrailStatus(data);
        }
      } else {
        const error = await response.json();
        alert('Collection failed: ' + (error.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('[handleCollectStatusInline] Error:', err);
      alert('Collection error: ' + err.message);
    }
  };

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
            await fetch(`/api/admin/pois/${destination.id}/image`, {
              method: 'DELETE',
              credentials: 'include'
            });
          } else if (pendingImage.data) {
            // Upload new image
            await fetch(`/api/admin/pois/${destination.id}/image-base64`, {
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
          await fetch(`/api/admin/pois/${linearFeature.id}/image`, {
            method: 'DELETE',
            credentials: 'include'
          });
        } else if (pendingImage.data) {
          // Upload new image
          await fetch(`/api/admin/pois/${linearFeature.id}/image-base64`, {
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
      const { geometry: _geometry, ...dataWithoutGeometry } = editedData;

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
    const linearImageUrl = linearFeature?.has_primary_image
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

        {/* Media section - Mosaic in view mode, ImageUploader in edit mode */}
        <div style={{ position: 'relative' }}>
          {isEditing && linearFeature?.id ? (
            <ImageUploader
              destinationId={linearFeature.id}
              hasImage={!!linearFeature.has_primary_image}
              pendingImage={pendingImage}
              onPendingImageChange={setPendingImage}
              updatedAt={linearFeature.updated_at}
              disabled={saving}
              isVirtualPoi={false}
              user={user}
              poiId={linearFeature.id}
              onMediaUpdate={handleMediaUpdate}
            />
          ) : media.length > 0 ? (
            <Mosaic media={media} allMedia={allMedia} poiId={linearFeature?.id} user={user} onMediaUpdate={handleMediaUpdate} />
          ) : user && linearFeature?.id && !mediaLoading ? (
            <div className="sidebar-no-media">
              <button
                className="btn-add-first-media"
                onClick={() => setUploadModalOpen(true)}
              >
                + Add Photo/Video
              </button>
            </div>
          ) : null}

          {/* Navigation chevrons on image - mobile only, only when image is visible */}
          {isMobile && !isEditing && onNavigate && poiNavigationList && poiNavigationList.length > 1 && media.length > 0 && (
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

        {/* Sidebar Tabs - same as destinations */}
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab ${sidebarTab === 'view' ? 'active' : ''}`}
            onClick={() => setSidebarTab('view')}
          >
            Info
          </button>
          <button
            className={`sidebar-tab ${sidebarTab === 'news' ? 'active' : ''}`}
            onClick={() => setSidebarTab('news')}
          >
            News
          </button>
          <button
            className={`sidebar-tab ${sidebarTab === 'events' ? 'active' : ''}`}
            onClick={() => setSidebarTab('events')}
          >
            Events
          </button>
          <button
            className={`sidebar-tab ${sidebarTab === 'history' ? 'active' : ''}`}
            onClick={() => setSidebarTab('history')}
          >
            History
          </button>
          <button
            className={`sidebar-tab ${sidebarTab === 'associations' ? 'active' : ''}`}
            onClick={() => setSidebarTab('associations')}
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
                      has_primary_image: !!driveFileId
                    });
                  }
                }}
              />
            ) : (
              <ReadOnlyView
                destination={linearFeature}
                isLinearFeature={true}
                isAdmin={isAdmin}
                editMode={editMode}
                onShare={() => setShowShareModal(true)}
                moreInfoLink={linearFeature.more_info_link}
                trailStatus={trailStatus}
                showNpsMap={showNpsMap}
                onToggleNpsMap={onToggleNpsMap}
                onCollectStatus={handleCollectStatusInline}
              />
            )
          )}

          {sidebarTab === 'news' && linearFeature && (
            <PoiNews poiId={linearFeature.id} isAdmin={isAdmin} editMode={editMode} onCountChange={setNewsCount} />
          )}

          {sidebarTab === 'events' && linearFeature && (
            <PoiEvents poiId={linearFeature.id} poiName={linearFeature.name} isAdmin={isAdmin} editMode={editMode} onCountChange={setEventsCount} />
          )}

          {sidebarTab === 'history' && linearFeature && (
            <div className="history-tab-content">
              {isEditing ? (
                <div className="edit-section">
                  <label>Historical Description
                  </label>
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
  const imageUrl = destination?.has_primary_image
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
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
      </div>

      {/* Media section - Mosaic in view mode, ImageUploader in edit mode */}
      <div style={{ position: 'relative' }}>
        {isEditing && destination?.id ? (
          <ImageUploader
            destinationId={destination.id}
            hasImage={!!destination.has_primary_image}
            pendingImage={pendingImage}
            onPendingImageChange={setPendingImage}
            updatedAt={destination.updated_at}
            disabled={saving}
            isVirtualPoi={destination?.poi_roles?.includes('organization') && !destination?.geometry && !destination?.latitude}
            user={user}
            poiId={destination.id}
            onMediaUpdate={handleMediaUpdate}
          />
        ) : media.length > 0 ? (
          <Mosaic media={media} allMedia={allMedia} poiId={destination?.id} user={user} onMediaUpdate={handleMediaUpdate} />
        ) : user && destination?.id && !mediaLoading ? (
          <div className="sidebar-no-media">
            <button
              className="btn-add-first-media"
              onClick={() => setUploadModalOpen(true)}
            >
              + Add Photo/Video
            </button>
          </div>
        ) : null}

        {/* Navigation chevrons on image - mobile only, only when image is visible */}
        {isMobile && !isEditing && onNavigate && poiNavigationList && poiNavigationList.length > 1 && media.length > 0 && (
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

      {/* Sidebar Tabs - always shown */}
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${sidebarTab === 'view' ? 'active' : ''}`}
          onClick={() => setSidebarTab('view')}
        >
          Info
        </button>
        <button
          className={`sidebar-tab ${sidebarTab === 'news' ? 'active' : ''}`}
          onClick={() => setSidebarTab('news')}
        >
          News
        </button>
        <button
          className={`sidebar-tab ${sidebarTab === 'events' ? 'active' : ''}`}
          onClick={() => setSidebarTab('events')}
        >
          Events
        </button>
        <button
          className={`sidebar-tab ${sidebarTab === 'history' ? 'active' : ''}`}
          onClick={() => setSidebarTab('history')}
        >
          History
        </button>
        <button
          className={`sidebar-tab ${sidebarTab === 'associations' ? 'active' : ''}`}
          onClick={() => setSidebarTab('associations')}
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
                    has_primary_image: !!driveFileId
                  });
                }
              }}
            />
          ) : (
            <ReadOnlyView
              destination={destination}
              isAdmin={isAdmin}
              editMode={editMode}
              showImage={false}
              onShare={() => setShowShareModal(true)}
              moreInfoLink={destination.more_info_link}
              trailStatus={trailStatus}
              showNpsMap={showNpsMap}
              onToggleNpsMap={onToggleNpsMap}
              onCollectStatus={handleCollectStatusInline}
            />
          )
        )}

        {sidebarTab === 'news' && destination && (
          <PoiNews poiId={destination.id} isAdmin={isAdmin} editMode={editMode} onCountChange={setNewsCount} />
        )}

        {sidebarTab === 'events' && destination && (
          <PoiEvents poiId={destination.id} poiName={destination.name} isAdmin={isAdmin} editMode={editMode} onCountChange={setEventsCount} />
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

      {uploadModalOpen && destination?.id && (
        <MediaUploadModal
          poiId={destination.id}
          onClose={() => setUploadModalOpen(false)}
          onSuccess={() => {
            setUploadModalOpen(false);
            handleMediaUpdate();
          }}
        />
      )}
    </div>
  );
}

export default Sidebar;
