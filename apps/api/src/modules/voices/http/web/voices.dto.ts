import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
const STATUSES = ['DRAFT', 'READY', 'BLOCKED_LICENSE', 'ARCHIVED'] as const;
const LICENSES = ['OWNED_RECORDING', 'AUTHORIZED_COMMERCIAL', 'CC_BY', 'CC_BY_NC', 'CUSTOM', 'UNKNOWN'] as const;
export class CreateVoiceDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(35) primaryLanguage!: string;
  @IsOptional() @IsString() @MaxLength(2000) description!: string | null;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) tags!: string[];
  @IsIn(LICENSES) licenseKind!: typeof LICENSES[number];
  @IsOptional() @IsString() @MaxLength(2000) licenseReference!: string | null;
  @IsOptional() @IsString() @MaxLength(2000) sourceReference!: string | null;
  @IsBoolean() commercialUseAllowed!: boolean;
}
export class UpdateVoiceDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(35) primaryLanguage?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  @IsOptional() @IsIn(LICENSES) licenseKind?: typeof LICENSES[number];
  @IsOptional() @IsString() @MaxLength(2000) licenseReference?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) sourceReference?: string | null;
  @IsOptional() @IsBoolean() commercialUseAllowed?: boolean;
}
export class VoiceListQueryDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsString() @MaxLength(120) query?: string;
  @IsOptional() @IsIn(STATUSES) status?: typeof STATUSES[number];
  @IsOptional() @IsString() @MaxLength(35) language?: string;
  @IsOptional() @IsString() @MaxLength(40) tag?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value) @IsBoolean() commercialUseAllowed?: boolean;
}
export class RequestVoiceSampleUploadDto {
  @IsString() @IsNotEmpty() @MaxLength(35) language!: string;
  @IsString() @IsNotEmpty() @MaxLength(1000) transcript!: string;
  @IsInt() @Min(3000) @Max(10000) durationMs!: number;
  @IsString() @IsNotEmpty() @MaxLength(255) fileName!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) contentType!: string;
  @IsInt() @Min(1) @Max(15 * 1024 * 1024) byteSize!: number;
  @IsOptional() @IsString() @Matches(/^[0-9a-f]{64}$/u) checksumSha256?: string;
}
