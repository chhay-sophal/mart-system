import { useLocale } from '../i18n/LocaleContext.jsx';

const OPTIONS = [
  { value: 'en', label: 'EN' },
  { value: 'km', label: 'ខ្មែរ' },
];

export default function LanguageToggle() {
  const { locale, setLocale, t } = useLocale();
  return (
    <div role="group" aria-label={t.shell.language} className="flex gap-0.5 bg-slate-100 dark:bg-slate-700 p-0.5 rounded-lg">
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => setLocale(value)}
          aria-pressed={locale === value}
          className={`px-2 py-0.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
            locale === value
              ? 'bg-white dark:bg-slate-900 text-[var(--accent)] shadow-xs'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
