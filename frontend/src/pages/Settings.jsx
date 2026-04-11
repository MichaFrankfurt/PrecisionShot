import { useState, useEffect, useRef } from 'react';
import { useI18n } from '../i18n/useI18n';

const DISTANCES = [5, 10, 15, 20, 25];

function CameraSelector({ settings, onSelect }) {
  const { t } = useI18n();
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [previewStream, setPreviewStream] = useState(null);
  const videoRef = useRef(null);

  // Callback ref: assign stream as soon as video element mounts
  const setVideoRef = (el) => {
    videoRef.current = el;
    if (el && previewStream) {
      el.srcObject = previewStream;
      el.onloadedmetadata = () => el.play().catch(() => {});
    }
  };

  async function loadCameras() {
    setLoading(true);
    try {
      // Step 1: Request generic permission
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
      tempStream.getTracks().forEach(t => t.stop());

      // Step 2: First enumeration
      await new Promise(r => setTimeout(r, 300));
      let devices = await navigator.mediaDevices.enumerateDevices();
      let videoDevices = devices.filter(d => d.kind === 'videoinput');

      // Step 3: Try each camera briefly to activate Continuity Camera and get labels
      for (const dev of videoDevices) {
        if (dev.deviceId && !dev.label) {
          try {
            const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: dev.deviceId } } });
            s.getTracks().forEach(t => t.stop());
          } catch {}
        }
      }

      // Step 4: Re-enumerate to pick up any newly activated cameras (iPhone)
      await new Promise(r => setTimeout(r, 500));
      devices = await navigator.mediaDevices.enumerateDevices();
      videoDevices = devices.filter(d => d.kind === 'videoinput');

      setCameras(videoDevices);
    } catch {
      setCameras([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadCameras();
    // Listen for new devices (iPhone plugged in/out)
    navigator.mediaDevices?.addEventListener('devicechange', loadCameras);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', loadCameras);
      if (previewStream) previewStream.getTracks().forEach(t => t.stop());
    };
  }, []);

  // Also handle when stream changes after video is already mounted
  useEffect(() => {
    if (previewStream && videoRef.current) {
      videoRef.current.srcObject = previewStream;
      videoRef.current.onloadedmetadata = () => videoRef.current.play().catch(() => {});
    }
  }, [previewStream]);

  async function selectCamera(deviceId) {
    // Stop old preview
    if (previewStream) {
      previewStream.getTracks().forEach(t => t.stop());
      setPreviewStream(null);
    }

    onSelect(deviceId);

    // Start live preview
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 360 } }
      });
      setPreviewStream(stream);
    } catch (e) {
      console.error('Camera preview error:', e);
    }
  }

  return (
    <div className="bg-surface rounded-xl p-5 border border-highlight">
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm font-medium text-gray-300">{t.camera}</label>
        <button onClick={loadCameras}
          className="text-xs text-gray-500 hover:text-accent transition">
          🔄 Aktualisieren
        </button>
      </div>
      <p className="text-gray-500 text-xs mb-3">{t.cameraHint}</p>

      {/* Live Preview — always in DOM, hidden when no stream */}
      <div className={`mb-3 rounded-lg overflow-hidden border border-highlight bg-black ${previewStream ? '' : 'hidden'}`}>
        <video ref={setVideoRef} autoPlay playsInline muted
          style={{ width: '100%', height: '160px', objectFit: 'cover', display: 'block' }} />
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">{t.loading}</p>
      ) : cameras.length === 0 ? (
        <p className="text-gray-500 text-sm">{t.noCamera}</p>
      ) : (
        <div className="space-y-2">
          {cameras.map((cam, i) => {
            const label = cam.label || `Kamera ${i + 1}`;
            const isIphone = /iphone|continuity|ipad/i.test(label);
            const isFacetime = /facetime/i.test(label);
            const isDesk = /schreibtisch|desk/i.test(label);
            return (
              <button
                key={cam.deviceId}
                onClick={() => selectCamera(cam.deviceId)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition border ${
                  settings?.camera_device_id === cam.deviceId
                    ? 'border-accent/30 bg-accent/5 text-white'
                    : 'border-highlight text-gray-400 hover:border-gray-500'
                }`}
              >
                <span className="text-xl">
                  {isIphone ? '📱' : isDesk ? '🖥️' : isFacetime ? '💻' : '📷'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{label}</p>
                  {isIphone && <p className="text-gray-500 text-xs">iPhone / iPad</p>}
                </div>
                {settings?.camera_device_id === cam.deviceId && (
                  <span className="text-accent text-sm">✓</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const { t } = useI18n();
  const [settings, setSettings] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch('/api/settings', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { setSettings(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setSaveError('');

    try {
      const token = localStorage.getItem('token');
      const body = { ...settings };
      if (apiKey) body.openai_key = apiKey;
      if (anthropicKey) body.anthropic_key = anthropicKey;

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const updated = await res.json();
      setSettings(updated);
      setApiKey('');
      setAnthropicKey('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-gray-400 text-center mt-12">{t.loading}</p>;

  return (
    <div className="max-w-lg mx-auto px-1 sm:px-0">
      <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">{t.settings}</h2>

      <div className="space-y-4 sm:space-y-6">
        {/* Distance */}
        <div className="bg-surface rounded-xl p-3 sm:p-5 border border-highlight">
          <label className="block text-sm font-medium text-gray-300 mb-3">{t.distance}</label>
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {DISTANCES.map(d => (
              <button
                key={d}
                onClick={() => setSettings({ ...settings, distance: d })}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition border min-w-[48px] ${
                  settings?.distance === d
                    ? 'bg-accent/10 border-accent text-white'
                    : 'bg-primary border-highlight text-gray-400 hover:border-gray-500'
                }`}
              >
                {d}m
              </button>
            ))}
          </div>
        </div>

        {/* Target Download */}
        <a href="/target.html" target="_blank" rel="noopener"
          className="block bg-surface rounded-xl p-3 sm:p-5 border border-highlight hover:border-accent/30 transition">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🎯</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-white">{t.downloadTarget}</p>
              <p className="text-gray-500 text-xs">{t.downloadTargetHint}</p>
            </div>
            <span className="text-accent text-lg">↗</span>
          </div>
        </a>

        {/* Shots per Series — Number Input */}
        <div className="bg-surface rounded-xl p-3 sm:p-5 border border-highlight">
          <label className="block text-sm font-medium text-gray-300 mb-3">{t.shotsPerSeries}</label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSettings({ ...settings, shots_per_series: Math.max(1, (settings?.shots_per_series || 5) - 1) })}
              className="w-12 h-12 rounded-lg bg-primary border border-highlight text-white text-xl font-bold hover:border-accent transition"
            >
              −
            </button>
            <input
              type="number"
              min="1"
              max="99"
              value={settings?.shots_per_series || 5}
              onChange={e => {
                const val = parseInt(e.target.value) || 1;
                setSettings({ ...settings, shots_per_series: Math.max(1, Math.min(99, val)) });
              }}
              className="w-20 h-12 text-center text-2xl font-bold bg-primary border border-highlight rounded-lg text-white focus:border-accent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              onClick={() => setSettings({ ...settings, shots_per_series: Math.min(99, (settings?.shots_per_series || 5) + 1) })}
              className="w-12 h-12 rounded-lg bg-primary border border-highlight text-white text-xl font-bold hover:border-accent transition"
            >
              +
            </button>
          </div>
        </div>

        {/* Target Type */}
        <div className="bg-surface rounded-xl p-3 sm:p-5 border border-highlight">
          <label className="block text-sm font-medium text-gray-300 mb-3">{t.targetType}</label>
          <div className="flex gap-2">
            {[
              { key: 'monitor', label: t.targetMonitor, icon: '🖥️' },
              { key: 'paper', label: t.targetPaper, icon: '🎯' }
            ].map(opt => (
              <button
                key={opt.key}
                onClick={() => setSettings({ ...settings, target_type: opt.key })}
                className={`flex-1 py-3 rounded-lg text-sm font-medium transition border flex items-center justify-center gap-2 ${
                  settings?.target_type === opt.key
                    ? 'bg-accent/10 border-accent text-white'
                    : 'bg-primary border-highlight text-gray-400 hover:border-gray-500'
                }`}
              >
                <span>{opt.icon}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Camera */}
        <CameraSelector settings={settings} onSelect={(id) => setSettings({ ...settings, camera_device_id: id })} />

        {/* Training Type */}
        <div className="bg-surface rounded-xl p-3 sm:p-5 border border-highlight">
          <label className="block text-sm font-medium text-gray-300 mb-3">{t.trainingType}</label>
          <div className="flex gap-2">
            {[
              { key: 'live', label: t.trainingLive, icon: '💥' },
              { key: 'laser', label: t.trainingLaser, icon: '🔴' }
            ].map(opt => (
              <button
                key={opt.key}
                onClick={() => setSettings({ ...settings, training_type: opt.key })}
                className={`flex-1 py-3 rounded-lg text-sm font-medium transition border flex items-center justify-center gap-2 ${
                  settings?.training_type === opt.key
                    ? 'bg-accent/10 border-accent text-white'
                    : 'bg-primary border-highlight text-gray-400 hover:border-gray-500'
                }`}
              >
                <span>{opt.icon}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* AI Provider — Radio-Auswahl mit jeweiligem Key-Feld */}
        <div className="bg-surface rounded-xl p-3 sm:p-5 border border-highlight">
          <label className="block text-sm font-medium text-gray-300 mb-4">{t.aiProvider}</label>

          {/* OpenAI */}
          <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-primary/50 transition mb-3"
            onClick={() => setSettings({ ...settings, ai_provider: 'openai' })}>
            <input type="radio" name="provider" checked={settings?.ai_provider !== 'claude'}
              onChange={() => setSettings({ ...settings, ai_provider: 'openai' })}
              className="mt-1 accent-[#E31B23]" />
            <div className="flex-1">
              <p className="text-white font-medium">🤖 {t.providerOpenAI}</p>
              <p className="text-gray-500 text-xs mt-1">{t.apiKeyHint}</p>
              {settings?.has_openai_key && (
                <p className="text-green-400 text-xs mt-1">✓ {settings.openai_key_masked}</p>
              )}
              {settings?.ai_provider !== 'claude' && (
                <input type="password" placeholder={t.apiKeyPlaceholder} value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  className="mt-2 w-full bg-primary border border-highlight rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-accent focus:outline-none text-sm font-mono" />
              )}
            </div>
          </label>

          {/* Claude */}
          <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-primary/50 transition"
            onClick={() => setSettings({ ...settings, ai_provider: 'claude' })}>
            <input type="radio" name="provider" checked={settings?.ai_provider === 'claude'}
              onChange={() => setSettings({ ...settings, ai_provider: 'claude' })}
              className="mt-1 accent-[#E31B23]" />
            <div className="flex-1">
              <p className="text-white font-medium">🧠 {t.providerClaude}</p>
              <p className="text-gray-500 text-xs mt-1">{t.anthropicKeyHint}</p>
              {settings?.has_anthropic_key && (
                <p className="text-green-400 text-xs mt-1">✓ {settings.anthropic_key_masked}</p>
              )}
              {settings?.ai_provider === 'claude' && (
                <input type="password" placeholder={t.anthropicKeyPlaceholder} value={anthropicKey}
                  onChange={e => setAnthropicKey(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  className="mt-2 w-full bg-primary border border-highlight rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-accent focus:outline-none text-sm font-mono" />
              )}
            </div>
          </label>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-accent hover:bg-accent/80 py-3 rounded-lg font-heading font-semibold tracking-wide transition disabled:opacity-50"
        >
          {saving ? '...' : t.saveSettings}
        </button>

        {saved && (
          <p className="text-green-400 text-sm text-center">{t.settingsSaved}</p>
        )}
        {saveError && (
          <p className="text-accent text-sm text-center">{saveError}</p>
        )}

        {/* API Usage */}
        <UsageStats />
      </div>
    </div>
  );
}

function UsageStats() {
  const { t } = useI18n();
  const [usage, setUsage] = useState(null);
  const [since, setSince] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return d.toISOString().split('T')[0];
  });

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      fetch(`/api/usage?since=${since}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(setUsage)
        .catch(() => {});
    }
  }, [since]);

  if (!usage) return null;

  return (
    <div className="bg-surface rounded-xl p-5 border border-highlight">
      <div className="flex items-center justify-between mb-3">
        <label className="text-sm font-medium text-gray-300">{t.usage}</label>
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs">{t.usageSince}</span>
          <input type="date" value={since} onChange={e => setSince(e.target.value)}
            className="bg-primary border border-highlight rounded px-2 py-1 text-xs text-gray-300 focus:border-accent focus:outline-none" />
        </div>
      </div>

      {usage.totals.requests === 0 ? (
        <p className="text-gray-500 text-sm">{t.usageNoData}</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-primary rounded-lg p-3 text-center">
              <p className="text-accent text-lg font-bold">${usage.totals.total_cost?.toFixed(4)}</p>
              <p className="text-gray-500 text-xs">{t.usageCost}</p>
            </div>
            <div className="bg-primary rounded-lg p-3 text-center">
              <p className="text-white text-lg font-bold">{usage.totals.requests}</p>
              <p className="text-gray-500 text-xs">{t.usageRequests}</p>
            </div>
            <div className="bg-primary rounded-lg p-3 text-center">
              <p className="text-white text-lg font-bold">{((usage.totals.tokens_in || 0) + (usage.totals.tokens_out || 0)).toLocaleString()}</p>
              <p className="text-gray-500 text-xs">{t.usageTokens}</p>
            </div>
          </div>
          {usage.breakdown?.length > 0 && (
            <div className="text-xs text-gray-500 space-y-1">
              {usage.breakdown.map((b, i) => (
                <div key={i} className="flex justify-between">
                  <span>{b.provider} / {b.endpoint}</span>
                  <span>{b.request_count}x — ${b.total_cost?.toFixed(4)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
