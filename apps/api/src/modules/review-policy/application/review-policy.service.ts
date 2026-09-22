import type { ChannelReviewPolicyPatch, SeriesReviewPolicyPatch } from '../domain/review-policy';
import type { PrismaReviewPolicyRepository } from '../infrastructure/prisma-review-policy-repository';

export class ReviewPolicyService {
  constructor(private readonly repository: PrismaReviewPolicyRepository) {}

  getChannel(id: string) { return this.repository.getChannel(id); }
  getSeries(id: string) { return this.repository.getSeries(id); }
  updateChannel(id: string, version: number, patch: ChannelReviewPolicyPatch, key: string) {
    return this.repository.updateChannel(id, version, patch, key);
  }
  updateSeries(id: string, version: number, parentVersion: number, patch: SeriesReviewPolicyPatch, key: string) {
    return this.repository.updateSeries(id, version, parentVersion, patch, key);
  }
}
