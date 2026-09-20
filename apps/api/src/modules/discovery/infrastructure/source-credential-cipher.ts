import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SourceCredentialCipher } from '../application/ports';

type Envelope = { v: 1; iv: string; tag: string; ciphertext: string };

export class AesGcmSourceCredentialCipher implements SourceCredentialCipher {
  private readonly key: Buffer;
  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.byteLength !== 32) throw new Error('Invalid source credential encryption key');
  }
  encrypt(value: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from('source-credential:v1'));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const envelope: Envelope = { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
    return Buffer.from(JSON.stringify(envelope), 'utf8');
  }
  decrypt(value: Buffer): string {
    const envelope = JSON.parse(value.toString('utf8')) as Envelope;
    if (envelope.v !== 1) throw new Error('Unsupported source credential envelope');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from('source-credential:v1'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }
}
