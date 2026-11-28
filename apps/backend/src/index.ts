import { env } from "./env";
import { buildApp } from "./app";
import { logger } from "./lib/logger";
import { startKhqrReverifier } from "./modules/payments/payments.service";

const app = buildApp();

app.listen(env.PORT, () => {
  logger.info(`@mart-system/backend listening on http://localhost:${env.PORT}`);
});

// Unconfirmed KHQR payments (e.g. confirmed by a cashier when the register
// couldn't check) are re-checked with Bakong in the background.
startKhqrReverifier();
