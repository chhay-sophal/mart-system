# Customer storefront plan

A public website where shoppers browse a branch's live catalog, order ahead, and pick up at the counter — paying by KHQR online or at the counter on collection. The visual design lives on the "Mart Storefront" canvas (home, catalog, product, checkout, branch finder, mobile home, mobile KHQR payment).

This doc records what the backend already gives the storefront, what's missing, and the order we're building it in. Like `plan.md`, it's a record of intent, not a live task list.

## Decisions

- **Online orders show up for staff in a new IMS page first.** IMS is always online, so it's the fastest path. Surfacing them on the POS itself needs a new offline sync event type (e.g. `ONLINE_ORDER_COLLECTED`) and is deferred.
- **"Pay at the counter" is allowed**, alongside KHQR. Because an unpaid order holds stock with no commitment from the shopper, a pay-at-counter order is cancelled automatically (stock released) if it isn't collected within a hold window after its pickup time. The window is a per-store setting.
- **No promotions for now.** The design's deal banner is hidden until a promotions feature exists.
- **Guest checkout only** (name + phone). `Order.customerId` exists but there's no `Customer` model, and accounts aren't needed to launch.

## What already exists

| Storefront need | Where it lives today |
|---|---|
| Branch list | `Store` — name, address, phone, timezone, `isActive` |
| Per-branch stock and price | `StoreProduct` — `stock`, `priceOverrideMinor`, `lowStockThreshold`; `Product.category` for aisles |
| Generate a KHQR code | `generateKhqr()` in `payments.service.ts` (5-minute expiry, per-store Bakong settings) |
| Check whether it was paid | `checkKhqrStatus()` — Bakong token renewal already handled |
| A payment record | `PaymentTransaction`, with a `PENDING` status |
| Online sales reaching the tills | The POS overwrites local stock with the backend's value on every pull (`apps/pos/sidecar/src/sync.js`), so a backend-side decrement for an online order reaches the tills automatically |

## What's missing

1. **Public, no-login reads.** Every read endpoint requires a staff token, and the staff product view includes `costPrice`, which must never be public. The storefront needs separate endpoints returning only public fields, with stock as a level (`IN_STOCK` / `LOW_STOCK` / `OUT_OF_STOCK`) rather than an exact count.
2. **An online order.** `Order` requires a `terminalId` and only has `COMPLETED`/`VOIDED` — it models a till sale. Online orders get their own `OnlineOrder` model: status (awaiting payment → paid/confirmed → ready → collected, plus cancelled and expired), branch, customer name and phone, pickup slot, a short pickup code, payment method, and line items. Prices are always computed server-side, never taken from the client.
3. **Shopper-facing KHQR.** The payment functions are reusable but their routes only accept terminal credentials. New public routes create the order plus its KHQR code (recording a `PENDING` `PaymentTransaction`), and report status by an unguessable order token — the server polls Bakong, never the browser. `PaymentTransaction.orderId` needs to become optional (or gain an `onlineOrderId`), and a new `StockMovementReason` (`ONLINE_SALE`) records the stock deduction.
4. **A way for staff to see orders.** Nothing surfaces an incoming order today. See decisions: an IMS page first.
5. **Branch details.** The design shows opening hours and a map; `Store` has neither. Needs `openingHours` and `latitude`/`longitude`.
6. **Public-endpoint hardening.** The existing rate limiter only counts failed PIN logins; public endpoints need a per-IP request limit. The storefront's origin must be added to `CORS_ALLOWED_ORIGINS` in production.

Deferred: product photos (`Product.imageUrl`), Khmer product names (`nameKm`), promotions, customer accounts, POS-side order display.

## Build order

Steps 1–3 are done; step 4 is next.

1. **Public branch and catalog endpoints**, with tests and a per-IP rate limit.
2. **`apps/web`** — browsing and cart against those endpoints, no checkout yet.
3. **Branch details** — opening hours and location on `Store`, editable in IMS, exposed publicly.
4. **Online orders** — `OnlineOrder` model, checkout (KHQR and pay at counter), payment status, stock deduction, auto-cancel of uncollected pay-at-counter orders.
5. **IMS "Online orders" page** — staff mark orders ready and collected, take counter payment.
6. **Later** — POS-side order display, photos, Khmer names, promotions.
