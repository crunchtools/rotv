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
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleImageClick(index);
              }
            }}
          >
            <img
              src={item.medium_url || item.thumbnail_url}
              alt={item.caption || `POI image ${index + 1}`}
              className="mosaic-image"
              onError={(e) => {
                if (item.media_type === 'youtube' && item.youtube_id) {
                  e.target.src = `https://img.youtube.com/vi/${item.youtube_id}/default.jpg`;
                }
              }}
            />
            {item.media_type === 'video' && (
              <div className="mosaic-video-indicator">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            )}
            {item.media_type === 'youtube' && (
              <div className="mosaic-youtube-indicator">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
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
