import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 20_000;
const SOUND_KEY = 'pos.onlineOrderSound';

function readSoundPref() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

// Two short rising tones, generated (no audio file to bundle or load).
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[880, 0], [1320, 0.18]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.32);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    // No audio device — the badge still shows.
  }
}

/**
 * Watches this branch's online orders from anywhere in the POS: how many need
 * the counter (to pack or ready — not ones still awaiting KHQR payment), and a
 * chime when a new one arrives. Online-only, like the screen itself: while
 * offline the count is simply null.
 */
export function useOnlineOrderAlerts(client, enabled) {
  const [count, setCount] = useState(null);
  const [soundOn, setSoundOn] = useState(readSoundPref);
  const seen = useRef(null);
  const soundRef = useRef(soundOn);
  useEffect(() => {
    soundRef.current = soundOn;
  }, [soundOn]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const orders = await client.get('/api/online-orders', { status: 'OPEN' });
        if (cancelled || !Array.isArray(orders)) return;
        const actionable = orders.filter((o) => o.status !== 'AWAITING_PAYMENT');
        setCount(actionable.length);
        const ids = new Set(actionable.map((o) => o.id));
        // The first load only sets the baseline — no chime for orders already waiting at startup.
        if (seen.current && soundRef.current && [...ids].some((id) => !seen.current.has(id))) playChime();
        seen.current = ids;
      } catch {
        if (!cancelled) setCount(null);
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [client, enabled]);

  const toggleSound = useCallback(() => {
    setSoundOn((on) => {
      const next = !on;
      try {
        localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
      } catch {
        // Not persisted; still applies until restart.
      }
      if (next) playChime();
      return next;
    });
  }, []);

  return { count, soundOn, toggleSound };
}
