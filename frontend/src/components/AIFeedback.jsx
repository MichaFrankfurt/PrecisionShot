import { useState, useCallback, useRef } from 'react';
import { useI18n } from '../i18n/useI18n';

const LANG_VOICES = { de: 'de-DE', en: 'en-US', ru: 'ru-RU' };

function SpeakButton({ text }) {
  const { lang } = useI18n();
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef(null);

  const stop = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(async () => {
    if (speaking) { stop(); return; }
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: text.replace(/---/g, '. '), lang })
      });
      if (res.ok && res.headers.get('content-type')?.includes('audio')) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); audioRef.current = null; };
        setLoading(false); setSpeaking(true); audio.play(); return;
      }
    } catch {}
    // Fallback: Browser TTS
    setLoading(false);
    const utterance = new SpeechSynthesisUtterance(text.replace(/---/g, '. '));
    utterance.lang = LANG_VOICES[lang] || 'de-DE';
    utterance.rate = 0.95;
    utterance.onend = () => setSpeaking(false);
    const voices = speechSynthesis.getVoices();
    const match = voices.find(v => v.lang.startsWith(lang));
    if (match) utterance.voice = match;
    setSpeaking(true); speechSynthesis.speak(utterance);
  }, [text, lang, speaking, stop]);

  return (
    <button onClick={speak} disabled={loading} title={speaking ? 'Stop' : 'Vorlesen'}
      className={`p-2 rounded-lg transition text-lg ${loading ? 'text-gray-500 animate-pulse' : speaking ? 'bg-accent/20 text-accent animate-pulse' : 'hover:bg-highlight/30 text-gray-400 hover:text-white'}`}>
      {loading ? '⏳' : speaking ? '⏹' : '🔊'}
    </button>
  );
}

function parseSections(text) {
  if (!text) return null;

  // Try to parse legacy JSON
  let displayText = text;
  try {
    const parsed = JSON.parse(text);
    if (parsed.coaching?.summary) {
      displayText = `${parsed.coaching.summary} ${parsed.coaching.next_task || ''}`.trim();
    }
  } catch {}

  // Split by --- separator
  const parts = displayText.split(/\n---\n|\n---|\n-{3,}\n/);

  if (parts.length >= 3) {
    return {
      analysis: parts[0].trim(),
      diagnosis: parts[1].trim(),
      nextSeries: parts[2].trim()
    };
  }
  if (parts.length === 2) {
    return { analysis: parts[0].trim(), diagnosis: '', nextSeries: parts[1].trim() };
  }
  return { analysis: displayText, diagnosis: '', nextSeries: '' };
}

function extractTags(text) {
  // Look for "Stichwort | Stichwort" pattern at the start
  const match = text.match(/^([^.!?\n]{3,50}(?:\s*[|•·]\s*[^.!?\n]{3,50})+)/);
  if (match) {
    const tags = match[1].split(/\s*[|•·]\s*/).map(t => t.trim()).filter(Boolean);
    const rest = text.slice(match[0].length).replace(/^\s*[.\n]+/, '').trim();
    return { tags, text: rest };
  }
  return { tags: [], text };
}

export default function AIFeedback({ feedback, totalScore, loading, maxScore, avgScore, shotsCount }) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="bg-surface rounded-xl p-4 sm:p-6 border border-highlight animate-pulse">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🧠</span>
          <span className="text-gray-400">{t.aiAnalyzingShort}</span>
        </div>
        <div className="h-4 bg-highlight/30 rounded w-3/4 mb-2" />
        <div className="h-4 bg-highlight/30 rounded w-full mb-2" />
        <div className="h-4 bg-highlight/30 rounded w-2/3" />
      </div>
    );
  }

  if (!feedback) return null;

  const sections = parseSections(feedback);
  if (!sections) return null;

  const { tags, text: analysisText } = extractTags(sections.analysis);
  const fullText = feedback;
  const displayAvg = avgScore != null ? avgScore : (totalScore != null && shotsCount ? (totalScore / shotsCount).toFixed(1) : null);

  return (
    <div className="space-y-3">
      {/* Header: Score + Speaker */}
      <div className="bg-surface rounded-xl p-4 border border-highlight">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🧠</span>
            <span className="font-heading font-semibold">{t.aiCoach}</span>
          </div>
          <div className="flex items-center gap-3">
            {displayAvg != null && (
              <div className="text-right">
                <span className="text-2xl font-bold text-accent">{displayAvg}</span>
                <span className="text-gray-500 text-sm"> Ø/10</span>
              </div>
            )}
            {totalScore != null && (
              <div className="text-right">
                <span className="text-lg text-gray-400">{totalScore.toFixed(1)}</span>
                <span className="text-gray-600 text-xs"> /{maxScore || 50}</span>
              </div>
            )}
            <SpeakButton text={fullText} />
          </div>
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {tags.map((tag, i) => (
              <span key={i} className="px-2.5 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-medium">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Analyse */}
      {analysisText && (
        <div className="bg-surface rounded-xl p-4 border border-highlight">
          <p className="text-gray-200 leading-relaxed whitespace-pre-line">{analysisText}</p>
          {sections.diagnosis && (
            <p className="text-gray-300 leading-relaxed whitespace-pre-line mt-3 pt-3 border-t border-highlight/50">
              {sections.diagnosis}
            </p>
          )}
        </div>
      )}

      {/* Nächste Serie — hervorgehoben */}
      {sections.nextSeries && (
        <div className="bg-accent/5 rounded-xl p-4 border-2 border-accent/40">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-accent font-heading font-semibold text-sm">→ Nächste Serie</span>
          </div>
          <p className="text-white leading-relaxed whitespace-pre-line">{sections.nextSeries}</p>
        </div>
      )}
    </div>
  );
}
