import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ModeSelector from '../components/ModeSelector';
import TargetCanvas from '../components/TargetCanvas';
import CameraInput from '../components/CameraInput';
import ImageUpload from '../components/ImageUpload';
import LiveDetection from '../components/LiveDetection';
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
  const [loadingMsg, setLoadingMsg] = useState('');
  const [maxShots, setMaxShots] = useState(5);
  const [error, setError] = useState('');
  const [resetKey, setResetKey] = useState(0);
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

  function handleReset() {
    setShots([]);
    setResult(null);
    setError('');
    setLoadingMsg('');
    setResetKey(k => k + 1);
  }

  function handleModeChange(newMode) {
    setMode(newMode);
    handleReset();
  }

  // Manual mode: analyze shots that were clicked on canvas
  async function handleAnalyze() {
    setLoading(true);
    setError('');
    try {
      const analysis = await api.analyze(shots, lang);
      setResult(analysis);
      await api.createSession({
        shots: analysis.shots,
        total_score: analysis.total_score,
        ai_feedback: analysis.ai_feedback
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Live mode: shots come from frame differencing, go straight to analysis
  async function handleLiveShotsComplete(liveShots) {
    setShots(liveShots);
    setLoading(true);
    setError('');
    setLoadingMsg(t.aiAnalyzing || 'AI analysiert...');
    try {
      const analysis = await api.analyze(liveShots, lang);
      setResult(analysis);
      await api.createSession({
        shots: analysis.shots,
        total_score: analysis.total_score,
        ai_feedback: analysis.ai_feedback
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  }

  // Camera/Upload mode: detect shots from image AND analyze in one step
  async function handleImageAnalyze(imageBase64) {
    setLoading(true);
    setError('');
    setLoadingMsg(t.detecting || 'Erkenne Treffer...');

    try {
      // Step 1: Detect shots from image
      const token = localStorage.getItem('token');
      const detectRes = await fetch('/api/vision/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image: imageBase64 })
      });
      if (!detectRes.ok) {
        const err = await detectRes.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${detectRes.status}`);
      }
      const detected = await detectRes.json();
      if (!detected.shots?.length) {
        throw new Error(t.noShotsDetected || 'Keine Treffer erkannt');
      }

      // Photo/Upload: use ALL detected shots (maxShots limit only applies to Live/Manual)
      const detectedShots = detected.shots;
      setShots(detectedShots);
      setLoadingMsg(t.aiAnalyzing || 'AI analysiert...');

      // Step 2: Analyze the detected shots
      const analysis = await api.analyze(detectedShots, lang);
      setResult(analysis);
      await api.createSession({
        shots: analysis.shots,
        total_score: analysis.total_score,
        ai_feedback: analysis.ai_feedback
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  }

  const shotsReady = shots.length >= maxShots;

  return (
    <div>
      <h2 className="text-xl sm:text-2xl font-bold mb-3 sm:mb-4">{t.newSeries}</h2>

      <ModeSelector mode={mode} onModeChange={handleModeChange} />

      <div className="grid md:grid-cols-2 gap-4 sm:gap-6">
        <div>
          {mode === 'manual' && (
            <TargetCanvas key={resetKey} shots={shots} onShot={handleShot} maxShots={maxShots} />
          )}
          {mode === 'live' && !result && (
            <LiveDetection maxShots={maxShots} onShotsComplete={handleLiveShotsComplete} />
          )}
          {mode === 'camera' && !result && (
            <CameraInput onAnalyze={handleImageAnalyze} loading={loading} />
          )}
          {mode === 'upload' && !result && (
            <ImageUpload onAnalyze={handleImageAnalyze} loading={loading} />
          )}

          {/* Show target with detected shots after analysis */}
          {mode !== 'manual' && mode !== 'live' && shots.length > 0 && (
            <TargetCanvas key={`r${resetKey}`} shots={shots} onShot={() => {}} maxShots={maxShots} />
          )}
          {mode === 'live' && result && (
            <TargetCanvas key={`l${resetKey}`} shots={shots} onShot={() => {}} maxShots={maxShots} />
          )}
        </div>

        <div className="space-y-4">
          <ShotList shots={result?.shots || shots.map((s, i) => ({ ...s, shot_number: i + 1 }))} />

          {/* Manual mode: analyze button */}
          {mode === 'manual' && shotsReady && !result && (
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="w-full bg-accent hover:bg-accent/80 py-3 rounded-lg font-heading font-semibold tracking-wide transition disabled:opacity-50"
            >
              {loading ? t.aiAnalyzing : t.analyzeSeries}
            </button>
          )}

          {/* Loading indicator */}
          {loading && loadingMsg && (
            <p className="text-accent text-sm text-center animate-pulse">{loadingMsg}</p>
          )}

          {error && <p className="text-accent text-sm text-center">{error}</p>}

          <AIFeedback
            feedback={result?.ai_feedback}
            totalScore={result?.total_score}
            avgScore={result?.avg_score}
            shotsCount={result?.shots_count || result?.shots?.length}
            loading={loading && !loadingMsg}
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

          {shots.length > 0 && !result && !loading && (
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
