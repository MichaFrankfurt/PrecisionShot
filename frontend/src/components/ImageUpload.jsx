import { useState, useRef } from 'react';
import { useI18n } from '../i18n/useI18n';

export default function ImageUpload({ onAnalyze, loading }) {
  const { t } = useI18n();
  const [base64, setBase64] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [imgOk, setImgOk] = useState(false);
  const fileRef = useRef(null);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setFileSize((file.size / 1024 / 1024).toFixed(1) + ' MB');
    setImgOk(false);

    const reader = new FileReader();
    reader.onloadend = () => setBase64(reader.result);
    reader.readAsDataURL(file);
  }

  function handleRemove() {
    setBase64('');
    setFileName('');
    setFileSize('');
    setImgOk(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  if (!base64) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div
          onClick={() => fileRef.current?.click()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f && fileRef.current) { const dt = new DataTransfer(); dt.items.add(f); fileRef.current.files = dt.files; handleFileChange({ target: fileRef.current }); } }}
          onDragOver={(e) => e.preventDefault()}
          className="w-full h-48 sm:h-64 border-2 border-dashed border-highlight hover:border-accent/50 rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer transition"
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
      <div className="relative rounded-xl overflow-hidden border border-highlight bg-surface" style={{ minHeight: 150 }}>
        {/* Actual image — rendered with opacity trick so onLoad fires even if initially invisible */}
        <img
          src={base64}
          alt={fileName}
          onLoad={() => setImgOk(true)}
          style={{
            width: '100%',
            maxHeight: 320,
            objectFit: 'contain',
            opacity: imgOk ? 1 : 0,
            position: imgOk ? 'relative' : 'absolute',
            top: 0,
            left: 0
          }}
        />

        {/* Fallback placeholder — visible when image hasn't loaded */}
        {!imgOk && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <span className="text-4xl">🖼️</span>
            <p className="text-white font-medium text-sm">{fileName}</p>
            <p className="text-gray-500 text-xs">{fileSize}</p>
            <p className="text-green-400 text-xs">✓ Bereit zur Analyse</p>
          </div>
        )}

        <button onClick={handleRemove}
          className="absolute top-2 right-2 z-20 bg-black/80 hover:bg-accent text-white w-8 h-8 rounded-full flex items-center justify-center text-sm transition">
          ✕
        </button>
      </div>

      <button
        onClick={() => onAnalyze(base64)}
        disabled={loading || !base64}
        className="w-full bg-accent hover:bg-accent/80 py-3 rounded-lg font-heading font-semibold tracking-wide transition disabled:opacity-50"
      >
        {loading ? t.aiAnalyzing : t.analyzeSeries}
      </button>

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
    </div>
  );
}
