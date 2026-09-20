import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsOptional, IsString } from 'class-validator';

export class IngestSelectionDto {
  @IsString() sourceAccountId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) sourceContentIds!: string[];
  @IsString() channelProfileId!: string;
  @IsOptional() @IsString() seriesProfileId?: string | null;
}
