import { queryOptions } from '@tanstack/react-query';

import { fetchReviewPolicy, type ReviewPolicyOwner } from './review-policy-api';

export const reviewPolicyKeys = {
  all: ['review-policy'] as const,
  detail: (owner: ReviewPolicyOwner, id: string) => [...reviewPolicyKeys.all, owner, id] as const,
};

export function reviewPolicyQuery(owner: ReviewPolicyOwner, id: string) {
  return queryOptions({
    queryKey: reviewPolicyKeys.detail(owner, id),
    queryFn: ({ signal }) => fetchReviewPolicy(owner, id, signal),
  });
}
