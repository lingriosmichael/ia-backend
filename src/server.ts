import { buildApp } from "./app.js";
import { loadConfig } from "./shared/config/env.js";

async function start() {
  const config = loadConfig();
  const app = await buildApp(config);
  const port = Number.parseInt(process.env.PORT ?? `${config.API_PORT}`, 10);

  if (
    process.env.NODE_ENV === "production" &&
    config.FILE_STORAGE_DRIVER === "local"
  ) {
    app.log.warn(
      "FILE_STORAGE_DRIVER=local: uploads live on this instance's local disk and are not shared across replicas. This service must stay at exactly one instance (see render.yaml numInstances) until FILE_STORAGE_DRIVER is switched to s3.",
    );
  }

  try {
    await app.listen({
      host: "0.0.0.0",
      port,
    });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

void start();
