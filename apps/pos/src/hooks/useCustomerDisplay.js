import { useEffect, useRef, useState } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { availableMonitors, getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';

const LABEL = 'customer-display';
// No monitor-change event in Tauri, so poll. Cheap: a couple of IPC calls.
const POLL_MS = 3000;

const sameMonitor = (a, b) =>
  a && b && a.position.x === b.position.x && a.position.y === b.position.y && a.size.width === b.size.width && a.size.height === b.size.height;

/**
 * Shows the customer display automatically whenever a second monitor is
 * attached: full screen there, kiosk-style (no frame, no taskbar entry,
 * always on top), without taking focus from the register. It's closed when
 * that monitor goes away and follows it if it moves. Returns whether it's open
 * so the register only broadcasts cart updates while someone can see them.
 */
export function useCustomerDisplay(enabled) {
  const [open, setOpen] = useState(false);
  const windowRef = useRef(null);
  const monitorRef = useRef(null);
  const busyRef = useRef(false);

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
      await new Promise((resolve, reject) => {
        win.once('tauri://created', resolve);
        win.once('tauri://error', (e) => reject(new Error(String(e.payload ?? e))));
      });
      win.once('tauri://destroyed', () => {
        windowRef.current = null;
        monitorRef.current = null;
        setOpen(false);
      });
      try {
        await placeOn(win, monitor);
        await win.show();
        await main.setFocus(); // keep keyboard/scanner input on the register
        setOpen(true);
      } catch (err) {
        await close().catch(() => {}); // retried on the next poll
        throw err;
      }
    }

    async function close() {
      const win = windowRef.current;
      windowRef.current = null;
      monitorRef.current = null;
      setOpen(false);
      await win?.close();
    }

    async function check() {
      if (busyRef.current || cancelled) return;
      busyRef.current = true;
      try {
        const here = await main.currentMonitor();
        const target = (await availableMonitors()).find((m) => !sameMonitor(m, here)) ?? null;
        if (cancelled) return;
        if (!target) {
          if (windowRef.current) await close();
        } else if (!windowRef.current) {
          await openOn(target);
        } else if (!sameMonitor(target, monitorRef.current)) {
          await placeOn(windowRef.current, target);
        }
      } catch (err) {
        console.error('Customer display:', err);
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

  return open;
}
