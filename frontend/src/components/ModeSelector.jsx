import { useI18n } from '../i18n/useI18n';

const MODES = [
  { key: 'manual', icon: '🖱️', labelKey: 'modeManual' },
  { key: 'camera', icon: '📷', labelKey: 'modeCamera' },
  { key: 'upload', icon: '📁', labelKey: 'modeUpload' },
];

export default function ModeSelector({ mode, onModeChange }) {
  const { t } = useI18n();

  return (
    <div className="flex gap-1.5 sm:gap-2 mb-4 sm:mb-6">
      {MODES.map(m => (
        <button
          key={m.key}
          onClick={() => onModeChange(m.key)}
          className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-2.5 sm:py-3 rounded-lg text-xs sm:text-sm font-medium transition border min-h-[44px] ${
            mode === m.key
              ? 'bg-accent/10 border-accent text-white'
              : 'bg-surface border-highlight hover:border-gray-500 text-gray-400'
          }`}
        >
          <span className="text-lg sm:text-base">{m.icon}</span>
          <span className="leading-tight">{t[m.labelKey]}</span>
        </button>
      ))}
    </div>
  );
}
