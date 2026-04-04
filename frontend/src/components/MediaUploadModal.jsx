import { useState, useRef } from 'react';
import PropTypes from 'prop-types';
import './MediaUploadModal.css';

/**
 * MediaUploadModal Component
 * Modal for uploading images, videos, or adding YouTube links
 */
function MediaUploadModal({ poiId, onClose, onSuccess }) {
  const [activeTab, setActiveTab] = useState('image');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  // Form states
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);

  const fileInputRef = useRef(null);

  const handleFileSelect = (file) => {
    if (!file) return;

    const isVideo = activeTab === 'video';
    const allowedTypes = isVideo
      ? ['video/mp4', 'video/webm', 'video/quicktime']
      : ['image/jpeg', 'image/png', 'image/webp'];

    if (!allowedTypes.includes(file.type)) {
      const expected = isVideo ? 'MP4, WebM, or MOV' : 'JPEG, PNG, or WebP';
      setError(`Please select a ${expected} file`);
      return;
    }

    // Video size validation
    if (isVideo && file.size > 10 * 1024 * 1024) {
      setError('Video must be less than 10MB. Please upload larger videos to YouTube instead.');
      return;
    }

    // Image size validation
    if (!isVideo && file.size > 10 * 1024 * 1024) {
      setError('Image must be less than 10MB');
      return;
    }

    setError(null);
    setSelectedFile(file);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target.result);
    };
    reader.readAsDataURL(file);
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleUpload = async () => {
    setError(null);
    setSuccess(null);
    setUploading(true);

    try {
      if (activeTab === 'youtube') {
        // YouTube URL upload
        if (!youtubeUrl.trim()) {
          setError('Please enter a YouTube URL');
          setUploading(false);
          return;
        }

        const response = await fetch(`/api/pois/${poiId}/media`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            media_type: 'youtube',
            youtube_url: youtubeUrl,
            caption: caption || null
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to add YouTube video');
        }

        const result = await response.json();
        setSuccess(result.message);
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1500);
      } else {
        // Image or video upload
        if (!selectedFile) {
          setError('Please select a file');
          setUploading(false);
          return;
        }

        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('media_type', activeTab);
        if (caption) {
          formData.append('caption', caption);
        }

        const response = await fetch(`/api/pois/${poiId}/media`, {
          method: 'POST',
          credentials: 'include',
          body: formData
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to upload');
        }

        const result = await response.json();
        setSuccess(result.message);
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1500);
      }
    } catch (err) {
      setError(err.message);
      setUploading(false);
    }
  };

  const renderFileUpload = () => (
    <div className="media-upload-section">
      {!selectedFile ? (
        <div
          className={`media-upload-dropzone ${dragActive ? 'drag-active' : ''}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="upload-icon">📁</div>
          <p>
            Drag and drop your {activeTab} here, or click to browse
          </p>
          <p className="upload-hint">
            {activeTab === 'video'
              ? 'MP4, WebM, or MOV (max 10MB)'
              : 'JPEG, PNG, or WebP (max 10MB)'}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept={
              activeTab === 'video'
                ? 'video/mp4,video/webm,video/quicktime'
                : 'image/jpeg,image/png,image/webp'
            }
            onChange={(e) => handleFileSelect(e.target.files[0])}
            style={{ display: 'none' }}
          />
        </div>
      ) : (
        <div className="media-upload-preview">
          {activeTab === 'image' ? (
            <img src={preview} alt="Preview" />
          ) : (
            <video src={preview} controls />
          )}
          <button
            className="preview-remove"
            onClick={() => {
              setSelectedFile(null);
              setPreview(null);
              if (fileInputRef.current) {
                fileInputRef.current.value = '';
              }
            }}
          >
            Remove
          </button>
          <div className="file-info">
            <strong>{selectedFile.name}</strong>
            <span>
              {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
            </span>
          </div>
        </div>
      )}

      <div className="form-group">
        <label>Caption (optional)</label>
        <input
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Add a caption..."
          maxLength={200}
        />
      </div>
    </div>
  );

  const renderYouTubeForm = () => (
    <div className="media-upload-section">
      <div className="form-group">
        <label>YouTube URL</label>
        <input
          type="url"
          value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
        />
        <p className="upload-hint">
          Paste a YouTube video URL or video ID
        </p>
      </div>

      <div className="form-group">
        <label>Caption (optional)</label>
        <input
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Add a caption..."
          maxLength={200}
        />
      </div>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content media-upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Media</h2>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-tabs">
          <button
            className={activeTab === 'image' ? 'active' : ''}
            onClick={() => {
              setActiveTab('image');
              setSelectedFile(null);
              setPreview(null);
              setError(null);
            }}
          >
            📷 Image
          </button>
          <button
            className={activeTab === 'video' ? 'active' : ''}
            onClick={() => {
              setActiveTab('video');
              setSelectedFile(null);
              setPreview(null);
              setError(null);
            }}
          >
            🎥 Video
          </button>
          <button
            className={activeTab === 'youtube' ? 'active' : ''}
            onClick={() => {
              setActiveTab('youtube');
              setSelectedFile(null);
              setPreview(null);
              setError(null);
            }}
          >
            ▶️ YouTube
          </button>
        </div>

        <div className="modal-body">
          {activeTab === 'youtube' ? renderYouTubeForm() : renderFileUpload()}

          {error && <div className="upload-error">{error}</div>}
          {success && <div className="upload-success">{success}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={uploading}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleUpload}
            disabled={uploading || (!selectedFile && activeTab !== 'youtube')}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}

MediaUploadModal.propTypes = {
  poiId: PropTypes.number.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func.isRequired
};

export default MediaUploadModal;
