import { useI18n } from '../i18n/useI18n';

const MODES = [
  { key: 'manual', icon: '🖱️', labelKey: 'modeManual' },
  { key: 'camera', icon: '📷', labelKey: 'modeCamera' },
  { key: 'upload', icon: '📁', labelKey: 'modeUpload' },
];

export default function ModeSelector({ mode, onModeChange }) {
  const { t } = useI18n();

  return (
    <div className="flex gap-2 mb-6">
      {MODES.map(m => (
        <button
          key={m.key}
          onClick={() => onModeChange(m.key)}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-medium transition border ${
            mode === m.key
              ? 'bg-accent/10 border-accent text-white'
              : 'bg-surface border-highlight hover:border-gray-500 text-gray-400'
          }`}
        >
          <span>{m.icon}</span>
          <span>{t[m.labelKey]}</span>
        </button>
      ))}
    </div>
  );
}
