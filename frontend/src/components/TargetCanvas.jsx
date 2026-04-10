import { useRef, useState } from 'react';
import { useI18n } from '../i18n/useI18n';

const BASE_SIZE = 340;
const MIN_SIZE = 280;
const MAX_SIZE = 600;
const STEP = 40;
const RINGS = 10;

export default function TargetCanvas({ shots, onShot, maxShots = 5 }) {
  const { t } = useI18n();
  const svgRef = useRef(null);
  const [size, setSize] = useState(BASE_SIZE);

  const center = size / 2;
  const ringWidth = (size / 2 - 10) / RINGS;
  // Scale factor so shot coordinates stay consistent regardless of zoom
  const scale = size / BASE_SIZE;

  function handleClick(e) {
    if (shots.length >= maxShots) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // Normalize to base coordinate system
    const x = (e.clientX - rect.left - center) / scale;
    const y = (e.clientY - rect.top - center) / scale;
    onShot({ x, y });
  }

  function zoomIn() { setSize(s => Math.min(MAX_SIZE, s + STEP)); }
  function zoomOut() { setSize(s => Math.max(MIN_SIZE, s - STEP)); }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-4">
        <div className="text-sm text-gray-400">
          {shots.length}/{maxShots} {t.shots}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} className="w-8 h-8 rounded bg-surface border border-highlight text-gray-400 hover:text-white hover:border-accent text-lg transition">−</button>
          <button onClick={zoomIn} className="w-8 h-8 rounded bg-surface border border-highlight text-gray-400 hover:text-white hover:border-accent text-lg transition">+</button>
        </div>
      </div>

      <svg
        ref={svgRef}
        width={size}
        height={size}
        onClick={handleClick}
        className="cursor-crosshair select-none"
        style={{ filter: 'drop-shadow(0 0 20px rgba(227, 27, 35, 0.15))' }}
      >
        {/* Background */}
        <circle cx={center} cy={center} r={center - 5} fill="#0D0D0D" stroke="#2A2A2A" strokeWidth="2" />

        {/* Rings with numbers */}
        {Array.from({ length: RINGS }, (_, i) => {
          const ringNum = i + 1; // 1 = outer, 10 = center
          const r = (RINGS - i) * ringWidth;
          const isInner = i >= 7;
          return (
            <g key={i}>
              <circle
                cx={center}
                cy={center}
                r={r}
                fill="none"
                stroke={isInner ? 'rgba(227, 27, 35, 0.35)' : 'rgba(42, 42, 42, 0.8)'}
                strokeWidth={isInner ? 1.5 : 1}
              />
              {/* Ring number label — positioned at top of each ring */}
              <text
                x={center}
                y={center - r + 12}
                textAnchor="middle"
                fill={isInner ? 'rgba(227, 27, 35, 0.5)' : 'rgba(150, 150, 150, 0.4)'}
                fontSize={size > 400 ? 11 : 9}
                fontWeight="500"
              >
                {ringNum}
              </text>
            </g>
          );
        })}

        {/* Center dot */}
        <circle cx={center} cy={center} r={3} fill="#E31B23" />

        {/* Crosshair lines */}
        <line x1={center} y1={5} x2={center} y2={size - 5} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
        <line x1={5} y1={center} x2={size - 5} y2={center} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />

        {/* Shot markers */}
        {shots.map((shot, i) => (
          <g key={i}>
            <circle
              cx={center + shot.x * scale}
              cy={center + shot.y * scale}
              r={Math.max(6, 8 * scale)}
              fill="rgba(227, 27, 35, 0.3)"
              stroke="#E31B23"
              strokeWidth="2"
            />
            <text
              x={center + shot.x * scale}
              y={center + shot.y * scale + 4}
              textAnchor="middle"
              fill="white"
              fontSize={Math.max(8, 10 * scale)}
              fontWeight="bold"
            >
              {i + 1}
            </text>
          </g>
        ))}
      </svg>

      {shots.length < maxShots && (
        <p className="text-gray-500 text-sm">{t.clickTarget}</p>
      )}
    </div>
  );
}
