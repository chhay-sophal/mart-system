import { lazy, Suspense, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PinIcon, SearchIcon } from '../components/Icons.jsx';
import { EmptyState, ErrorState, Loading } from '../components/Status.jsx';
import { useBranch } from '../state/BranchContext.jsx';
import { OpenBadge, WeeklyHours } from '../components/BranchHours.jsx';

// Leaflet only loads when there's actually a map to show.
const BranchMap = lazy(() => import('../components/BranchMap.jsx'));

const hasPin = (s) => s.latitude != null && s.longitude != null;

function directionsUrl(s) {
  const query = hasPin(s) ? `${s.latitude},${s.longitude}` : s.address;
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

function BranchCard({ store, mine, highlighted, onShop }) {
  const directions = directionsUrl(store);
  return (
    <li
      id={`branch-${store.id}`}
      className={`flex scroll-mt-4 flex-col gap-3 rounded-[20px] border-2 bg-surface p-5 transition-shadow ${
        mine ? 'border-brand' : 'border-line'
      } ${highlighted ? 'shadow-[0_0_0_4px_var(--color-sun)]' : ''}`}
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <strong className="font-display text-[22px]">{store.name}</strong>
          <OpenBadge store={store} />
        </div>
        {store.address && <span className="text-[15px] text-muted">{store.address}</span>}
        {store.phone && (
          <a href={`tel:${store.phone.replace(/\s/g, '')}`} className="self-start text-[15px]">
            {store.phone}
          </a>
        )}
      </div>
      <WeeklyHours store={store} />
      <div className="mt-auto flex flex-wrap gap-2.5">
        <button
          type="button"
          onClick={onShop}
          className={`min-h-11 rounded-xl px-4 font-semibold ${
            mine ? 'bg-brand-soft text-brand' : 'bg-brand text-white hover:bg-brand-dark'
          }`}
        >
          {mine ? 'Your branch · shop now' : 'Shop this branch'}
        </button>
        {directions && (
          <a
            href={directions}
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
}

export default function BranchesPage() {
  const { stores, branch, chooseBranch, loading, error, reload } = useBranch();
  const [q, setQ] = useState('');
  const [highlightedId, setHighlightedId] = useState(null);
  const navigate = useNavigate();

  const highlight = useCallback((id) => {
    setHighlightedId(id);
    document.getElementById(`branch-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  if (loading) return <Loading label="Finding branches…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const needle = q.trim().toLowerCase();
  const shown = stores.filter(
    (s) => !needle || s.name.toLowerCase().includes(needle) || (s.address ?? '').toLowerCase().includes(needle),
  );
  const pinned = shown.filter(hasPin);
  const withMap = stores.some(hasPin);

  let list;
  if (stores.length === 0) list = <EmptyState title="No branches are taking online orders yet" />;
  else if (shown.length === 0) list = <EmptyState title="No branch matches that search" />;
  else
    list = (
      <ul className={`m-0 grid list-none gap-4 p-0 ${withMap ? '' : 'md:grid-cols-2 lg:grid-cols-3'}`}>
        {shown.map((s) => (
          <BranchCard
            key={s.id}
            store={s}
            mine={s.id === branch?.id}
            highlighted={s.id === highlightedId}
            onShop={() => {
              chooseBranch(s.id);
              navigate('/shop');
            }}
          />
        ))}
      </ul>
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

      {withMap ? (
        <div className="flex flex-col gap-6 md:flex-row md:items-stretch md:gap-8">
          <div className="order-last md:order-first md:w-[440px] md:shrink-0">{list}</div>
          <div className="md:sticky md:top-4 md:flex-1 md:self-start">
            {pinned.length > 0 ? (
              <Suspense fallback={<div className="h-80 rounded-[28px] bg-[#dce5da] md:h-[520px]" />}>
                <BranchMap stores={pinned} selectedId={highlightedId ?? branch?.id} onSelect={highlight} />
              </Suspense>
            ) : (
              <EmptyState title="None of these branches are on the map yet" />
            )}
          </div>
        </div>
      ) : (
        list
      )}
    </div>
  );
}
