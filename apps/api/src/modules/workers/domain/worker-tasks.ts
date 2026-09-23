import type {
  CommitOutputRequest,
  CompleteTaskRequest,
  FailTaskRequest,
  LeaseActionRequest,
  OutputGrantRequest,
  TaskConfiguration,
  TaskInputAsset,
  TaskOutputSpecification,
  TaskProgressRequest,
  WorkerTaskType,
} from '@reup-dubbing-studio/api-contract/worker';

export type TaskManifest = {
  inputs: Array<Omit<TaskInputAsset, 'download'>>;
  outputs: TaskOutputSpecification[];
};

export type ClaimableTaskSnapshot = {
  taskType: WorkerTaskType;
  configuration: TaskConfiguration;
  manifest: TaskManifest;
};

export type { CommitOutputRequest, CompleteTaskRequest, FailTaskRequest, LeaseActionRequest, OutputGrantRequest, TaskProgressRequest };
