import { useState, useRef, useEffect, useCallback } from 'react';
import { useI18n } from '../i18n/useI18n';

export default function CameraInput({ onShotsDetected }) {
  const { t } = useI18n();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [cameraName, setCameraName] = useState('');

  const startCamera = useCallback(async () => {
    setError('');
    setCameraReady(false);
    setStatus('Kamera wird gestartet...');

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
        // Fallback to any camera
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }

      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      setCameraName(track?.label || 'Kamera');

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play().then(() => {
            setCameraReady(true);
            setStatus('');
          });
        };
      }
    } catch (err) {
      setError(t.cameraError + ': ' + err.message);
      setStatus('');
    }
  }, [t]);

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }

  useEffect(() => {
    return () => stopCamera();
  }, []);

  async function handleDetect() {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const frame = canvas.toDataURL('image/jpeg', 0.85);

    setDetecting(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/vision/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image: frame })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error);
      }
      const data = await res.json();
      if (!data.shots?.length) { setError(t.noShotsDetected); return; }
      stopCamera();
      onShotsDetected(data.shots);
    } catch (err) {
      setError(err.message);
    } finally {
      setDetecting(false);
    }
  }

  // Initial state
  if (!cameraReady && !streamRef.current) {
    return (
      <div className="flex flex-col items-center gap-4">
        <button
          onClick={startCamera}
          className="w-full h-64 border-2 border-dashed border-highlight hover:border-accent/50 rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer transition"
        >
          <span className="text-4xl opacity-50">📷</span>
          <p className="text-gray-400 text-sm">{t.cameraStart}</p>
          <p className="text-gray-600 text-xs">{t.cameraPermission}</p>
        </button>
        {error && <p className="text-accent text-sm text-center">{error}</p>}
        <canvas ref={canvasRef} className="hidden" />
        <video ref={videoRef} className="hidden" autoPlay playsInline muted />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Camera name */}
      {cameraName && (
        <p className="text-gray-500 text-xs">{cameraName}</p>
      )}

      <div className="w-full">
        <div className="relative rounded-xl overflow-hidden border border-highlight bg-black">
          <video ref={videoRef} autoPlay playsInline muted
            style={{ width: '100%', height: '280px', objectFit: 'cover', display: 'block' }} />
          {cameraReady && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-48 border border-accent/40 rounded-full" />
              <div className="absolute w-0.5 h-10 bg-accent/40" />
              <div className="absolute w-10 h-0.5 bg-accent/40" />
            </div>
          )}
          {detecting && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <span className="text-accent animate-pulse font-heading font-semibold text-lg">{t.detecting}</span>
            </div>
          )}
        </div>

        {cameraReady && (
          <button onClick={handleDetect} disabled={detecting}
            className="w-full mt-4 bg-accent hover:bg-accent/80 py-3 rounded-lg font-heading font-semibold tracking-wide transition disabled:opacity-50">
            {detecting ? t.detecting : t.detectShots}
          </button>
        )}
      </div>

      {status && <p className="text-gray-400 text-xs">{status}</p>}
      {error && <p className="text-accent text-sm text-center">{error}</p>}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
