import { useState, useRef, useEffect, useCallback } from 'react';
import { useI18n } from '../i18n/useI18n';
import { detectNewShots } from '../lib/frameDiff';
import { mapPixelToTarget } from '../lib/coordinateMapper';

const PROCESS_WIDTH = 640;
const PROCESS_HEIGHT = 480;
const DETECT_INTERVAL_MS = 200;

const MIN_HEIGHT = 200;
const MAX_HEIGHT = 500;
const HEIGHT_STEP = 50;

export default function LiveDetection({ maxShots = 5, onShotsComplete }) {
  const { t } = useI18n();
  const [videoHeight, setVideoHeight] = useState(280);
  const videoRef = useRef(null);
  const processCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const loopRef = useRef(null);
  const lastProcessedRef = useRef(0);
  const referenceDataRef = useRef(null);
  const detectedPixelShotsRef = useRef([]); // pixel coords for deduplication

  const [phase, setPhase] = useState('idle'); // idle | calibrating | detecting | stopped
  const [shots, setShots] = useState([]);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');
  const [cameraName, setCameraName] = useState('');

  // Start camera
  const startCamera = useCallback(async () => {
    setError('');
    try {
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
      try { stream = await navigator.mediaDevices.getUserMedia(constraints); }
      catch { stream = await navigator.mediaDevices.getUserMedia({ video: true }); }

      streamRef.current = stream;
      setCameraName(stream.getVideoTracks()[0]?.label || 'Kamera');

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.addEventListener('loadedmetadata', () => {
          video.play().then(() => setPhase('calibrating'));
        }, { once: true });
        if (video.readyState >= 1) video.play().then(() => setPhase('calibrating'));
      }
    } catch (err) {
      setError(t.cameraError + ': ' + err.message);
    }
  }, [t]);

  // Capture reference frame
  const captureReference = useCallback(() => {
    setCountdown(3);
    let count = 3;
    const interval = setInterval(() => {
      count--;
      setCountdown(count);
      if (count <= 0) {
        clearInterval(interval);
        const canvas = processCanvasRef.current;
        const video = videoRef.current;
        if (canvas && video) {
          const ctx = canvas.getContext('2d');
          canvas.width = PROCESS_WIDTH;
          canvas.height = PROCESS_HEIGHT;
          ctx.drawImage(video, 0, 0, PROCESS_WIDTH, PROCESS_HEIGHT);
          referenceDataRef.current = ctx.getImageData(0, 0, PROCESS_WIDTH, PROCESS_HEIGHT).data;
          detectedPixelShotsRef.current = [];
          setShots([]);
          setPhase('detecting');
        }
      }
    }, 1000);
  }, []);

  // Detection loop
  useEffect(() => {
    if (phase !== 'detecting') return;

    function loop(timestamp) {
      if (!referenceDataRef.current) { loopRef.current = requestAnimationFrame(loop); return; }

      if (timestamp - lastProcessedRef.current >= DETECT_INTERVAL_MS) {
        lastProcessedRef.current = timestamp;

        const canvas = processCanvasRef.current;
        const video = videoRef.current;
        if (!canvas || !video || video.readyState < 2) {
          loopRef.current = requestAnimationFrame(loop);
          return;
        }

        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, PROCESS_WIDTH, PROCESS_HEIGHT);
        const currentData = ctx.getImageData(0, 0, PROCESS_WIDTH, PROCESS_HEIGHT).data;

        const { newShots } = detectNewShots(
          referenceDataRef.current, currentData,
          PROCESS_WIDTH, PROCESS_HEIGHT,
          detectedPixelShotsRef.current,
          { threshold: 130, laserColor: 'red', dedupeRadius: 25 }
        );

        if (newShots.length > 0) {
          const mapped = newShots.map(s => mapPixelToTarget(s.px, s.py, PROCESS_WIDTH, PROCESS_HEIGHT));

          detectedPixelShotsRef.current = [
            ...detectedPixelShotsRef.current,
            ...newShots.map(s => ({ px: s.px, py: s.py }))
          ];

          setShots(prev => {
            const next = [...prev, ...mapped].slice(0, maxShots);
            if (next.length >= maxShots) {
              setPhase('autoAnalyze');
            }
            return next;
          });

          // Draw markers on overlay
          drawOverlay();
        }
      }

      if (phase === 'detecting') {
        loopRef.current = requestAnimationFrame(loop);
      }
    }

    loopRef.current = requestAnimationFrame(loop);
    return () => { if (loopRef.current) cancelAnimationFrame(loopRef.current); };
  }, [phase, maxShots]);

  // Auto-analyze when maxShots reached
  useEffect(() => {
    if (phase === 'autoAnalyze') {
      // Small delay so user sees the last shot marker
      const timer = setTimeout(() => {
        if (loopRef.current) cancelAnimationFrame(loopRef.current);
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
          streamRef.current = null;
        }
        setPhase('stopped');
        onShotsComplete(shots);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [phase, shots, onShotsComplete]);

  // Draw shot markers on overlay
  function drawOverlay() {
    const overlay = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!overlay || !video) return;

    const rect = video.getBoundingClientRect();
    overlay.width = rect.width;
    overlay.height = rect.height;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const scaleX = rect.width / PROCESS_WIDTH;
    const scaleY = rect.height / PROCESS_HEIGHT;

    detectedPixelShotsRef.current.forEach((shot, i) => {
      const x = shot.px * scaleX;
      const y = shot.py * scaleY;

      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(227, 27, 35, 0.4)';
      ctx.fill();
      ctx.strokeStyle = '#E31B23';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = 'white';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x, y);
    });
  }

  // Stop and analyze
  function handleAnalyze() {
    setPhase('stopped');
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (shots.length > 0) {
      onShotsComplete(shots);
    }
  }

  // Reset
  function handleReset() {
    referenceDataRef.current = null;
    detectedPixelShotsRef.current = [];
    setShots([]);
    setPhase('calibrating');
    setCountdown(0);
  }

  // Cleanup
  useEffect(() => {
    return () => {
      if (loopRef.current) cancelAnimationFrame(loopRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Shot counter + Zoom */}
      {phase !== 'idle' && (
        <div className="flex items-center gap-3">
          <div className="text-sm text-gray-400">
            <span className="text-2xl font-bold text-accent">{shots.length}</span>
            <span className="text-gray-500">/{maxShots}</span>
          </div>
          {phase === 'detecting' && (
            <span className="text-green-400 text-xs animate-pulse">● LIVE</span>
          )}
          {phase === 'stopped' && (
            <span className="text-yellow-400 text-xs">■ GESTOPPT</span>
          )}
          <div className="flex items-center gap-1">
            <button onClick={() => setVideoHeight(h => Math.max(MIN_HEIGHT, h - HEIGHT_STEP))}
              onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); setVideoHeight(h => Math.max(MIN_HEIGHT, h - HEIGHT_STEP)); }}
              className="w-9 h-9 sm:w-8 sm:h-8 rounded bg-surface border border-highlight text-gray-400 hover:text-white hover:border-accent text-lg transition select-none">−</button>
            <button onClick={() => setVideoHeight(h => Math.min(MAX_HEIGHT, h + HEIGHT_STEP))}
              onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); setVideoHeight(h => Math.min(MAX_HEIGHT, h + HEIGHT_STEP)); }}
              className="w-9 h-9 sm:w-8 sm:h-8 rounded bg-surface border border-highlight text-gray-400 hover:text-white hover:border-accent text-lg transition select-none">+</button>
          </div>
        </div>
      )}

      {/* Video + Overlay */}
      <div className={`w-full relative rounded-xl overflow-hidden border border-highlight bg-black ${phase === 'idle' ? 'hidden' : ''}`}>
        <video ref={videoRef} autoPlay playsInline muted
          style={{ width: '100%', height: `${videoHeight}px`, objectFit: 'cover', display: 'block' }} />
        <canvas ref={overlayCanvasRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />

        {/* Countdown overlay */}
        {countdown > 0 && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="text-6xl font-bold text-accent animate-pulse">{countdown}</span>
          </div>
        )}

        {/* Calibration guide */}
        {phase === 'calibrating' && countdown === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-48 h-48 border-2 border-dashed border-accent/50 rounded-full" />
            <div className="absolute w-0.5 h-12 bg-accent/30" />
            <div className="absolute w-12 h-0.5 bg-accent/30" />
          </div>
        )}
      </div>

      {/* Buttons */}
      {phase === 'idle' && (
        <button onClick={startCamera}
          className="w-full h-48 sm:h-64 border-2 border-dashed border-highlight hover:border-accent/50 rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer transition">
          <span className="text-4xl">🔴</span>
          <p className="text-gray-400 text-sm">{t.cameraStart}</p>
          <p className="text-gray-600 text-xs">Live Laser-Erkennung</p>
        </button>
      )}

      {phase === 'calibrating' && countdown === 0 && (
        <div className="w-full space-y-2">
          <p className="text-gray-400 text-sm text-center">Richte die Kamera auf die Zielscheibe</p>
          <button onClick={captureReference}
            className="w-full bg-accent hover:bg-accent/80 py-3 rounded-lg font-heading font-semibold tracking-wide transition">
            Referenz setzen (3s Countdown)
          </button>
        </div>
      )}

      {phase === 'detecting' && (
        <button onClick={handleAnalyze}
          className="w-full bg-accent hover:bg-accent/80 py-3 rounded-lg font-heading font-semibold tracking-wide transition">
          {t.analyzeSeries} ({shots.length} {t.shots})
        </button>
      )}

      {phase === 'stopped' && shots.length > 0 && (
        <div className="w-full space-y-2">
          <button onClick={handleAnalyze}
            className="w-full bg-accent hover:bg-accent/80 py-3 rounded-lg font-heading font-semibold tracking-wide transition">
            {t.analyzeSeries}
          </button>
          <button onClick={handleReset}
            className="w-full bg-surface border border-highlight hover:bg-highlight/30 py-2 rounded-lg text-sm text-gray-400 transition">
            {t.reset}
          </button>
        </div>
      )}

      {error && <p className="text-accent text-sm text-center">{error}</p>}
      {cameraName && phase !== 'idle' && <p className="text-gray-600 text-xs">{cameraName}</p>}

      {/* Offscreen processing canvas */}
      <canvas ref={processCanvasRef} className="hidden" />
    </div>
  );
}
