import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { CartIcon, GridIcon, HomeIcon, PinIcon, SearchIcon } from '../components/Icons.jsx';
import { useBranch } from '../state/BranchContext.jsx';
import { useCart } from '../state/CartContext.jsx';
import { useOpenLabel } from '../lib/useOpenLabel.js';
import { MART_NAME } from '../lib/config.js';

function SearchBox({ className = '' }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  return (
    <form
      role="search"
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        navigate(q.trim() ? `/shop?q=${encodeURIComponent(q.trim())}` : '/shop');
      }}
    >
      <label className="flex h-12 items-center gap-2.5 rounded-xl border border-line bg-ground px-4 text-muted focus-within:border-brand">
        <SearchIcon />
        <span className="sr-only">Search products</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search noodles, rice, drinks…"
          className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted"
        />
      </label>
    </form>
  );
}

function CartCountBadge({ count, className }) {
  if (count === 0) return null;
  return (
    <span
      className={`absolute flex items-center justify-center rounded-full bg-sun font-bold text-ink ${className}`}
      aria-hidden="true"
    >
      {count}
    </span>
  );
}

const cartLabel = (count) => `Cart, ${count} ${count === 1 ? 'item' : 'items'}`;

function CartButton() {
  const { count } = useCart();
  return (
    <Link
      to="/cart"
      aria-label={cartLabel(count)}
      className="relative flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand text-white hover:bg-brand-dark"
    >
      <CartIcon className="size-[22px]" />
      <CartCountBadge count={count} className="-top-1.5 -right-1.5 h-[22px] min-w-[22px] px-1.5 text-xs" />
    </Link>
  );
}

const navClass = ({ isActive }) =>
  `font-semibold no-underline ${isActive ? 'text-brand underline underline-offset-[6px]' : 'text-ink hover:text-brand'}`;

function BranchBar() {
  const { branch, loading } = useBranch();
  const openLabel = useOpenLabel(branch);
  let label;
  if (loading) label = 'Finding branches…';
  else if (branch)
    label = (
      <>
        Picking up from <strong>{branch.name}</strong>
      </>
    );
  else label = 'No branches are taking online orders yet';

  return (
    <div className="bg-ink text-sm text-ground">
      <div className="mx-auto flex max-w-[1200px] items-center gap-3 px-4 py-2.5 md:px-8">
        <PinIcon className="size-[18px] shrink-0" />
        <span className="truncate">{label}</span>
        {openLabel && (
          <>
            <span className="hidden text-faint sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="hidden truncate sm:inline">{openLabel}</span>
          </>
        )}
        <Link to="/branches" className="ml-auto shrink-0 font-semibold text-sun hover:text-sun">
          Change branch
        </Link>
      </div>
    </div>
  );
}

const tabClass = ({ isActive }) =>
  `flex min-h-13 flex-col items-center justify-center gap-1 text-xs no-underline ${
    isActive ? 'font-bold text-brand' : 'font-semibold text-muted'
  }`;

function MobileTabBar() {
  const { count } = useCart();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line bg-surface px-2 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] md:hidden"
    >
      <NavLink to="/" end className={tabClass}>
        <HomeIcon className="size-[22px]" />
        Home
      </NavLink>
      <NavLink to="/shop" className={tabClass}>
        <GridIcon className="size-[22px]" />
        Shop
      </NavLink>
      <NavLink to="/branches" className={tabClass}>
        <PinIcon className="size-[22px]" />
        Branches
      </NavLink>
      <NavLink to="/cart" className={tabClass} aria-label={cartLabel(count)}>
        <span className="relative">
          <CartIcon className="size-[22px]" />
          <CartCountBadge count={count} className="-top-2 left-3.5 h-5 min-w-5 px-1 text-[11px]" />
        </span>
        Cart
      </NavLink>
    </nav>
  );
}

function Footer() {
  return (
    <footer className="bg-ink text-ground">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-10 px-4 pt-12 pb-28 md:px-8 md:pb-10">
        <div className="grid gap-10 sm:grid-cols-3">
          <Logo inverted />
          <div className="flex flex-col gap-2.5">
            <strong className="text-[13px] tracking-[0.08em] text-faint uppercase">Shop</strong>
            <Link to="/shop" className="text-ground no-underline hover:underline">
              All products
            </Link>
            <Link to="/cart" className="text-ground no-underline hover:underline">
              Your cart
            </Link>
          </div>
          <div className="flex flex-col gap-2.5">
            <strong className="text-[13px] tracking-[0.08em] text-faint uppercase">Visit</strong>
            <Link to="/branches" className="text-ground no-underline hover:underline">
              Branch finder
            </Link>
          </div>
        </div>
        <p className="border-t border-[#33443b] pt-6 text-sm text-[#b9c2bc]">
          © {new Date().getFullYear()} {MART_NAME}
        </p>
      </div>
    </footer>
  );
}

export default function SiteLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-30 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3.5 md:flex-nowrap md:px-8">
          <Logo />
          <SearchBox className="order-last w-full md:order-none md:flex-1" />
          <nav aria-label="Main" className="hidden gap-7 text-[15px] md:flex">
            <NavLink to="/shop" className={navClass}>
              Shop
            </NavLink>
            <NavLink to="/branches" className={navClass}>
              Branches
            </NavLink>
          </nav>
          <div className="ml-auto md:ml-0">
            <CartButton />
          </div>
        </div>
      </header>
      <BranchBar />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <MobileTabBar />
    </div>
  );
}
