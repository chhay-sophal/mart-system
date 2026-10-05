import { Sun, Monitor, Moon } from 'lucide-react';

const OPTIONS = [
  { value: 'light', Icon: Sun, label: 'Light' },
  { value: 'system', Icon: Monitor, label: 'System' },
  { value: 'dark', Icon: Moon, label: 'Dark' },
];

export default function ThemeToggle({ theme, onChange }) {
  return (
    <div className="flex gap-0.5 bg-slate-100 dark:bg-slate-700 p-0.5 rounded-lg">
      {OPTIONS.map(({ value, Icon, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          title={label}
          aria-label={label}
          aria-pressed={theme === value}
          className={`p-1.5 rounded-md transition-colors cursor-pointer ${
            theme === value
              ? 'bg-white dark:bg-slate-900 text-[var(--accent)] shadow-xs'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}
