import { AesGcmCredentialCipher } from '../../src/modules/settings/infrastructure/aes-gcm-credential-cipher';

describe('settings credential encryption', () => {
  const cipher = new AesGcmCredentialCipher(Buffer.alloc(32, 7).toString('base64'));

  it('round-trips an AES-256-GCM envelope without storing plaintext', () => {
    const secret = 'secret-plaintext-sentinel';
    const encrypted = cipher.encrypt({ apiKey: secret });

    expect(Buffer.from(encrypted.payload).toString('utf8')).not.toContain(secret);
    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.hint).toBe('inel');
    expect(cipher.decrypt<{ apiKey: string }>(encrypted)).toEqual({ apiKey: secret });
  });

  it('rejects ciphertext authentication failure', () => {
    const encrypted = cipher.encrypt({ apiKey: 'secret' });
    const envelope = JSON.parse(Buffer.from(encrypted.payload).toString('utf8')) as { ciphertext: string };
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -2)}AA`;
    const payload = Buffer.from(JSON.stringify(envelope));

    expect(() => cipher.decrypt({ payload, keyVersion: 1 })).toThrow();
  });
});
