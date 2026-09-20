import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';
import { AVAILABILITIES, CONTENT_TYPES, DISCOVERY_MODES, SOURCE_PLATFORMS, WATCHLIST_STATUSES } from '../../domain/discovery';

export class CreateSourceAccountDto {
  @IsIn(SOURCE_PLATFORMS) platform!: typeof SOURCE_PLATFORMS[number];
  @IsString() @IsNotEmpty() @MaxLength(120) displayName!: string;
}
export class SourceAccountQueryDto { @IsOptional() @IsIn(SOURCE_PLATFORMS) platform?: typeof SOURCE_PLATFORMS[number]; }
export class ImportSourceCredentialDto { @IsString() @IsNotEmpty() @MaxLength(262144) netscapeCookie!: string; }
export class CategoryQueryDto { @IsIn(SOURCE_PLATFORMS) platform!: typeof SOURCE_PLATFORMS[number]; }
export class CreateDiscoveryRunDto {
  @IsString() @IsNotEmpty() sourceAccountId!: string;
  @IsIn(DISCOVERY_MODES) mode!: typeof DISCOVERY_MODES[number];
  @IsOptional() @IsString() @MaxLength(2000) input?: string;
  @IsOptional() @IsString() @MaxLength(200) query?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsInt() @IsIn([20, 50, 100]) requestedLimit?: number;
}
export class DiscoveryItemsQueryDto {
  @IsOptional() @IsString() runId?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() creatorId?: string;
  @IsOptional() @IsIn(CONTENT_TYPES) contentType?: typeof CONTENT_TYPES[number];
  @IsOptional() @IsIn(AVAILABILITIES) availability?: typeof AVAILABILITIES[number];
  @IsOptional() @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value) @IsBoolean() ingestEligible?: boolean;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}
export class CreateWatchlistDto {
  @IsString() @IsNotEmpty() sourceAccountId!: string;
  @IsIn(['CREATOR']) mode!: 'CREATOR';
  @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(2000) input!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) displayName!: string;
  @IsInt() @Min(15) @Max(43200) scheduleIntervalMin!: number;
}
export class UpdateWatchlistDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) displayName?: string;
  @IsOptional() @IsIn(WATCHLIST_STATUSES) status?: typeof WATCHLIST_STATUSES[number];
  @IsOptional() @IsInt() @Min(15) @Max(43200) scheduleIntervalMin?: number;
}
