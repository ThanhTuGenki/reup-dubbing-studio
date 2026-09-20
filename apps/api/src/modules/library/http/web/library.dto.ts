import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
export class LibraryListQueryDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() platform?: string;
  @IsOptional() @IsUUID() channelProfileId?: string;
  @IsOptional() @IsUUID() seriesProfileId?: string;
  @IsOptional() @IsIn(['NONE','PARTIAL','READY','CLEANED']) outputReadiness?: 'NONE'|'PARTIAL'|'READY'|'CLEANED';
  @IsOptional() @IsISO8601() updatedFrom?: string;
  @IsOptional() @IsISO8601() updatedTo?: string;
  @IsOptional() @IsString() @MaxLength(120) query?: string;
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() includeArchived?: boolean;
}
export class LibraryGrantDto { @IsOptional() @IsIn(['preview','download']) purpose?: 'preview'|'download'; }
