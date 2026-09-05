import { logger } from "./logger";

type WorkerState = {
  status: "running" | "stopped" | "unavailable";
  lastHeartbeat: Date | null;
  currentJobId: string | null;
};

const state: WorkerState = {
  status: "stopped",
  lastHeartbeat: null,
  currentJobId: null,
};

let heartbeatTimer: NodeJS.Timeout | undefined;

export function getAiWorkerState(): WorkerState {
  return { ...state };
}

export function startAiWorker() {
  if (heartbeatTimer) return;
  state.status = process.env.AI_WORKER_DISABLED === "true" ? "unavailable" : "running";
  state.lastHeartbeat = new Date();
  if (state.status === "running") {
    heartbeatTimer = setInterval(() => {
      state.lastHeartbeat = new Date();
    }, 15_000);
    heartbeatTimer.unref();
    logger.info("AI worker queue monitor started; feature processors will be enabled in later phases");
  } else {
    logger.info("AI worker disabled by configuration");
  }
}