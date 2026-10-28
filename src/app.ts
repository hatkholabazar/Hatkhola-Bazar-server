import express, { Application } from "express";
import cors from "cors";
import { env } from "./config/env.js";
import apiRouter from "./routes/index.js";
import { notFoundHandler } from "./middlewares/notFound.middleware.js";
import { errorHandler } from "./middlewares/error.middleware.js";

const app: Application = express();

app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.use("/api", apiRouter);

// Fallback handlers
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
