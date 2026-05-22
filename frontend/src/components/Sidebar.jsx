import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ImageUploader from './ImageUploader';
import ThumbnailCarousel from './ThumbnailCarousel';
import { DetailImage } from './NewsEventsShared';
import Mosaic from './Mosaic';
import MediaUploadModal from './MediaUploadModal';
import usePoiMedia from '../hooks/usePoiMedia';
import { generateSlug } from './sidebar/helpers';
import ShareModal from './sidebar/ShareModal';
import ReadOnlyView from './sidebar/ReadOnlyView';
import EditView from './sidebar/EditView';
import PoiNews from './sidebar/PoiNews';
import ContentDetail from './sidebar/ContentDetail';
import PoiEvents from './sidebar/PoiEvents';
import AssociationsModal from './sidebar/AssociationsModal';
import AssociationsTabContent from './sidebar/AssociationsTabContent';
import TrailStatus from './sidebar/TrailStatus';

const SIDEBAR_TAB_LABELS = {
  view: 'Info',
  news: 'News',
  events: 'Events',
  history: 'History',
  associations: 'Associations',
};

function Sidebar({ tourActive, poi, isLinearPoi, isNewPOI, newOrganization, isNewOrganization, onClose, isAdmin, user, editMode, onPoiUpdate, onPoiDelete, onSaveNewPOI, onCancelNewPOI, onSaveNewOrganization, onCancelNewOrganization, previewCoords, onPreviewCoordsChange, onNavigate, currentIndex, totalCount, poiNavigationList, associations, allDestinations, allLinearFeatures, allVirtualPois, onSelectPoi, onAssociationsChanged, onStartDrawingAssociations, isInMtbMode, selectedFromMtbList, mtbTrailsList, currentMtbIndex, onNavigateMtbTrail, onBackToMtbList, permalinkInfo, onSetPermalink, onClearPermalink, initialSidebarTab, onSidebarTabChange }) {
  const navigate = useNavigate();

  // Unified POI prop (spec 019). The sidebar takes a single `poi` plus
  // `isLinearPoi`, the selection KIND from App — NOT geometry, so a dual-role
  // organization+boundary selected as an organization renders as a destination
  // even though it has geometry (PR #348). Legacy split locals are derived from
  // that flag so the existing body keeps working unchanged.
  const linearFeature = poi && isLinearPoi ? poi : null;
  const destination = poi && !isLinearPoi ? poi : null;
  const onDestinationUpdate = onPoiUpdate;
  const onLinearFeatureUpdate = onPoiUpdate;
  const onDestinationDelete = onPoiDelete;
  const onLinearFeatureDelete = onPoiDelete;
  const onSelectDestination = onSelectPoi;
  const onSelectLinearFeature = onSelectPoi;
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sidebarTab, setSidebarTab] = useState(initialSidebarTab || 'view');
  const [permalinkItem, setPermalinkItem] = useState(null);

  useEffect(() => {
    setPermalinkItem(null);
    if (permalinkInfo) {
      setSidebarTab(permalinkInfo.type === 'event' ? 'events' : 'news');
    }
  }, [permalinkInfo]);

  useEffect(() => {
    if (initialSidebarTab) {
      setSidebarTab(initialSidebarTab);
    }
  }, [initialSidebarTab]);

  const [showShareModal, setShowShareModal] = useState(false);
  const [showAssociationsModal, setShowAssociationsModal] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [pendingImage, setPendingImage] = useState(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [, setNewsCount] = useState(0);
  const [, setEventsCount] = useState(0);
  const [, setCollectResult] = useState(null);
  const [trailStatus, setTrailStatus] = useState(null);
  const [tabCounts, setTabCounts] = useState({ news_count: null, events_count: null });

  const [selectedPoiIds, setSelectedPoiIds] = useState(new Set());

  useEffect(() => {
    if (newOrganization) {
      setSelectedPoiIds(newOrganization._selectedPoiIds || new Set());
    }
  }, [newOrganization]);

  const { media, allMedia, mediaLoading, refreshMedia: handleMediaUpdate } = usePoiMedia(poi, onPoiUpdate);

  const activePoi = destination || linearFeature;


  const handleSelectDestinationFromAssociations = React.useCallback((poi) => {
    onSelectDestination(poi);
    setSidebarTab('view'); // Switch to Info tab
  }, [onSelectDestination]);

  const handleSelectLinearFeatureFromAssociations = React.useCallback((poi) => {
    onSelectLinearFeature(poi);
    setSidebarTab('view'); // Switch to Info tab
  }, [onSelectLinearFeature]);

  const touchStartX = React.useRef(null);
  const touchStartY = React.useRef(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwipingHorizontally, setIsSwipingHorizontally] = useState(false);

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

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleTouchStart = (e) => {
    const target = e.target;
    const isCarousel = target.closest('.thumbnail-carousel-wrapper, .thumbnail-carousel');
    const isNavButton = target.closest('.image-nav-btn');

    if (isCarousel || isNavButton) {
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

    if (!isSwipingHorizontally && Math.abs(deltaX) > 10) {
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        setIsSwipingHorizontally(true);
      }
    }

    if (isSwipingHorizontally || Math.abs(deltaX) > Math.abs(deltaY)) {
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

    const minSwipeDistance = 50;
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > minSwipeDistance) {
      if (deltaX > 0) {
        if (currentIndex > 0) {
          onNavigate('prev');
        }
      } else {
        if (poiNavigationList && currentIndex < poiNavigationList.length - 1) {
          onNavigate('next');
        }
      }
    }

    touchStartX.current = null;
    touchStartY.current = null;
    setSwipeOffset(0);
    setIsSwipingHorizontally(false);
  };

  const displayItem = linearFeature || destination;
  const isLinearFeature = !!linearFeature;

  useEffect(() => {
    const poiId = displayItem?.id;
    if (!poiId) {
      setTabCounts({ news_count: null, events_count: null });
      return;
    }
    setTabCounts({ news_count: null, events_count: null });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const controller = new AbortController();
    fetch(`/api/pois/${poiId}/tab-counts?tz=${encodeURIComponent(tz)}`, { signal: controller.signal })
      .then(res => (res.ok ? res.json() : { news_count: 0, events_count: 0 }))
      .then(data => setTabCounts(data))
      .catch(err => {
        if (err.name === 'AbortError') return;
        setTabCounts({ news_count: 0, events_count: 0 });
      });
    return () => controller.abort();
  }, [displayItem?.id]);

  const poiAssociationsCount = useMemo(() => {
    if (!displayItem?.id) return 0;
    return (associations || []).filter(a =>
      a.virtual_poi_id === displayItem.id || a.physical_poi_id === displayItem.id
    ).length;
  }, [associations, displayItem?.id]);

  const visibleTabs = useMemo(() => {
    const tabs = ['view'];
    const adminOverride = isAdmin && editMode;
    if (adminOverride || (tabCounts.news_count !== null && tabCounts.news_count > 0)) {
      tabs.push('news');
    }
    if (adminOverride || (tabCounts.events_count !== null && tabCounts.events_count > 0)) {
      tabs.push('events');
    }
    if (adminOverride || (displayItem?.historical_description && displayItem.historical_description.trim())) {
      tabs.push('history');
    }
    if (adminOverride || poiAssociationsCount > 0) {
      tabs.push('associations');
    }
    return tabs;
  }, [isAdmin, editMode, tabCounts.news_count, tabCounts.events_count, displayItem?.historical_description, poiAssociationsCount]);

  const handleSidebarTabChange = useCallback((tab) => {
    setSidebarTab(tab);
    if (onSidebarTabChange) onSidebarTabChange(tab);
    if (permalinkInfo && onClearPermalink) onClearPermalink();
    const poiSlug = generateSlug(displayItem?.name);
    if (poiSlug) {
      navigate(tab === 'view' ? `/${poiSlug}` : `/${poiSlug}/${tab}`);
    }
  }, [displayItem, navigate, onSidebarTabChange, permalinkInfo, onClearPermalink]);

  useEffect(() => {
    if (displayItem) {
      setEditedData({ ...displayItem });
      const shouldEnterEditMode = (isAdmin && editMode) || isNewPOI;
      setIsEditing(shouldEnterEditMode);
      if (!permalinkInfo) setSidebarTab('view');
    } else {
      setIsEditing(false);
    }
  }, [displayItem, isAdmin, editMode, isNewPOI, selectedFromMtbList]);

  useEffect(() => {
    if (permalinkInfo) return;
    if (sidebarTab !== 'view' && !visibleTabs.includes(sidebarTab)) {
      setSidebarTab('view');
    }
  }, [visibleTabs, sidebarTab, permalinkInfo]);

  useEffect(() => {
    if (previewCoords && isEditing && !isLinearFeature) {
      setEditedData(prev => ({
        ...prev,
        latitude: previewCoords.lat,
        longitude: previewCoords.lng
      }));
    }
  }, [previewCoords, isEditing, isLinearFeature]);

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

  useEffect(() => {
    if (isEditing) {
      setTimeout(() => {
        const textareas = document.querySelectorAll('.edit-section textarea, .history-tab-content textarea');
        textareas.forEach(textarea => {
          textarea.style.height = 'auto';
          textarea.style.height = textarea.scrollHeight + 'px';
        });
      }, 0);
    }
  }, [isEditing, editedData.brief_description, editedData.historical_description]);

  useEffect(() => {
    setTrailStatus(null);

    if (!displayItem || !displayItem.id) {
      return;
    }

    if (!displayItem.status_url) {
      return;
    }

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

  const handleCollectStatusInline = async () => {
    if (!displayItem?.id) return;
    try {
      const response = await fetch(`/api/admin/pois/${displayItem.id}/status/collect`, {
        method: 'POST',
        credentials: 'include'
      });
      if (response.ok) {
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

  const handleSaveDestination = async () => {
    if (!editedData.name || !editedData.name.trim()) {
      alert('Name is required');
      return;
    }

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
        if (pendingImage) {
          if (pendingImage.deleted) {
            await fetch(`/api/admin/pois/${destination.id}/image`, {
              method: 'DELETE',
              credentials: 'include'
            });
          } else if (pendingImage.data) {
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

  const handleSaveLinearFeature = async () => {
    if (!editedData.name || !editedData.name.trim()) {
      alert('Name is required');
      return;
    }

    setSaving(true);
    try {
      if (pendingImage) {
        if (pendingImage.deleted) {
          await fetch(`/api/admin/pois/${linearFeature.id}/image`, {
            method: 'DELETE',
            credentials: 'include'
          });
        } else if (pendingImage.data) {
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

      const { geometry: _geometry, ...dataWithoutGeometry } = editedData;

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

  if (!displayItem) {
    return null;
  }

  if (isLinearFeature) {
    const linearImageUrl = linearFeature?.has_primary_image
      ? `/api/pois/${linearFeature.id}/thumbnail?size=medium&v=${linearFeature.updated_at || Date.now()}`
      : null;

    const getLinearDefaultThumbnail = () => {
      if (linearFeature.poi_roles?.includes('river')) return '/icons/thumbnails/river.svg';
      if (linearFeature.poi_roles?.includes('boundary')) return '/icons/thumbnails/boundary.svg';
      return '/icons/thumbnails/trail.svg';
    };

    return (
      <div
        className={`sidebar open ${isEditing ? 'editing' : ''}`}
        onTouchStart={isMobile && onNavigate ? handleTouchStart : undefined}
        onTouchMove={isMobile && onNavigate ? handleTouchMove : undefined}
        onTouchEnd={isMobile && onNavigate ? handleTouchEnd : undefined}
      >
        {isMobile && !tourActive && onNavigate && poiNavigationList && poiNavigationList.length > 0 && (
          <ThumbnailCarousel
            pois={poiNavigationList}
            currentIndex={currentIndex}
            onNavigate={onNavigate}
          />
        )}

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

          {isMobile && !isEditing && !permalinkInfo && onNavigate && poiNavigationList && poiNavigationList.length > 1 && media.length > 0 && (
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

        <div className="sidebar-tabs">
          {visibleTabs.map(tab => (
            <button
              key={tab}
              className={`sidebar-tab ${sidebarTab === tab ? 'active' : ''}`}
              onClick={() => handleSidebarTabChange(tab)}
            >
              {SIDEBAR_TAB_LABELS[tab]}
            </button>
          ))}
        </div>

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
                onCollectStatus={handleCollectStatusInline}
              />
            )
          )}

          {sidebarTab === 'news' && linearFeature && (
            <PoiNews poiId={linearFeature.id} poiName={linearFeature.name} isAdmin={isAdmin} editMode={editMode} onCountChange={setNewsCount}
              onSelectNews={(info) => onSetPermalink && onSetPermalink(info)} />
          )}

          {sidebarTab === 'events' && linearFeature && (
            <PoiEvents poiId={linearFeature.id} poiName={linearFeature.name} isAdmin={isAdmin} editMode={editMode} onCountChange={setEventsCount}
              onSelectEvent={(info) => onSetPermalink && onSetPermalink(info)} />
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

  const imageUrl = destination?.has_primary_image
    ? `/api/pois/${destination.id}/thumbnail?size=medium&v=${destination.updated_at || Date.now()}`
    : null;

  return (
    <div
      className={`sidebar ${destination ? 'open' : ''} ${isEditing ? 'editing' : ''}`}
      onTouchStart={isMobile && onNavigate ? handleTouchStart : undefined}
      onTouchMove={isMobile && onNavigate ? handleTouchMove : undefined}
      onTouchEnd={isMobile && onNavigate ? handleTouchEnd : undefined}
    >
      {isMobile && !tourActive && onNavigate && poiNavigationList && poiNavigationList.length > 0 && (
        <ThumbnailCarousel
          pois={poiNavigationList}
          currentIndex={currentIndex}
          onNavigate={onNavigate}
        />
      )}

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

      <div style={{ position: 'relative' }}>
        {permalinkInfo && (sidebarTab === 'news' || sidebarTab === 'events') ? (
          permalinkItem ? (
            <DetailImage key={permalinkItem.id} imageUrl={permalinkItem.image_url} poiId={permalinkItem.poi_id} alt={permalinkItem.title} />
          ) : (
            <div style={{ height: '180px', marginBottom: '12px' }} />
          )
        ) : isEditing && destination?.id ? (
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

        {isMobile && !isEditing && !permalinkInfo && onNavigate && poiNavigationList && poiNavigationList.length > 1 && media.length > 0 && (
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

      <div className="sidebar-tabs">
        {visibleTabs.map(tab => (
          <button
            key={tab}
            className={`sidebar-tab ${sidebarTab === tab ? 'active' : ''}`}
            onClick={() => handleSidebarTabChange(tab)}
          >
            {SIDEBAR_TAB_LABELS[tab]}
          </button>
        ))}
      </div>

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
              onCollectStatus={handleCollectStatusInline}
            />
          )
        )}

        {permalinkInfo && (sidebarTab === 'news' || sidebarTab === 'events') && (
          <ContentDetail
            permalinkInfo={permalinkInfo}
            onItemLoaded={setPermalinkItem}
            onBack={() => {
              if (onClearPermalink) onClearPermalink();
              const subTab = permalinkInfo?.type === 'event' ? 'events' : 'news';
              if (destination) {
                navigate(`/${generateSlug(destination.name)}/${subTab}`);
              }
            }}
          />
        )}

        {sidebarTab === 'news' && destination && !permalinkInfo && (
          <PoiNews poiId={destination.id} poiName={destination.name} isAdmin={isAdmin} editMode={editMode} onCountChange={setNewsCount}
            onSelectNews={(info) => onSetPermalink && onSetPermalink(info)} />
        )}

        {sidebarTab === 'events' && destination && !permalinkInfo && (
          <PoiEvents poiId={destination.id} poiName={destination.name} isAdmin={isAdmin} editMode={editMode} onCountChange={setEventsCount}
            onSelectEvent={(info) => onSetPermalink && onSetPermalink(info)} />
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
