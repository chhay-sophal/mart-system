import { env } from "./env";
import { buildApp } from "./app";
import { logger } from "./lib/logger";

const app = buildApp();

app.listen(env.PORT, () => {
  logger.info(`@mart-system/backend listening on http://localhost:${env.PORT}`);
});
