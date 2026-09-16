import { env } from "./env";
import { buildApp } from "./app";

const app = buildApp();

app.listen(env.PORT, () => {
  console.log(`@mart-system/backend listening on http://localhost:${env.PORT}`);
});
