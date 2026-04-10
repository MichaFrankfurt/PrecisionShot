import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n/useI18n';

export default function Dashboard() {
  const { t } = useI18n();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getSessions().then(setSessions).finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-400 text-center mt-12">{t.loading}</p>;

  return (
    <div>
      <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">{t.history}</h2>

      {sessions.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400 text-lg mb-4">{t.noTrainings}</p>
          <Link to="/new" className="bg-accent hover:bg-accent/80 px-6 py-3 rounded-lg font-medium transition inline-block">
            {t.startFirst}
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map(s => (
            <Link
              key={s.id}
              to={`/session/${s.id}`}
              className="block bg-surface rounded-xl p-3 sm:p-4 hover:bg-highlight/30 transition border border-highlight/20"
            >
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-medium">{t.series} #{s.id}</p>
                  <p className="text-gray-400 text-sm">{s.date}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-accent">{s.avg_score?.toFixed(1) || (s.total_score / (s.shots_count || 5)).toFixed(1)}</p>
                  <p className="text-gray-500 text-xs">Ø/10 ({s.shots_count || '?'} {t.shots})</p>
                </div>
              </div>
              {s.ai_feedback && (
                <p className="text-gray-300 text-sm mt-2 line-clamp-1">{
                  (() => {
                    try {
                      const parsed = JSON.parse(s.ai_feedback);
                      return parsed.coaching?.summary || s.ai_feedback;
                    } catch { return s.ai_feedback; }
                  })()
                }</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
