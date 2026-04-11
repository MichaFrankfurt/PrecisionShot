import { useRef, useState, useCallback } from 'react';
import { useI18n } from '../i18n/useI18n';

function playClickSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.08);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.1);
    setTimeout(() => ctx.close(), 200);
  } catch {}
}

const BASE_SIZE = 340;
const MIN_SIZE = 240;
const MAX_SIZE = 600;
const STEP = 40;
const RINGS = 10;

export default function TargetCanvas({ shots, onShot, maxShots = 5 }) {
  const { t } = useI18n();
  const svgRef = useRef(null);
  const [size, setSize] = useState(BASE_SIZE);
  const touchedRef = useRef(false); // Prevents click after touch on iOS

  const center = size / 2;
  const ringWidth = (size / 2 - 10) / RINGS;
  const scale = size / BASE_SIZE;

  const getCoords = useCallback((clientX, clientY) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: (clientX - rect.left - center) / scale,
      y: (clientY - rect.top - center) / scale
    };
  }, [center, scale]);

  function handleClick(e) {
    // On touch devices, ignore the synthetic click that follows touchend
    if (touchedRef.current) { touchedRef.current = false; return; }
    if (shots.length >= maxShots) return;
    const coords = getCoords(e.clientX, e.clientY);
    if (coords) { playClickSound(); onShot(coords); }
  }

  function handleTouchEnd(e) {
    if (shots.length >= maxShots) return;
    e.preventDefault();
    touchedRef.current = true; // Block the following click event
    const touch = e.changedTouches[0]; // Use changedTouches for touchend
    if (!touch) return;
    const coords = getCoords(touch.clientX, touch.clientY);
    if (coords) { playClickSound(); onShot(coords); }
  }

  function zoomIn() { setSize(s => Math.min(MAX_SIZE, s + STEP)); }
  function zoomOut() { setSize(s => Math.max(MIN_SIZE, s - STEP)); }

  return (
    <div className="flex flex-col items-center gap-2 sm:gap-3">
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="text-xs sm:text-sm text-gray-400">
          {shots.length}/{maxShots} {t.shots}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); zoomOut(); }}
            className="w-9 h-9 sm:w-8 sm:h-8 rounded bg-surface border border-highlight text-gray-400 hover:text-white hover:border-accent text-lg sm:text-lg transition select-none">−</button>
          <button onClick={zoomIn} onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); zoomIn(); }}
            className="w-9 h-9 sm:w-8 sm:h-8 rounded bg-surface border border-highlight text-gray-400 hover:text-white hover:border-accent text-lg sm:text-lg transition select-none">+</button>
        </div>
      </div>

      <svg
        ref={svgRef}
        width={size}
        height={size}
        onClick={handleClick}
        onTouchEnd={handleTouchEnd}
        className="cursor-crosshair select-none touch-none max-w-full"
        style={{ filter: 'drop-shadow(0 0 20px rgba(227, 27, 35, 0.15))' }}
      >
        <circle cx={center} cy={center} r={center - 5} fill="#0D0D0D" stroke="#2A2A2A" strokeWidth="2" />

        {Array.from({ length: RINGS }, (_, i) => {
          const ringNum = i + 1;
          const r = (RINGS - i) * ringWidth;
          const isInner = i >= 7;
          return (
            <g key={i}>
              <circle cx={center} cy={center} r={r} fill="none"
                stroke={isInner ? 'rgba(227, 27, 35, 0.35)' : 'rgba(42, 42, 42, 0.8)'}
                strokeWidth={isInner ? 1.5 : 1} />
              <text x={center} y={center - r + (size > 300 ? 12 : 9)} textAnchor="middle"
                fill={isInner ? 'rgba(227, 27, 35, 0.5)' : 'rgba(150, 150, 150, 0.4)'}
                fontSize={size > 400 ? 11 : size > 300 ? 9 : 7} fontWeight="500">
                {ringNum}
              </text>
            </g>
          );
        })}

        <circle cx={center} cy={center} r={3} fill="#E31B23" />
        <line x1={center} y1={5} x2={center} y2={size - 5} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
        <line x1={5} y1={center} x2={size - 5} y2={center} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />

        {shots.map((shot, i) => (
          <g key={i}>
            <circle cx={center + shot.x * scale} cy={center + shot.y * scale}
              r={Math.max(5, 8 * scale)} fill="rgba(227, 27, 35, 0.3)" stroke="#E31B23" strokeWidth="2" />
            <text x={center + shot.x * scale} y={center + shot.y * scale + 4}
              textAnchor="middle" fill="white" fontSize={Math.max(7, 10 * scale)} fontWeight="bold">
              {i + 1}
            </text>
          </g>
        ))}
      </svg>

      {shots.length < maxShots && (
        <p className="text-gray-500 text-xs sm:text-sm">{t.clickTarget}</p>
      )}
    </div>
  );
}
