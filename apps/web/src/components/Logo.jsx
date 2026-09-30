import { Link } from 'react-router-dom';
import { MART_NAME } from '../lib/config.js';

export default function Logo({ inverted = false }) {
  const initial = MART_NAME.trim().charAt(0).toUpperCase() || 'M';
  return (
    <Link to="/" className="flex items-center gap-2.5 no-underline">
      <span
        className={`flex size-9 items-center justify-center rounded-[11px] font-display text-xl font-extrabold ${
          inverted ? 'bg-sun text-ink' : 'bg-brand text-white'
        }`}
      >
        {initial}
      </span>
      <span className={`font-display text-[22px] font-bold tracking-tight ${inverted ? 'text-ground' : 'text-ink'}`}>
        {MART_NAME}
      </span>
    </Link>
  );
}
