import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import photosRouter from "./photos";
import albumsRouter from "./albums";
import importsRouter from "./imports";
import libraryRouter from "./library";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(photosRouter);
router.use(albumsRouter);
router.use(importsRouter);
router.use(libraryRouter);

export default router;
