import { useState, useEffect } from 'react';
import { useI18n } from '../i18n/useI18n';
import AIFeedback from '../components/AIFeedback';

export default function Progress() {
  const { t, lang } = useI18n();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      fetch('/api/progress', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => { setData(d); setLoading(false); })
        .catch(() => setLoading(false));
    }
  }, []);

  async function generateAISummary() {
    setAiLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/progress/ai?lang=${lang}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const d = await res.json();
      setAiSummary(d.summary || '');
    } catch {}
    setAiLoading(false);
  }

  if (loading) return <p className="text-gray-400 text-center mt-12">{t.loading}</p>;
  if (!data || data.totalSessions < 3) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <span className="text-5xl mb-4 block">📊</span>
        <p className="text-gray-400 text-lg">{t.progressNoData}</p>
        <p className="text-gray-500 text-sm mt-2">Mindestens 3 Serien nötig</p>
      </div>
    );
  }

  const trendColor = data.trend > 0 ? 'text-green-400' : data.trend < 0 ? 'text-red-400' : 'text-gray-400';
  const trendText = data.trend > 0 ? t.progressImproving : data.trend < 0 ? t.progressDeclining : t.progressStable;
  const trendArrow = data.trend > 0 ? '↑' : data.trend < 0 ? '↓' : '→';

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">{t.progress}</h2>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 mb-4 sm:mb-6">
        <div className="bg-surface rounded-xl p-3 sm:p-4 border border-highlight text-center">
          <p className="text-2xl font-bold text-accent">{data.avgScorePerShot?.toFixed(1)}</p>
          <p className="text-gray-500 text-xs">{t.progressAvg} Ø/10</p>
        </div>
        <div className="bg-surface rounded-xl p-3 sm:p-4 border border-highlight text-center">
          <p className="text-2xl font-bold text-white">{data.bestAvgPerShot?.toFixed(1)}</p>
          <p className="text-gray-500 text-xs">{t.progressBest} Ø/10</p>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-highlight text-center">
          <p className="text-2xl font-bold text-white">{data.totalSessions}</p>
          <p className="text-gray-500 text-xs">{t.progressSessions}</p>
        </div>
        <div className="bg-surface rounded-xl p-4 border border-highlight text-center">
          <p className={`text-2xl font-bold ${trendColor}`}>{trendArrow} {Math.abs(data.trend || 0).toFixed(1)}</p>
          <p className="text-gray-500 text-xs">{t.progressTrend}</p>
        </div>
      </div>

      {/* Trend message */}
      <div className={`bg-surface rounded-xl p-4 border border-highlight mb-6 ${trendColor}`}>
        <p className="font-medium">{trendText}</p>
      </div>

      {/* Score History Chart (simple bar chart) */}
      <div className="bg-surface rounded-xl p-5 border border-highlight mb-6">
        <h3 className="text-sm font-medium text-gray-300 mb-4">Score-Verlauf (letzte {data.history?.length} Serien)</h3>
        <div className="flex items-end gap-1" style={{ height: 120 }}>
          {data.history?.map((s, i) => {
            const avg = s.shots_count > 0 ? s.total_score / s.shots_count : 0;
            const pct = (avg / 10) * 100;
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${s.date}: ${avg.toFixed(1)} Ø/10 (${s.shots_count} Schuss)`}>
                <div
                  className="w-full rounded-t transition-all"
                  style={{
                    height: `${pct}%`,
                    minHeight: 4,
                    backgroundColor: pct >= 85 ? '#22c55e' : pct >= 65 ? '#eab308' : '#E31B23'
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-2">
          <span className="text-gray-600 text-xs">{data.history?.[0]?.date}</span>
          <span className="text-gray-600 text-xs">{data.history?.[data.history.length - 1]?.date}</span>
        </div>
      </div>

      {/* AI Progress Analysis */}
      <div className="mb-6">
        {!aiSummary && !aiLoading && (
          <button onClick={generateAISummary}
            className="w-full bg-accent hover:bg-accent/80 py-3 rounded-lg font-heading font-semibold tracking-wide transition">
            🧠 AI-Fortschrittsanalyse erstellen
          </button>
        )}
        {aiLoading && (
          <div className="bg-surface rounded-xl p-6 border border-highlight animate-pulse">
            <p className="text-gray-400 text-center">{t.aiAnalyzingShort}</p>
          </div>
        )}
        {aiSummary && (
          <AIFeedback feedback={aiSummary} />
        )}
      </div>
    </div>
  );
}
