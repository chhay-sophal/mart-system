import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PinIcon, SearchIcon } from '../components/Icons.jsx';
import { EmptyState, ErrorState, Loading } from '../components/Status.jsx';
import { useBranch } from '../state/BranchContext.jsx';

// Store has no coordinates or opening hours yet (build step 3), so this is a
// searchable list with address-based directions rather than the design's map.
export default function BranchesPage() {
  const { stores, branch, chooseBranch, loading, error, reload } = useBranch();
  const [q, setQ] = useState('');
  const navigate = useNavigate();

  if (loading) return <Loading label="Finding branches…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const needle = q.trim().toLowerCase();
  const shown = stores.filter(
    (s) => !needle || s.name.toLowerCase().includes(needle) || (s.address ?? '').toLowerCase().includes(needle),
  );

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 pt-8 pb-16 md:px-8 md:pt-10">
      <h1 className="m-0 font-display text-[36px] font-extrabold tracking-[-0.02em] md:text-[52px]">Our branches</h1>
      {stores.length > 1 && (
        <label className="flex h-12 max-w-xl items-center gap-2.5 rounded-xl border border-line-strong bg-surface px-4 text-muted focus-within:border-brand">
          <SearchIcon />
          <span className="sr-only">Search branches by name or street</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or street"
            className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted"
          />
        </label>
      )}

      {stores.length === 0 ? (
        <EmptyState title="No branches are taking online orders yet" />
      ) : shown.length === 0 ? (
        <EmptyState title="No branch matches that search" />
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((s) => {
            const mine = s.id === branch?.id;
            return (
              <li
                key={s.id}
                className={`flex flex-col gap-4 rounded-[20px] border-2 bg-surface p-5 ${mine ? 'border-brand' : 'border-line'}`}
              >
                <div className="flex flex-col gap-1">
                  <strong className="font-display text-[22px]">{s.name}</strong>
                  {s.address && <span className="text-[15px] text-muted">{s.address}</span>}
                  {s.phone && (
                    <a href={`tel:${s.phone.replace(/\s/g, '')}`} className="self-start text-[15px]">
                      {s.phone}
                    </a>
                  )}
                </div>
                <div className="mt-auto flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      chooseBranch(s.id);
                      navigate('/shop');
                    }}
                    className={`min-h-11 rounded-xl px-4 font-semibold ${
                      mine ? 'bg-brand-soft text-brand' : 'bg-brand text-white hover:bg-brand-dark'
                    }`}
                  >
                    {mine ? 'Your branch · shop now' : 'Shop this branch'}
                  </button>
                  {s.address && (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-11 items-center gap-2 rounded-xl border border-line-strong px-4 font-semibold text-ink no-underline"
                    >
                      <PinIcon className="size-[18px]" />
                      Directions
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
