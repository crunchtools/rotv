import React, { useState, useEffect } from 'react';
import FilterSheet, { FilterChip } from './FilterSheet';
import { NewsCardBody } from './NewsEventsShared';
import ContentFormModal from './ContentFormModal';
import useModeration from '../hooks/useModeration';
import ModerationExtras from './ModerationExtras';
import useFetchedList from '../hooks/useFetchedList';

function ParkNews({ isAdmin, editMode, onSelectPoi, onEditNewsItem, refreshTrigger }) {
  const { items: news, loading, error, reload: fetchNews } = useFetchedList('/api/news/recent', 'Failed to load news');
  const [searchText, setSearchText] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;
  const [typeFilters, setTypeFilters] = useState({
    general: true,
    alert: true,
    wildlife: true,
    infrastructure: true,
    community: true
  });
  const [showNewForm, setShowNewForm] = useState(false);

  const mod = useModeration({
    onItemsChanged: () => fetchNews()
  });

  useEffect(() => {
    fetchNews();
  }, [refreshTrigger]);

  const filteredNews = React.useMemo(() => {
    let filtered = news;

    if (searchText.trim()) {
      const search = searchText.toLowerCase();
      filtered = filtered.filter(item =>
        (item.title || '').toLowerCase().includes(search) ||
        (item.summary || '').toLowerCase().includes(search) ||
        (item.poi_name || '').toLowerCase().includes(search)
      );
    }

    filtered = filtered.filter(item => typeFilters[item.news_type || 'general'] !== false);

    return filtered;
  }, [news, searchText, typeFilters]);

  const totalPages = Math.ceil(filteredNews.length / PAGE_SIZE);
  const paginatedNews = filteredNews.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  if (loading) {
    return (
      <div className="park-news-tab">
        <h2>News</h2>
        <div className="loading-indicator">Loading news...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="park-news-tab">
        <h2>News</h2>
        <div className="error-message">{error}</div>
      </div>
    );
  }

  return (
    <div className="park-news-tab">
      <div className="news-events-header tab-header-with-new">
        <div>
          <h2>News</h2>
          <p className="tab-subtitle">Recent news from across Cuyahoga Valley National Park</p>
        </div>
        {editMode && isAdmin && (
          <button className="tab-new-btn" onClick={() => setShowNewForm(true)}>+ New</button>
        )}
      </div>

      {showNewForm && (
        <ContentFormModal
          mode="create"
          contentType="news"
          pois={mod.pois}
          onCreate={() => fetchNews()}
          onClose={() => setShowNewForm(false)}
        />
      )}

      <div className="results-filters">
        <input
          type="text"
          className="results-search-input"
          placeholder="Search news by title, summary, or location..."
          value={searchText}
          onChange={(e) => { setSearchText(e.target.value); setCurrentPage(1); }}
        />
        <FilterSheet activeCount={Object.values(typeFilters).filter(on => !on).length}>
          <div className="results-type-filters">
            {[
              { key: 'general', icon: 'N', label: 'General' },
              { key: 'alert', icon: '!', label: 'Alert' },
              { key: 'wildlife', icon: 'W', label: 'Wildlife' },
              { key: 'infrastructure', icon: 'I', label: 'Infrastructure' },
              { key: 'community', icon: 'M', label: 'Community' },
            ].map(f => (
              <FilterChip key={f.key} id={f.key} active={typeFilters[f.key]} onToggle={() => { setTypeFilters(prev => ({ ...prev, [f.key]: !prev[f.key] })); setCurrentPage(1); }}>
                <span className="type-filter-icon">{f.icon}</span>
                {f.label}
              </FilterChip>
            ))}
          </div>
        </FilterSheet>
        <div className="results-count">
          Showing {filteredNews.length === 0 ? '0' : `${((currentPage - 1) * PAGE_SIZE) + 1}-${Math.min(currentPage * PAGE_SIZE, filteredNews.length)}`} of {filteredNews.length} news items
        </div>
      </div>

      <div className="news-events-layout">
        <div className="news-events-content">
          {filteredNews.length === 0 ? (
            <p className="no-content">
              {news.length > 0
                ? 'No news matches the current filters. Try a different search, or open Filters.'
                : 'No recent news available.'}
            </p>
          ) : (
          <div className="park-news-list" onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              const items = Array.from(e.currentTarget.querySelectorAll('.park-news-item'));
              const idx = items.indexOf(e.target.closest('.park-news-item'));
              if (idx === -1) return;
              e.preventDefault();
              const next = e.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
              items[next].focus();
            }
          }}>
        {paginatedNews.map(item => {
          const enrichedItem = { ...item, content_type: 'news' };
          return (
            <NewsCardBody
              key={item.id}
              item={item}
              onSelectPoi={onSelectPoi}
            >
              {editMode && isAdmin && (
                <ModerationExtras
                  item={enrichedItem}
                  isPending={false}
                  editingItem={mod.editingItem}
                  editFields={mod.editFields}
                  setEditFields={mod.setEditFields}
                  itemUrls={mod.itemUrls}
                  newUrlInput={mod.newUrlInput}
                  setNewUrlInput={mod.setNewUrlInput}
                  addingUrl={mod.addingUrl}
                  iaDateItem={mod.iaDateItem}
                  mergingItem={mod.mergingItem}
                  mergeCandidates={mod.mergeCandidates}
                  merging={mod.merging}
                  confirmDelete={mod.confirmDelete}
                  setConfirmDelete={mod.setConfirmDelete}
                  pois={mod.pois}
                  onApprove={mod.handleApprove}
                  onReject={mod.handleReject}
                  onRequeue={mod.handleRequeue}
                  onDelete={mod.handleDelete}
                  onSave={mod.handleSave}
                  onIaDate={mod.handleIaDate}
                  onStartEditing={mod.startEditing}
                  onCancelEditing={mod.cancelEditing}
                  onStartMerge={mod.startMerge}
                  onMerge={mod.handleMerge}
                  onCancelMerge={mod.cancelMerge}
                  onAddUrl={mod.handleAddUrl}
                  onRemoveUrl={mod.handleRemoveUrl}
                />
              )}
            </NewsCardBody>
          );
        })}
          </div>
          )}
          {totalPages > 1 && (
            <div className="pagination-controls">
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(p => p - 1)}
                disabled={currentPage === 1}
              >
                Back
              </button>
              <span className="pagination-info">
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage(p => p + 1)}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
      {editMode && isAdmin && mod.notification && (
        <div className={`result-message ${mod.notification.type}`} style={{ margin: '10px 1rem' }}>
          {mod.notification.message}
        </div>
      )}
    </div>
  );
}

export default ParkNews;
