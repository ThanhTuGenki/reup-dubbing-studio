import type {
  ReviewGateMode,
  ReviewPolicy,
  StoredReviewPolicyValues,
  UpdateChannelReviewPolicy,
  UpdateSeriesReviewPolicy,
} from '@reup-dubbing-studio/api-client';

export type ReviewPolicyField = Exclude<keyof StoredReviewPolicyValues, 'autoRequestRender'>;
export type ReviewPolicyDraft = StoredReviewPolicyValues;

export const gateFields: ReadonlyArray<{
  key: ReviewPolicyField;
  label: string;
  description: string;
  bypassWarning: string;
}> = [
  { key: 'castGate', label: 'Cast & giọng', description: 'Duyệt character → voice mapping trước khi tạo audio.', bypassWarning: 'Bỏ điểm duyệt không bỏ qua voice readiness hoặc license.' },
  { key: 'scriptGate', label: 'Kịch bản dịch', description: 'Duyệt nội dung và timing của bản dịch hiện tại.', bypassWarning: 'Bản sửa mới vẫn làm decision cũ hết hiệu lực.' },
  { key: 'ttsGate', label: 'Audio TTS', description: 'Nghe và duyệt audio đã chọn cho mọi segment.', bypassWarning: 'Render vẫn bị chặn nếu thiếu audio sẵn sàng hoặc chưa chọn.' },
  { key: 'renderGate', label: 'Thành phẩm render', description: 'Hậu kiểm output render cụ thể sau khi job hoàn tất.', bypassWarning: 'Gate này không quyết định việc tạo render request.' },
  { key: 'publishContentGate', label: 'Nội dung đăng bài', description: 'Chuẩn bị gate cho title, caption và checklist publishing.', bypassWarning: 'Publishing chưa kích hoạt gate này trong MVP.' },
];

export function draftFromPolicy(policy: ReviewPolicy): ReviewPolicyDraft { return { ...policy.stored }; }

export function effectiveDraft(policy: ReviewPolicy, draft: ReviewPolicyDraft) {
  return {
    castGate: draft.castGate ?? policy.effective.castGate,
    scriptGate: draft.scriptGate ?? policy.effective.scriptGate,
    ttsGate: draft.ttsGate ?? policy.effective.ttsGate,
    renderGate: draft.renderGate ?? policy.effective.renderGate,
    publishContentGate: draft.publishContentGate ?? policy.effective.publishContentGate,
    autoRequestRender: draft.autoRequestRender ?? policy.effective.autoRequestRender,
  };
}

export function buildPolicyPatch(owner: 'channel' | 'series', policy: ReviewPolicy, draft: ReviewPolicyDraft) {
  const patch: Record<string, ReviewGateMode | boolean | null> = {};
  for (const key of [...gateFields.map(({ key }) => key), 'autoRequestRender'] as const) {
    if (draft[key] !== policy.stored[key]) patch[key] = draft[key];
  }
  return owner === 'channel' ? patch as UpdateChannelReviewPolicy : patch as UpdateSeriesReviewPolicy;
}

export function policyDirty(policy: ReviewPolicy, draft: ReviewPolicyDraft) {
  return gateFields.some(({ key }) => policy.stored[key] !== draft[key])
    || policy.stored.autoRequestRender !== draft.autoRequestRender;
}
