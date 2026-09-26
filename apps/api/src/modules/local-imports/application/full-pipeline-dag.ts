import type { Prisma } from '@prisma/client';

import { uuidV7 } from '../../../platform/ids/uuid-v7';
import type { ProfileJobSnapshot } from '../../profiles';

type TaskSeed = {
  id: string;
  taskType: 'TRANSCRIBE_ASR' | 'MERGE_TRANSCRIPT' | 'TRANSLATE' | 'ASSIGN_CAST'
    | 'GENERATE_INITIAL_TTS' | 'WAIT_FOR_REVIEW' | 'SEPARATE_AUDIO' | 'EXPORT_SRT' | 'RENDER';
  resourceClass: 'GPU_BATCH' | 'CPU' | 'CONTROL_PLANE' | 'GPU_TTS_INTERACTIVE' | 'HUMAN_REVIEW';
  status: 'READY' | 'BLOCKED';
  readyAt: Date | null;
  inputManifest: Prisma.InputJsonValue;
  configuration: Prisma.InputJsonValue;
  requiredCapabilities: string[];
  minimumVramMb?: number;
  minimumScratchBytes?: bigint;
  expectedRuntimeSeconds?: number;
};

export type FullPipelineDag = {
  tasks: TaskSeed[];
  dependencies: Array<{ taskId: string; dependsOnTaskId: string }>;
};

export function buildFullPipelineDag(input: {
  rawAssetId: string;
  sourceLanguage: string;
  sourceByteSize: number;
  snapshot: ProfileJobSnapshot;
  now: Date;
}): FullPipelineDag {
  const ids = {
    asr: uuidV7(), merge: uuidV7(), translate: uuidV7(), cast: uuidV7(), tts: uuidV7(),
    review: uuidV7(), separate: uuidV7(), srt: uuidV7(), render: uuidV7(),
  };
  const variants = [
    ...(input.snapshot.pipeline.output16x9Enabled ? [{ variant: 'FULL_16X9', outputSlot: 'video-16x9' }] : []),
    ...(input.snapshot.pipeline.output9x16Enabled ? [{ variant: 'HIGHLIGHT_9X16', outputSlot: 'video-9x16' }] : []),
  ];
  const tasks: TaskSeed[] = [
    {
      id: ids.asr, taskType: 'TRANSCRIBE_ASR', resourceClass: 'GPU_BATCH', status: 'READY', readyAt: input.now,
      inputManifest: {
        inputs: [{ slot: 'raw', kind: 'RAW', assetId: input.rawAssetId, metadata: {} }],
        outputs: [{ slot: 'asr-json', kind: 'ASR_JSON', minItems: 1, maxItems: 1, allowedContentTypes: ['application/json'], maxByteSize: '104857600' }],
      },
      configuration: { kind: 'TRANSCRIBE_ASR', language: input.sourceLanguage, modelSize: 'medium' },
      requiredCapabilities: ['transcript.asr.v1'], minimumVramMb: 2048,
      minimumScratchBytes: BigInt(input.sourceByteSize * 2), expectedRuntimeSeconds: 600,
    },
    blocked(ids.merge, 'MERGE_TRANSCRIPT', 'CPU'),
    blocked(ids.translate, 'TRANSLATE', 'CONTROL_PLANE'),
    blocked(ids.cast, 'ASSIGN_CAST', 'CONTROL_PLANE'),
    blocked(ids.tts, 'GENERATE_INITIAL_TTS', 'GPU_TTS_INTERACTIVE'),
    blocked(ids.review, 'WAIT_FOR_REVIEW', 'HUMAN_REVIEW'),
    blocked(ids.separate, 'SEPARATE_AUDIO', 'GPU_BATCH', {
      configuration: { kind: 'SEPARATE_AUDIO', modelName: 'htdemucs' },
      requiredCapabilities: ['audio.separate.demucs.v1'], minimumVramMb: 2048,
    }),
    blocked(ids.srt, 'EXPORT_SRT', 'CPU'),
    blocked(ids.render, 'RENDER', 'GPU_BATCH', {
      configuration: { kind: 'RENDER', subtitleMode: 'EXTERNAL_ONLY', variants },
      requiredCapabilities: ['media.render.ffmpeg.v1'], minimumVramMb: 512,
    }),
  ];
  return {
    tasks,
    dependencies: [
      edge(ids.merge, ids.asr), edge(ids.translate, ids.merge), edge(ids.cast, ids.translate),
      edge(ids.tts, ids.cast), edge(ids.review, ids.tts), edge(ids.separate, ids.review),
      edge(ids.srt, ids.review), edge(ids.render, ids.review), edge(ids.render, ids.separate), edge(ids.render, ids.srt),
    ],
  };
}

function blocked(
  id: string,
  taskType: TaskSeed['taskType'],
  resourceClass: TaskSeed['resourceClass'],
  overrides: Partial<TaskSeed> = {},
): TaskSeed {
  return {
    id, taskType, resourceClass, status: 'BLOCKED', readyAt: null,
    inputManifest: { inputs: [], outputs: [] }, configuration: { kind: taskType },
    requiredCapabilities: [], ...overrides,
  };
}

function edge(taskId: string, dependsOnTaskId: string) {
  return { taskId, dependsOnTaskId };
}
