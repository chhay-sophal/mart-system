import { useAuth } from '../auth/AuthContext.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';

/**
 * Labelled store picker over every store the signed-in user can access, with
 * "All stores" as the '' value. Not tied to the AppShell's current store:
 * the page decides the default.
 */
export default function StoreSelect({ value, onChange }) {
  const { stores } = useAuth();
  const { t } = useLocale();

  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{t.common.store}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-[var(--border)] rounded-lg px-3 h-9 text-sm bg-white dark:bg-slate-800"
      >
        <option value="">{t.common.allStores}</option>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}
