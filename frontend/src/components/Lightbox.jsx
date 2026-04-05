import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import MediaUploadModal from './MediaUploadModal';
import './Lightbox.css';

/**
 * Lightbox Component
 * Full-screen media viewer with prev/next navigation
 * Supports images, videos, and YouTube embeds
 * Uses React Portal to render outside sidebar DOM
 */
function Lightbox({ media, initialIndex = 0, onClose, poiId, user, onMediaUpdate }) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [settingPrimary, setSettingPrimary] = useState(false);

  const handlePrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : media.length - 1));
  }, [media.length]);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev < media.length - 1 ? prev + 1 : 0));
  }, [media.length]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        handlePrevious();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, handlePrevious, handleNext]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, []);

  if (!media || media.length === 0) {
    return null;
  }

  const currentMedia = media[currentIndex];

  const handleUploadSuccess = () => {
    setUploadModalOpen(false);
    if (onMediaUpdate) {
      onMediaUpdate();
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this image?')) {
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch(`/api/pois/${poiId}/media/${currentMedia.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete');
      }

      // If this is the last image, close lightbox
      if (media.length === 1) {
        onClose();
        if (onMediaUpdate) {
          onMediaUpdate();
        }
        return;
      }

      // Move to next image, or previous if we're at the end
      let newIndex = currentIndex;
      if (currentIndex >= media.length - 1) {
        newIndex = Math.max(0, currentIndex - 1);
      }

      // Update the index first
      setCurrentIndex(newIndex);

      // Refresh media list
      if (onMediaUpdate) {
        onMediaUpdate();
      }
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Failed to delete image: ' + error.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleSetPrimary = async () => {
    if (!window.confirm('Set this as the primary image? The current primary will become a gallery image.')) {
      return;
    }

    const currentMediaId = currentMedia.id;
    setSettingPrimary(true);
    try {
      const response = await fetch(`/api/pois/${poiId}/media/${currentMedia.id}/set-primary`, {
        method: 'PATCH',
        credentials: 'include'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to set primary');
      }

      // Refresh media and stay on the same image (it will move to index 0 as primary)
      if (onMediaUpdate) {
        onMediaUpdate();
      }

      // Emit event to refresh map markers with new primary image
      window.dispatchEvent(new CustomEvent('poi-updated', { detail: { poiId } }));

      // The image we just set as primary will now be at index 0
      setCurrentIndex(0);
    } catch (error) {
      console.error('Set primary failed:', error);
      alert('Failed to set as primary: ' + error.message);
    } finally {
      setSettingPrimary(false);
    }
  };

  const renderMedia = () => {
    if (currentMedia.media_type === 'youtube') {
      return (
        <div className="lightbox-youtube-container">
          <iframe
            src={currentMedia.embed_url}
            title={currentMedia.caption || 'YouTube video'}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="lightbox-youtube"
          />
        </div>
      );
    } else if (currentMedia.media_type === 'video') {
      return (
        <video
          src={currentMedia.full_url}
          controls
          autoPlay
          className="lightbox-video"
        >
          Your browser does not support the video tag.
        </video>
      );
    } else {
      return (
        <img
          src={currentMedia.full_url}
          alt={currentMedia.caption || `Media ${currentIndex + 1}`}
          className="lightbox-image"
        />
      );
    }
  };

  return createPortal(
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-container" onClick={(e) => e.stopPropagation()}>
        {/* Close Button */}
        <button
          className="lightbox-close"
          onClick={onClose}
          aria-label="Close lightbox"
        >
          ✕
        </button>

        {/* Navigation Arrows */}
        {media.length > 1 && (
          <>
            <button
              className="lightbox-arrow lightbox-arrow-left"
              onClick={handlePrevious}
              aria-label="Previous"
            >
              ‹
            </button>
            <button
              className="lightbox-arrow lightbox-arrow-right"
              onClick={handleNext}
              aria-label="Next"
            >
              ›
            </button>
          </>
        )}

        {/* Main Media */}
        <div className="lightbox-main">
          {renderMedia()}
        </div>

        {/* Caption */}
        {currentMedia.caption && (
          <div className="lightbox-caption">
            {currentMedia.caption}
          </div>
        )}

        {/* Pending indicator for user's own uploads */}
        {currentMedia.moderation_status === 'pending' && (
          <div className="lightbox-pending-badge">
            ⏱ Pending Review
          </div>
        )}

        {/* Primary image indicator */}
        {currentMedia.role === 'primary' && (
          <div className="lightbox-primary-badge">
            ⭐ Primary Image
          </div>
        )}

        {/* Counter */}
        <div className="lightbox-counter">
          {currentIndex + 1} / {media.length}
        </div>

        {/* Thumbnail Strip */}
        {media.length > 1 && (
          <div className="lightbox-thumbnails">
            {media.map((item, index) => (
              <div
                key={item.id}
                className={`lightbox-thumbnail ${
                  index === currentIndex ? 'active' : ''
                }`}
                onClick={() => setCurrentIndex(index)}
                role="button"
                tabIndex={0}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setCurrentIndex(index);
                  }
                }}
              >
                <img
                  src={item.thumbnail_url}
                  alt={item.caption || `Thumbnail ${index + 1}`}
                />
                {item.media_type === 'video' && (
                  <div className="thumbnail-video-indicator">▶</div>
                )}
                {item.media_type === 'youtube' && (
                  <div className="thumbnail-youtube-indicator">YT</div>
                )}
                {item.moderation_status === 'pending' && (
                  <div className="thumbnail-pending-indicator">⏱</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Set as Primary button for admins on non-primary published images */}
        {user && (user.role === 'admin' || user.role === 'media_admin') &&
         currentMedia.role !== 'primary' &&
         ['published', 'auto_approved'].includes(currentMedia.moderation_status) && (
          <button
            className="lightbox-set-primary"
            onClick={(e) => {
              e.stopPropagation();
              handleSetPrimary();
            }}
            disabled={settingPrimary}
            aria-label="Set as primary image"
          >
            {settingPrimary ? 'Setting...' : '⭐ Set as Primary'}
          </button>
        )}

        {/* Delete button for user's own uploads or admins */}
        {user && (currentMedia.uploaded_by_user || user.role === 'admin' || user.role === 'media_admin') && (
          <button
            className="lightbox-delete-media"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
            disabled={deleting}
            aria-label="Delete this image"
          >
            {deleting ? 'Deleting...' : '🗑 Delete'}
          </button>
        )}

        {/* Add Photo/Video button for authenticated users */}
        {user && (
          <button
            className="lightbox-add-media"
            onClick={(e) => {
              e.stopPropagation();
              setUploadModalOpen(true);
            }}
            aria-label="Add photo or video"
          >
            + Add Photo/Video
          </button>
        )}
      </div>

      {/* Upload Modal */}
      {uploadModalOpen && (
        <MediaUploadModal
          poiId={poiId}
          onClose={() => setUploadModalOpen(false)}
          onSuccess={handleUploadSuccess}
        />
      )}
    </div>,
    document.body
  );
}

export default Lightbox;
