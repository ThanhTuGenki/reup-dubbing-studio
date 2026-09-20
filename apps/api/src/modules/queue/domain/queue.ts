export type QueueFilters = { cursor?: string; limit?: number; status?: string; kind?: string; resourceClass?: string; channelProfileId?: string; query?: string; createdFrom?: string; createdTo?: string };
export type QueueAction = { reason?: string; taskId?: string };

export type QueueTaskView = {
  id: string; taskType: string; resourceClass: string; status: string; progressPercent: number;
  progressDetail: string | null; attemptCount: number; maxAttempts: number; readyAt: string | null;
  version: number; createdAt: string; updatedAt: string;
};

export type QueueJobView = {
  id: string; videoId: string; kind: string; status: string; version: number; title: string | null;
  channelProfileId: string; channelProfileName: string | null; seriesProfileId: string | null;
  seriesProfileName: string | null; currentTask: QueueTaskView | null;
  progress: { percent: number; completedTasks: number; totalTasks: number };
  failure: { code: string; detail: string | null } | null;
  actions: { canRetry: boolean; canCancel: boolean };
  startedAt: string | null; finishedAt: string | null; createdAt: string; updatedAt: string;
};

export type QueueJobDetail = QueueJobView & { tasks: QueueTaskView[]; timeline: QueueTimelineEvent[] };
export type QueueTimelineEvent = { id: string; eventType: string; fromStatus: string | null; toStatus: string | null; message: string | null; occurredAt: string };
export type QueueAttemptView = { id: string; taskId: string; taskType: string; attemptNumber: number; executorKind: string; status: string; startedAt: string; finishedAt: string | null; executionMs: string | null; errorCode: string | null; errorDetail: string | null };
