import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, LangSwitcher } from '../i18n/useI18n';
import { LogoFull, LogoIcon } from './Logo';

export default function Navbar({ user, onLogout }) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="bg-surface border-b border-highlight px-3 md:px-4 py-3">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        {/* Logo — compact on mobile */}
        <Link to="/" className="hidden md:block" onClick={() => setMenuOpen(false)}>
          <LogoFull />
        </Link>
        <Link to="/" className="md:hidden" onClick={() => setMenuOpen(false)}>
          <LogoIcon size={32} />
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-4">
          <LangSwitcher />
          <Link to="/new" className="bg-accent hover:bg-accent/80 px-4 py-2 rounded-lg text-sm font-heading font-semibold tracking-wide transition">
            {t.newSession}
          </Link>
          <Link to="/progress" className="text-gray-400 hover:text-white transition text-sm" title={t.progress}>📊</Link>
          <Link to="/settings" className="text-gray-400 hover:text-white transition" title={t.settings}>⚙️</Link>
          <span className="text-light-gray text-sm">{user.username}</span>
          <button onClick={onLogout} className="text-gray-500 hover:text-white text-sm transition">{t.logout}</button>
        </div>

        {/* Mobile: CTA + Hamburger */}
        <div className="flex md:hidden items-center gap-2">
          <Link to="/new" className="bg-accent hover:bg-accent/80 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold tracking-wide transition"
            onClick={() => setMenuOpen(false)}>
            + {t.newSeries?.split(' ').pop() || 'Serie'}
          </Link>
          <button onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 text-gray-400 hover:text-white transition">
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="md:hidden mt-3 pt-3 border-t border-highlight space-y-1">
          <Link to="/" onClick={() => setMenuOpen(false)}
            className="block px-3 py-2.5 rounded-lg text-gray-300 hover:bg-highlight/30 transition">
            🏠 {t.history}
          </Link>
          <Link to="/new" onClick={() => setMenuOpen(false)}
            className="block px-3 py-2.5 rounded-lg text-gray-300 hover:bg-highlight/30 transition">
            🎯 {t.newSession}
          </Link>
          <Link to="/progress" onClick={() => setMenuOpen(false)}
            className="block px-3 py-2.5 rounded-lg text-gray-300 hover:bg-highlight/30 transition">
            📊 {t.progress}
          </Link>
          <Link to="/settings" onClick={() => setMenuOpen(false)}
            className="block px-3 py-2.5 rounded-lg text-gray-300 hover:bg-highlight/30 transition">
            ⚙️ {t.settings}
          </Link>
          <div className="px-3 py-2.5 flex items-center justify-between">
            <LangSwitcher />
            <div className="flex items-center gap-3">
              <span className="text-gray-400 text-sm">{user.username}</span>
              <button onClick={() => { onLogout(); setMenuOpen(false); }}
                className="text-accent text-sm">{t.logout}</button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
