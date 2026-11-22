import { dehydrate, hydrate } from '@tanstack/react-query';

// Shares the query cache between this browser's open IMS tabs, so a list one
// tab has already downloaded isn't downloaded again by another:
//
// - A newly opened tab asks the open ones for their cache ('hello') and
//   starts from it ('snapshot'), before its first page mounts.
// - Whatever one tab fetches (or sets after a save) is copied into the
//   others ('data'), keeping its original fetch time, so each tab's
//   staleness rules still apply as if it had fetched it itself.
// - A save that invalidates data in one tab marks it stale in the others
//   too ('invalidate'), without refetching there: the saving tab's own
//   refetch arrives as 'data', and any other tab refreshes once it's next
//   focused or opens that page.
//
// Memory only (BroadcastChannel), nothing is written to disk. Every message
// carries the signed-in user's id, and a tab only accepts data for its own
// user, only while signed in, so a cache never crosses into another user's
// session.

const CHANNEL = 'ims:query-cache';
const tabId = Math.random().toString(36).slice(2);

let channel = null;
let queryClient = null;
let currentUser = null;
// Snapshots that arrived before this tab finished resuming its session;
// applied once it knows (and matches) the user.
let pendingSnapshots = [];
// Set while applying another tab's change, so it isn't echoed back.
let applyingRemote = false;

function post(message) {
  if (!channel || !currentUser) return;
  try {
    channel.postMessage({ ...message, from: tabId, user: currentUser });
  } catch {
    // Data that can't be structured-cloned just stays local to this tab.
  }
}

function applyRemote(fn) {
  applyingRemote = true;
  try {
    fn();
  } finally {
    applyingRemote = false;
  }
}

function onMessage({ data: msg }) {
  if (!msg || msg.from === tabId || (msg.to && msg.to !== tabId)) return;

  if (msg.type === 'hello') {
    // Answered only while signed in; the newcomer checks the user itself.
    if (!currentUser) return;
    const state = dehydrate(queryClient);
    if (state.queries.length) post({ type: 'snapshot', to: msg.from, state });
    return;
  }

  if (msg.type === 'snapshot' && !currentUser) {
    pendingSnapshots.push(msg);
    return;
  }

  if (!currentUser || msg.user !== currentUser) return;

  if (msg.type === 'snapshot') {
    // hydrate() keeps whichever copy of each query is newer.
    applyRemote(() => hydrate(queryClient, msg.state));
  } else if (msg.type === 'data') {
    const existing = queryClient.getQueryCache().find({ queryKey: msg.queryKey, exact: true });
    if (existing && existing.state.dataUpdatedAt >= msg.dataUpdatedAt) return;
    applyRemote(() => queryClient.setQueryData(msg.queryKey, msg.data, { updatedAt: msg.dataUpdatedAt }));
  } else if (msg.type === 'invalidate') {
    applyRemote(() => queryClient.invalidateQueries({ queryKey: msg.queryKey, exact: true, refetchType: 'none' }));
  }
}

/** Starts syncing `client` with the other tabs. Call once, at startup. */
export function startTabSync(client) {
  if (channel || typeof BroadcastChannel === 'undefined') return;
  queryClient = client;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = onMessage;

  client.getQueryCache().subscribe((event) => {
    if (applyingRemote || !currentUser || event.type !== 'updated') return;
    const { query, action } = event;
    if (action.type === 'success') {
      post({ type: 'data', queryKey: query.queryKey, data: query.state.data, dataUpdatedAt: query.state.dataUpdatedAt });
    } else if (action.type === 'invalidate') {
      post({ type: 'invalidate', queryKey: query.queryKey });
    }
  });

  // Ask before this tab has even resumed its session, so the answer is
  // usually here by the time its first page would fetch. Replies are held
  // in pendingSnapshots until the user is known.
  channel.postMessage({ type: 'hello', from: tabId });
}

/**
 * Who this tab is signed in as (lib/session.js userIdOfToken), or null once
 * signed out. Snapshots received while it was still resuming are applied
 * now, if they're for this user.
 */
export function setTabSyncUser(userId) {
  currentUser = userId || null;
  const pending = pendingSnapshots;
  pendingSnapshots = [];
  if (!currentUser || !queryClient) return;
  for (const msg of pending) {
    if (msg.user === currentUser) applyRemote(() => hydrate(queryClient, msg.state));
  }
}
