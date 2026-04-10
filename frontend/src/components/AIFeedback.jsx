import { useState, useCallback } from 'react';
import { useI18n } from '../i18n/useI18n';

const LANG_VOICES = { de: 'de-DE', en: 'en-US', ru: 'ru-RU' };

function SpeakButton({ text }) {
  const { lang } = useI18n();
  const [speaking, setSpeaking] = useState(false);

  const speak = useCallback(() => {
    if (speaking) {
      speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = LANG_VOICES[lang] || 'de-DE';
    utterance.rate = 0.95;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    const voices = speechSynthesis.getVoices();
    const match = voices.find(v => v.lang.startsWith(lang));
    if (match) utterance.voice = match;
    setSpeaking(true);
    speechSynthesis.speak(utterance);
  }, [text, lang, speaking]);

  return (
    <button onClick={speak} title={speaking ? 'Stop' : 'Vorlesen'}
      className={`p-2 rounded-lg transition text-lg ${speaking ? 'bg-accent/20 text-accent animate-pulse' : 'hover:bg-highlight/30 text-gray-400 hover:text-white'}`}>
      {speaking ? '⏹' : '🔊'}
    </button>
  );
}

export default function AIFeedback({ feedback, totalScore, loading, maxScore }) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="bg-surface rounded-xl p-6 border border-highlight animate-pulse">
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

  // Extract readable text — handle legacy JSON and plain text
  let displayText = feedback;
  try {
    const parsed = JSON.parse(feedback);
    if (parsed.coaching?.summary) {
      displayText = `${parsed.coaching.summary} ${parsed.coaching.next_task || ''}`.trim();
    }
  } catch {
    // Already plain text — perfect
  }

  return (
    <div className="bg-surface rounded-xl p-6 border border-accent/30">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">🧠</span>
          <span className="font-heading font-semibold">{t.aiCoach}</span>
        </div>
        <div className="flex items-center gap-2">
          {totalScore != null && (
            <div className="text-right">
              <span className="text-2xl font-bold text-accent">{totalScore.toFixed(1)}</span>
              <span className="text-gray-500 text-sm"> / {maxScore || 50}</span>
            </div>
          )}
          <SpeakButton text={displayText} />
        </div>
      </div>
      <p className="text-gray-200 leading-relaxed whitespace-pre-line">{displayText}</p>
    </div>
  );
}
