import { Router } from "express";
import healthRouter from "./health.route.js";

const apiRouter = Router();

apiRouter.use(healthRouter);

export default apiRouter;

