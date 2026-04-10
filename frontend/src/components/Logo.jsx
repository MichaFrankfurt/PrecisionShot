export function LogoIcon({ size = 40, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className}>
      {/* Outer ring */}
      <circle cx="50" cy="50" r="46" fill="none" stroke="#B0B0B0" strokeWidth="3" />
      {/* Middle ring */}
      <circle cx="50" cy="50" r="32" fill="none" stroke="#B0B0B0" strokeWidth="2.5" />
      {/* Inner ring */}
      <circle cx="50" cy="50" r="18" fill="none" stroke="#B0B0B0" strokeWidth="2" />
      {/* Center dot - red */}
      <circle cx="50" cy="50" r="6" fill="#E31B23" />
      {/* Crosshair lines */}
      <line x1="50" y1="4" x2="50" y2="32" stroke="#B0B0B0" strokeWidth="2.5" />
      <line x1="50" y1="68" x2="50" y2="96" stroke="#B0B0B0" strokeWidth="2.5" />
      <line x1="4" y1="50" x2="18" y2="50" stroke="#B0B0B0" strokeWidth="2.5" />
      <line x1="68" y1="50" x2="96" y2="50" stroke="#B0B0B0" strokeWidth="2.5" />
      {/* Letter P */}
      <path d="M42 28 L42 72 M42 28 L58 28 C66 28 70 34 70 42 C70 50 66 54 58 54 L42 54"
        fill="none" stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Laser beam */}
      <line x1="4" y1="76" x2="44" y2="50" stroke="#E31B23" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="44" cy="50" r="3" fill="#E31B23" opacity="0.6" />
    </svg>
  );
}

export function LogoFull({ className = '' }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <LogoIcon size={38} />
      <div className="flex items-baseline gap-0">
        <span className="font-heading text-xl tracking-wider text-white">PRECISION</span>
        <span className="font-heading text-xl tracking-wider font-bold text-accent">SHOT</span>
        <span className="text-sm text-gray-400 ml-0.5">.ai</span>
      </div>
    </div>
  );
}

export function LogoLogin({ className = '' }) {
  return (
    <div className={`flex flex-col items-center gap-4 ${className}`}>
      <LogoIcon size={80} />
      <div className="flex items-baseline gap-0">
        <span className="font-heading text-3xl tracking-wider text-white">PRECISION</span>
        <span className="font-heading text-3xl tracking-wider font-bold text-accent">SHOT</span>
        <span className="text-lg text-gray-400 ml-1">.ai</span>
      </div>
    </div>
  );
}
