import { useState, useRef, useEffect, useCallback } from 'react';
import { useI18n } from '../i18n/useI18n';

export default function CameraInput({ onAnalyze, loading }) {
  const { t } = useI18n();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [cameraName, setCameraName] = useState('');

  const startCamera = useCallback(async () => {
    setError('');
    setStarting(true);

    try {
      // Load saved camera from settings
      const token = localStorage.getItem('token');
      let deviceId = '';
      if (token) {
        try {
          const res = await fetch('/api/settings', { headers: { Authorization: `Bearer ${token}` } });
          const s = await res.json();
          deviceId = s.camera_device_id || '';
        } catch {}
      }

      const constraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      };

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }

      // Stop any existing stream first
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      streamRef.current = stream;
      setCameraName(stream.getVideoTracks()[0]?.label || 'Kamera');

      // Assign to video element — videoRef is always in DOM
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        // Use event listener instead of property assignment (more reliable on iOS)
        const onMetadata = () => {
          video.play()
            .then(() => { setCameraReady(true); setStarting(false); })
            .catch(() => { setCameraReady(true); setStarting(false); });
          video.removeEventListener('loadedmetadata', onMetadata);
        };
        video.addEventListener('loadedmetadata', onMetadata);

        // Fallback: if metadata already loaded (e.g. switching cameras)
        if (video.readyState >= 1) {
          video.play()
            .then(() => { setCameraReady(true); setStarting(false); })
            .catch(() => { setCameraReady(true); setStarting(false); });
        }
      }
    } catch (err) {
      setError(t.cameraError + ': ' + err.message);
      setStarting(false);
    }
  }, [t]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  function handleAnalyzeFromCamera() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const frame = canvas.toDataURL('image/jpeg', 0.85);
    // Stop camera
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
    onAnalyze(frame);
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Video element — ALWAYS in DOM, hidden when not streaming */}
      <div className={`w-full ${cameraReady ? '' : 'hidden'}`}>
        {cameraName && <p className="text-gray-500 text-xs text-center mb-2">{cameraName}</p>}
        <div className="relative rounded-xl overflow-hidden border border-highlight bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ width: '100%', height: '280px', objectFit: 'cover', display: 'block' }}
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-48 h-48 border border-accent/40 rounded-full" />
            <div className="absolute w-0.5 h-10 bg-accent/40" />
            <div className="absolute w-10 h-0.5 bg-accent/40" />
          </div>
        </div>
        <button onClick={handleAnalyzeFromCamera} disabled={loading}
          className="w-full mt-4 bg-accent hover:bg-accent/80 py-3 rounded-lg font-heading font-semibold tracking-wide transition disabled:opacity-50">
          {loading ? t.aiAnalyzing : t.analyzeSeries}
        </button>
      </div>

      {/* Start button — shown when camera not active */}
      {!cameraReady && (
        <button onClick={startCamera} disabled={starting}
          className="w-full h-48 sm:h-64 border-2 border-dashed border-highlight hover:border-accent/50 rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer transition disabled:opacity-50">
          <span className="text-4xl opacity-50">📷</span>
          <p className="text-gray-400 text-sm">{starting ? 'Kamera wird gestartet...' : t.cameraStart}</p>
          {!starting && <p className="text-gray-600 text-xs">{t.cameraPermission}</p>}
          {starting && <p className="text-accent text-xs animate-pulse">Bitte warten...</p>}
        </button>
      )}

      {error && <p className="text-accent text-sm text-center">{error}</p>}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
