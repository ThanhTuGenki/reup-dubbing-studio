import { createHash } from 'node:crypto';
import type { VoiceRepository } from './ports';
import { VoiceError } from '../domain/voice-errors';
import type { CreateVoiceProfile, UpdateVoiceProfile, VoiceListQuery } from '../domain/voices';

export class VoicesService {
  constructor(private readonly repository: VoiceRepository) {}
  list(query: VoiceListQuery) { return this.repository.list(query); }
  get(id: string) { return this.repository.get(id); }
  create(input: CreateVoiceProfile, key: string) { validate(input); return this.repository.create(input, key, hash(input)); }
  update(id: string, version: number, input: UpdateVoiceProfile) {
    if (!Object.keys(input).length) fail('Voice patch cannot be empty');
    const record = input as Record<string, unknown>;
    if (['name', 'primaryLanguage', 'tags', 'licenseKind', 'commercialUseAllowed'].some((key) => record[key] === null)) fail('Patch contains null for a non-nullable field');
    validate(input, true); return this.repository.update(id, version, input);
  }
  activate(id: string, version: number) { return this.repository.activate(id, version); }
  archive(id: string, version: number) { return this.repository.archive(id, version); }
  restore(id: string, version: number) { return this.repository.restore(id, version); }
}

function validate(input: CreateVoiceProfile | UpdateVoiceProfile, partial = false) {
  if ((!partial || input.name !== undefined) && (!input.name?.trim() || input.name.trim().length > 120)) fail('Voice name must contain 1 to 120 characters');
  if ((!partial || input.primaryLanguage !== undefined) && !language(input.primaryLanguage ?? '')) fail('Invalid primary language');
  if (input.description !== undefined && input.description !== null && input.description.length > 2000) fail('Voice description is too long');
  if (input.tags !== undefined && (input.tags.length > 20 || input.tags.some((tag) => !tag.trim() || tag.length > 40))) fail('Invalid voice tags');
  if (input.licenseReference !== undefined && input.licenseReference !== null && input.licenseReference.length > 2000) fail('License reference is too long');
  if (input.sourceReference !== undefined && input.sourceReference !== null && input.sourceReference.length > 2000) fail('Source reference is too long');
  if (input.commercialUseAllowed && (input.licenseKind === 'CC_BY_NC' || input.licenseKind === 'UNKNOWN')) fail('This license cannot allow commercial use');
  if (!partial && input.commercialUseAllowed && input.licenseKind !== 'OWNED_RECORDING' && !input.licenseReference?.trim()) fail('Commercial use requires a license reference');
}
export function language(value: string) { return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(value); }
function fail(message: string): never { throw new VoiceError('VOICE_VALIDATION_FAILED', message); }
function hash(value: unknown) { return createHash('sha256').update(stableStringify(value)).digest('hex'); }
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
