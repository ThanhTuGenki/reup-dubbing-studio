import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ContentCredentialCommandDto {
  @IsIn(['REPLACE', 'CLEAR']) action!: 'REPLACE' | 'CLEAR';
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(4096) value?: string;
}

export class StorageCredentialValueDto {
  @IsString() @IsNotEmpty() @MaxLength(256) accessKeyId!: string;
  @IsString() @IsNotEmpty() @MaxLength(4096) secretAccessKey!: string;
}

export class StorageCredentialCommandDto {
  @IsIn(['REPLACE', 'CLEAR']) action!: 'REPLACE' | 'CLEAR';
  @IsOptional() @IsObject() @ValidateNested() @Type(() => StorageCredentialValueDto)
  value?: StorageCredentialValueDto;
}

export class ContentAgentPatchDto {
  @IsOptional() @IsIn(['ANTHROPIC', 'OPENAI']) provider?: 'ANTHROPIC' | 'OPENAI';
  @IsOptional() @IsString() @MaxLength(128) model?: string;
  @IsOptional() @ValidateNested() @Type(() => ContentCredentialCommandDto)
  credential?: ContentCredentialCommandDto;
}

export class StoragePatchDto {
  @IsOptional() @IsIn(['R2']) backend?: 'R2';
  @IsOptional() @IsString() @MaxLength(64) accountId?: string;
  @IsOptional() @IsString() @MaxLength(63) bucket?: string;
  @IsOptional() @ValidateNested() @Type(() => StorageCredentialCommandDto)
  credential?: StorageCredentialCommandDto;
}

export class RetentionPatchDto {
  @IsOptional() @IsInt() @Min(1) @Max(365) rawVideoDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(90) intermediateDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) taskLogDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(3650) finalOutputDays?: number;
}

export class UpdateSettingsDto {
  @IsOptional() @ValidateNested() @Type(() => ContentAgentPatchDto)
  contentAgent?: ContentAgentPatchDto;
  @IsOptional() @ValidateNested() @Type(() => StoragePatchDto)
  storage?: StoragePatchDto;
  @IsOptional() @ValidateNested() @Type(() => RetentionPatchDto)
  retention?: RetentionPatchDto;
}

export class TestCredentialDto {
  @IsIn(['STORED', 'PROVIDED']) source!: 'STORED' | 'PROVIDED';
  @IsOptional() value?: unknown;
}

export class TestContentAgentDto {
  @IsIn(['ANTHROPIC', 'OPENAI']) provider!: 'ANTHROPIC' | 'OPENAI';
  @IsString() @IsNotEmpty() @MaxLength(128) model!: string;
  @ValidateNested() @Type(() => TestCredentialDto) credential!: TestCredentialDto;
}

export class TestStorageDto {
  @IsString() @IsNotEmpty() @MaxLength(64) accountId!: string;
  @IsString() @IsNotEmpty() @MaxLength(63) bucket!: string;
  @ValidateNested() @Type(() => TestCredentialDto) credential!: TestCredentialDto;
}
