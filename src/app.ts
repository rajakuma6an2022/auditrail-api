import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { eventsRouter } from "./routes/events.js"; 

export function createApp() {
  const app = express();

 app.set("trust proxy", env.TRUST_PROXY_HOPS);
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 1000,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );

  app.use(healthRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/events", eventsRouter); 

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
