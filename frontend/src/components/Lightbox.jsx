import { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import './Lightbox.css';

/**
 * Lightbox Component
 * Full-screen media viewer with prev/next navigation
 * Supports images, videos, and YouTube embeds
 */
function Lightbox({ media, initialIndex = 0, onClose, poiId }) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  const handlePrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : media.length - 1));
  }, [media.length]);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev < media.length - 1 ? prev + 1 : 0));
  }, [media.length]);

  // Keyboard navigation
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

  // Prevent body scroll when lightbox is open
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

  return (
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

Lightbox.propTypes = {
  media: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.number.isRequired,
      media_type: PropTypes.oneOf(['image', 'video', 'youtube']).isRequired,
      thumbnail_url: PropTypes.string.isRequired,
      full_url: PropTypes.string,
      youtube_url: PropTypes.string,
      embed_url: PropTypes.string,
      caption: PropTypes.string
    })
  ).isRequired,
  initialIndex: PropTypes.number,
  onClose: PropTypes.func.isRequired,
  poiId: PropTypes.number
};

export default Lightbox;
