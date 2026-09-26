import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class LocalVideoUploadDto {
  @IsString() @Matches(UUID_V7) channelProfileId!: string;
  @IsOptional() @IsString() @Matches(UUID_V7) seriesProfileId?: string | null;
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsString() @Matches(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u) sourceLanguage!: string;
  @IsString() @IsNotEmpty() @MaxLength(255) fileName!: string;
  @IsString() @Matches(/^video\/mp4$/u) contentType!: 'video/mp4';
  @IsInt() @Min(1) @Max(10 * 1024 * 1024 * 1024) byteSize!: number;
  @IsString() @Matches(/^[a-f0-9]{64}$/u) checksumSha256!: string;
  @IsInt() @Min(1) @Max(86_400_000) durationMs!: number;
  @IsInt() @Min(1) @Max(16_384) width!: number;
  @IsInt() @Min(1) @Max(16_384) height!: number;
}
