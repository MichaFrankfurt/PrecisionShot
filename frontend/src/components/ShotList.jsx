import { useI18n } from '../i18n/useI18n';

export default function ShotList({ shots }) {
  const { t } = useI18n();
  if (!shots.length) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-400">{t.shotsList}</h3>
      {shots.map((shot, i) => (
        <div key={i} className="flex items-center justify-between bg-primary/50 rounded-lg px-4 py-2 text-sm">
          <span className="text-gray-400">#{i + 1}</span>
          <span className="text-gray-300">
            x: {shot.x.toFixed(0)}, y: {shot.y.toFixed(0)}
          </span>
          <span className="font-medium text-accent">{shot.score?.toFixed(1) || '—'}</span>
        </div>
      ))}
    </div>
  );
}
