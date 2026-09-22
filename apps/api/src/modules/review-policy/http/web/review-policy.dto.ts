import { IsBoolean, IsIn, IsOptional } from 'class-validator';

const GATE_MODES = ['MANUAL_REQUIRED', 'NOT_REQUIRED'] as const;
type GateMode = typeof GATE_MODES[number];

export class UpdateChannelReviewPolicyDto {
  @IsOptional() @IsIn(GATE_MODES) castGate?: GateMode;
  @IsOptional() @IsIn(GATE_MODES) scriptGate?: GateMode;
  @IsOptional() @IsIn(GATE_MODES) ttsGate?: GateMode;
  @IsOptional() @IsIn(GATE_MODES) renderGate?: GateMode;
  @IsOptional() @IsIn(GATE_MODES) publishContentGate?: GateMode;
  @IsOptional() @IsBoolean() autoRequestRender?: boolean;
}

export class UpdateSeriesReviewPolicyDto {
  @IsOptional() @IsIn(GATE_MODES) castGate?: GateMode | null;
  @IsOptional() @IsIn(GATE_MODES) scriptGate?: GateMode | null;
  @IsOptional() @IsIn(GATE_MODES) ttsGate?: GateMode | null;
  @IsOptional() @IsIn(GATE_MODES) renderGate?: GateMode | null;
  @IsOptional() @IsIn(GATE_MODES) publishContentGate?: GateMode | null;
  @IsOptional() @IsBoolean() autoRequestRender?: boolean | null;
}
