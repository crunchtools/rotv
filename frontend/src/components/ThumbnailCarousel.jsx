import React, { useRef, useEffect, useState } from 'react';

// Thumbnail carousel for mobile POI navigation
function ThumbnailCarousel({ pois, currentIndex, onNavigate }) {
  const wrapperRef = useRef(null);
  const carouselRef = useRef(null);
  const selectedRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const hideTimerRef = useRef(null);

  // Check scroll position to show/hide edge indicators
  const updateScrollIndicators = () => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    const scrollLeft = carousel.scrollLeft;
    const scrollWidth = carousel.scrollWidth;
    const clientWidth = carousel.clientWidth;
    const maxScroll = scrollWidth - clientWidth;

    // Show left indicator if scrolled right (not at start)
    setCanScrollLeft(scrollLeft > 5);

    // Show right indicator if not at end
    setCanScrollRight(scrollLeft < maxScroll - 5);
  };

  // Update indicators on scroll
  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    updateScrollIndicators();
    carousel.addEventListener('scroll', updateScrollIndicators);

    // Also update on resize
    window.addEventListener('resize', updateScrollIndicators);

    return () => {
      carousel.removeEventListener('scroll', updateScrollIndicators);
      window.removeEventListener('resize', updateScrollIndicators);
    };
  }, [pois]);

  // Auto-scroll to keep selected thumbnail visible
  useEffect(() => {
    if (selectedRef.current && carouselRef.current) {
      selectedRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      });
    }
  }, [currentIndex]);

  // Auto-hide carousel after 5 seconds
  useEffect(() => {
    // Clear any existing timer
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }

    // Show carousel initially or when currentIndex changes (user is navigating)
    setIsVisible(true);

    // Set timer to hide after 5 seconds
    hideTimerRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 5000);

    // Cleanup timer on unmount or when currentIndex changes
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [currentIndex]);

  const handleThumbnailClick = (index) => {
    if (index === currentIndex) return;

    // For adjacent items (prev/next), navigate with animation
    // For distant items, jump directly (onNavigate can handle this)
    const distance = Math.abs(index - currentIndex);

    if (distance === 1) {
      // Adjacent - smooth animation
      const direction = index > currentIndex ? 'next' : 'prev';
      onNavigate(direction);
    } else {
      // Distant - direct jump (pass index directly)
      onNavigate(index);
    }
  };

  // Get thumbnail image URL or default icon
  const getThumbnailUrl = (poi) => {
    if (poi.image_mime_type) {
      return `/api/pois/${poi.id}/thumbnail?size=small&v=${poi.updated_at || Date.now()}`;
    }

    // Default icons based on type
    if (poi._isVirtual) return '/icons/thumbnails/virtual.svg';
    if (poi._isLinear) {
      if (poi.feature_type === 'river') return '/icons/thumbnails/river.svg';
      if (poi.feature_type === 'boundary') return '/icons/thumbnails/boundary.svg';
      return '/icons/thumbnails/trail.svg';
    }
    return '/icons/thumbnails/destination.svg';
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
              role="button"
              tabIndex={0}
              aria-label={`Navigate to ${poi.name}`}
            >
              <div className="thumbnail-image">
                <img src={getThumbnailUrl(poi)} alt={poi.name} loading="lazy" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ThumbnailCarousel;
