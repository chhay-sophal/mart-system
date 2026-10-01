# @mart-system/ims

Always-online inventory/back-office web app. Scaffolded in Phase 3 — see [docs/plan.md](../../docs/plan.md).

## Online orders

**Online orders** (first in the nav) is where the counter handles storefront pickup orders for the selected branch: open orders grouped as *To pack*, *Ready for pickup* and *Awaiting KHQR payment*, refreshed every 15 seconds, with search by pickup code, phone or name. **Mark ready** when the bag is packed; **Collected** when it's handed over (pay-at-counter orders ask whether it was cash, KHQR or card); **Cancel order** returns the items to stock — only inventory staff and admins can cancel, and a paid KHQR order has to be refunded by hand. The nav badge and the tab title show how many orders need attention, from any page. Unpaid pay-at-counter orders are released automatically after the branch's hold window (`online_order_hold_minutes` in Settings, default 60). See [docs/online-orders-plan.md](../../docs/online-orders-plan.md).
