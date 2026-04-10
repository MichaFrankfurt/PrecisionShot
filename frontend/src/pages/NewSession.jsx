import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ModeSelector from '../components/ModeSelector';
import TargetCanvas from '../components/TargetCanvas';
import CameraInput from '../components/CameraInput';
import ImageUpload from '../components/ImageUpload';
import ShotList from '../components/ShotList';
import AIFeedback from '../components/AIFeedback';
import { api } from '../api';
import { useI18n } from '../i18n/useI18n';

export default function NewSession() {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState('manual');
  const [shots, setShots] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [maxShots, setMaxShots] = useState(5);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      fetch('/api/settings', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(s => { if (s.shots_per_series) setMaxShots(s.shots_per_series); })
        .catch(() => {});
    }
  }, []);

  function handleShot(pos) {
    if (shots.length < maxShots) {
      setShots(prev => [...prev, pos]);
    }
  }

  function handleShotsDetected(detectedShots) {
    setShots(detectedShots.slice(0, maxShots));
  }

  function handleReset() {
    setShots([]);
    setResult(null);
  }

  function handleModeChange(newMode) {
    setMode(newMode);
    setShots([]);
    setResult(null);
  }

  async function handleAnalyze() {
    setLoading(true);
    try {
      const analysis = await api.analyze(shots, lang);
      setResult(analysis);

      await api.createSession({
        shots: analysis.shots,
        total_score: analysis.total_score,
        ai_feedback: analysis.ai_feedback
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const shotsReady = shots.length >= maxShots;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">{t.newSeries}</h2>

      <ModeSelector mode={mode} onModeChange={handleModeChange} />

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          {mode === 'manual' && (
            <TargetCanvas shots={shots} onShot={handleShot} maxShots={maxShots} />
          )}
          {mode === 'camera' && !shotsReady && !result && (
            <CameraInput onShotsDetected={handleShotsDetected} />
          )}
          {mode === 'upload' && !shotsReady && !result && (
            <ImageUpload onShotsDetected={handleShotsDetected} />
          )}

          {/* Show target with detected shots for camera/upload modes */}
          {mode !== 'manual' && shotsReady && (
            <TargetCanvas shots={shots} onShot={() => {}} maxShots={maxShots} />
          )}
        </div>

        <div className="space-y-4">
          <ShotList shots={result?.shots || shots.map((s, i) => ({ ...s, shot_number: i + 1 }))} />

          {shotsReady && !result && (
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="w-full bg-accent hover:bg-accent/80 py-3 rounded-lg font-heading font-semibold tracking-wide transition disabled:opacity-50"
            >
              {loading ? t.aiAnalyzing : t.analyzeSeries}
            </button>
          )}

          <AIFeedback
            feedback={result?.ai_feedback}
            totalScore={result?.total_score}
            loading={loading}
            maxScore={maxShots * 10}
          />

          {result && (
            <div className="flex gap-3">
              <button
                onClick={handleReset}
                className="flex-1 bg-highlight hover:bg-highlight/80 py-3 rounded-lg font-medium transition"
              >
                {t.newSeriesBtn}
              </button>
              <button
                onClick={() => navigate('/')}
                className="flex-1 bg-surface border border-highlight hover:bg-highlight/30 py-3 rounded-lg font-medium transition"
              >
                {t.dashboard}
              </button>
            </div>
          )}

          {shots.length > 0 && !result && (
            <button
              onClick={handleReset}
              className="w-full bg-surface border border-highlight hover:bg-highlight/30 py-2 rounded-lg text-sm text-gray-400 transition"
            >
              {t.reset}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
