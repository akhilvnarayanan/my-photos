import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import photosRouter from "./photos";
import albumsRouter from "./albums";
import importsRouter from "./imports";
import libraryRouter from "./library";
import aiRouter from "./ai";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(photosRouter);
router.use(albumsRouter);
router.use(importsRouter);
router.use(libraryRouter);
router.use(aiRouter);

export default router;
