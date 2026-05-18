import React, { useRef, useState } from 'react';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

function GeoJSONUploader({ geometry, onChange }) {
  const fileInputRef = useRef(null);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState(null);

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    if (file.size > MAX_FILE_SIZE) {
      setError('File too large (max 5MB)');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);

        let geo = null;
        if (parsed.type === 'Feature') {
          geo = parsed.geometry;
        } else if (parsed.type === 'FeatureCollection') {
          if (parsed.features?.length === 1) {
            geo = parsed.features[0].geometry;
          } else if (parsed.features?.length > 1) {
            geo = {
              type: 'GeometryCollection',
              geometries: parsed.features.map(f => f.geometry).filter(Boolean)
            };
          }
        } else if (parsed.type && parsed.coordinates) {
          geo = parsed;
        }

        if (!geo || !geo.type) {
          setError('No valid geometry found in file');
          return;
        }

        const validTypes = ['Point', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'];
        if (!validTypes.includes(geo.type)) {
          setError(`Unsupported geometry type: ${geo.type}`);
          return;
        }

        setFileName(file.name);
        onChange(geo);
      } catch (err) {
        setError('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  };

  const handleClear = () => {
    setFileName(null);
    setError(null);
    onChange(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const hasGeometry = geometry && geometry.type;

  return (
    <div className="geojson-uploader">
      <label>GeoJSON Geometry</label>
      <input
        ref={fileInputRef}
        type="file"
        accept=".geojson,.json"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />
      <div
        className={`geojson-upload-area ${hasGeometry ? 'has-file' : ''}`}
        onClick={() => !hasGeometry && fileInputRef.current?.click()}
      >
        {hasGeometry ? (
          <div className="geojson-file-info">
            <div>
              <div className="geojson-file-name">{fileName || 'Existing geometry'}</div>
              <div className="geojson-file-meta">{geometry.type}</div>
            </div>
            <button
              type="button"
              className="geojson-clear-btn"
              onClick={(e) => { e.stopPropagation(); handleClear(); }}
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="geojson-upload-prompt">
            Click to upload .geojson or .json file
          </div>
        )}
      </div>
      {error && <div className="geojson-error">{error}</div>}
    </div>
  );
}

export default GeoJSONUploader;
