import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectToDatabase, disconnectFromDatabase } from "./db/connection.js";

/**
 * Connects to MongoDB, then listens.
 *
 * Connecting first means a misconfigured MONGODB_URI is a startup failure with
 * a clear message, rather than every authenticated request failing at runtime
 * once traffic arrives.
 */
async function main(): Promise<void> {
  await connectToDatabase();
  console.log(`[server] connected to MongoDB (${env.MONGODB_DATABASE})`);

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    console.log(`[server] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
    console.log(`[server] health: http://localhost:${env.PORT}/api/health`);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`[server] ${signal} received, closing`);
      server.close(() => {
        void disconnectFromDatabase().finally(() => process.exit(0));
      });
    });
  }
}

main().catch((error: unknown) => {
  console.error("[server] failed to start:", error);
  process.exit(1);
});
