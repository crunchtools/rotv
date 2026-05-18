import React, { useRef, useEffect, useState } from 'react';

function ThumbnailCarousel({ pois, currentIndex, onNavigate }) {
  const wrapperRef = useRef(null);
  const carouselRef = useRef(null);
  const selectedRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const hideTimerRef = useRef(null);

  const updateScrollIndicators = () => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    const scrollLeft = carousel.scrollLeft;
    const scrollWidth = carousel.scrollWidth;
    const clientWidth = carousel.clientWidth;
    const maxScroll = scrollWidth - clientWidth;

    setCanScrollLeft(scrollLeft > 5);
    setCanScrollRight(scrollLeft < maxScroll - 5);
  };

  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    updateScrollIndicators();
    carousel.addEventListener('scroll', updateScrollIndicators);

    window.addEventListener('resize', updateScrollIndicators);

    return () => {
      carousel.removeEventListener('scroll', updateScrollIndicators);
      window.removeEventListener('resize', updateScrollIndicators);
    };
  }, [pois]);

  useEffect(() => {
    if (selectedRef.current && carouselRef.current) {
      selectedRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      });
    }
  }, [currentIndex]);

  useEffect(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }

    setIsVisible(true);

    hideTimerRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 5000);

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [currentIndex]);

  const handleThumbnailClick = (index) => {
    if (index === currentIndex) return;

    const distance = Math.abs(index - currentIndex);

    if (distance === 1) {
      const direction = index > currentIndex ? 'next' : 'prev';
      onNavigate(direction);
    } else {
      onNavigate(index);
    }
  };

  const getDefaultThumbnail = (poi) => {
    if (poi._isVirtual) return '/icons/thumbnails/virtual.svg';
    if (poi._isLinear) {
      if (poi.feature_type === 'river') return '/icons/thumbnails/river.svg';
      if (poi.feature_type === 'boundary') return '/icons/thumbnails/boundary.svg';
      return '/icons/thumbnails/trail.svg';
    }
    return '/icons/thumbnails/destination.svg';
  };

  const getThumbnailUrl = (poi) => {
    if (poi.has_primary_image) {
      return `/api/pois/${poi.id}/thumbnail?size=small&v=${poi.updated_at || Date.now()}`;
    }
    return getDefaultThumbnail(poi);
  };

  return (
    <div
      ref={wrapperRef}
      className={`thumbnail-carousel-wrapper ${canScrollLeft ? 'can-scroll-left' : ''} ${canScrollRight ? 'can-scroll-right' : ''} ${!isVisible ? 'hidden' : ''}`}
    >
      <div className="thumbnail-carousel" ref={carouselRef}>
        {pois.map((poi, index) => {
          const isSelected = index === currentIndex;

          return (
            <div
              key={`${poi._isLinear ? 'linear' : poi._isVirtual ? 'virtual' : 'point'}-${poi.id}`}
              ref={isSelected ? selectedRef : null}
              className={`thumbnail-item ${isSelected ? 'selected' : ''}`}
              onClick={() => handleThumbnailClick(index)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleThumbnailClick(index); }}}
              role="button"
              tabIndex={0}
              aria-label={`Navigate to ${poi.name}`}
            >
              <div className="thumbnail-image">
                <img
                  src={getThumbnailUrl(poi)}
                  alt={poi.name}
                  loading="lazy"
                  onError={(e) => { e.target.src = getDefaultThumbnail(poi); }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ThumbnailCarousel;
