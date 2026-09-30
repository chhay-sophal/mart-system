import { env } from "./env";
import { buildApp } from "./app";
import { logger } from "./lib/logger";
import { startOnlineOrderSweep } from "./modules/onlineOrders/onlineOrderLifecycle";

const app = buildApp();
// Expires unpaid KHQR orders and cancels uncollected pay-at-counter ones (see onlineOrderLifecycle.ts).
startOnlineOrderSweep();

app.listen(env.PORT, () => {
  logger.info(`@mart-system/backend listening on http://localhost:${env.PORT}`);
});
