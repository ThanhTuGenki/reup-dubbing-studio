import type {
  ReviewPolicy,
  ReviewPolicyValues,
  UpdateChannelReviewPolicy,
  UpdateSeriesReviewPolicy,
} from '@reup-dubbing-studio/api-contract';

export type ReviewPolicyView = ReviewPolicy;
export type ChannelReviewPolicyPatch = UpdateChannelReviewPolicy;
export type SeriesReviewPolicyPatch = UpdateSeriesReviewPolicy;

export type ReviewPolicySnapshot = {
  schemaVersion: 1;
  channelPolicyVersion: number;
  seriesPolicyVersion: number | null;
  effective: ReviewPolicyValues;
};
