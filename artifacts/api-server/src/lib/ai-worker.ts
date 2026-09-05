import { claimNextAiJob, completeAiJob, failAiJob } from "./ai-jobs";
import { processOcrJob } from "./ai-ocr";

const POLL_MS = Number(process.env.AI_WORKER_POLL_MS ?? 2000);

function requestedFeatures(value: string) {
  return new Set(value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
}

export async function processJob(job: Awaited<ReturnType<typeof claimNextAiJob>>) {
  if (!job) return;

  const features = requestedFeatures(job.requestedFeatures);
  const versions: string[] = [];

  if (features.has("ocr") || features.has("all")) {
    await processOcrJob(job.userId, job.photoId);
    versions.push("ocr-v1");
  }

  // Object detection, places enrichment and anonymous face detection are added
  // as independent processors. Keeping feature selection explicit prevents one
  // processor from pretending that the other analyses have already run.
  if (versions.length === 0) {
    throw new Error(`Unsupported AI features: ${job.requestedFeatures}`);
  }

  await completeAiJob(job.id, versions.join("+"));
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
