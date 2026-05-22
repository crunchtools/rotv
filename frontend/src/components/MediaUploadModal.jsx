import { useState, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import './MediaUploadModal.css';

const MAX_REGULAR_IMAGES = 3;
let nextStagedId = 0;

/**
 * MediaUploadModal Component
 * Modal for uploading images, videos, or adding YouTube links.
 * The Image tab supports selecting multiple files at once: regular users may
 * stage up to MAX_REGULAR_IMAGES, admins are unlimited. Each staged image
 * carries its own optional caption and is uploaded sequentially.
 */
function MediaUploadModal({ poiId, onClose, onSuccess }) {
  const { isAdmin } = useAuth();
  const imageLimit = isAdmin ? Infinity : MAX_REGULAR_IMAGES;

  const [activeTab, setActiveTab] = useState('image');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [selectedImages, setSelectedImages] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);

  const fileInputRef = useRef(null);

  const validateFile = (file) => {
    const isVideo = activeTab === 'video';
    const fileName = file.name.toLowerCase();

    const allowedTypes = isVideo
      ? ['video/mp4', 'video/webm', 'video/quicktime']
      : ['image/jpeg', 'image/png', 'image/webp'];

    const allowedExtensions = isVideo
      ? ['.mp4', '.webm', '.mov']
      : ['.jpg', '.jpeg', '.png', '.webp'];

    const hasValidType = allowedTypes.includes(file.type);
    const hasValidExtension = allowedExtensions.some(ext => fileName.endsWith(ext));

    if (!hasValidType && !hasValidExtension) {
      const expected = isVideo ? 'MP4, WebM, or MOV' : 'JPEG, PNG, or WebP';
      return `Please select a ${expected} file`;
    }

    if (file.size > 10 * 1024 * 1024) {
      return isVideo
        ? 'Video must be less than 10MB. Please upload larger videos to YouTube instead.'
        : 'Image must be less than 10MB';
    }

    return null;
  };

  const handleImageSelect = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    setError(null);

    const remaining = imageLimit - selectedImages.length;
    const accepted = [];
    let rejectedForCap = 0;

    for (const file of files) {
      if (accepted.length >= remaining) {
        rejectedForCap += 1;
        continue;
      }
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        continue;
      }
      accepted.push(file);
    }

    if (rejectedForCap > 0 && Number.isFinite(imageLimit)) {
      setError(`You can upload up to ${imageLimit} images at once.`);
    }

    if (accepted.length === 0) return;

    const staged = accepted.map((file) => ({
      id: nextStagedId++,
      file,
      preview: null,
      caption: ''
    }));

    setSelectedImages((prev) => [...prev, ...staged]);

    staged.forEach(({ id, file }) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        setSelectedImages((prev) =>
          prev.map((img) => (img.id === id ? { ...img, preview: e.target.result } : img))
        );
      };
      reader.readAsDataURL(file);
    });
  };

  const handleVideoSelect = (file) => {
    if (!file) return;

    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setSelectedVideo({ file, preview: null });

    const reader = new FileReader();
    reader.onload = (e) => {
      setSelectedVideo((prev) => (prev ? { ...prev, preview: e.target.result } : prev));
    };
    reader.readAsDataURL(file);
  };

  const removeImage = (id) => {
    setSelectedImages((prev) => prev.filter((img) => img.id !== id));
  };

  const updateImageCaption = (id, value) => {
    setSelectedImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, caption: value } : img))
    );
  };

  const switchTab = (tab) => {
    setActiveTab(tab);
    setSelectedImages([]);
    setSelectedVideo(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
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

    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

    if (activeTab === 'video') {
      handleVideoSelect(e.dataTransfer.files[0]);
    } else {
      handleImageSelect(e.dataTransfer.files);
    }
  };

  const uploadFile = async (file, mediaType, itemCaption) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('media_type', mediaType);
    if (itemCaption) {
      formData.append('caption', itemCaption);
    }

    const response = await fetch(`/api/pois/${poiId}/media`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    });

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await response.text();
      throw new Error(`Upload failed (HTTP ${response.status}). Server returned ${contentType || 'unknown content-type'}: ${text.slice(0, 120)}`);
    }

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Upload failed (HTTP ${response.status})`);
    }

    return response.json();
  };

  const handleYouTubeUpload = async () => {
    if (!youtubeUrl.trim()) {
      setError('Please enter a YouTube URL');
      return;
    }

    setUploading(true);
    try {
      const response = await fetch(`/api/pois/${poiId}/media`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'youtube',
          youtube_url: youtubeUrl,
          caption: caption || null
        })
      });

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(`Request failed (HTTP ${response.status}). Server returned ${contentType || 'unknown content-type'}: ${text.slice(0, 120)}`);
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to add YouTube video (HTTP ${response.status})`);
      }

      const result = await response.json();
      setSuccess(result.message);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.message);
      setUploading(false);
    }
  };

  const handleVideoUpload = async () => {
    if (!selectedVideo) {
      setError('Please select a file');
      return;
    }

    setUploading(true);
    try {
      const result = await uploadFile(selectedVideo.file, 'video', caption);
      setSuccess(result.message);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.message);
      setUploading(false);
    }
  };

  const handleImageUpload = async () => {
    if (selectedImages.length === 0) {
      setError('Please select at least one image');
      return;
    }

    setUploading(true);

    const failed = [];
    let succeeded = 0;

    for (let i = 0; i < selectedImages.length; i++) {
      const img = selectedImages[i];
      setProgress({ current: i + 1, total: selectedImages.length });
      try {
        await uploadFile(img.file, 'image', img.caption);
        succeeded += 1;
      } catch (err) {
        failed.push({ id: img.id, error: err.message });
      }
    }

    setProgress(null);

    if (failed.length === 0) {
      setSuccess(`${succeeded} image${succeeded === 1 ? '' : 's'} submitted for review`);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
      return;
    }

    const failedIds = new Set(failed.map((f) => f.id));
    setSelectedImages((prev) => prev.filter((img) => failedIds.has(img.id)));
    setUploading(false);
    setError(`${succeeded} uploaded, ${failed.length} failed. First error: ${failed[0].error}`);
    if (succeeded > 0) {
      onSuccess();
    }
  };

  const handleUpload = () => {
    setError(null);
    setSuccess(null);

    if (activeTab === 'youtube') {
      return handleYouTubeUpload();
    }
    if (activeTab === 'video') {
      return handleVideoUpload();
    }
    return handleImageUpload();
  };

  const renderImageUpload = () => {
    const atLimit = selectedImages.length >= imageLimit;
    return (
      <div className="media-upload-section">
        {!atLimit && (
          <div
            className={`media-upload-dropzone ${dragActive ? 'drag-active' : ''}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="upload-icon">📁</div>
            <p>Drag and drop images here, or click to browse</p>
            <p className="upload-hint">
              JPEG, PNG, or WebP (max 10MB each)
              {Number.isFinite(imageLimit) ? ` — up to ${imageLimit} at once` : ''}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              multiple
              onChange={(e) => {
                handleImageSelect(e.target.files);
                e.target.value = '';
              }}
              style={{ display: 'none' }}
            />
          </div>
        )}

        {selectedImages.length > 0 && (
          <>
            <div className="staged-images-count">
              {selectedImages.length}
              {Number.isFinite(imageLimit) ? ` / ${imageLimit}` : ''} selected
            </div>
            <div className="staged-images-list">
              {selectedImages.map((img) => (
                <div key={img.id} className="staged-image">
                  <div className="staged-image-thumb">
                    {img.preview ? (
                      <img src={img.preview} alt={img.file.name} />
                    ) : (
                      <div className="staged-image-loading">…</div>
                    )}
                  </div>
                  <div className="staged-image-details">
                    <div className="file-info">
                      <strong>{img.file.name}</strong>
                      <span>{(img.file.size / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                    <input
                      type="text"
                      className="staged-image-caption"
                      value={img.caption}
                      onChange={(e) => updateImageCaption(img.id, e.target.value)}
                      placeholder="Caption (optional)"
                      maxLength={200}
                      disabled={uploading}
                    />
                  </div>
                  <button
                    className="staged-image-remove"
                    onClick={() => removeImage(img.id)}
                    disabled={uploading}
                    aria-label={`Remove ${img.file.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  const renderVideoUpload = () => (
    <div className="media-upload-section">
      {!selectedVideo ? (
        <div
          className={`media-upload-dropzone ${dragActive ? 'drag-active' : ''}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="upload-icon">📁</div>
          <p>Drag and drop your video here, or click to browse</p>
          <p className="upload-hint">MP4, WebM, or MOV (max 10MB)</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
            onChange={(e) => handleVideoSelect(e.target.files[0])}
            style={{ display: 'none' }}
          />
        </div>
      ) : (
        <div className="media-upload-preview">
          <video src={selectedVideo.preview} controls />
          <button
            className="preview-remove"
            onClick={() => {
              setSelectedVideo(null);
              if (fileInputRef.current) {
                fileInputRef.current.value = '';
              }
            }}
          >
            Remove
          </button>
          <div className="file-info">
            <strong>{selectedVideo.file.name}</strong>
            <span>{(selectedVideo.file.size / 1024 / 1024).toFixed(2)} MB</span>
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

  const renderTabBody = () => {
    if (activeTab === 'youtube') return renderYouTubeForm();
    if (activeTab === 'video') return renderVideoUpload();
    return renderImageUpload();
  };

  const uploadDisabled =
    uploading ||
    (activeTab === 'image' && selectedImages.length === 0) ||
    (activeTab === 'video' && !selectedVideo) ||
    (activeTab === 'youtube' && !youtubeUrl.trim());

  const uploadLabel = () => {
    if (uploading) {
      if (progress) {
        return `Uploading ${progress.current} of ${progress.total}…`;
      }
      return 'Uploading…';
    }
    if (activeTab === 'image' && selectedImages.length > 1) {
      return `Upload ${selectedImages.length} images`;
    }
    return 'Upload';
  };

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
            onClick={() => switchTab('image')}
          >
            📷 Image
          </button>
          <button
            className={activeTab === 'video' ? 'active' : ''}
            onClick={() => switchTab('video')}
          >
            🎥 Video
          </button>
          <button
            className={activeTab === 'youtube' ? 'active' : ''}
            onClick={() => switchTab('youtube')}
          >
            ▶️ YouTube
          </button>
        </div>

        <div className="modal-body">
          {renderTabBody()}

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
            disabled={uploadDisabled}
          >
            {uploadLabel()}
          </button>
        </div>
      </div>
    </div>
  );
}

export default MediaUploadModal;
