import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatPublicationDate, NewsTypeIcon } from './NewsEventsShared';
import ShareButton from './ShareButton';

function generateSlug(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function NewsPermalink({ poiSlug, titleSlug }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`/api/news/${poiSlug}/${titleSlug}`)
      .then(res => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Article not found' : 'Failed to load');
        return res.json();
      })
      .then(data => { setItem(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [poiSlug, titleSlug]);

  if (loading) {
    return (
      <div className="permalink-page">
        <div className="permalink-loading">Loading...</div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="permalink-page">
        <div className="permalink-error">
          <h2>{error || 'Article not found'}</h2>
          <p>This article may have been removed or the link may be incorrect.</p>
          <button onClick={() => navigate('/')} className="permalink-back-btn">
            Back to Map
          </button>
        </div>
      </div>
    );
  }

  const permalinkUrl = `/news/${poiSlug}/${titleSlug}`;

  return (
    <div className="permalink-page">
      <div className="permalink-card">
        <div className="permalink-nav">
          <button onClick={() => navigate('/')} className="permalink-back-btn">
            &larr; Back to Map
          </button>
        </div>

        <div className="permalink-header">
          <NewsTypeIcon type={item.news_type} />
          <h1 className="permalink-title">{item.title}</h1>
        </div>

        {item.poi_name && (
          <button
            className="permalink-poi-link"
            onClick={() => navigate(`/?poi=${generateSlug(item.poi_name)}`)}
          >
            {item.poi_name}
          </button>
        )}

        <div className="permalink-meta">
          {item.source_name && <span className="permalink-source">{item.source_name}</span>}
          {item.publication_date && (
            <span className="permalink-date">{formatPublicationDate(item.publication_date)}</span>
          )}
        </div>

        {item.summary && <p className="permalink-summary">{item.summary}</p>}

        <div className="permalink-actions">
          {item.source_url && (
            <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="permalink-read-more">
              Read full article &rarr;
            </a>
          )}
          <ShareButton
            title={item.title}
            text={item.summary || ''}
            url={permalinkUrl}
          />
        </div>

        {item.additional_urls && item.additional_urls.length > 0 && (
          <div className="permalink-additional-sources">
            <span>Also reported by: </span>
            {item.additional_urls.map((u, i) => (
              <a key={i} href={u.url} target="_blank" rel="noopener noreferrer">
                {u.source_name || `Source ${i + 2}`}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
