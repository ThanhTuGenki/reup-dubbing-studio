import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';
export class VideoDeletionItemDto { @IsString() videoId!: string; @IsInt() @Min(1) version!: number; }
export class VideoBulkDeletionDto { @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => VideoDeletionItemDto) items!: VideoDeletionItemDto[]; }
