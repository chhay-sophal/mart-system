/** Loading / error / empty states, so every page handles them the same way. */
export function Loading({ label = 'Loading…' }) {
  return (
    <p role="status" className="py-16 text-center text-muted">
      {label}
    </p>
  );
}

export function ErrorState({ error, onRetry, title = 'Something went wrong' }) {
  const offline = error?.isNetworkError || error?.status === 0;
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <p className="font-display text-2xl font-bold">{title}</p>
      <p className="text-muted">
        {offline ? 'We couldn’t reach the store. Check your connection and try again.' : 'Please try again in a moment.'}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 rounded-xl border border-line-strong bg-surface px-5 font-semibold"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <p className="font-display text-2xl font-bold">{title}</p>
      {children && <div className="text-muted">{children}</div>}
    </div>
  );
}
