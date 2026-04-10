import { useState, useRef, useEffect, useCallback } from 'react';
import { useI18n } from '../i18n/useI18n';
import { detectLaserShotWithReference } from '../lib/frameDiff';
import { mapPixelToTarget } from '../lib/coordinateMapper';

const PROCESS_WIDTH = 640;
const PROCESS_HEIGHT = 480;
const DETECT_INTERVAL_MS = 150;
const SHOT_COOLDOWN_MS = 600;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

export default function LiveDetection({ maxShots = 5, onShotsComplete }) {
  const { t } = useI18n();
  const videoRef = useRef(null);
  const processCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const loopRef = useRef(null);
  const lastProcessedRef = useRef(0);
  const lastShotTimeRef = useRef(0);
  const referenceDataRef = useRef(null);
  const detectedPixelShotsRef = useRef([]);

  const [phase, setPhase] = useState('idle');
  const [shots, setShots] = useState([]);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');
  const [cameraName, setCameraName] = useState('');
  const [zoom, setZoom] = useState(1);

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

      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
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
          lastShotTimeRef.current = 0;
          setShots([]);
          clearOverlay();
          setPhase('detecting');
        }
      }
    }, 1000);
  }, []);

  // Detection loop
  useEffect(() => {
    if (phase !== 'detecting') return;

    function loop(timestamp) {
      if (timestamp - lastProcessedRef.current < DETECT_INTERVAL_MS) {
        loopRef.current = requestAnimationFrame(loop);
        return;
      }
      lastProcessedRef.current = timestamp;

      const canvas = processCanvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video || video.readyState < 2) {
        loopRef.current = requestAnimationFrame(loop);
        return;
      }

      // Cooldown check
      const now = performance.now();
      if (now - lastShotTimeRef.current < SHOT_COOLDOWN_MS) {
        loopRef.current = requestAnimationFrame(loop);
        return;
      }

      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, PROCESS_WIDTH, PROCESS_HEIGHT);
      const currentData = ctx.getImageData(0, 0, PROCESS_WIDTH, PROCESS_HEIGHT);

      const { newShots } = detectLaserShotWithReference(
        currentData.data,
        referenceDataRef.current,
        PROCESS_WIDTH, PROCESS_HEIGHT,
        detectedPixelShotsRef.current,
        { brightnessThreshold: 200, coreThreshold: 235, dedupeRadius: 40, laserColor: 'red' }
      );

      if (newShots.length > 0) {
        // Only count 1 shot (the largest cluster)
        const bestShot = newShots[0]; // already sorted by size
        const mapped = mapPixelToTarget(bestShot.px, bestShot.py, PROCESS_WIDTH, PROCESS_HEIGHT);

        detectedPixelShotsRef.current = [...detectedPixelShotsRef.current, { px: bestShot.px, py: bestShot.py }];
        lastShotTimeRef.current = now;

        setShots(prev => {
          const next = [...prev, mapped].slice(0, maxShots);
          if (next.length >= maxShots) {
            setPhase('autoAnalyze');
          }
          return next;
        });

        drawOverlay();
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
      const timer = setTimeout(() => {
        if (loopRef.current) cancelAnimationFrame(loopRef.current);
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        setPhase('stopped');
        onShotsComplete(shots);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [phase, shots, onShotsComplete]);

  // Clear overlay canvas
  function clearOverlay() {
    const overlay = overlayCanvasRef.current;
    if (overlay) {
      const ctx = overlay.getContext('2d');
      ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
  }

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
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(227, 27, 35, 0.4)';
      ctx.fill();
      ctx.strokeStyle = '#E31B23';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = 'white';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x, y);
    });
  }

  // Analyze
  function handleAnalyze() {
    setPhase('stopped');
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (shots.length > 0) onShotsComplete(shots);
  }

  // Reset — clears EVERYTHING
  function handleReset() {
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    referenceDataRef.current = null;
    detectedPixelShotsRef.current = [];
    lastShotTimeRef.current = 0;
    setShots([]);
    clearOverlay();

    // If camera is still running, go back to calibrating
    if (streamRef.current) {
      setPhase('calibrating');
      setCountdown(0);
    } else {
      // Camera was stopped — restart
      setPhase('idle');
      startCamera();
    }
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
      {/* Header: Shot counter + Zoom + Status */}
      {phase !== 'idle' && (
        <div className="flex items-center gap-3 flex-wrap justify-center">
          <div className="text-sm text-gray-400">
            <span className="text-2xl font-bold text-accent">{shots.length}</span>
            <span className="text-gray-500">/{maxShots}</span>
          </div>
          {phase === 'detecting' && <span className="text-green-400 text-xs animate-pulse">● LIVE</span>}
          {phase === 'stopped' && <span className="text-yellow-400 text-xs">■ STOP</span>}
          {phase === 'autoAnalyze' && <span className="text-accent text-xs animate-pulse">⏳ Analyse...</span>}
          <div className="flex items-center gap-1">
            <button onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
              onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); setZoom(z => Math.max(MIN_ZOOM, z - ZOOM_STEP)); }}
              className="w-9 h-9 rounded bg-surface border border-highlight text-gray-400 hover:text-white text-lg transition select-none">−</button>
            <span className="text-gray-500 text-xs w-8 text-center">{zoom}x</span>
            <button onClick={() => setZoom(z => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
              onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); setZoom(z => Math.min(MAX_ZOOM, z + ZOOM_STEP)); }}
              className="w-9 h-9 rounded bg-surface border border-highlight text-gray-400 hover:text-white text-lg transition select-none">+</button>
          </div>
        </div>
      )}

      {/* Video + Overlay */}
      <div className={`w-full relative rounded-xl overflow-hidden border border-highlight bg-black ${phase === 'idle' ? 'hidden' : ''}`}>
        <video ref={videoRef} autoPlay playsInline muted
          style={{ width: '100%', height: '280px', objectFit: 'cover', display: 'block', transform: `scale(${zoom})`, transformOrigin: 'center center' }} />
        <canvas ref={overlayCanvasRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />

        {countdown > 0 && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="text-6xl font-bold text-accent animate-pulse">{countdown}</span>
          </div>
        )}

        {phase === 'calibrating' && countdown === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-48 h-48 border-2 border-dashed border-accent/50 rounded-full" />
            <div className="absolute w-0.5 h-12 bg-accent/30" />
            <div className="absolute w-12 h-0.5 bg-accent/30" />
          </div>
        )}
      </div>

      {/* Buttons — ALWAYS show reset when not idle */}
      <div className="w-full space-y-2">
        {phase === 'idle' && (
          <button onClick={startCamera}
            className="w-full h-48 sm:h-64 border-2 border-dashed border-highlight hover:border-accent/50 rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer transition">
            <span className="text-4xl">🔴</span>
            <p className="text-gray-400 text-sm">{t.cameraStart}</p>
            <p className="text-gray-600 text-xs">Live Laser-Erkennung</p>
          </button>
        )}

        {phase === 'calibrating' && countdown === 0 && (
          <>
            <p className="text-gray-400 text-sm text-center">Richte die Kamera auf die Zielscheibe</p>
            <button onClick={captureReference}
              className="w-full bg-accent hover:bg-accent/80 py-3 rounded-lg font-heading font-semibold tracking-wide transition">
              Referenz setzen (3s)
            </button>
          </>
        )}

        {phase === 'detecting' && (
          <button onClick={handleAnalyze}
            className="w-full bg-accent hover:bg-accent/80 py-3 rounded-lg font-heading font-semibold tracking-wide transition">
            {t.analyzeSeries} ({shots.length} {t.shots})
          </button>
        )}

        {phase === 'stopped' && shots.length > 0 && (
          <button onClick={handleAnalyze}
            className="w-full bg-accent hover:bg-accent/80 py-3 rounded-lg font-heading font-semibold tracking-wide transition">
            {t.analyzeSeries}
          </button>
        )}

        {/* RESET — always visible when not idle */}
        {phase !== 'idle' && phase !== 'autoAnalyze' && (
          <button onClick={handleReset}
            className="w-full bg-surface border border-highlight hover:bg-highlight/30 py-2 rounded-lg text-sm text-gray-400 transition">
            {t.reset}
          </button>
        )}
      </div>

      {error && <p className="text-accent text-sm text-center">{error}</p>}
      {cameraName && phase !== 'idle' && <p className="text-gray-600 text-xs">{cameraName}</p>}

      <canvas ref={processCanvasRef} className="hidden" />
    </div>
  );
}
