import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const VOICE_MODES = ['SINGLE', 'DUAL', 'MULTI_AUTO'] as const;
const TIMING_POLICIES = ['PRESERVE_SEGMENT', 'FIT_SEGMENT', 'ALLOW_DRIFT'] as const;

export class PipelineConfigDto {
  @IsString() @IsNotEmpty() @MaxLength(35) targetLanguage!: string;
  @IsOptional() @IsUUID() defaultVoiceProfileId!: string | null;
  @IsIn(VOICE_MODES) voiceMode!: typeof VOICE_MODES[number];
  @IsString() @IsNotEmpty() @MaxLength(35) subtitleLanguage!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) subtitleFilenameRule!: string;
  @IsOptional() @IsInt() @Min(1) @Max(500) subtitleMaxLineLength!: number | null;
  @IsNumber() @Min(0.5) @Max(2) ttsSpeed!: number;
  @IsIn(TIMING_POLICIES) timingPolicy!: typeof TIMING_POLICIES[number];
  @IsBoolean() removeHardSubEnabled!: boolean;
  @IsBoolean() output16x9Enabled!: boolean;
  @IsBoolean() output9x16Enabled!: boolean;
}

export class PipelinePatchDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(35) targetLanguage?: string;
  @IsOptional() @IsUUID() defaultVoiceProfileId?: string | null;
  @IsOptional() @IsIn(VOICE_MODES) voiceMode?: typeof VOICE_MODES[number];
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(35) subtitleLanguage?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) subtitleFilenameRule?: string;
  @IsOptional() @IsInt() @Min(1) @Max(500) subtitleMaxLineLength?: number | null;
  @IsOptional() @IsNumber() @Min(0.5) @Max(2) ttsSpeed?: number;
  @IsOptional() @IsIn(TIMING_POLICIES) timingPolicy?: typeof TIMING_POLICIES[number];
  @IsOptional() @IsBoolean() removeHardSubEnabled?: boolean;
  @IsOptional() @IsBoolean() output16x9Enabled?: boolean;
  @IsOptional() @IsBoolean() output9x16Enabled?: boolean;
}

export class ContentConfigDto {
  @IsObject() voiceRules!: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(4000) ctaTemplate!: string | null;
  @IsObject() metadataTemplate!: Record<string, unknown>;
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(100, { each: true })
  baseKeywords!: string[];
}

export class ContentPatchDto {
  @IsOptional() @IsObject() voiceRules?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(4000) ctaTemplate?: string | null;
  @IsOptional() @IsObject() metadataTemplate?: Record<string, unknown>;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(100, { each: true })
  baseKeywords?: string[];
}

export class DestinationDto {
  @IsIn(['YOUTUBE', 'FACEBOOK']) platform!: 'YOUTUBE' | 'FACEBOOK';
  @IsOptional() @IsString() @MaxLength(200) externalId?: string | null;
  @IsString() @IsNotEmpty() @MaxLength(200) displayName!: string;
  @IsBoolean() isRequired!: boolean;
  @IsBoolean() isActive!: boolean;
  @IsObject() platformConfig!: Record<string, unknown>;
}

export class CreateChannelProfileDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @ValidateNested() @Type(() => PipelineConfigDto) pipeline!: PipelineConfigDto;
  @ValidateNested() @Type(() => ContentConfigDto) content!: ContentConfigDto;
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => DestinationDto)
  destinations!: DestinationDto[];
}

export class UpdateChannelProfileDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE']) status?: 'DRAFT' | 'ACTIVE';
  @IsOptional() @ValidateNested() @Type(() => PipelinePatchDto) pipeline?: PipelinePatchDto;
  @IsOptional() @ValidateNested() @Type(() => ContentPatchDto) content?: ContentPatchDto;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => DestinationDto)
  destinations?: DestinationDto[];
}

export class SeriesOverridesDto extends PipelinePatchDto {}

export class SubtitleMaskDto {
  @IsNumber() @Min(0) @Max(1) x!: number;
  @IsNumber() @Min(0) @Max(1) y!: number;
  @IsNumber() @Min(0) @Max(1) width!: number;
  @IsNumber() @Min(0) @Max(1) height!: number;
}

export class CreateSeriesProfileDto {
  @IsUUID() channelProfileId!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsOptional() @ValidateNested() @Type(() => SeriesOverridesDto) overrides?: SeriesOverridesDto;
  @IsOptional() @ValidateNested() @Type(() => SubtitleMaskDto) mask?: SubtitleMaskDto | null;
}

export class UpdateSeriesProfileDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE']) status?: 'DRAFT' | 'ACTIVE';
  @IsOptional() @ValidateNested() @Type(() => SeriesOverridesDto) overrides?: SeriesOverridesDto;
  @IsOptional() @ValidateNested() @Type(() => SubtitleMaskDto) mask?: SubtitleMaskDto | null;
}

export class ProfileListQueryDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsString() @MaxLength(120) query?: string;
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'ARCHIVED']) status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  @IsOptional() @IsIn(['READY', 'NEEDS_CONFIGURATION']) readiness?: 'READY' | 'NEEDS_CONFIGURATION';
  @IsOptional() @IsUUID() channelProfileId?: string;
}

export class RequestProfileUploadDto {
  @IsIn(['INTRO', 'OUTRO', 'LOGO', 'WATERMARK', 'MASK_REFERENCE_FRAME'])
  role!: 'INTRO' | 'OUTRO' | 'LOGO' | 'WATERMARK' | 'MASK_REFERENCE_FRAME';
  @IsString() @IsNotEmpty() @MaxLength(255) fileName!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) contentType!: string;
  @IsInt() @Min(1) @Max(2_147_483_648) byteSize!: number;
  @IsOptional() @IsString() @MaxLength(64) checksumSha256?: string;
  @IsOptional() @IsInt() @Min(1) @Max(16_384) width?: number;
  @IsOptional() @IsInt() @Min(1) @Max(16_384) height?: number;
}
