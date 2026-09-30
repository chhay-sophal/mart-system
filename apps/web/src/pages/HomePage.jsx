import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import ProductCard from '../components/ProductCard.jsx';
import { ArrowRightIcon, BagIcon, ClockIcon, PulseIcon, ScanIcon } from '../components/Icons.jsx';
import { ErrorState, Loading } from '../components/Status.jsx';
import { aisleOf, aisleTint } from '../lib/format.js';
import { useCatalog } from '../lib/useCatalog.js';
import { useBranch } from '../state/BranchContext.jsx';

const FEATURED_COUNT = 5;

function Hero() {
  return (
    <section className="mx-auto grid max-w-[1200px] items-center gap-10 px-4 pt-10 pb-8 md:grid-cols-2 md:gap-16 md:px-8 md:pt-16">
      <div className="flex flex-col gap-6">
        <span className="flex items-center gap-2 self-start rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-muted">
          <ClockIcon className="size-4" />
          Order ahead · Pick up in store
        </span>
        <h1 className="m-0 font-display text-[42px] leading-[1.02] font-extrabold tracking-[-0.025em] md:text-[68px]">
          Your corner mart, packed and waiting.
        </h1>
        <p className="m-0 max-w-[520px] text-lg leading-relaxed text-muted">
          See what’s on the shelf at your branch right now, add it to your cart, and collect it at the counter.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/shop"
            className="flex min-h-12 items-center gap-2.5 rounded-[14px] bg-brand px-6 text-[17px] font-semibold text-white no-underline hover:bg-brand-dark hover:text-white"
          >
            Start shopping
            <ArrowRightIcon className="size-[18px]" />
          </Link>
          <Link
            to="/branches"
            className="flex min-h-12 items-center rounded-[14px] border border-line-strong bg-surface px-6 text-[17px] font-semibold text-ink no-underline"
          >
            Find a branch
          </Link>
        </div>
        <ul className="m-0 grid list-none gap-5 border-t border-line p-0 pt-6 sm:grid-cols-3">
          {[
            [PulseIcon, 'Live stock', 'from every branch'],
            [ScanIcon, 'Pay with KHQR', 'from any banking app'],
            [BagIcon, 'Grab and go', 'at the counter'],
          ].map(([Icon, title, sub]) => (
            <li key={title} className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-brand">
                <Icon className="size-[18px]" />
              </span>
              <span className="text-sm leading-snug text-muted">
                <strong className="text-ink">{title}</strong>
                <br />
                {sub}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {/* Decorative stand-in until real storefront photography exists. */}
      <div aria-hidden="true" className="hidden h-[520px] grid-cols-2 grid-rows-3 gap-4 md:grid">
        <div className="row-span-2 rounded-[28px] bg-[#e2ecd6]" />
        <div className="rounded-[28px] bg-[#f2e5cc]" />
        <div className="row-span-2 rounded-[28px] bg-sun" />
        <div className="rounded-[28px] bg-[#dce9ef]" />
      </div>
    </section>
  );
}

function SectionHeading({ title, linkTo, linkLabel }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <h2 className="m-0 font-display text-[28px] font-bold tracking-[-0.015em] md:text-[38px]">{title}</h2>
      {linkTo && (
        <Link to={linkTo} className="shrink-0 font-semibold">
          {linkLabel}
        </Link>
      )}
    </div>
  );
}

function Aisles({ products }) {
  const aisles = useMemo(() => {
    const counts = new Map();
    for (const p of products) counts.set(aisleOf(p), (counts.get(aisleOf(p)) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [products]);

  if (aisles.length === 0) return null;
  return (
    <section className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-8 md:px-8">
      <SectionHeading title="Shop by aisle" linkTo="/shop" linkLabel="Browse everything" />
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-6 md:gap-4 md:overflow-visible md:px-0">
        {aisles.map(([aisle, count]) => (
          <Link
            key={aisle}
            to={`/shop?aisle=${encodeURIComponent(aisle)}`}
            className="flex h-28 w-32 shrink-0 flex-col justify-between rounded-[20px] p-4 text-ink no-underline md:h-44 md:w-auto md:p-5"
            style={{ backgroundColor: aisleTint(aisle) }}
          >
            <span className="text-[13px] font-semibold text-muted">
              {count} {count === 1 ? 'item' : 'items'}
            </span>
            <span className="font-display text-lg leading-tight font-bold md:text-[22px]">{aisle}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Featured({ products, branchName }) {
  // No sales-ranking endpoint yet, so this is "what's in stock here", not "popular".
  const featured = useMemo(
    () => products.filter((p) => p.stockLevel === 'IN_STOCK').slice(0, FEATURED_COUNT),
    [products],
  );
  if (featured.length === 0) return null;
  return (
    <section className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-8 md:px-8">
      <SectionHeading title={`On the shelf at ${branchName}`} linkTo="/shop" linkLabel="See all products" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5 md:gap-5">
        {featured.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    ['Choose your branch', 'Prices and stock switch to what’s actually on that branch’s shelves.'],
    ['Order and pay', 'Pay with KHQR from your banking app, or pay at the counter when you collect.'],
    ['Collect at the counter', 'Show your order number and your bag is handed over.'],
  ];
  return (
    <section className="mx-auto max-w-[1200px] px-4 pt-8 pb-16 md:px-8">
      <div className="flex flex-col gap-8 rounded-[28px] border border-line bg-surface p-6 md:p-14">
        <h2 className="m-0 font-display text-[28px] font-bold tracking-[-0.015em] md:text-[38px]">How pickup works</h2>
        <ol className="m-0 grid list-none gap-8 p-0 md:grid-cols-3 md:gap-10">
          {steps.map(([title, body], i) => (
            <li key={title} className="flex flex-col gap-3">
              <span className="flex size-12 items-center justify-center rounded-full bg-brand font-display text-xl font-extrabold text-white">
                {i + 1}
              </span>
              <h3 className="m-0 text-xl font-bold">{title}</h3>
              <p className="m-0 leading-relaxed text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export default function HomePage() {
  const { branch, error: branchError, reload: reloadBranches } = useBranch();
  const catalog = useCatalog();

  let catalogSection = null;
  if (branchError) catalogSection = <ErrorState error={branchError} onRetry={reloadBranches} />;
  else if (catalog.error) catalogSection = <ErrorState error={catalog.error} onRetry={catalog.reload} />;
  else if (catalog.loading) catalogSection = <Loading label="Loading the shelves…" />;
  else if (branch && catalog.data)
    catalogSection = (
      <>
        <Aisles products={catalog.data} />
        <Featured products={catalog.data} branchName={branch.name} />
      </>
    );

  return (
    <>
      <Hero />
      {catalogSection}
      <HowItWorks />
    </>
  );
}
