import { runAiWorker } from "./lib/ai-worker";

const controller = new AbortController();

const stop = () => controller.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

runAiWorker(controller.signal).catch((error) => {
  console.error("AI worker stopped", error);
  process.exitCode = 1;
});
