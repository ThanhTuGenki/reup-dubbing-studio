import type {
  CreatePublicationProof,
  CreatePublishPackage,
  PlanPublicationTask,
  VerifyPublicationProof,
} from '@reup-dubbing-studio/api-contract';

export type CreatePackageInput = CreatePublishPackage;
export type PublicationPlanInput = PlanPublicationTask;
export type ProofInput = CreatePublicationProof;
export type ProofVerificationInput = VerifyPublicationProof;
export type PublicationAssetRole = 'VIDEO' | 'SUBTITLE' | 'THUMBNAIL';
export type PublicationFilters = {
  cursor?: string; limit?: number; status?: string; platform?: string;
  destinationId?: string; videoId?: string; scheduled?: boolean; overdue?: boolean;
};
