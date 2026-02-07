import React, { useState, useRef } from 'react';

function ImageUploader({
  destinationId,
  hasImage,
  pendingImage,
  onPendingImageChange,
  disabled,
  isVirtualPoi,
  updatedAt
}) {
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  // Determine what to show:
  // 1. If pendingImage.data exists: show preview from data URL
  // 2. If pendingImage.deleted is true: show placeholder
  // 3. If hasImage: show thumbnail from server
  // 4. Otherwise: show upload zone

  const cacheParam = updatedAt || Date.now();
  const serverImageUrl = hasImage ? `/api/pois/${destinationId}/thumbnail?size=medium&v=${cacheParam}` : null;

  let imagePreviewUrl = null;
  let showUploadZone = false;

  if (pendingImage?.data) {
    // Show preview from staged data
    imagePreviewUrl = `data:${pendingImage.mimeType};base64,${pendingImage.data}`;
  } else if (pendingImage?.deleted) {
    // Image marked for deletion, show upload zone
    showUploadZone = true;
  } else if (hasImage) {
    // Show existing image from server
    imagePreviewUrl = serverImageUrl;
  } else {
    // No image at all, show upload zone
    showUploadZone = true;
  }

  const handleFileSelect = async (file) => {
    if (!file) return;

    console.log('[ImageUploader] File selected:', {
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified
    });

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      setError('Please select a JPEG, PNG, WebP, or GIF image');
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be less than 10MB');
      return;
    }

    setError(null);

    try {
      // Read file as base64
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          console.log('[ImageUploader] File read successfully, size:', e.target.result?.length);
          const dataUrl = e.target.result;
          const base64 = dataUrl.split(',')[1];
          resolve(base64);
        };
        reader.onerror = (e) => {
          console.error('[ImageUploader] FileReader error:', e);
          console.error('[ImageUploader] FileReader error details:', {
            error: reader.error,
            readyState: reader.readyState
          });
          reject(new Error('Failed to read file'));
        };
        reader.readAsDataURL(file);
      });

      // Store in parent's state (staging)
      onPendingImageChange({
        data: base64Data,
        mimeType: file.type
      });

      // Reset file input AFTER successful read
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setError(err.message);
      // Reset file input on error too
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDelete = () => {
    if (!confirm('Delete this image?')) return;

    if (hasImage) {
      // Mark existing image for deletion
      onPendingImageChange({ deleted: true });
    } else {
      // Just clear pending image
      onPendingImageChange(null);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleInputChange = (e) => {
    console.log('[ImageUploader] handleInputChange called', {
      hasFiles: !!e.target.files,
      fileCount: e.target.files?.length,
      firstFile: e.target.files?.[0]?.name
    });
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0]);
    } else {
      console.log('[ImageUploader] No file in input change event');
    }
  };

  const handleClick = () => {
    console.log('[ImageUploader] handleClick called, fileInputRef:', !!fileInputRef.current);
    fileInputRef.current?.click();
  };

  return (
    <div className="image-uploader">
      <label>Destination Image</label>

      {error && (
        <div className="image-upload-error">{error}</div>
      )}

      {!showUploadZone ? (
        <div className={`image-preview-container ${isVirtualPoi ? 'virtual-thumbnail' : ''}`}>
          <img
            src={imagePreviewUrl}
            alt="Destination"
            className={`image-preview ${isVirtualPoi ? 'logo-image' : ''}`}
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.nextSibling.style.display = 'flex';
            }}
          />
          <div className="image-load-error" style={{ display: 'none' }}>
            Failed to load image
          </div>
          <div className="image-preview-actions">
            <button
              type="button"
              className="image-change-btn"
              onClick={handleClick}
              disabled={disabled}
            >
              Change
            </button>
            <button
              type="button"
              className="image-delete-btn"
              onClick={handleDelete}
              disabled={disabled}
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`image-drop-zone ${dragActive ? 'drag-active' : ''}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={!disabled ? handleClick : undefined}
        >
          <div className="drop-zone-icon">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
            </svg>
          </div>
          <p className="drop-zone-text">
            Drag & drop an image here<br/>
            or click to select
          </p>
          <p className="drop-zone-hint">
            JPEG, PNG, WebP, or GIF (max 10MB)
          </p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleInputChange}
        style={{ display: 'none' }}
        disabled={disabled}
      />
    </div>
  );
}

export default ImageUploader;
