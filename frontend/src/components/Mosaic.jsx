import { useState } from 'react';
import Lightbox from './Lightbox';
import './Mosaic.css';

// compact: one small thumbnail that opens the gallery, for the half-height card on a phone.
function Mosaic({ media, allMedia, poiId, user, onMediaUpdate, compact = false }) {
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
      {compact ? (
        <button
          type="button"
          className="mosaic-thumb"
          aria-label={`View ${lightboxMedia.length} ${lightboxMedia.length === 1 ? 'photo' : 'photos'}`}
          onClick={() => handleImageClick(0)}
        >
          <img
            src={media[0].thumbnail_url || media[0].medium_url}
            alt=""
            className="mosaic-image"
            onError={(e) => {
              if (media[0].media_type === 'youtube' && media[0].youtube_id) {
                e.target.src = `https://img.youtube.com/vi/${media[0].youtube_id}/default.jpg`;
              }
            }}
          />
          {lightboxMedia.length > 1 && (
            <span className="mosaic-thumb-count">{lightboxMedia.length}</span>
          )}
        </button>
      ) : (
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
              {item.moderation_status === 'pending' && (
                <div className="mosaic-pending-indicator">
                  Pending Review
                </div>
              )}
              {index === 2 && lightboxMedia.length > 3 && (
                <div className="mosaic-more-overlay">
                  +{lightboxMedia.length - 3}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

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
