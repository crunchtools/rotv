import React from 'react';
import PoiSearchSelect from './PoiSearchSelect';
import { formatPublicationDate } from './NewsEventsShared';
import { FIELD_CONFIGS } from '../hooks/useModeration';
import ContentFormModal from './ContentFormModal';

// Style helpers (extracted from ModerationInbox)
const badgeStyle = (bg) => ({
  backgroundColor: bg, color: 'white', padding: '1px 8px', borderRadius: '10px',
  fontSize: '0.72rem', fontWeight: 'bold', textTransform: 'uppercase'
});

const actionBtn = (disabled = false) => ({
  padding: '4px 0', border: '1px solid #bbb', borderRadius: '5px',
  backgroundColor: disabled ? '#e0e0e0' : '#f5f5f5', color: disabled ? '#999' : '#333',
  cursor: disabled ? 'default' : 'pointer', fontSize: '0.75rem', fontWeight: '500',
  width: '72px', textAlign: 'center'
});

const btnStyle = (bg, color = 'white', border = 'none') => ({
  padding: '5px 12px', border, borderRadius: '6px',
  backgroundColor: bg, color, cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500'
});

const inputStyle = {
  padding: '6px 10px', borderRadius: '6px', border: '1px solid #d0d0d0',
  fontSize: '0.85rem', width: '100%', boxSizing: 'border-box'
};

const getConfidenceColor = (score) => {
  if (score === null || score === undefined) return '#999';
  if (score < 0.5) return '#f44336';
  if (score < 0.9) return '#ff9800';
  return '#4caf50';
};

const getTypeBadgeColor = (type) => {
  switch (type) {
    case 'news': return '#2196f3';
    case 'event': return '#9c27b0';
    case 'photo': return '#4caf50';
    default: return '#757575';
  }
};

const getSourceBadge = (source) => {
  switch (source) {
    case 'ai': return { label: 'AI', color: '#ff9800' };
    case 'human': return { label: 'Human', color: '#607d8b' };
    case 'newsletter': return { label: 'Newsletter', color: '#00897b' };
    case 'feed': return { label: 'Feed', color: '#5c6bc0' };
    case 'api': return { label: 'API', color: '#8d6e63' };
    case 'community': return { label: 'Community', color: '#26a69a' };
    default: return null;
  }
};

function renderFieldInput(fc, values, setValues, pois) {
  const val = values[fc.key] || '';
  const onChange = (v) => setValues({ ...values, [fc.key]: v });

  if (fc.type === 'textarea') {
    return <textarea value={val} onChange={e => onChange(e.target.value)}
      rows={3} style={inputStyle} placeholder={fc.label} />;
  }
  if (fc.type === 'select') {
    return (
      <select value={val} onChange={e => onChange(e.target.value)} style={inputStyle}>
        <option value="">-- Select --</option>
        {fc.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (fc.type === 'poi') {
    return (
      <PoiSearchSelect
        pois={pois}
        value={val}
        onChange={(id) => onChange(id || '')}
        placeholder="Search POIs..."
      />
    );
  }
  const lang = fc.type === 'date' ? 'en-US' : undefined;
  return <input type={fc.type || 'text'} value={val} onChange={e => onChange(e.target.value)}
    style={inputStyle} placeholder={fc.label} required={fc.required} lang={lang} />;
}

/**
 * Shared per-item moderation UI: badges, inline edit form, action buttons, merge UI.
 * Rendered as children of NewsCardBody/EventCardBody.
 */
export default function ModerationExtras({
  item,
  isPending = false,
  // From useModeration hook
  editingItem, editFields, setEditFields,
  itemUrls, newUrlInput, setNewUrlInput, addingUrl,
  iaDateItem,
  mergingItem, mergeCandidates, merging,
  confirmDelete, setConfirmDelete,
  selectedItems,
  pois,
  // Handlers from hook
  onApprove, onReject, onRequeue, onDelete,
  onSave, onIaDate,
  onStartEditing, onCancelEditing,
  onStartMerge, onMerge, onCancelMerge,
  onAddUrl, onRemoveUrl,
  onToggleSelect
}) {
  const itemKey = `${item.content_type}:${item.id}`;
  const isEditing = editingItem === itemKey;

  return (
    <div onClick={(e) => e.stopPropagation()}>
      {/* Moderation badges */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', margin: '10px 0 8px' }}>
        <span style={badgeStyle('#757575')}>#{item.id}</span>
        <span style={badgeStyle(getTypeBadgeColor(item.content_type))}>
          {item.content_type}
        </span>
        {item.content_source && getSourceBadge(item.content_source) && (
          <span style={badgeStyle(getSourceBadge(item.content_source).color)}>
            {getSourceBadge(item.content_source).label}
          </span>
        )}
        {!isPending && item.moderation_status && (
          <span style={badgeStyle(item.moderation_status === 'rejected' ? '#f44336' : '#4caf50')}>
            {item.moderation_status === 'rejected' ? 'Rejected' : 'Approved'}
          </span>
        )}
        {(item.additional_url_count > 0 || (item.additional_urls && item.additional_urls.length > 0)) && (
          <span style={badgeStyle('#1565c0')}>
            +{item.additional_url_count || item.additional_urls?.length} URL{(item.additional_url_count || item.additional_urls?.length) > 1 ? 's' : ''}
          </span>
        )}

        {/* Triage chips */}
        {item.content_type !== 'photo' && (() => {
          const issues = item.ai_issues ? (() => { try { return JSON.parse(item.ai_issues); } catch { return []; } })() : [];
          const urlIssueCodes = ['content_not_on_source_page', 'missing_source_url'];
          const hasNoDate = item.content_type === 'event'
            ? !item.publication_date && !item.start_date
            : !item.publication_date || !item.date_consensus_score;
          const hasUrlIssue = issues.some(i => urlIssueCodes.includes(i)) || (!item.source_url && item.content_type !== 'photo');
          const urlLabel = !item.source_url ? 'No URL' : 'Wrong URL';
          const hasOther = issues.some(i => !urlIssueCodes.includes(i));
          return (
            <>
              {hasNoDate && <span style={badgeStyle('#e65100')}>No Date</span>}
              {hasUrlIssue && <span style={badgeStyle('#e65100')}>{urlLabel}</span>}
              {hasOther && <span style={badgeStyle('#b71c1c')}>Other</span>}
            </>
          );
        })()}

        {/* Confidence score */}
        {item.confidence_score !== null && item.confidence_score !== undefined && (
          <span style={{
            color: getConfidenceColor(item.confidence_score),
            fontWeight: 'bold', fontSize: '0.78rem'
          }}>
            {(item.confidence_score * 100).toFixed(0)}%
          </span>
        )}

        {/* Timestamps */}
        <span style={{ fontSize: '0.72rem', color: '#aaa' }}>
          {formatPublicationDate(item.collection_date || item.created_at)}
          {item.moderated_at && ` · Mod: ${formatPublicationDate(item.moderated_at)}`}
        </span>
      </div>

      {/* Edit modal */}
      {isEditing && (
        <ContentFormModal
          mode="edit"
          contentType={item.content_type}
          fields={editFields}
          setFields={setEditFields}
          item={item}
          pois={pois}
          itemUrls={itemUrls[itemKey] || []}
          newUrlInput={newUrlInput}
          setNewUrlInput={setNewUrlInput}
          addingUrl={addingUrl}
          onAddUrl={onAddUrl}
          onRemoveUrl={onRemoveUrl}
          onSave={() => onSave(item.content_type, item.id, item)}
          onClose={onCancelEditing}
        />
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginTop: '6px' }}>
        {isPending && onToggleSelect && (
          <input type="checkbox" checked={selectedItems?.has(itemKey)}
            onChange={() => onToggleSelect(item.content_type, item.id)}
            style={{ marginRight: '4px' }} />
        )}
        {isPending && (
          <>
            <button onClick={() => onApprove(item.content_type, item.id, item)}
              style={actionBtn()}>Approve</button>
            <button onClick={() => onReject(item.content_type, item.id, item)}
              style={actionBtn()}>Reject</button>
          </>
        )}
        {!isPending && (
          <>
            <button onClick={() => onReject(item.content_type, item.id, item)}
              style={actionBtn()}>Reject</button>
            <button onClick={() => onRequeue(item.content_type, item.id)}
              style={actionBtn()}>Requeue</button>
          </>
        )}
        {item.content_type !== 'photo' && (
          <button onClick={() => onIaDate(item.content_type, item.id, item.source_url)}
            disabled={iaDateItem === itemKey}
            title="Look up earliest Internet Archive snapshot date for this URL"
            style={actionBtn(iaDateItem === itemKey)}>
            {iaDateItem === itemKey ? 'Looking up...' : 'IA Date'}
          </button>
        )}
        <button onClick={() => onStartEditing(item)}
          style={actionBtn()}>{isEditing ? 'Close' : 'Edit'}</button>
        {item.content_type !== 'photo' && (
          <button onClick={() => onStartMerge(item)}
            style={actionBtn()}>Merge</button>
        )}
        {item.content_type !== 'photo' && (
          confirmDelete === itemKey ? (
            <>
              <button onClick={() => onDelete(item.content_type, item.id)}
                style={{ ...actionBtn(), backgroundColor: '#ffebee', color: '#c62828', borderColor: '#ef9a9a', width: 'auto', padding: '4px 8px' }}>
                Confirm Delete
              </button>
              <button onClick={() => setConfirmDelete(null)}
                style={actionBtn()}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(itemKey)}
              style={{ ...actionBtn(), backgroundColor: '#ffebee', color: '#c62828', borderColor: '#ef9a9a' }}>
              Delete
            </button>
          )
        )}
      </div>

      {/* Merge candidate selection */}
      {mergingItem && mergingItem.type === item.content_type && mergingItem.id === item.id && (
        <div style={{ marginTop: '8px', padding: '10px', backgroundColor: '#e3f2fd',
          borderRadius: '6px', border: '1px solid #90caf9' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 'bold', marginBottom: '6px', color: '#1565c0' }}>
            Merge this item into (target keeps its title/summary):
          </div>
          {mergeCandidates.length === 0 ? (
            <div style={{ fontSize: '0.78rem', color: '#666' }}>
              {mergingItem ? 'Loading candidates...' : 'No other items found for this POI.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '300px', overflowY: 'auto' }}>
              {mergeCandidates.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '6px 8px', backgroundColor: 'white', borderRadius: '4px',
                  border: '1px solid #e0e0e0' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: '500' }}>
                      {c.title}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#888', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <span>#{c.id}</span>
                      <span>{c.moderation_status}</span>
                      {c.publication_date && <span>{new Date(c.publication_date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</span>}
                      {c.additional_url_count > 0 && <span>+{c.additional_url_count} URLs</span>}
                    </div>
                    {c.source_url && (
                      <div style={{ fontSize: '0.68rem', color: '#1976d2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.source_url}
                      </div>
                    )}
                  </div>
                  <button onClick={() => onMerge(c.id)} disabled={merging}
                    style={{ ...actionBtn(merging), backgroundColor: merging ? '#ccc' : '#1565c0',
                      color: 'white', flexShrink: 0 }}>
                    {merging ? 'Merging...' : 'Merge Into'}
                  </button>
                </div>
              ))}
            </div>
          )}
          <button onClick={onCancelMerge}
            style={{ ...actionBtn(), marginTop: '6px', fontSize: '0.72rem' }}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// Export style helpers for ModerationInbox create form
export { FIELD_CONFIGS, badgeStyle, actionBtn, btnStyle, inputStyle, renderFieldInput, getConfidenceColor, getTypeBadgeColor, getSourceBadge };
