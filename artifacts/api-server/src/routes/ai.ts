import { Router, type IRouter, type Response } from "express";
import { UpdateAiSettingsBody } from "@workspace/api-zod";
import { requireUser } from "../lib/auth";
import {
  backfillAiJobs,
  ensureAiSettings,
  getAiStatus,
  retryFailedAiJobs,
  updateAiSettings,
} from "../lib/ai-jobs";
import { getAiWorkerState } from "../lib/ai-worker";

const router: IRouter = Router();
router.use(requireUser);

async function sendStatus(userId: string, res: Response) {
  res.json(await getAiStatus(userId, getAiWorkerState()));
}

router.get("/ai/status", async (_req, res): Promise<void> => {
  await sendStatus(res.locals.user.userId as string, res);
});

router.patch("/ai/settings", async (req, res): Promise<void> => {
  const parsed = UpdateAiSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid AI settings", details: parsed.error.flatten() });
    return;
  }
  const userId = res.locals.user.userId as string;
  await updateAiSettings(userId, parsed.data);
  await sendStatus(userId, res);
});

router.post("/ai/backfill", async (_req, res): Promise<void> => {
  const createdJobs = await backfillAiJobs(res.locals.user.userId as string);
  res.status(202).json({ createdJobs });
});

router.post("/ai/retry-failed", async (_req, res): Promise<void> => {
  const retriedJobs = await retryFailedAiJobs(res.locals.user.userId as string);
  res.status(202).json({ retriedJobs });
});

router.post("/ai/pause", async (_req, res): Promise<void> => {
  const userId = res.locals.user.userId as string;
  await updateAiSettings(userId, { processingPaused: true });
  await sendStatus(userId, res);
});

router.post("/ai/resume", async (_req, res): Promise<void> => {
  const userId = res.locals.user.userId as string;
  await updateAiSettings(userId, { processingPaused: false });
  await sendStatus(userId, res);
});

export default router;