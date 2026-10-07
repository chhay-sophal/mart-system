import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { QRCodeCanvas } from 'qrcode.react';
import { Store, Settings, ShoppingCart, X, CheckCircle2, AlertTriangle, Keyboard, Lock, History, Sun, Moon, BarChart3, Keyboard as KeyboardIcon, Printer, Package, Scissors, PauseCircle, FileClock, Inbox } from 'lucide-react';
import { useDarkMode } from './hooks/useDarkMode';
import LockScreen from './LockScreen';
import FirstRunSetup from './FirstRunSetup';
import SettingsManager from './SettingsManager';
import SalesHistory from './SalesHistory';
import DailySummary from './DailySummary';
import ProductsView from './ProductsView';
import DraftsDialog from './DraftsDialog';
import Invoice from './Invoice';
import { openCashDrawer, printerConfig } from './receipt/thermalPrinter';
import { STATIC_QR_KEY, parseStaticQrCodes } from './staticQr';
import { addProduct, quantityOf, splitLine } from './cartLines';
import { translations as t } from './locales';
import UpdateChecker from './UpdateChecker';
import BackendContext from './BackendContext';
import { ApiClient, ApiError } from '@mart-system/api-client';
import { usdToKhr } from './khr';
import { useCustomerDisplay } from './hooks/useCustomerDisplay';
import { useShortcuts } from './hooks/useShortcuts';
import ShortcutHelp from './ShortcutHelp';
import ConfirmDialog from './ConfirmDialog';
import DrawerPinPrompt from './DrawerPinPrompt';
import { useToast } from './Toast';
import { invalidateSales, queryClient, queryKeys } from './queryClient';
import { combosFor, displayCombo } from './shortcuts';
import { STANDBY_IMAGE_KEY } from './standbyImage';

export default function App() {
  const [cart, setCart] = useState([]);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [amountPaidUsd, setAmountPaidUsd] = useState('');
  const [amountPaidKhr, setAmountPaidKhr] = useState('');
  const [checkoutResult, setCheckoutResult] = useState(null);
  const [invoiceData, setInvoiceData] = useState(null);
  const [showInvoice, setShowInvoice] = useState(false);
  const [view, setView] = useState('REGISTER');
  // Always starts locked — a shared-terminal device with no persisted
  // session across app launches (confirmed decision, not an oversight).
  const [session, setSession] = useState(null);
  const [activeKhqr, setActiveKhqr] = useState(null);
  const [khqrLoading, setKhqrLoading] = useState(false);
  const [staticQrBank, setStaticQrBank] = useState('');
  // Fixed bank KHQR images from Settings > KHQR (issue #12).
  const [staticQrCodes, setStaticQrCodes] = useState([]);
  const [dynamicRate, setDynamicRate] = useState(4100);
  const [showManualInput, setShowManualInput] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [clearCartPrompt, setClearCartPrompt] = useState(false);
  const [showDrawerPinPrompt, setShowDrawerPinPrompt] = useState(false);
  // Locking the register (button or shortcut) drops cached sales data, so the
  // next cashier starts fresh.
  useEffect(() => {
    if (!session) queryClient.clear();
  }, [session]);
  const notify = useToast();
  // In-app messages (window.alert isn't reliably shown in the Tauri window).
  const notice = (key, vars = {}) =>
    Object.entries(vars).reduce((text, [k, v]) => text.replace(`{${k}}`, v), t[locale]?.notices?.[key] ?? t.en.notices[key]);
  // For the scanner listener's long-lived closure; kept current after each render.
  const noticeRef = useRef(notice);
  useEffect(() => {
    noticeRef.current = notice;
  });
  const manualInputRef = useRef(null);
  const tenderKhrRef = useRef(null);
  const [locale, setLocale] = useState('km');
  const [mainCurrency, setMainCurrency] = useState('USD');
  const [storeName, setStoreName] = useState('');
  const [storeIcon, setStoreIcon] = useState('');
  const [standbyImage, setStandbyImage] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [storePhone, setStorePhone] = useState('');
  // Non-Tauri (plain browser dev) never needs the port-discovery/health-check
  // below, so it starts 'ready' directly instead of flipping to it post-mount.
  const [backendStatus, setBackendStatus] = useState(() =>
    (window.__TAURI_INTERNALS__ ?? window.__TAURI__) ? 'loading' : 'ready'
  ); // 'loading' | 'ready' | 'error'
  // null while unknown (checked once the sidecar's up) -- a fresh install has
  // no staff cached yet, so LockScreen's PIN check can never succeed until a
  // one-time pairing step runs. See FirstRunSetup.
  const [isPaired, setIsPaired] = useState(null);
  const [isDark, toggleDark] = useDarkMode();

  const [txDiscountType, setTxDiscountType] = useState('pct');
  const [txDiscountValue, setTxDiscountValue] = useState('');
  const [showDrafts, setShowDrafts] = useState(false);
  const [draftToDelete, setDraftToDelete] = useState(null);
  const [lowStockItems, setLowStockItems] = useState([]);
  const [lowStockDismissed, setLowStockDismissed] = useState(false);
  // Settings > General; on unless this register turned it off.
  const [showLowStockAlert, setShowLowStockAlert] = useState(true);
  const [printer, setPrinter] = useState(() => printerConfig());

  const barcodeRef = useRef(null);
  const IS_TAURI = Boolean(window.__TAURI_INTERNALS__ ?? window.__TAURI__);
  // Opens itself on a second monitor when one is attached (issue #3).
  const customerDisplay = useCustomerDisplay(IS_TAURI, (error) =>
    notify((t[locale]?.settingsPage?.generalSection?.displayFailed || "Customer display couldn't open: {error}").replace('{error}', error))
  );
  const customerDisplayOpen = customerDisplay.open;
  const customerDisplayPayloadRef = useRef(null);
  // The standby image (issue #4) travels on its own event: it can be a few
  // hundred KB, so it's only sent when it changes or a display (re)opens, not
  // with every cart update.
  const standbyImageRef = useRef('');
  useEffect(() => {
    if (!IS_TAURI) return undefined;
    const unlistenPromise = listen('customer-display-ready', () => {
      emit('customer-display-standby', { image: standbyImageRef.current });
      if (customerDisplayPayloadRef.current) emit('customer-display', customerDisplayPayloadRef.current);
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [IS_TAURI]);
  useEffect(() => {
    standbyImageRef.current = standbyImage;
    if (IS_TAURI && customerDisplayOpen) emit('customer-display-standby', { image: standbyImage });
  }, [IS_TAURI, customerDisplayOpen, standbyImage]);
  const backendPortRef = useRef(5050);
  const initialBackendUrl = IS_TAURI ? 'http://localhost:5050' : (import.meta.env.PROD ? '' : 'http://localhost:5050');
  // Created once (useState's lazy initializer, not a ref — reading a ref
  // during render is flagged by react-hooks/refs); its baseUrl is mutated in
  // place via setBaseUrl() below once Tauri's async port-discovery resolves
  // the sidecar's real port. The setter is never called again.
  const [client] = useState(() => new ApiClient({ baseUrl: initialBackendUrl }));

  // In production Tauri builds, discover the actual port the sidecar bound to,
  // then poll until the backend is ready.
  useEffect(() => {
    if (!IS_TAURI) return;

    let cancelled = false;
    let healthId = null;

    async function discoverAndWait() {
      // Poll invoke until the Rust side has parsed the PORT line from sidecar stdout.
      if (import.meta.env.PROD) {
        for (let i = 0; i < 40; i++) {
          if (cancelled) return;
          try {
            const port = await invoke('get_backend_port');
            if (port) {
              backendPortRef.current = port;
              client.setBaseUrl(`http://localhost:${port}`);
              break;
            }
          } catch { /* best effort — keep polling until the retry budget runs out */ }
          await new Promise(r => setTimeout(r, 250));
        }
      }

      let attempts = 0;
      const MAX = 24; // 12 seconds total
      const url = `http://localhost:${backendPortRef.current}/api/settings`;
      healthId = setInterval(async () => {
        if (cancelled) { clearInterval(healthId); return; }
        attempts++;
        try {
          const res = await fetch(url);
          if (res.ok) { clearInterval(healthId); setBackendStatus('ready'); }
        } catch {
          if (attempts >= MAX) { clearInterval(healthId); setBackendStatus('error'); }
        }
      }, 500);
    }

    discoverAndWait();
    return () => { cancelled = true; if (healthId) clearInterval(healthId); };
    // IS_TAURI/client never actually change across renders (a fixed window flag
    // and a stable useState singleton respectively) — listing them satisfies the
    // rule honestly without turning this into anything but a mount-once effect.
  }, [IS_TAURI, client]);

  useEffect(() => {
    if (backendStatus !== 'ready') return;
    let cancelled = false;
    client
      .get('/api/sync/status')
      .then((data) => { if (!cancelled) setIsPaired(Boolean(data.isPaired)); })
      // Fail open (assume paired) so a transient glitch on this one check
      // never blocks a terminal that was already working fine.
      .catch(() => { if (!cancelled) setIsPaired(true); });
    return () => { cancelled = true; };
  }, [backendStatus, client]);

  useEffect(() => {
    if (view === 'REGISTER' && barcodeRef.current) barcodeRef.current.focus();
  }, [view]);

  useEffect(() => {
    if (backendStatus !== 'ready' || view !== 'REGISTER') return;
    client.get('/api/products/low-stock')
      .then(data => { if (data) setLowStockItems(data.items); })
      .catch(() => {});
  }, [backendStatus, view, client]);

  useEffect(() => {
    if (view !== 'REGISTER') return;

    let keyBuffer = '';
    let lastTimestamp = Date.now();

    const handleGlobalScanStream = (e) => {
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

      const currentTimestamp = Date.now();
      if (currentTimestamp - lastTimestamp > 50) {
        keyBuffer = '';
      }
      lastTimestamp = currentTimestamp;

      if (e.key === 'Enter') {
        const cleanBarcode = keyBuffer.trim();
        if (cleanBarcode.length > 0) {
          executeDirectBarcodeLookup(cleanBarcode);
          keyBuffer = '';
        }
        return;
      }

      if (e.key.length === 1) {
        keyBuffer += e.key;
      }
    };

    const executeDirectBarcodeLookup = async (scannedBarcode) => {
      try {
        const product = await client.get(`/api/products/barcode/${scannedBarcode}`);

        setCart((prevCart) => addProduct(prevCart, product));

        setCheckoutResult(null);
      } catch (err) {
        if (err instanceof ApiError && !err.isNetworkError) {
          notify(noticeRef.current('productNotRegistered', { barcode: scannedBarcode }));
        } else {
          console.error('Error handling direct global barcode query lookup:', err);
          notify(noticeRef.current('localServerUnreachable'));
        }
      }
    };

    window.addEventListener('keydown', handleGlobalScanStream);
    return () => window.removeEventListener('keydown', handleGlobalScanStream);
  }, [view, client, notify]);


  // Formats a raw numeric string (no commas) for display as "1,000,000.12";
  // stripMoneyInput reverses it back to a plain numeric string for state/parseFloat.
  const formatMoneyInput = (raw) => {
    if (!raw) return '';
    const [intPart, decPart] = String(raw).split('.');
    const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return decPart !== undefined ? `${withCommas}.${decPart}` : withCommas;
  };
  const stripMoneyInput = (formatted) => formatted.replace(/,/g, '');

  const rawSubtotalUsd = cart.reduce((sum, item) => {
    const base = item.currency === 'KHR' ? item.price / dynamicRate : Number(item.price);
    return sum + base * item.quantity;
  }, 0);

  const subtotalUsd = cart.reduce((sum, item) => {
    const base = item.currency === 'KHR' ? item.price / dynamicRate : Number(item.price);
    let unitPrice = base;
    if (item.discount > 0) {
      if (item.discountType === 'fixed') {
        const discUsd = item.currency === 'KHR' ? item.discount / dynamicRate : item.discount;
        unitPrice = Math.max(0, base - discUsd);
      } else {
        unitPrice = base * (1 - item.discount / 100);
      }
    }
    return sum + unitPrice * item.quantity;
  }, 0);

  const itemDiscountAmt = rawSubtotalUsd - subtotalUsd;

  const txDiscountAmt = (() => {
    const val = parseFloat(txDiscountValue || 0);
    if (!val) return 0;
    if (txDiscountType === 'pct') return subtotalUsd * (val / 100);
    const valUsd = mainCurrency === 'KHR' ? val / dynamicRate : val;
    return Math.min(valUsd, subtotalUsd);
  })();

  const totalDiscountAmt = itemDiscountAmt + txDiscountAmt;

  const totalUsd = Math.max(0, subtotalUsd - txDiscountAmt);
  const totalKhr = usdToKhr(totalUsd, dynamicRate);

  const tenderedUsd = parseFloat(amountPaidUsd || 0);
  const tenderedKhr = parseFloat(amountPaidKhr || 0);
  const totalTenderedInUsd = tenderedUsd + (tenderedKhr / dynamicRate);
  // Half a cent tolerance absorbs USD/KHR conversion rounding noise (e.g. 5000 KHR tendered
  // against a total converted from KHR won't land on the exact same float as totalUsd).
  const PAYMENT_TOLERANCE_USD = 0.005;
  const changeDueUsdRaw = totalTenderedInUsd - totalUsd;
  const changeDueUsd = Math.abs(changeDueUsdRaw) < PAYMENT_TOLERANCE_USD ? 0 : changeDueUsdRaw;
  const changeDueKhr = changeDueUsd > 0 ? usdToKhr(changeDueUsd, dynamicRate) : 0;
  const isCashPaymentSufficient = changeDueUsd >= 0;

  // Declared here (rather than lower down with the other checkout handlers) so
  // it's defined before the KHQR-polling effect below references it.
  async function autoCommitKhqrOrder(khqrDetails) {
    const cartSnapshot = [...cart];
    const payload = {
      items: cart,
      payment_method: 'KHQR',
      // Stored in the main currency, exactly as shown on screen.
      total_amount: mainCurrency === 'KHR' ? totalKhr : totalUsd,
      currency: mainCurrency,
      amount_paid_usd: totalUsd,
      amount_paid_khr: 0,
      cashier_user_id: session.userId,
      // Bug fix: khqrDetails was received but never forwarded, so the sidecar
      // never recorded which QR/md5 this sale actually paid via — meaning it
      // could never sync a PaymentTransaction for it either.
      khqr_data: {
        md5_hash: khqrDetails.md5_hash,
        qr_string: khqrDetails.qr_string,
        currency: khqrDetails.currency,
      },
    };

    try {
      const data = await client.post('/api/orders/checkout', payload);
      setCheckoutResult(data);
      invalidateSales(); // History and Daily Summary show the new sale right away
      setInvoiceData({
        order_id: data.order_id,
        items: cartSnapshot,
        subtotalBeforeDiscountUsd: rawSubtotalUsd,
        transactionDiscountUsd: txDiscountAmt,
        totalDiscountUsd: totalDiscountAmt,
        totalUsd,
        totalKhr,
        mainCurrency,
        dynamicRate,
        storeName,
        storeAddress,
        storePhone,
        storeIcon,
        cashierName: session.name,
        paymentMethod: 'KHQR',
        amountPaidUsd: totalUsd,
        amountPaidKhr: 0,
        changeDueKhr: 0,
        timestamp: new Date().toISOString(),
      });
      if (printer.receipt.autoPrint) setShowInvoice(true); // Settings > Printer > Receipt
      setCart([]);
      setActiveKhqr(null);
      setPaymentMethod('CASH');
      setTxDiscountValue('');
      setTxDiscountType('pct');
    } catch (err) {
      console.error('Error auto-finalizing transaction process:', err);
    }
  }

  // Banks offered under Bank QR: the admin's list in Settings > KHQR, the
  // ones switched on, in the admin's order.
  const staticQrBanks = staticQrCodes.filter((c) => c.enabled).map((c) => c.bank);
  // The selected bank's QR, shown on the customer display to scan.
  const staticQrImage = paymentMethod === 'STATIC_QR'
    ? staticQrCodes.find((c) => c.bank === staticQrBank && c.enabled)?.image ?? null
    : null;

  useEffect(() => {
    if (!IS_TAURI) return;

    let displayState;
    if (checkoutResult) {
      displayState = 'done';
    } else if (cart.length > 0 && ((paymentMethod === 'KHQR' && activeKhqr) || paymentMethod === 'STATIC_QR')) {
      // Payment only with something to pay for: an empty cart is idle (standby
      // image) whichever payment method is selected.
      displayState = 'payment';
    } else if (cart.length > 0) {
      displayState = 'active';
    } else {
      displayState = 'idle';
    }

    // Kept even while no display is open, so a display that opens (or
    // reloads) mid-sale gets the current state on 'customer-display-ready'.
    customerDisplayPayloadRef.current = {
      state: displayState,
      cart,
      rawSubtotalUsd,
      subtotalUsd,
      txDiscountAmt,
      totalUsd,
      totalKhr,
      mainCurrency,
      dynamicRate,
      storeName,
      storeIcon,
      locale,
      changeDueKhr: checkoutResult ? (checkoutResult.change_due_khr || 0) : changeDueKhr,
      paymentMethod,
      tenderedUsd: parseFloat(amountPaidUsd || 0),
      tenderedKhr: parseFloat(amountPaidKhr || 0),
      qrString: activeKhqr?.qr_string || null,
      staticQrBank: paymentMethod === 'STATIC_QR' ? staticQrBank : '',
      staticQrImage,
      isDark,
    };
    if (customerDisplayOpen) emit('customer-display', customerDisplayPayloadRef.current);
  }, [
    IS_TAURI, cart, rawSubtotalUsd, subtotalUsd, txDiscountAmt, checkoutResult, paymentMethod, activeKhqr,
    customerDisplayOpen, amountPaidUsd, amountPaidKhr, isDark, changeDueKhr, dynamicRate, locale, mainCurrency,
    storeIcon, storeName, totalKhr, totalUsd, staticQrBank, staticQrImage,
  ]);

  useEffect(() => {
    let pollingInterval = null;

    if (paymentMethod === 'KHQR' && activeKhqr?.md5_hash) {
      pollingInterval = setInterval(async () => {
        try {
          const data = await client.get(`/api/payments/check-status/${activeKhqr.md5_hash}`);
          if (data.status === 'PAID') {
            clearInterval(pollingInterval);
            await autoCommitKhqrOrder(activeKhqr);
          }
        } catch (err) {
          console.error('Error running automated payment check:', err);
        }
      }, 3000);
    }

    return () => {
      if (pollingInterval) clearInterval(pollingInterval);
    };
    // autoCommitKhqrOrder is intentionally excluded — it's unmemoized, so listing
    // it would restart this interval every render. cart is already listed, so the
    // interval already restarts (with a fresh closure) whenever cart changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKhqr, paymentMethod, cart, client]);

  useEffect(() => {
    if (backendStatus !== 'ready') return;
    client.get('/api/settings')
      .then(data => {
        if (data.exchange_rate) setDynamicRate(Number(data.exchange_rate));
        // This register's own choice (Settings > General) wins over the store's.
        if (data.display_language || data.locale) setLocale(data.display_language || data.locale);
        if (data.main_currency) setMainCurrency(data.main_currency);
        if (data.store_name) setStoreName(data.store_name);
        if (data.store_icon !== undefined) setStoreIcon(data.store_icon || '');
        setStandbyImage(data[STANDBY_IMAGE_KEY] || '');
        setShowLowStockAlert(data.show_low_stock_alert !== 'false');
        setPrinter(printerConfig(data));
        setStaticQrCodes(parseStaticQrCodes(data[STATIC_QR_KEY]));
        if (data.store_address !== undefined) setStoreAddress(data.store_address || '');
        if (data.store_phone !== undefined) setStorePhone(data.store_phone || '');
      })
      .catch(err => console.error("Could not sync app settings configuration", err));
  }, [backendStatus, view, client]);

  const handleBarcodeSubmit = async (e) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;

    try {
      const product = await client.get(`/api/products/barcode/${barcodeInput}`);

      setCart((prevCart) => addProduct(prevCart, product));

      setBarcodeInput('');
      setCheckoutResult(null);
    } catch (err) {
      if (err instanceof ApiError && !err.isNetworkError) {
        notify(notice('productNotFound'));
        setBarcodeInput('');
      } else {
        console.error('Error fetching product:', err);
        notify(notice('localServerUnreachable'));
      }
    }
  };

  // Products tab (issue #13): the same as scanning the item's barcode.
  const addFromProducts = (product) => {
    const quantity = quantityOf(cart, product.id) + 1;
    setCart((prevCart) => addProduct(prevCart, product));
    setCheckoutResult(null);
    notify((t[locale].products.added || 'Added {name} ({qty} in cart)').replace('{name}', product.name).replace('{qty}', quantity), 'success');
  };

  const fetchKHQRString = async () => {
    const amount = mainCurrency === 'KHR' ? totalKhr : totalUsd;
    if (amount <= 0) return;
    setKhqrLoading(true);
    try {
      const data = await client.post('/api/payments/khqr', { amount, currency: mainCurrency });
      setActiveKhqr(data);
    } catch (err) {
      console.error("Failed to compile target KHQR string packet", err);
    }
    setKhqrLoading(false);
  };

  // Cart edits act on one line (lineId): a product can be on several lines.
  const updateQuantity = (lineId, delta) => {
    setCart((prevCart) =>
      prevCart
        .map((item) => (item.lineId === lineId ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0)
    );
    setCheckoutResult(null);
    setActiveKhqr(null);
  };

  const removeItem = (lineId) => {
    setCart((prevCart) => prevCart.filter((item) => item.lineId !== lineId));
    setCheckoutResult(null);
    setActiveKhqr(null);
  };

  // Draft carts (issue #1): set the sale aside while the customer fetches more
  // items, serve the next person, and pick it up again without rescanning.
  const draftsQuery = useQuery({
    queryKey: queryKeys.drafts(),
    queryFn: () => client.get('/api/drafts'),
    enabled: backendStatus === 'ready' && Boolean(session),
  });
  const drafts = draftsQuery.data ?? [];
  const dr = t[locale].drafts;

  const resetSale = () => {
    setCart([]);
    setCheckoutResult(null);
    setActiveKhqr(null);
    setTxDiscountValue('');
    setTxDiscountType('pct');
    setAmountPaidUsd('');
    setAmountPaidKhr('');
    setStaticQrBank('');
    setPaymentMethod('CASH');
  };

  // Saves the cart as a draft and clears it for the next customer. Returns
  // whether it was saved, so a failure never loses the cart.
  const saveDraft = async () => {
    if (cart.length === 0) return false;
    try {
      await client.post('/api/drafts', { cart, txDiscountType, txDiscountValue });
      resetSale();
      queryClient.invalidateQueries({ queryKey: queryKeys.drafts() });
      notify(dr.saved, 'success');
      return true;
    } catch (err) {
      console.error('Saving draft failed:', err);
      notify(notice('localServerUnreachable'));
      return false;
    }
  };

  // Puts a draft back in the cart. Anything in the cart now is saved as a
  // draft first, so nothing is ever lost by resuming.
  const resumeDraft = async (draft) => {
    if (cart.length > 0 && !(await saveDraft())) return;
    try {
      await client.delete(`/api/drafts/${draft.id}`);
    } catch (err) {
      console.error('Removing resumed draft failed:', err);
      notify(notice('localServerUnreachable'));
      return;
    }
    setCart(draft.cart);
    setTxDiscountType(draft.txDiscountType);
    setTxDiscountValue(draft.txDiscountValue);
    setCheckoutResult(null);
    setShowDrafts(false);
    queryClient.invalidateQueries({ queryKey: queryKeys.drafts() });
    notify(dr.resumed, 'success');
  };

  const deleteDraft = async (draft) => {
    setDraftToDelete(null);
    try {
      await client.delete(`/api/drafts/${draft.id}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.drafts() });
    } catch (err) {
      console.error('Deleting draft failed:', err);
      notify(notice('localServerUnreachable'));
    }
  };

  // Splits one unit off a line so it can be discounted on its own (e.g. a defect).
  const splitItem = (lineId) => {
    setCart((prevCart) => splitLine(prevCart, lineId));
    setCheckoutResult(null);
    setActiveKhqr(null);
  };

  const setItemDiscount = (lineId, val, type) => {
    setCart(prev => prev.map(item => {
      if (item.lineId !== lineId) return item;
      const update = { ...item };
      if (type !== undefined) { update.discountType = type; update.discount = 0; }
      if (val !== undefined) update.discount = val;
      return update;
    }));
    setCheckoutResult(null);
    setActiveKhqr(null);
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;

    const cartSnapshot = [...cart];
    const paidUsd = paymentMethod === 'CASH' ? parseFloat(amountPaidUsd || 0) : totalUsd;
    const paidKhr = paymentMethod === 'CASH' ? parseFloat(amountPaidKhr || 0) : 0;

    const payload = {
      items: cart,
      payment_method: paymentMethod,
      bank_name: paymentMethod === 'STATIC_QR' ? staticQrBank : null,
      // Stored in the main currency, exactly as shown on screen.
      total_amount: mainCurrency === 'KHR' ? totalKhr : totalUsd,
      currency: mainCurrency,
      amount_paid_usd: paidUsd,
      amount_paid_khr: paidKhr,
      cashier_user_id: session.userId,
    };

    try {
      const data = await client.post('/api/orders/checkout', payload);
      setCheckoutResult(data);
      invalidateSales(); // History and Daily Summary show the new sale right away
      // Settings > Printer: pop the drawer for the cashier to put the cash in.
      if (paymentMethod === 'CASH' && printer.direct && printer.openDrawerOnCash) {
        openCashDrawer(printer).catch((err) =>
          notify((t[locale].settingsPage?.printerSection?.failed || 'Printer problem: {error}').replace('{error}', err?.message || String(err))),
        );
      }
      setInvoiceData({
        order_id: data.order_id,
        items: cartSnapshot,
        subtotalBeforeDiscountUsd: rawSubtotalUsd,
        transactionDiscountUsd: txDiscountAmt,
        totalDiscountUsd: totalDiscountAmt,
        totalUsd,
        totalKhr,
        mainCurrency,
        dynamicRate,
        storeName,
        storeAddress,
        storePhone,
        storeIcon,
        cashierName: session.name,
        paymentMethod,
        bankName: paymentMethod === 'STATIC_QR' ? staticQrBank : null,
        amountPaidUsd: paidUsd,
        amountPaidKhr: paidKhr,
        changeDueKhr: data.change_due_khr || 0,
        timestamp: new Date().toISOString(),
      });
      if (printer.receipt.autoPrint) setShowInvoice(true); // Settings > Printer > Receipt
      setCart([]);
      setAmountPaidUsd('');
      setAmountPaidKhr('');
      setActiveKhqr(null);
      setStaticQrBank('');
      setTxDiscountValue('');
      setTxDiscountType('pct');
    } catch (err) {
      if (err instanceof ApiError && !err.isNetworkError) {
        notify(notice('checkoutFailed', { reason: err.body?.error ?? notice('unknownError') }));
      } else {
        console.error('Error checking out:', err);
        notify(notice('localServerUnreachable'));
      }
    }
  };

  // Manual open, for making change or at open/close -- same call and error
  // reporting as the automatic open-on-cash-sale above.
  const openDrawerNow = () => {
    openCashDrawer(printer).catch((err) =>
      notify((t[locale].settingsPage?.printerSection?.failed || 'Printer problem: {error}').replace('{error}', err?.message || String(err))),
    );
  };
  const handleOpenDrawer = () => {
    if (!printer.direct) return;
    // Settings > Drawer > Require a PIN to open the drawer.
    if (printer.requireDrawerPin) { setShowDrawerPinPrompt(true); return; }
    openDrawerNow();
  };

  // ── Keyboard shortcuts (issue #7). The keys are fixed in shortcuts.js;
  // this is what each action does. Daily Summary's day actions live in
  // DailySummary.jsx.
  const sc = t[locale]?.shortcuts || {};
  const onRegister = view === 'REGISTER';
  // Mirrors the on-screen buttons: KHQR completes itself once paid.
  const canCheckout =
    cart.length > 0 &&
    ((paymentMethod === 'CASH' && isCashPaymentSufficient) || (paymentMethod === 'STATIC_QR' && Boolean(staticQrBank)));
  const goTo = (next) => {
    setShowShortcuts(false);
    setView(next);
  };
  const focusSoon = (ref) => setTimeout(() => ref.current?.focus(), 0);
  const keyHint = (action) => {
    const combos = combosFor(action);
    return combos.length ? ` (${combos.map(displayCombo).join(' / ')})` : '';
  };
  useShortcuts(
    {
      help: { run: () => setShowShortcuts((open) => !open) },
      back: {
        when: () => showShortcuts || clearCartPrompt || showDrafts || draftToDelete || view === 'HISTORY' || view === 'SUMMARY' || view === 'PRODUCTS',
        run: () => {
          if (showShortcuts) return setShowShortcuts(false);
          if (draftToDelete) return setDraftToDelete(null);
          if (showDrafts) return setShowDrafts(false);
          if (clearCartPrompt) return setClearCartPrompt(false);
          goTo('REGISTER');
        },
      },
      register: { run: () => goTo('REGISTER') },
      history: { run: () => goTo('HISTORY') },
      summary: { run: () => goTo('SUMMARY') },
      products: { run: () => goTo('PRODUCTS') },
      settings: { when: () => session?.role === 'ADMIN', run: () => goTo('SETTINGS') },
      lock: { run: () => { setShowShortcuts(false); setSession(null); } },
      manualBarcode: { run: () => { goTo('REGISTER'); setShowManualInput(true); focusSoon(manualInputRef); } },
      payCash: { when: () => onRegister, run: () => { setPaymentMethod('CASH'); setCheckoutResult(null); setActiveKhqr(null); focusSoon(tenderKhrRef); } },
      payKhqr: { when: () => onRegister, run: () => { setPaymentMethod('KHQR'); setCheckoutResult(null); } },
      payStaticQr: { when: () => onRegister, run: () => { setPaymentMethod('STATIC_QR'); setCheckoutResult(null); setActiveKhqr(null); setStaticQrBank(''); } },
      checkout: { when: () => onRegister && canCheckout, run: () => handleCheckout() },
      clearCart: { when: () => onRegister && cart.length > 0, run: () => setClearCartPrompt(true) },
      saveDraft: { when: () => onRegister && cart.length > 0, run: () => saveDraft() },
      drafts: { when: () => onRegister, run: () => setShowDrafts(true) },
      openDrawer: { when: () => onRegister && printer.direct, run: () => handleOpenDrawer() },
    },
    Boolean(session)
  );
  const shortcutHelp = showShortcuts ? <ShortcutHelp locale={locale} onClose={() => setShowShortcuts(false)} /> : null;

  if (backendStatus === 'loading' || (backendStatus === 'ready' && isPaired === null)) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', gap:'16px', fontFamily:'sans-serif' }}>
        <div style={{ width:'40px', height:'40px', border:'4px solid #ccc', borderTopColor:'#555', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
        <p style={{ color:'#555', margin:0 }}>Starting backend…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (backendStatus === 'error') {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', gap:'12px', fontFamily:'sans-serif' }}>
        <p style={{ color:'#c00', fontSize:'18px', margin:0, display:'flex', alignItems:'center', gap:'8px' }}><AlertTriangle size={18} />Backend failed to start</p>
        <p style={{ color:'#555', margin:0 }}>The database server did not respond after 12 seconds.</p>
        <p style={{ color:'#888', fontSize:'13px', margin:0 }}>Try restarting the app. If it keeps failing, reinstall.</p>
      </div>
    );
  }

  if (isPaired === false) {
    return (
      <BackendContext.Provider value={client}>
        <FirstRunSetup client={client} onPaired={() => setIsPaired(true)} />
      </BackendContext.Provider>
    );
  }

  if (!session) {
    return (
      <BackendContext.Provider value={client}>
        <LockScreen currentLocale={locale} onUnlock={setSession} />
      </BackendContext.Provider>
    );
  }

  if (view === 'HISTORY') {
    return (
      <BackendContext.Provider value={client}>
        <SalesHistory
          onBackToRegister={() => setView('REGISTER')}
          shop={{ storeName, storeAddress, storePhone, storeIcon }}
          printer={printer}
          currentLocale={locale}
          dynamicRate={dynamicRate}
          mainCurrency={mainCurrency}
        />
        {shortcutHelp}
      </BackendContext.Provider>
    );
  }

  if (view === 'PRODUCTS') {
    return (
      <BackendContext.Provider value={client}>
        <ProductsView
          onBackToRegister={() => setView('REGISTER')}
          currentLocale={locale}
          cart={cart}
          onAddToCart={addFromProducts}
          mainCurrency={mainCurrency}
          dynamicRate={dynamicRate}
        />
        {shortcutHelp}
      </BackendContext.Provider>
    );
  }

  if (view === 'SUMMARY') {
    return (
      <BackendContext.Provider value={client}>
        <DailySummary
          onBackToRegister={() => setView('REGISTER')}
          shop={{ storeName, storeAddress, storePhone, storeIcon }}
          printer={printer}
          currentLocale={locale}
          dynamicRate={dynamicRate}
          mainCurrency={mainCurrency}
        />
        {shortcutHelp}
      </BackendContext.Provider>
    );
  }

  if (view === 'SETTINGS' && session.role === 'ADMIN') {
    return (
      <BackendContext.Provider value={client}>
        <SettingsManager
          onBackToRegister={() => setView('REGISTER')}
          currentLocale={locale}
          onLocaleChange={setLocale}
          customerDisplay={IS_TAURI ? customerDisplay : null}
        />
        {shortcutHelp}
      </BackendContext.Provider>
    );
  }

  return (
    <>
    {shortcutHelp}
    {showDrafts && (
      <DraftsDialog drafts={drafts} locale={locale} mainCurrency={mainCurrency} dynamicRate={dynamicRate}
        onResume={resumeDraft} onDelete={setDraftToDelete} onClose={() => setShowDrafts(false)} />
    )}
    {draftToDelete && (
      <ConfirmDialog
        title={dr.deleteTitle}
        body={dr.deleteBody}
        cancelLabel={sc.cancel || 'Cancel'}
        confirmLabel={dr.delete}
        onCancel={() => setDraftToDelete(null)}
        onConfirm={() => deleteDraft(draftToDelete)}
        danger
      />
    )}
    {showDrawerPinPrompt && (
      <DrawerPinPrompt
        pin={printer.drawerPin}
        t={t[locale]?.drawerPinPrompt}
        onCancel={() => setShowDrawerPinPrompt(false)}
        onConfirm={() => {
          setShowDrawerPinPrompt(false);
          openDrawerNow();
        }}
      />
    )}
    {clearCartPrompt && (
      <ConfirmDialog
        title={sc.clearCartTitle || 'Clear the cart?'}
        body={sc.confirmClearCart || 'Remove every item from the cart?'}
        cancelLabel={sc.cancel || 'Cancel'}
        confirmLabel={sc.clearCartConfirm || 'Clear cart'}
        onCancel={() => setClearCartPrompt(false)}
        onConfirm={() => {
          setClearCartPrompt(false);
          setCart([]);
          setCheckoutResult(null);
          setActiveKhqr(null);
        }}
        danger
      />
    )}
    <div className="h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-900 flex flex-col font-sans text-slate-900 dark:text-white antialiased">
      {/* Structural Header Grid */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-3.5 flex justify-between items-center shadow-xs flex-shrink-0">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 flex items-center justify-center text-4xl flex-shrink-0">
            {storeIcon
              ? <img src={storeIcon} alt="store" className="w-10 h-10 rounded-xl object-cover" />
              : <Store size={20} className="text-slate-400 dark:text-slate-400" />}
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 dark:text-white tracking-tight font-display">{storeName || t[locale].shopName}</h1>
            <p className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 tracking-wider uppercase">{t[locale].register}</p>
          </div>
          <div className="h-6 w-px bg-slate-200 dark:bg-slate-600 ml-2"></div>
          <button
            onClick={() => setView('PRODUCTS')}
            title={`${t[locale].products.title}${keyHint('products')}`}
            className="px-3.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 border border-transparent hover:border-slate-200 dark:hover:border-slate-600 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Package size={14} /> {t[locale].products.title}
          </button>
          <button
            onClick={() => setView('HISTORY')}
            title={`${t[locale].salesHistory.title}${keyHint('history')}`}
            className="px-3.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 border border-transparent hover:border-slate-200 dark:hover:border-slate-600 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <History size={14} /> {t[locale].salesHistory.title}
          </button>
          <button
            onClick={() => setView('SUMMARY')}
            title={`${(t[locale].dailySummary || {}).navLabel || 'Daily Summary'}${keyHint('summary')}`}
            className="px-3.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 border border-transparent hover:border-slate-200 dark:hover:border-slate-600 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <BarChart3 size={14} /> {(t[locale].dailySummary || {}).navLabel || 'Daily Summary'}
          </button>
          {session.role === 'ADMIN' && (
            <button
              onClick={() => setView('SETTINGS')}
              title={`${t[locale].settings}${keyHint('settings')}`}
              className="px-3.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 border border-transparent hover:border-slate-200 dark:hover:border-slate-600 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Settings size={14} /> {t[locale].settings}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <UpdateChecker />
          <button
            onClick={() => setShowShortcuts(true)}
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 transition-colors cursor-pointer"
            title={`${sc.title || 'Keyboard Shortcuts'}${keyHint('help')}`}
          >
            <KeyboardIcon size={16} />
          </button>
          <button
            onClick={handleOpenDrawer}
            disabled={!printer.direct}
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            title={`${sc.openDrawer || 'Open cash drawer'}${keyHint('openDrawer')}`}
          >
            <Inbox size={16} />
          </button>
          <button
            onClick={toggleDark}
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 transition-colors cursor-pointer"
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            onClick={() => setSession(null)}
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 transition-colors cursor-pointer"
            title={`${t[locale].lockTerminal}${keyHint('lock')}`}
          >
            <Lock size={16} />
          </button>
          <div className="bg-slate-50 dark:bg-slate-900 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300">
            {t[locale].exchangeRate}: <span className="font-bold text-slate-900 dark:text-white ml-1">$1 = {dynamicRate.toLocaleString()} ៛</span>
          </div>
        </div>
      </header>

      {/* Main Container Dashboard split layout */}
      <div className="flex-1 flex overflow-hidden w-full">
        {/* Left Workspace Panel: Basket stream and actions */}
        <div className="flex-1 flex flex-col p-5 overflow-hidden gap-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 p-4 rounded-2xl shadow-xs text-indigo-900 dark:text-indigo-200 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                <p className="text-xs font-bold text-slate-600 dark:text-slate-300 tracking-wide uppercase">{t[locale].bgListenerActive}</p>
              </div>
              <button
                onClick={() => {
                  setShowManualInput(!showManualInput);
                  setBarcodeInput('');
                }}
                className={`text-xs font-bold px-3 py-2 rounded-xl transition-all flex items-center gap-1 cursor-pointer ${showManualInput ? 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200' : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/40'}`}
              >
                {showManualInput
                  ? <><Lock size={13} /> {t[locale].closeManual}</>
                  : <><Keyboard size={13} /> {t[locale].typeManual}</>}
              </button>
            </div>

            {showManualInput && (
              <form onSubmit={handleBarcodeSubmit} className="flex gap-2 mt-3 animate-fadeIn">
                <input
                  type="text"
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  placeholder={t[locale].placeholderManual}
                  ref={manualInputRef}
                  className="flex-1 h-11 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:bg-white dark:focus:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-xl text-sm focus:outline-hidden focus:border-indigo-500 focus:ring-2 focus:ring-indigo-50 dark:focus:ring-indigo-900/30"
                  autoFocus
                />
                <button
                  type="submit"
                  className="h-11 px-5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm transition-colors shadow-xs cursor-pointer"
                >
                  {t[locale].addItem}
                </button>
              </form>
            )}
          </div>

          {/* Low stock alert banner */}
          {showLowStockAlert && lowStockItems.length > 0 && !lowStockDismissed && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 flex items-start gap-3 flex-shrink-0">
              <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-amber-800 dark:text-amber-300">
                  {t[locale].lowStockAlert} — {lowStockItems.length} {locale === 'km' ? 'មុខទំនិញ' : 'item(s)'}
                </p>
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5 truncate">
                  {lowStockItems.map(i => `${i.name} (${i.stock} ${t[locale].lowStockItemsRemaining})`).join(' · ')}
                </p>
              </div>
              <button
                onClick={() => setLowStockDismissed(true)}
                className="text-amber-400 hover:text-amber-600 shrink-0 cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Master Item Basket View */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700 flex-1 flex flex-col overflow-hidden shadow-xs">
            <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 flex justify-between items-center flex-shrink-0">
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 tracking-tight font-display">{t[locale].currentBasket}</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowDrafts(true)} title={`${dr.title}${keyHint('drafts')}`}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer">
                  <FileClock size={13} /> {dr.title}
                  {drafts.length > 0 && <span className="bg-amber-500 text-white rounded-full px-1.5 text-[10px] leading-4">{drafts.length}</span>}
                </button>
                <button onClick={saveDraft} disabled={cart.length === 0} title={`${dr.save}${keyHint('saveDraft')}`}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                  <PauseCircle size={13} /> {dr.save}
                </button>
                <span className="text-xs bg-slate-200/80 dark:bg-slate-700/80 text-slate-700 dark:text-slate-200 font-bold px-3 py-1 rounded-full">
                  {cart.reduce((a, b) => a + b.quantity, 0)} {t[locale].itemsCount}
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto content-start">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-400 gap-3 py-12">
                  <div className="w-16 h-16 bg-slate-50 dark:bg-slate-900 rounded-2xl flex items-center justify-center border border-slate-100 dark:border-slate-700 text-slate-300 dark:text-slate-400"><ShoppingCart size={28} /></div>
                  <p className="text-sm font-semibold text-slate-400 dark:text-slate-400 font-display">{t[locale].basketEmpty}</p>
                </div>
              ) : (
                <div>
                  {cart.map((item, index) => {
                    const isLast = index === cart.length - 1;

                    return (
                      <div
                        key={item.lineId}
                        className={`py-1 px-3 hover:bg-slate-200 dark:hover:bg-slate-700/90 transition-colors ${
                          isLast ? '' : 'border-b border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0 pr-4">
                            <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate">{item.name}</h3>
                            <p className="text-[11px] text-slate-400 dark:text-slate-400 tracking-wider mt-0.5">#{item.barcode}</p>
                          </div>
                          <div className="flex items-stretch gap-5">
                            {/* Price Per Unit */}
                            <div className="text-right w-24 flex flex-col justify-center">
                              {/* The original price is struck through only when the item is discounted. */}
                              {item.discount > 0 && (
                                <p className="text-[11px] text-slate-400 dark:text-slate-400 line-through">
                                  {item.currency === 'KHR' ? `${Math.round(item.price).toLocaleString()} ៛` : `${Number(item.price).toFixed(2)}`}
                                </p>
                              )}
                              <p className="font-bold text-sm text-slate-900 dark:text-white">
                                {item.discountType === 'fixed'
                                  ? item.currency === 'KHR'
                                    ? `${Math.round(Math.max(0, item.price - item.discount)).toLocaleString()} ៛`
                                    : `$${Math.max(0, Number(item.price) - item.discount).toFixed(2)}`
                                  : item.currency === 'KHR'
                                    ? `${Math.round(item.price * (1 - (item.discount || 0) / 100)).toLocaleString()} ៛`
                                    : `$${(Number(item.price) * (1 - (item.discount || 0) / 100)).toFixed(2)}`
                                }
                              </p>
                            </div>

                            {/* Discount controls */}
                            <div className="flex items-stretch gap-1">
                              <input
                                type="number"
                                min="0"
                                max={item.discountType !== 'fixed' ? '100' : undefined}
                                value={item.discount || ''}
                                onChange={e => {
                                  let v = parseFloat(e.target.value);
                                  if (isNaN(v) || v < 0) v = 0;
                                  if ((item.discountType || 'pct') === 'pct' && v > 100) v = 100;
                                  setItemDiscount(item.lineId, v === 0 && e.target.value === '' ? 0 : v);
                                }}
                                className="w-30 h-full text-center text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg px-1.5 py-1 outline-none bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-100 dark:focus:ring-amber-900/30 focus:border-amber-400 dark:focus:border-amber-600"
                                placeholder="0"
                              />
                              <div className="flex w-16 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                                <button
                                  onClick={() => setItemDiscount(item.lineId, undefined, 'pct')}
                                  className={`flex-1 px-0 py-1 text-[10px] font-bold transition-all cursor-pointer ${
                                    (item.discountType || 'pct') === 'pct'
                                      ? 'bg-amber-500 text-white'
                                      : 'bg-white dark:bg-slate-800 text-slate-400 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                                  }`}
                                >%</button>
                                <button
                                  onClick={() => setItemDiscount(item.lineId, undefined, 'fixed')}
                                  className={`flex-1 px-0 py-1 text-[10px] font-bold border-l border-slate-200 dark:border-slate-700 transition-all cursor-pointer ${
                                    item.discountType === 'fixed'
                                      ? 'bg-amber-500 text-white border-amber-500'
                                      : 'bg-white dark:bg-slate-800 text-slate-400 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                                  }`}
                                >{item.currency === 'KHR' ? '៛' : '$'}</button>
                              </div>
                            </div>
                            
                            {/* Qty stepper */}
                            <div className="flex items-center border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-700 rounded-xl p-0.5 shadow-2xs">
                              <button onClick={() => updateQuantity(item.lineId, -1)} className="w-8 h-8 flex items-center justify-center font-bold text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer">&minus;</button>
                              <span className="w-9 text-center font-bold text-sm text-slate-800 dark:text-slate-100">{item.quantity}</span>
                              <button onClick={() => updateQuantity(item.lineId, 1)} className="w-8 h-8 flex items-center justify-center font-bold text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer">+</button>
                            </div>

                            {/* Split one unit onto its own line, to discount just that one. Kept
                                in place (invisible) at quantity 1 so the columns stay aligned. */}
                            <button onClick={() => splitItem(item.lineId)} disabled={item.quantity < 2}
                              title={t[locale].splitLine} aria-label={t[locale].splitLine}
                              className={`self-center w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 dark:text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-all cursor-pointer ${item.quantity < 2 ? 'invisible' : ''}`}>
                              <Scissors size={14} />
                            </button>

                            {/* Line total */}
                            <div className="text-right w-24 flex flex-col justify-center">
                              {item.discount > 0 ? (() => {
                                const base = item.price * item.quantity;
                                const discounted = item.discountType === 'fixed'
                                  ? Math.max(0, item.price - item.discount) * item.quantity
                                  : item.price * item.quantity * (1 - item.discount / 100);
                                return (
                                  <>
                                    <p className="text-[11px] text-slate-400 dark:text-slate-400 line-through">
                                      {item.currency === 'KHR' ? `${Math.round(base).toLocaleString()} ៛` : `$${Number(base).toFixed(2)}`}
                                    </p>
                                    <p className="font-bold text-sm text-amber-600 dark:text-amber-400">
                                      {item.currency === 'KHR' ? `${Math.round(discounted).toLocaleString()} ៛` : `$${discounted.toFixed(2)}`}
                                    </p>
                                  </>
                                );
                              })() : (
                                <p className="font-bold text-sm text-slate-900 dark:text-white">
                                  {item.currency === 'KHR'
                                    ? `${(item.price * item.quantity).toLocaleString()} ៛`
                                    : `$${(Number(item.price) * item.quantity).toFixed(2)}`}
                                </p>
                              )}
                            </div>
                            <button onClick={() => removeItem(item.lineId)} className="text-slate-300 dark:text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 w-8 h-8 rounded-lg transition-all flex items-center justify-center cursor-pointer"><X size={14} /></button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Checkout Ledger Panel */}
        <div className="w-96 bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 shadow-xl p-5 flex flex-col justify-between overflow-y-auto flex-shrink-0">
          <div className="space-y-3">
            {/* Transaction Discount */}
            {/* <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-bold tracking-wider text-slate-400 dark:text-slate-400 uppercase font-display truncate min-w-fit">
                  {locale === 'km' ? 'បញ្ចុះតម្លៃ' : 'Discount'}
                </label>
                <input
                  type="number"
                  value={txDiscountValue}
                  onChange={e => {
                    let v = parseFloat(e.target.value);
                    if (isNaN(v) || v < 0) v = 0;
                    if (txDiscountType === 'pct' && v > 100) v = 100;
                    setTxDiscountValue(v === 0 && e.target.value === '' ? '' : String(v));
                    setCheckoutResult(null);
                    setActiveKhqr(null);
                  }}
                  min="0"
                  max={txDiscountType === 'pct' ? '100' : undefined}
                  placeholder={txDiscountType === 'pct' ? '0' : mainCurrency === 'KHR' ? '0' : '0.00'}
                  className="flex-1 h-9 px-3 pr-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-800 dark:text-slate-100 text-sm focus:ring-2 focus:ring-amber-100 dark:focus:ring-amber-900/30 focus:outline-hidden focus:border-amber-500"
                />
                <div className="flex w-16 ml-auto rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                  <button
                    onClick={() => { setTxDiscountType('pct'); setTxDiscountValue(''); setCheckoutResult(null); setActiveKhqr(null); }}
                    className={`flex-1 px-0 py-1 text-[10px] font-bold transition-all cursor-pointer ${
                      txDiscountType === 'pct'
                        ? 'bg-amber-500 text-white'
                        : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >%</button>
                  <button
                    onClick={() => { setTxDiscountType('fixed'); setTxDiscountValue(''); setCheckoutResult(null); setActiveKhqr(null); }}
                    className={`flex-1 px-0 py-1 text-[10px] font-bold border-l border-slate-200 dark:border-slate-700 transition-all cursor-pointer ${
                      txDiscountType === 'fixed'
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >{mainCurrency === 'KHR' ? '៛' : '$'}</button>
                </div>
              </div>
            </div> */}
            
            <div className="bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 rounded-2xl p-5 relative overflow-hidden shadow-md shadow-slate-900/10 border border-slate-200/60 dark:border-slate-700">
              <div className="space-y-3 relative z-10">
                <div className="flex justify-between items-baseline">
                  <span className="text-md font-medium font-display">
                    {t[locale].subtotal}
                  </span>
                  <span className="text-sm font-bold">
                    {mainCurrency === 'USD' ? `$${rawSubtotalUsd.toFixed(2)}` : `${usdToKhr(rawSubtotalUsd, dynamicRate).toLocaleString()} ៛`}
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-md font-medium tracking-wider font-display truncate min-w-fit">
                      {locale === 'km' ? 'បញ្ចុះតម្លៃ' : 'Discount'}
                    </label>
                    <div className="flex-1">
                      <input
                        type="number"
                        value={txDiscountValue}
                        onChange={e => {
                          let v = parseFloat(e.target.value);
                          if (isNaN(v) || v < 0) v = 0;
                          if (txDiscountType === 'pct' && v > 100) v = 100;
                          setTxDiscountValue(v === 0 && e.target.value === '' ? '' : String(v));
                          setCheckoutResult(null);
                          setActiveKhqr(null);
                        }}
                        min="0"
                        max={txDiscountType === 'pct' ? '100' : undefined}
                        placeholder={txDiscountType === 'pct' ? '0' : mainCurrency === 'KHR' ? '0' : '0.00'}
                        className="w-full h-9 px-3 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-800 dark:text-slate-100 text-sm focus:ring-2 focus:ring-amber-100 dark:focus:ring-amber-900/30 focus:outline-hidden focus:border-amber-500"
                      />
                    </div>
                    
                    <div className="flex w-16 ml-auto rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                      <button
                        onClick={() => { setTxDiscountType('pct'); setTxDiscountValue(''); setCheckoutResult(null); setActiveKhqr(null); }}
                        className={`flex-1 px-0 py-1 text-[10px] font-bold transition-all cursor-pointer ${
                          txDiscountType === 'pct'
                            ? 'bg-amber-500 text-white'
                            : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                        }`}
                      >%</button>
                      <button
                        onClick={() => { setTxDiscountType('fixed'); setTxDiscountValue(''); setCheckoutResult(null); setActiveKhqr(null); }}
                        className={`flex-1 px-0 py-1 text-[10px] font-bold border-l border-slate-200 dark:border-slate-700 transition-all cursor-pointer ${
                          txDiscountType === 'fixed'
                            ? 'bg-amber-500 text-white border-amber-500'
                            : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                        }`}
                      >{mainCurrency === 'KHR' ? '៛' : '$'}</button>
                    </div>
                  </div>
                </div>
                {totalDiscountAmt > 0 && (
                  <div className="flex justify-between items-baseline">
                    <span className="text-md font-medium font-display">
                      {t[locale].totalDiscountAmount}
                    </span>
                    <span className="text-sm font-bold text-amber-400">
                      {mainCurrency === 'USD' ? `−$${totalDiscountAmt.toFixed(2)}` : `−${usdToKhr(totalDiscountAmt, dynamicRate).toLocaleString()} ៛`}
                    </span>
                  </div>
                )}
                <div className="border-t border-slate-800 dark:border-slate-700 pt-2.5 flex justify-between items-baseline">
                  <span className="text-md font-medium font-display">
                    {mainCurrency === 'USD' ? t[locale].totalUsd : t[locale].totalKhr}
                  </span>
                  <span className="text-3xl font-black tracking-tight">
                    {mainCurrency === 'USD' ? `$${totalUsd.toFixed(2)}` : `${totalKhr.toLocaleString()} ៛`}
                  </span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-md font-medium font-display">
                    {mainCurrency === 'USD' ? t[locale].totalKhr : t[locale].totalUsd}
                  </span>
                  <span className="text-base font-bold text-emerald-400">
                    {mainCurrency === 'USD' ? `${totalKhr.toLocaleString()} ៛` : `$${totalUsd.toFixed(2)}`}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold tracking-wider text-slate-400 dark:text-slate-400 uppercase mb-2 font-display">{t[locale].settlementType}</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => { setPaymentMethod('CASH'); setCheckoutResult(null); setActiveKhqr(null); }}
                  className={`py-3 px-2 rounded-xl border font-bold text-xs transition-all flex items-center justify-center gap-1 cursor-pointer ${paymentMethod === 'CASH' ? 'bg-slate-900 text-white border-slate-900 shadow-xs' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                >
                  {t[locale].cash}
                </button>
                <button
                  onClick={() => { setPaymentMethod('KHQR'); setCheckoutResult(null); }}
                  className={`py-3 px-2 rounded-xl border font-bold text-xs transition-all flex items-center justify-center gap-1 cursor-pointer ${paymentMethod === 'KHQR' ? 'bg-rose-600 text-white border-rose-600 shadow-xs' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                >
                  {t[locale].khqr}
                </button>
                <button
                  onClick={() => { setPaymentMethod('STATIC_QR'); setCheckoutResult(null); setActiveKhqr(null); setStaticQrBank(''); }}
                  className={`py-3 px-2 rounded-xl border font-bold text-xs transition-all flex items-center justify-center gap-1 cursor-pointer ${paymentMethod === 'STATIC_QR' ? 'bg-amber-500 text-white border-amber-500 shadow-xs' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                >
                  {t[locale].staticQr}
                </button>
              </div>
            </div>

            {paymentMethod === 'CASH' ? (
              <div className="space-y-4">
                <div className="space-y-3 bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-700">
                  <div className='flex gap-1'>
                    <label className="text-[11px] font-bold text-slate-500 dark:text-slate-300 uppercase tracking-wide font-display truncate min-w-fit flex items-center justify-center">{t[locale].tenderedKhr}</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      ref={tenderKhrRef}
                      value={formatMoneyInput(amountPaidKhr)}
                      onChange={(e) => {
                        const raw = stripMoneyInput(e.target.value);
                        if (!/^\d*\.?\d*$/.test(raw)) return;
                        setAmountPaidKhr(raw);
                        setCheckoutResult(null);
                      }}
                      className="w-full mt-1.5 h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-800 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-50 dark:focus:ring-indigo-900/30 focus:outline-hidden focus:border-indigo-500"
                      placeholder="0"
                    />
                  </div>
                  <div className='flex gap-1'>
                    <label className="text-[11px] font-bold text-slate-500 dark:text-slate-300 uppercase tracking-wide font-display truncate min-w-fit flex items-center justify-center">{t[locale].tenderedUsd}</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formatMoneyInput(amountPaidUsd)}
                      onChange={(e) => {
                        const raw = stripMoneyInput(e.target.value);
                        if (!/^\d*\.?\d*$/.test(raw)) return;
                        setAmountPaidUsd(raw);
                        setCheckoutResult(null);
                      }}
                      className="w-full mt-1.5 h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-800 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-50 dark:focus:ring-indigo-900/30 focus:outline-hidden focus:border-indigo-500"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                {totalTenderedInUsd > 0 && (
                  <div className={`p-4 rounded-2xl border transition-all ${changeDueUsd >= 0 ? 'bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800' : 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'}`}>
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] font-bold text-slate-500 dark:text-slate-300 uppercase tracking-wide font-display">
                        {changeDueUsd >= 0 ? t[locale].changeDue : t[locale].shortage}
                      </span>
                      <span className={`text-lg font-black ${changeDueUsd >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {mainCurrency === 'USD'
                          ? changeDueUsd >= 0 ? `$${changeDueUsd.toFixed(2)}` : `$${Math.abs(changeDueUsd).toFixed(2)}`
                          : changeDueUsd >= 0 ? `${usdToKhr(changeDueUsd, dynamicRate).toLocaleString()} ៛` : `${usdToKhr(Math.abs(changeDueUsd), dynamicRate).toLocaleString()} ៛`
                        }
                      </span>
                    </div>
                    <p className="text-[10px] font-bold text-right mt-0.5 text-slate-400 dark:text-slate-400">
                      {mainCurrency === 'USD'
                        ? `${usdToKhr(changeDueUsd, dynamicRate).toLocaleString()} ៛`
                        : `$${changeDueUsd.toFixed(2)} USD`
                      }
                    </p>
                  </div>
                )}
              </div>
            ) : paymentMethod === 'STATIC_QR' ? (
              <div className="space-y-3 bg-amber-50/30 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900 p-4 rounded-2xl">
                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-300 uppercase tracking-wide font-display">{t[locale].staticQrPrompt}</p>
                {staticQrBanks.length === 0 && (
                  <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">{t[locale].staticQrNoneEnabled}</p>
                )}
                <div className="grid grid-cols-3 gap-1.5">
                  {staticQrBanks.map(bank => (
                    <button
                      key={bank}
                      onClick={() => setStaticQrBank(b => b === bank ? '' : bank)}
                      className={`py-2 px-1 rounded-xl border font-bold text-[11px] transition-all cursor-pointer ${staticQrBank === bank ? 'bg-amber-500 text-white border-amber-500' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 hover:border-amber-200 dark:hover:border-amber-800'}`}
                    >
                      {bank}
                    </button>
                  ))}
                </div>
                {staticQrImage && (
                  <div className="flex items-center gap-3 bg-white dark:bg-slate-900 border border-amber-100 dark:border-amber-900 rounded-xl p-2">
                    <img src={staticQrImage} alt={staticQrBank} className="w-14 h-14 object-contain bg-white rounded-lg" />
                    <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">{t[locale].staticQrShowing}</p>
                  </div>
                )}
                <p className="text-[10px] text-slate-400 dark:text-slate-400">{t[locale].staticQrNote}</p>
                <button
                  onClick={handleCheckout}
                  disabled={cart.length === 0 || !staticQrBank}
                  className={`w-full py-3 rounded-xl font-bold text-sm transition-all font-display shadow-xs ${cart.length === 0 || !staticQrBank ? 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-400 cursor-not-allowed' : 'bg-amber-500 text-white cursor-pointer hover:bg-amber-600 active:scale-[0.99]'}`}
                >
                  {staticQrBank ? t[locale].confirmReceived : `${t[locale].selectBank}...`}
                </button>
              </div>
            ) : (
              <div className="space-y-4 bg-rose-50/30 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900 p-5 rounded-2xl flex flex-col items-center">
                {activeKhqr ? (
                  <>
                    <div className="bg-white dark:bg-slate-800 p-2.5 rounded-xl shadow-xs border border-rose-100 dark:border-rose-900">
                      <QRCodeCanvas value={activeKhqr.qr_string} size={160} level={"M"} includeMargin={true} />
                    </div>
                    <div className="text-center">
                      <p className="font-bold text-xs text-slate-800 dark:text-slate-100 font-display">{t[locale].scanToPay}</p>
                      <p className="text-[10px] text-rose-500 font-bold mt-0.5">{t[locale].ref}: {activeKhqr.md5_hash.substring(0, 8).toUpperCase()}</p>
                      <p className="text-[9px] text-slate-400 dark:text-slate-400 mt-2 font-display animate-pulse">{t[locale].waitingPayment}</p>
                    </div>
                  </>
                ) : khqrLoading ? (
                  <p className="text-xs text-slate-400 dark:text-slate-400 font-bold font-display animate-pulse">{t[locale].assemblingPacket}</p>
                ) : (
                  <button
                    onClick={fetchKHQRString}
                    disabled={totalUsd <= 0}
                    className="py-3 px-5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-colors cursor-pointer"
                  >
                    {t[locale].generateQr}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="mt-5 space-y-3 flex-shrink-0">
            {checkoutResult && (
              <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 p-3.5 rounded-xl flex items-start gap-2.5">
                <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-bold text-xs text-emerald-900 dark:text-emerald-200 font-display">{t[locale].orderSaved}</p>
                  {checkoutResult.change_due_khr > 0 && (
                    <p className="text-base font-black text-emerald-600 dark:text-emerald-400 mt-0.5">{checkoutResult.change_due_khr.toLocaleString()} ៛</p>
                  )}
                </div>
                {invoiceData && (
                  <button
                    onClick={() => setShowInvoice(true)}
                    className="flex-shrink-0 self-center px-3 py-2 bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-bold rounded-lg text-[11px] hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Printer size={12} /> {t[locale].invoice.printBtn}
                  </button>
                )}
              </div>
            )}

            {paymentMethod === 'CASH' && (
              <button
                onClick={handleCheckout}
                disabled={cart.length === 0 || !isCashPaymentSufficient}
                className={`w-full h-12 rounded-xl font-bold transition-all text-sm font-display shadow-xs ${cart.length === 0 || !isCashPaymentSufficient ? 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-400 cursor-not-allowed' : 'bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700 active:scale-[0.99]'}`}
              >
                {t[locale].finalizeOrder}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>

      {invoiceData && showInvoice && (
        <Invoice
          key={invoiceData.order_id} // a new sale prints its own receipt
          invoiceData={invoiceData}
          locale={locale}
          onClose={() => setShowInvoice(false)}
          printer={printer}
        />
      )}
    </>
  );
}
