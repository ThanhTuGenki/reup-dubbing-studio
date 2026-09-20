export type WorkerRoleValue = 'BATCH_MEDIA' | 'INTERACTIVE_TTS';
export interface CreateImageInput { role: WorkerRoleValue; semanticVersion: string; imageDigest: string; registryRef: string; contractVersion: number }
export interface CreateWorkerInput { displayName: string; role: WorkerRoleValue; provider: string; providerInstanceId?: string; expectedGpuModel?: string; expectedVramMb?: number; approvedImageId: string; hourlyRateCp: string; paidVndPerCp?: string; billingStartedAt: string }
export interface EnrollmentInput { sessionNonce: string; role: WorkerRoleValue; imageDigest: string; agentVersion: string; contractVersion: number; gpuInventory: unknown[]; cpuInventory: Record<string, unknown>; capacity: Record<string, unknown> }
export interface HeartbeatInput { sequence: string; sentAt: string; capacity: Record<string, unknown>; currentTaskCount: number; activeLeaseIds: string[]; telemetry: Record<string, unknown>; agentVersion: string; contractVersion: number }
export interface WorkerFilters { cursor?: string; limit?: number; role?: string; observedStatus?: string; desiredStatus?: string; provider?: string; query?: string }
