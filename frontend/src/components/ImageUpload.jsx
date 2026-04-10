import { useState, useRef, useEffect } from 'react';
import { useI18n } from '../i18n/useI18n';

// Convert any image file to a displayable JPEG via canvas
async function fileToPreview(file) {
  // Method 1: createImageBitmap (handles HEIC on Safari, some Chrome versions)
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.9);
    } catch { /* fall through */ }
  }

  // Method 2: Image element + object URL
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Cannot decode image'));
    };
    img.src = url;
  });
}

export default function ImageUpload({ onShotsDetected }) {
  const { t } = useI18n();
  const [previewSrc, setPreviewSrc] = useState('');
  const [base64, setBase64] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [status, setStatus] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setPreviewSrc('');
    setFileName(file.name);
    setFileSize((file.size / 1024 / 1024).toFixed(1) + ' MB');
    setStatus('Bild wird verarbeitet...');

    // Read raw base64 for API
    const reader = new FileReader();
    reader.onloadend = () => setBase64(reader.result);
    reader.readAsDataURL(file);

    // Convert to displayable preview
    fileToPreview(file)
      .then(src => { setPreviewSrc(src); setStatus(''); })
      .catch(() => setStatus('Vorschau nicht verfügbar'));
  }

  async function handleDetect() {
    if (!base64) return;
    setDetecting(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/vision/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image: base64 })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error);
      }
      const data = await res.json();
      if (!data.shots?.length) { setError(t.noShotsDetected); return; }
      onShotsDetected(data.shots);
    } catch (err) {
      setError(err.message);
    } finally {
      setDetecting(false);
    }
  }

  function handleRemove() {
    setPreviewSrc('');
    setBase64('');
    setFileName('');
    setFileSize('');
    setStatus('');
    setError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  if (!base64 && !previewSrc) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div
          onClick={() => fileRef.current?.click()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f && fileRef.current) { const dt = new DataTransfer(); dt.items.add(f); fileRef.current.files = dt.files; handleFileChange({ target: fileRef.current }); } }}
          onDragOver={(e) => e.preventDefault()}
          className="w-full h-64 border-2 border-dashed border-highlight hover:border-accent/50 rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer transition"
        >
          <span className="text-4xl opacity-50">📷</span>
          <p className="text-gray-400 text-sm text-center px-4">{t.uploadHint}</p>
          <p className="text-gray-600 text-xs">{t.uploadFormats}</p>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative rounded-xl overflow-hidden border border-highlight bg-surface" style={{ minHeight: 180 }}>
        {previewSrc ? (
          <img src={previewSrc} alt={fileName} className="w-full object-contain" style={{ maxHeight: 320 }} />
        ) : (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <span className="text-4xl">🖼️</span>
            <p className="text-white font-medium text-sm">{fileName}</p>
            <p className="text-gray-500 text-xs">{fileSize}</p>
            {base64 && <p className="text-green-400 text-xs">✓ Bereit zur Analyse</p>}
          </div>
        )}
        <button onClick={handleRemove}
          className="absolute top-2 right-2 z-20 bg-black/80 hover:bg-accent text-white w-8 h-8 rounded-full flex items-center justify-center text-sm transition">
          ✕
        </button>
      </div>

      <button onClick={handleDetect} disabled={detecting || !base64}
        className="w-full bg-accent hover:bg-accent/80 py-3 rounded-lg font-heading font-semibold tracking-wide transition disabled:opacity-50">
        {detecting ? t.detecting : t.analyzeImage}
      </button>

      {error && <p className="text-accent text-sm text-center">{error}</p>}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
    </div>
  );
}
