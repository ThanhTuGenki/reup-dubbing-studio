import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueueListQueryDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() kind?: string;
  @IsOptional() @IsString() resourceClass?: string;
  @IsOptional() @IsString() channelProfileId?: string;
  @IsOptional() @IsString() @MaxLength(120) query?: string;
  @IsOptional() @IsString() createdFrom?: string;
  @IsOptional() @IsString() createdTo?: string;
}
export class QueueAttemptsQueryDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
export class QueueActionDto { @IsOptional() @IsString() @MaxLength(500) reason?: string; @IsOptional() @IsString() taskId?: string; }
