import { useEffect, useRef, useState } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { availableMonitors, currentMonitor, getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';

const LABEL = 'customer-display';
// No monitor-change event in Tauri, so poll. Cheap: a couple of IPC calls.
const POLL_MS = 3000;
// A window that never reports created/error mustn't block the poll forever.
const CREATE_TIMEOUT_MS = 8000;
// Dev builds only: with one monitor, the display can be opened as an ordinary
// window on the same screen to see what customers will see.
const PREVIEW_ALLOWED = import.meta.env.DEV;

// The customer display on its own monitor: kiosk-style, placed full screen.
const KIOSK_OPTIONS = {
  visible: false,
  focus: false,
  decorations: false,
  resizable: false,
  skipTaskbar: true,
  alwaysOnTop: true,
};

// The dev preview: an ordinary window to move around next to the register.
const PREVIEW_OPTIONS = {
  title: 'Customer Display (preview)',
  width: 1280,
  height: 720,
  center: true,
  focus: false,
  decorations: true,
  resizable: true,
};

const sameMonitor = (a, b) =>
  a && b && a.position.x === b.position.x && a.position.y === b.position.y && a.size.width === b.size.width && a.size.height === b.size.height;

const describe = (err) => (err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err));

async function createDisplayWindow(options) {
  // A window left over from an earlier attempt (or a dev reload) would make
  // creating another with the same label fail on every retry.
  const leftover = await WebviewWindow.getByLabel(LABEL);
  if (leftover) await leftover.close().catch(() => {});
  return new WebviewWindow(LABEL, { url: '/?window=customer', title: 'Customer Display', ...options });
}

function waitUntilCreated(win) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the window did not open in time')), CREATE_TIMEOUT_MS);
    win.once('tauri://created', () => {
      clearTimeout(timer);
      resolve();
    });
    win.once('tauri://error', (e) => {
      clearTimeout(timer);
      reject(new Error(describe(e.payload ?? e)));
    });
  });
}

/**
 * Shows the customer display automatically whenever a second monitor is
 * attached: full screen there, kiosk-style (no frame, no taskbar entry,
 * always on top), without taking focus from the register. It's closed when
 * that monitor goes away and follows it if it moves.
 *
 * Returns { open, monitorCount, monitorName, error, preview, canPreview,
 * setPreview } -- `open` gates the register's cart broadcasts; the rest is
 * shown in Settings > General so a display that doesn't appear can be
 * diagnosed at the till. In dev builds, setPreview(true) opens the display in
 * a normal, movable window instead; monitor polling pauses while it's open.
 */
export function useCustomerDisplay(enabled, onError) {
  const [status, setStatus] = useState({ open: false, monitorCount: null, monitorName: null, error: null });
  const [preview, setPreview] = useState(false);
  const previewRef = useRef(false);
  const windowRef = useRef(null);
  const monitorRef = useRef(null);
  const busyRef = useRef(false);
  const lastErrorRef = useRef(null);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const main = getCurrentWindow();

    async function placeOn(win, monitor) {
      await win.setFullscreen(false);
      await win.setPosition(new PhysicalPosition(monitor.position.x, monitor.position.y));
      await win.setSize(new PhysicalSize(monitor.size.width, monitor.size.height));
      await win.setFullscreen(true);
      monitorRef.current = monitor;
    }

    async function openOn(monitor) {
      const win = await createDisplayWindow(KIOSK_OPTIONS);
      windowRef.current = win;
      try {
        await waitUntilCreated(win);
        win.once('tauri://destroyed', () => {
          windowRef.current = null;
          monitorRef.current = null;
          setStatus((s) => ({ ...s, open: false, monitorName: null }));
        });
        await placeOn(win, monitor);
        await win.show();
        await main.setFocus(); // keep keyboard/scanner input on the register
        setStatus((s) => ({ ...s, open: true, monitorName: monitor.name ?? null, error: null }));
        lastErrorRef.current = null;
      } catch (err) {
        await close().catch(() => {}); // retried on the next poll
        throw err;
      }
    }

    async function close() {
      const win = windowRef.current;
      windowRef.current = null;
      monitorRef.current = null;
      setStatus((s) => ({ ...s, open: false, monitorName: null }));
      await win?.close();
    }

    async function check() {
      // The dev preview owns the window while it's open.
      if (busyRef.current || cancelled || previewRef.current) return;
      busyRef.current = true;
      try {
        // currentMonitor is a module function in @tauri-apps/api v2, not a Window method.
        const [here, monitors] = await Promise.all([currentMonitor(), availableMonitors()]);
        if (cancelled || previewRef.current) return;
        setStatus((s) => (s.monitorCount === monitors.length ? s : { ...s, monitorCount: monitors.length }));
        // With the register's own monitor unknown, don't guess: the "other"
        // monitor could be the one the register is on.
        const target = here ? monitors.find((m) => !sameMonitor(m, here)) ?? null : null;
        if (!target) {
          if (windowRef.current) await close();
        } else if (!windowRef.current) {
          await openOn(target);
        } else if (!sameMonitor(target, monitorRef.current)) {
          await placeOn(windowRef.current, target);
        }
      } catch (err) {
        const message = describe(err);
        console.error('Customer display:', err);
        setStatus((s) => ({ ...s, error: message }));
        // Report each distinct failure once, not every 3 seconds.
        if (lastErrorRef.current !== message) {
          lastErrorRef.current = message;
          onErrorRef.current?.(message);
        }
      } finally {
        busyRef.current = false;
      }
    }

    check();
    const timer = setInterval(check, POLL_MS);
    // The window isn't closed here: it lives as long as the app (the Rust side
    // exits the app when the main window closes), and closing on cleanup would
    // race React's dev double-mount into opening two windows with one label.
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);

  // The dev preview: opened on request, closed when turned off. Closing the
  // window itself turns it off too; monitor polling then resumes.
  useEffect(() => {
    previewRef.current = preview;
    if (!enabled || !PREVIEW_ALLOWED) return undefined;
    let cancelled = false;

    async function closePreview() {
      const win = windowRef.current;
      if (!win?.isPreview) return;
      windowRef.current = null;
      setStatus((s) => ({ ...s, open: false, monitorName: null }));
      await win.close().catch(() => {});
    }

    async function openPreview() {
      // Let a monitor check that's under way finish, then take over the window.
      while (busyRef.current) await new Promise((r) => setTimeout(r, 50));
      if (cancelled || windowRef.current?.isPreview) return;
      monitorRef.current = null;
      try {
        const win = await createDisplayWindow(PREVIEW_OPTIONS);
        win.isPreview = true;
        windowRef.current = win;
        await waitUntilCreated(win);
        win.once('tauri://destroyed', () => {
          if (windowRef.current === win) windowRef.current = null;
          setStatus((s) => ({ ...s, open: false, monitorName: null }));
          setPreview(false);
        });
        setStatus((s) => ({ ...s, open: true, monitorName: 'Preview', error: null }));
      } catch (err) {
        windowRef.current = null;
        setPreview(false);
        onErrorRef.current?.(describe(err));
      }
    }

    if (preview) openPreview();
    else closePreview();
    return () => {
      cancelled = true;
    };
  }, [enabled, preview]);

  return { ...status, preview, canPreview: PREVIEW_ALLOWED, setPreview };
}
