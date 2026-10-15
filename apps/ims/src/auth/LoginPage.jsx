import { useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import LanguageToggle from '../components/LanguageToggle.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useLocale();
  const l = t.shell.login;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(username, password);
    } catch {
      setError(l.invalid);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white dark:bg-slate-800 border border-[var(--border)] rounded-xl p-8 shadow-sm"
      >
        <div className="flex items-start justify-between gap-3 mb-1">
          <h1 className="text-xl font-semibold text-[var(--text-h)]">{t.shell.appName}</h1>
          <LanguageToggle />
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{l.subtitle}</p>

        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1" htmlFor="username">
          {l.username}
        </label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />

        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1" htmlFor="password">
          {l.password}
        </label>
        <div className="relative mb-4">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-[var(--border)] rounded-lg px-3 py-1.5 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            {showPassword ? l.hide : l.show}
          </button>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-[var(--accent)] text-white rounded-lg py-2 text-sm font-medium disabled:opacity-60 cursor-pointer"
        >
          {submitting ? l.signingIn : l.signIn}
        </button>
      </form>
    </div>
  );
}
