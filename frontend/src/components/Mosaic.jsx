import { useState } from 'react';
import Lightbox from './Lightbox';
import './Mosaic.css';

/**
 * Mosaic Component
 * Displays 1-3 images in a Facebook-style mosaic layout
 * Click opens lightbox with all media
 */
function Mosaic({ media, allMedia, poiId, user, onMediaUpdate }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  if (!media || media.length === 0) {
    return null;
  }

  const handleImageClick = (index) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const handleCloseLightbox = () => {
    setLightboxOpen(false);
  };

  const lightboxMedia = allMedia || media;
  const mosaicImages = media.slice(0, 3);

  return (
    <>
      <div className={`mosaic mosaic-${mosaicImages.length}`}>
        {mosaicImages.map((item, index) => (
          <div
            key={item.id}
            className={`mosaic-item mosaic-item-${index}`}
            onClick={() => handleImageClick(index)}
            role="button"
            tabIndex={0}
            onKeyPress={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleImageClick(index);
              }
            }}
          >
            <img
              src={item.medium_url || item.thumbnail_url}
              alt={item.caption || `POI image ${index + 1}`}
              className="mosaic-image"
            />
            {item.media_type === 'video' && (
              <div className="mosaic-video-indicator">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="white">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            )}
            {item.media_type === 'youtube' && (
              <div className="mosaic-youtube-indicator">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="white">
                  <path d="M10 15l5.19-3L10 9v6m11.56-7.83c.13.47.22 1.1.28 1.9.07.8.1 1.49.1 2.09L22 12c0 2.19-.16 3.8-.44 4.83-.25.9-.83 1.48-1.73 1.73-.47.13-1.33.22-2.65.28-1.3.07-2.49.1-3.59.1L12 19c-4.19 0-6.8-.16-7.83-.44-.9-.25-1.48-.83-1.73-1.73-.13-.47-.22-1.10-.28-1.9-.07-.8-.1-1.49-.1-2.09L2 12c0-2.19.16-3.8.44-4.83.25-.9.83-1.48 1.73-1.73.47-.13 1.33-.22 2.65-.28 1.3-.07 2.49-.1 3.59-.1L12 5c4.19 0 6.8.16 7.83.44.9.25 1.48.83 1.73 1.73z" />
                </svg>
              </div>
            )}
            {/* Primary indicator */}
            {item.role === 'primary' && (
              <div className="mosaic-primary-indicator">⭐</div>
            )}
            {/* Pending indicator for user's own uploads */}
            {item.moderation_status === 'pending' && (
              <div className="mosaic-pending-indicator">
                Pending Review
              </div>
            )}
            {/* Show count overlay on last image if there are more */}
            {index === 2 && lightboxMedia.length > 3 && (
              <div className="mosaic-more-overlay">
                +{lightboxMedia.length - 3}
              </div>
            )}
          </div>
        ))}
      </div>

      {lightboxOpen && (
        <Lightbox
          media={lightboxMedia}
          initialIndex={lightboxIndex}
          onClose={handleCloseLightbox}
          poiId={poiId}
          user={user}
          onMediaUpdate={onMediaUpdate}
        />
      )}
    </>
  );
}

export default Mosaic;
