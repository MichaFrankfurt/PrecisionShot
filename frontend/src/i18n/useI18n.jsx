import { createContext, useContext, useState, useEffect } from 'react';
import de from './de.js';
import en from './en.js';
import ru from './ru.js';

const langs = { de, en, ru };
const I18nContext = createContext();

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'de');

  useEffect(() => {
    localStorage.setItem('lang', lang);
  }, [lang]);

  const t = langs[lang] || de;

  return (
    <I18nContext.Provider value={{ t, lang, setLang }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export function LangSwitcher({ className = '' }) {
  const { lang, setLang } = useI18n();
  return (
    <div className={`flex gap-1 ${className}`}>
      {['de', 'en', 'ru'].map(l => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`px-2 py-1 rounded text-xs font-medium transition ${
            lang === l
              ? 'bg-accent text-white'
              : 'bg-highlight/30 text-gray-400 hover:text-white'
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
