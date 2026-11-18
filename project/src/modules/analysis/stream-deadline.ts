export type StreamDeadlineReason = 'FIRST_OUTPUT_TIMEOUT' | 'STREAM_IDLE_TIMEOUT' | 'REQUEST_TIMEOUT';
export const STREAM_DEADLINE_DEFAULTS = {firstOutputMs:120000, idleMs:60000, requestMs:600000} as const;

export function createStreamDeadline(limits: {firstOutputMs:number; idleMs:number; requestMs:number}) {
  const controller = new AbortController();
  let failure: StreamDeadlineReason | undefined;
  const expire = (reason:StreamDeadlineReason) => {
    if (!controller.signal.aborted) {
      failure = reason;
      controller.abort();
    }
  };
  let activityTimer = setTimeout(() => expire('FIRST_OUTPUT_TIMEOUT'), limits.firstOutputMs);
  const requestTimer = setTimeout(() => expire('REQUEST_TIMEOUT'), limits.requestMs);
  return {
    signal: controller.signal,
    reason: () => failure,
    text(value:string) {
      if (!value.trim() || controller.signal.aborted) return;
      clearTimeout(activityTimer);
      activityTimer = setTimeout(() => expire('STREAM_IDLE_TIMEOUT'), limits.idleMs);
    },
    dispose() {
      clearTimeout(activityTimer);
      clearTimeout(requestTimer);
    },
  };
}
