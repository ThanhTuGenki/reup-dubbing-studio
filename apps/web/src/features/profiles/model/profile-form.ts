import type {
  ChannelProfile,
  CreateChannelProfile,
  CreateSeriesProfile,
  SeriesProfile,
  UpdateChannelProfile,
  UpdateSeriesProfile,
} from '@reup-dubbing-studio/api-client';

export type ChannelDraft = {
  name: string; status: 'DRAFT' | 'ACTIVE'; targetLanguage: string; defaultVoiceProfileId: string;
  voiceMode: 'SINGLE' | 'DUAL' | 'MULTI_AUTO'; subtitleLanguage: string; subtitleFilenameRule: string;
  subtitleMaxLineLength: string; ttsSpeed: string; timingPolicy: 'PRESERVE_SEGMENT' | 'FIT_SEGMENT' | 'ALLOW_DRIFT';
  removeHardSubEnabled: boolean; output16x9Enabled: boolean; output9x16Enabled: boolean; ctaTemplate: string; baseKeywords: string;
  youtubeName: string; youtubeExternalId: string; facebookName: string; facebookExternalId: string;
};

export type SeriesField = 'targetLanguage' | 'defaultVoiceProfileId' | 'voiceMode' | 'subtitleLanguage'
  | 'subtitleFilenameRule' | 'subtitleMaxLineLength' | 'ttsSpeed' | 'timingPolicy'
  | 'removeHardSubEnabled' | 'output16x9Enabled' | 'output9x16Enabled';

export type SeriesDraft = {
  name: string; channelProfileId: string; status: 'DRAFT' | 'ACTIVE'; overridden: Set<SeriesField>;
  targetLanguage: string; defaultVoiceProfileId: string; voiceMode: 'SINGLE' | 'DUAL' | 'MULTI_AUTO';
  subtitleLanguage: string; subtitleFilenameRule: string; subtitleMaxLineLength: string; ttsSpeed: string;
  timingPolicy: 'PRESERVE_SEGMENT' | 'FIT_SEGMENT' | 'ALLOW_DRIFT'; removeHardSubEnabled: boolean; output16x9Enabled: boolean; output9x16Enabled: boolean;
  maskEnabled: boolean; maskX: string; maskY: string; maskWidth: string; maskHeight: string;
};

export type ProfileFormErrors = Record<string, string>;

export function emptyChannelDraft(): ChannelDraft {
  return {
    name: '', status: 'DRAFT', targetLanguage: 'vi', defaultVoiceProfileId: '', voiceMode: 'SINGLE',
    subtitleLanguage: 'vi', subtitleFilenameRule: '{slug}.vi.srt', subtitleMaxLineLength: '42',
    ttsSpeed: '1', timingPolicy: 'FIT_SEGMENT', removeHardSubEnabled: false, output16x9Enabled: true, output9x16Enabled: false,
    ctaTemplate: '', baseKeywords: '', youtubeName: '', youtubeExternalId: '', facebookName: '', facebookExternalId: '',
  };
}

export function channelDraft(profile: ChannelProfile): ChannelDraft {
  const youtube = profile.destinations.find((item) => item.platform === 'YOUTUBE');
  const facebook = profile.destinations.find((item) => item.platform === 'FACEBOOK');
  return {
    name: profile.name, status: profile.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
    targetLanguage: profile.pipeline.targetLanguage, defaultVoiceProfileId: profile.pipeline.defaultVoiceProfileId ?? '',
    voiceMode: profile.pipeline.voiceMode, subtitleLanguage: profile.pipeline.subtitleLanguage,
    subtitleFilenameRule: profile.pipeline.subtitleFilenameRule,
    subtitleMaxLineLength: profile.pipeline.subtitleMaxLineLength?.toString() ?? '',
    ttsSpeed: profile.pipeline.ttsSpeed.toString(), timingPolicy: profile.pipeline.timingPolicy,
    removeHardSubEnabled: profile.pipeline.removeHardSubEnabled,
    output16x9Enabled: profile.pipeline.output16x9Enabled, output9x16Enabled: profile.pipeline.output9x16Enabled,
    ctaTemplate: profile.content.ctaTemplate ?? '', baseKeywords: profile.content.baseKeywords.join(', '),
    youtubeName: youtube?.displayName ?? '', youtubeExternalId: youtube?.externalId ?? '',
    facebookName: facebook?.displayName ?? '', facebookExternalId: facebook?.externalId ?? '',
  };
}

export function validateChannelDraft(draft: ChannelDraft): ProfileFormErrors {
  const errors: ProfileFormErrors = {};
  if (!draft.name.trim()) errors.name = 'Nhập tên Channel Profile.';
  if (!language(draft.targetLanguage)) errors.targetLanguage = 'Nhập mã ngôn ngữ BCP 47 hợp lệ.';
  if (!language(draft.subtitleLanguage)) errors.subtitleLanguage = 'Nhập mã ngôn ngữ subtitle hợp lệ.';
  if (!draft.subtitleFilenameRule.trim()) errors.subtitleFilenameRule = 'Nhập quy tắc tên file subtitle.';
  if (draft.defaultVoiceProfileId && !uuid(draft.defaultVoiceProfileId)) errors.defaultVoiceProfileId = 'Voice ID phải là UUID.';
  const maxLine = Number(draft.subtitleMaxLineLength);
  if (draft.subtitleMaxLineLength && (!Number.isInteger(maxLine) || maxLine < 1 || maxLine > 500)) errors.subtitleMaxLineLength = 'Giá trị từ 1 đến 500.';
  const speed = Number(draft.ttsSpeed);
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) errors.ttsSpeed = 'Tốc độ từ 0.5 đến 2.';
  if (!draft.output16x9Enabled && !draft.output9x16Enabled) errors.outputs = 'Bật ít nhất một output.';
  return errors;
}

export function buildChannelCreate(draft: ChannelDraft): CreateChannelProfile {
  return {
    name: draft.name.trim(), pipeline: pipelineFromChannel(draft),
    content: { voiceRules: {}, ctaTemplate: textOrNull(draft.ctaTemplate), metadataTemplate: {}, baseKeywords: keywords(draft.baseKeywords) },
    destinations: destinations(draft),
  };
}

export function buildChannelUpdate(draft: ChannelDraft, current: ChannelProfile): UpdateChannelProfile {
  return {
    name: draft.name.trim(), status: draft.status, pipeline: pipelineFromChannel(draft),
    content: {
      voiceRules: current.content.voiceRules, ctaTemplate: textOrNull(draft.ctaTemplate),
      metadataTemplate: current.content.metadataTemplate, baseKeywords: keywords(draft.baseKeywords),
    }, destinations: destinations(draft),
  };
}

export function emptySeriesDraft(channelProfileId = ''): SeriesDraft {
  return {
    name: '', channelProfileId, status: 'DRAFT', overridden: new Set(),
    targetLanguage: 'vi', defaultVoiceProfileId: '', voiceMode: 'SINGLE', subtitleLanguage: 'vi',
    subtitleFilenameRule: '{slug}.vi.srt', subtitleMaxLineLength: '42', ttsSpeed: '1', timingPolicy: 'FIT_SEGMENT',
    removeHardSubEnabled: false, output16x9Enabled: true, output9x16Enabled: false,
    maskEnabled: false, maskX: '0.1', maskY: '0.8', maskWidth: '0.8', maskHeight: '0.1',
  };
}

export function seriesDraft(profile: SeriesProfile): SeriesDraft {
  const effective = profile.effectiveConfig;
  return {
    name: profile.name, channelProfileId: profile.channelProfileId,
    status: profile.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
    overridden: new Set((Object.entries(profile.inheritance)
      .filter(([, source]) => source === 'SERIES').map(([key]) => key)) as SeriesField[]),
    targetLanguage: effective.targetLanguage, defaultVoiceProfileId: effective.defaultVoiceProfileId ?? '',
    voiceMode: effective.voiceMode, subtitleLanguage: effective.subtitleLanguage,
    subtitleFilenameRule: effective.subtitleFilenameRule,
    subtitleMaxLineLength: effective.subtitleMaxLineLength?.toString() ?? '', ttsSpeed: effective.ttsSpeed.toString(),
    timingPolicy: effective.timingPolicy, removeHardSubEnabled: effective.removeHardSubEnabled, output16x9Enabled: effective.output16x9Enabled,
    output9x16Enabled: effective.output9x16Enabled, maskEnabled: Boolean(profile.mask),
    maskX: profile.mask?.x.toString() ?? '0.1', maskY: profile.mask?.y.toString() ?? '0.8',
    maskWidth: profile.mask?.width.toString() ?? '0.8', maskHeight: profile.mask?.height.toString() ?? '0.1',
  };
}

export function validateSeriesDraft(draft: SeriesDraft): ProfileFormErrors {
  const errors: ProfileFormErrors = {};
  if (!draft.name.trim()) errors.name = 'Nhập tên Series Profile.';
  if (!uuid(draft.channelProfileId)) errors.channelProfileId = 'Chọn Channel Profile cha.';
  if (draft.overridden.has('targetLanguage') && !language(draft.targetLanguage)) errors.targetLanguage = 'Mã ngôn ngữ không hợp lệ.';
  if (draft.overridden.has('defaultVoiceProfileId') && !uuid(draft.defaultVoiceProfileId)) errors.defaultVoiceProfileId = 'Nhập Voice ID dạng UUID để ghi đè.';
  if (draft.overridden.has('subtitleLanguage') && !language(draft.subtitleLanguage)) errors.subtitleLanguage = 'Mã ngôn ngữ subtitle không hợp lệ.';
  if (draft.overridden.has('subtitleFilenameRule') && !draft.subtitleFilenameRule.trim()) errors.subtitleFilenameRule = 'Nhập quy tắc tên file subtitle.';
  if (draft.overridden.has('subtitleMaxLineLength')) {
    const maxLine = Number(draft.subtitleMaxLineLength);
    if (!Number.isInteger(maxLine) || maxLine < 1 || maxLine > 500) errors.subtitleMaxLineLength = 'Giá trị từ 1 đến 500.';
  }
  if (draft.overridden.has('ttsSpeed')) {
    const speed = Number(draft.ttsSpeed); if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) errors.ttsSpeed = 'Tốc độ từ 0.5 đến 2.';
  }
  if (draft.overridden.has('output16x9Enabled') && draft.overridden.has('output9x16Enabled') && !draft.output16x9Enabled && !draft.output9x16Enabled) errors.outputs = 'Bật ít nhất một output.';
  if (draft.removeHardSubEnabled && !draft.maskEnabled) errors.mask = 'Cấu hình mask khi bật xóa hard-sub.';
  else if (draft.removeHardSubEnabled && !validMask(draft)) errors.mask = 'Mask phải nằm hoàn toàn trong khung normalized 0–1.';
  return errors;
}

export function buildSeriesCreate(draft: SeriesDraft): CreateSeriesProfile {
  return { channelProfileId: draft.channelProfileId, name: draft.name.trim(), overrides: seriesOverrides(draft), mask: mask(draft) };
}
export function buildSeriesUpdate(draft: SeriesDraft): UpdateSeriesProfile {
  return { name: draft.name.trim(), status: draft.status, overrides: seriesOverrides(draft), mask: mask(draft) };
}

function pipelineFromChannel(draft: ChannelDraft): CreateChannelProfile['pipeline'] {
  return {
    targetLanguage: draft.targetLanguage.trim(), defaultVoiceProfileId: textOrNull(draft.defaultVoiceProfileId),
    voiceMode: draft.voiceMode, subtitleLanguage: draft.subtitleLanguage.trim(),
    subtitleFilenameRule: draft.subtitleFilenameRule.trim(),
    subtitleMaxLineLength: draft.subtitleMaxLineLength ? Number(draft.subtitleMaxLineLength) : null,
    ttsSpeed: Number(draft.ttsSpeed), timingPolicy: draft.timingPolicy,
    removeHardSubEnabled: draft.removeHardSubEnabled,
    output16x9Enabled: draft.output16x9Enabled, output9x16Enabled: draft.output9x16Enabled,
  };
}
function destinations(draft: ChannelDraft): CreateChannelProfile['destinations'] {
  return [
    ...(draft.youtubeName.trim() ? [{ platform: 'YOUTUBE' as const, externalId: textOrNull(draft.youtubeExternalId), displayName: draft.youtubeName.trim(), isRequired: true, isActive: true, platformConfig: {} }] : []),
    ...(draft.facebookName.trim() ? [{ platform: 'FACEBOOK' as const, externalId: textOrNull(draft.facebookExternalId), displayName: draft.facebookName.trim(), isRequired: false, isActive: true, platformConfig: {} }] : []),
  ];
}
function seriesOverrides(draft: SeriesDraft): NonNullable<CreateSeriesProfile['overrides']> {
  return {
    targetLanguage: draft.overridden.has('targetLanguage') ? draft.targetLanguage.trim() : null,
    defaultVoiceProfileId: draft.overridden.has('defaultVoiceProfileId') ? textOrNull(draft.defaultVoiceProfileId) : null,
    voiceMode: draft.overridden.has('voiceMode') ? draft.voiceMode : null,
    subtitleLanguage: draft.overridden.has('subtitleLanguage') ? draft.subtitleLanguage.trim() : null,
    subtitleFilenameRule: draft.overridden.has('subtitleFilenameRule') ? draft.subtitleFilenameRule.trim() : null,
    subtitleMaxLineLength: draft.overridden.has('subtitleMaxLineLength') && draft.subtitleMaxLineLength ? Number(draft.subtitleMaxLineLength) : null,
    ttsSpeed: draft.overridden.has('ttsSpeed') ? Number(draft.ttsSpeed) : null,
    timingPolicy: draft.overridden.has('timingPolicy') ? draft.timingPolicy : null,
    removeHardSubEnabled: draft.overridden.has('removeHardSubEnabled') ? draft.removeHardSubEnabled : null,
    output16x9Enabled: draft.overridden.has('output16x9Enabled') ? draft.output16x9Enabled : null,
    output9x16Enabled: draft.overridden.has('output9x16Enabled') ? draft.output9x16Enabled : null,
  };
}
function mask(draft: SeriesDraft) {
  return draft.maskEnabled ? { x: Number(draft.maskX), y: Number(draft.maskY), width: Number(draft.maskWidth), height: Number(draft.maskHeight) } : null;
}
function validMask(draft: SeriesDraft) {
  const [x, y, width, height] = [draft.maskX, draft.maskY, draft.maskWidth, draft.maskHeight].map(Number);
  return [x, y, width, height].every(Number.isFinite) && x! >= 0 && y! >= 0 && width! > 0 && height! > 0 && x! + width! <= 1 && y! + height! <= 1;
}
function keywords(value: string) { return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]; }
function textOrNull(value: string) { return value.trim() || null; }
function language(value: string) { return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(value); }
function uuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value); }
