import { buildApp } from "./app.js";
import { loadConfig } from "./shared/config/env.js";

async function start() {
  const config = loadConfig();
  const app = await buildApp(config);

  try {
    await app.listen({
      host: "0.0.0.0",
      port: config.API_PORT,
    });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

void start();
