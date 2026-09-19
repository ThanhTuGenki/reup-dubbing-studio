import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { CredentialCipher, EncryptedCredential, StoredCredential } from '../application/ports';

type Envelope = { v: 1; iv: string; tag: string; ciphertext: string };

export class AesGcmCredentialCipher implements CredentialCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.byteLength !== 32) throw new Error('Invalid settings encryption key');
  }

  encrypt(value: unknown): EncryptedCredential {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from('settings-credential:v1'));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const envelope: Envelope = {
      v: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
    return {
      payload: Buffer.from(JSON.stringify(envelope), 'utf8'),
      hint: credentialHint(value),
      keyVersion: 1,
    };
  }

  decrypt<T>(credential: StoredCredential): T {
    if (credential.keyVersion !== 1) throw new Error('Unsupported credential key version');
    const envelope = JSON.parse(Buffer.from(credential.payload).toString('utf8')) as Envelope;
    if (envelope.v !== 1) throw new Error('Unsupported credential envelope');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from('settings-credential:v1'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8')) as T;
  }
}

function credentialHint(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    const candidate = 'accessKeyId' in value
      ? (value as { accessKeyId?: unknown }).accessKeyId
      : (value as { apiKey?: unknown }).apiKey;
    if (typeof candidate === 'string') return candidate.slice(-4);
  }
  return '';
}
