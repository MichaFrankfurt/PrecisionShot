import { useState } from 'react';
import { api } from '../api';
import { useI18n, LangSwitcher } from '../i18n/useI18n';
import { LogoLogin } from '../components/Logo';

export default function Login({ onLogin }) {
  const { t } = useI18n();
  const [isRegister, setIsRegister] = useState(false);
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = isRegister
        ? await api.register(form)
        : await api.login({ email: form.email, password: form.password });
      onLogin(data.user, data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-primary flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl p-8 w-full max-w-md shadow-2xl border border-highlight">
        <div className="text-center mb-8">
          <LogoLogin />
          <p className="text-light-gray mt-3 text-sm tracking-wide uppercase">{t.subtitle}</p>
          <LangSwitcher className="justify-center mt-4" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
            <input
              type="text"
              placeholder={t.username}
              value={form.username}
              onChange={e => setForm({ ...form, username: e.target.value })}
              className="w-full bg-primary border border-highlight rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:border-accent focus:outline-none"
            />
          )}
          <input
            type="email"
            placeholder={t.email}
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            className="w-full bg-primary border border-highlight rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:border-accent focus:outline-none"
          />
          <input
            type="password"
            placeholder={t.password}
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            className="w-full bg-primary border border-highlight rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:border-accent focus:outline-none"
          />

          {error && <p className="text-accent text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent hover:bg-accent/80 py-3 rounded-lg font-heading font-semibold tracking-wide transition disabled:opacity-50"
          >
            {loading ? '...' : isRegister ? t.register : t.login}
          </button>
        </form>

        <p className="text-center text-gray-500 text-sm mt-4">
          {isRegister ? t.alreadyRegistered : t.noAccount}{' '}
          <button onClick={() => setIsRegister(!isRegister)} className="text-accent hover:underline">
            {isRegister ? t.login : t.register}
          </button>
        </p>

        <a href="/target.html" target="_blank" rel="noopener"
          className="mt-4 flex items-center justify-center gap-2 text-gray-500 hover:text-accent text-xs transition">
          <span>🎯</span>
          <span>{t.downloadTarget}</span>
        </a>
      </div>
    </div>
  );
}
