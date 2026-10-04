import { useEffect, useRef, useState } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { availableMonitors, getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';

const LABEL = 'customer-display';
// No monitor-change event in Tauri, so poll. Cheap: a couple of IPC calls.
const POLL_MS = 3000;
// A window that never reports created/error mustn't block the poll forever.
const CREATE_TIMEOUT_MS = 8000;

const sameMonitor = (a, b) =>
  a && b && a.position.x === b.position.x && a.position.y === b.position.y && a.size.width === b.size.width && a.size.height === b.size.height;

const describe = (err) => (err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err));

/**
 * Shows the customer display automatically whenever a second monitor is
 * attached: full screen there, kiosk-style (no frame, no taskbar entry,
 * always on top), without taking focus from the register. It's closed when
 * that monitor goes away and follows it if it moves.
 *
 * Returns { open, monitorCount, monitorName, error } -- `open` gates the
 * register's cart broadcasts; the rest is shown in Settings > General so a
 * display that doesn't appear can be diagnosed at the till.
 */
export function useCustomerDisplay(enabled, onError) {
  const [status, setStatus] = useState({ open: false, monitorCount: null, monitorName: null, error: null });
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

    async function openOn(monitor) {
      // A window left over from an earlier attempt (or a dev reload) would make
      // creating another with the same label fail on every retry.
      const leftover = await WebviewWindow.getByLabel(LABEL);
      if (leftover) await leftover.close().catch(() => {});

      const win = new WebviewWindow(LABEL, {
        url: '/?window=customer',
        title: 'Customer Display',
        visible: false,
        focus: false,
        decorations: false,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
      });
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
      if (busyRef.current || cancelled) return;
      busyRef.current = true;
      try {
        const [here, monitors] = await Promise.all([main.currentMonitor(), availableMonitors()]);
        if (cancelled) return;
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

  return status;
}
