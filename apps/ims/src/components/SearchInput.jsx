import { useEffect, useRef } from 'react';

/**
 * A page's top search box. Pair with hooks/useSearch.js. With `shortcut`,
 * pressing "/" anywhere on the page (outside another field) focuses it.
 */
export default function SearchInput({ value, onChange, placeholder, shortcut = false, className = 'flex-1 min-w-64' }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!shortcut) return;
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (e.key !== '/' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcut]);

  return (
    <input
      ref={ref}
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`${className} border border-[var(--border)] rounded-lg px-3 h-9 text-sm bg-white dark:bg-slate-800`}
    />
  );
}
