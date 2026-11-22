// An icon-only button. `label` is both its tooltip and its accessible name,
// so the action is never conveyed by the icon alone.
//
//   <IconButton icon={Pencil} label={t.common.edit} tone="accent" onClick={...} />
//
// tone: 'default' (neutral), 'accent' (the primary row action) or 'danger'
// (destructive, e.g. delete). Only for actions whose icon is universally
// understood; anything with consequences or no clear icon stays a text button.
const TONES = {
  default: 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700',
  accent: 'text-[var(--accent)] hover:bg-[var(--accent-bg)]',
  danger: 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40',
};

export default function IconButton({ icon: Icon, label, onClick, tone = 'default', size = 16, disabled = false, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`inline-flex items-center justify-center p-1.5 rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default ${TONES[tone]} ${className}`}
    >
      <Icon size={size} aria-hidden="true" />
    </button>
  );
}
