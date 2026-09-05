import { claimNextAiJob, completeAiJob, failAiJob } from "./ai-jobs";

const POLL_MS = Number(process.env.AI_WORKER_POLL_MS ?? 2000);
const MODEL_VERSION = process.env.AI_MODEL_VERSION ?? "foundation-1";

/**
 * Durable worker loop. Feature-specific local models are plugged into processJob
 * in later phases. Keeping the worker independent means imports and browsing do
 * not depend on AI availability.
 */
export async function processJob(job: Awaited<ReturnType<typeof claimNextAiJob>>) {
  if (!job) return;

  // Foundation stage: validate the job lifecycle without modifying media.
  // Later processors will independently populate places, OCR, tags and
  // user-managed face groups and may report partial results.
  await completeAiJob(job.id, MODEL_VERSION);
}

export async function runAiWorker(signal?: AbortSignal) {
  while (!signal?.aborted) {
    const job = await claimNextAiJob();
    if (job) {
      try {
        await processJob(job);
      } catch (error) {
        await failAiJob(job.id, error instanceof Error ? error.message : String(error));
      }
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

if (process.env.RUN_AI_WORKER === "true") {
  runAiWorker().catch((error) => {
    console.error("AI worker stopped", error);
    process.exitCode = 1;
  });
}
