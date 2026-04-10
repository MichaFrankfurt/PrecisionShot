import { Link } from 'react-router-dom';
import { useI18n, LangSwitcher } from '../i18n/useI18n';
import { LogoFull } from './Logo';

export default function Navbar({ user, onLogout }) {
  const { t } = useI18n();

  return (
    <nav className="bg-surface border-b border-highlight px-4 py-3">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <Link to="/">
          <LogoFull />
        </Link>
        <div className="flex items-center gap-4">
          <LangSwitcher />
          <Link to="/new" className="bg-accent hover:bg-accent/80 px-4 py-2 rounded-lg text-sm font-heading font-semibold tracking-wide transition">
            {t.newSession}
          </Link>
          <Link to="/progress" className="text-gray-400 hover:text-white transition text-sm" title={t.progress}>
            📊
          </Link>
          <Link to="/settings" className="text-gray-400 hover:text-white transition" title={t.settings}>
            ⚙️
          </Link>
          <span className="text-light-gray text-sm">{user.username}</span>
          <button onClick={onLogout} className="text-gray-500 hover:text-white text-sm transition">
            {t.logout}
          </button>
        </div>
      </div>
    </nav>
  );
}
