import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, IsUrl, Max, MaxLength, Min, ValidateNested } from 'class-validator';

class PublishTaskSelectionDto { @IsUUID() destinationId!: string; @IsUUID() renderOutputId!: string; }
export class CreatePublishPackageDto { @IsArray() @ValidateNested({ each: true }) @Type(() => PublishTaskSelectionDto) tasks!: PublishTaskSelectionDto[]; }
export class PublicationFieldDto { @IsString() @MaxLength(10000) value!: string; }
export class PublicationLockDto { @IsBoolean() isLocked!: boolean; }
export class PublicationPlanDto { @IsOptional() @IsISO8601() scheduledAt?: string | null; @IsOptional() @IsISO8601() deadlineAt?: string | null; @IsOptional() @IsString() @MaxLength(2000) notes?: string | null; }
export class PublicationChecklistDto { @IsIn(['PENDING', 'COMPLETED', 'SKIPPED']) status!: 'PENDING'|'COMPLETED'|'SKIPPED'; }
export class PublicationProofDto { @IsOptional() @IsString() @MaxLength(300) platformPostId?: string | null; @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(2048) publicUrl?: string | null; }
export class PublicationVerificationDto { @IsIn(['VERIFIED', 'FAILED']) status!: 'VERIFIED'|'FAILED'; @IsOptional() @IsString() @MaxLength(1000) detail?: string | null; }
export class PublicationListQueryDto { @IsOptional() @IsString() cursor?: string; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number; @IsOptional() @IsString() status?: string; @IsOptional() @IsIn(['YOUTUBE','FACEBOOK']) platform?: string; @IsOptional() @IsUUID() destinationId?: string; @IsOptional() @IsUUID() videoId?: string; @IsOptional() @Type(() => Boolean) @IsBoolean() scheduled?: boolean; @IsOptional() @Type(() => Boolean) @IsBoolean() overdue?: boolean; }
