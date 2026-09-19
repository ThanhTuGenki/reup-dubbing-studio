import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

import type { StorageProbe } from '../application/ports';
import type { ConnectionTestResult } from '../domain/settings';
import { SettingsError } from '../domain/settings-errors';

export class R2StorageProbe implements StorageProbe {
  async test(input: Parameters<StorageProbe['test']>[0]): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    const key = `_healthchecks/${randomUUID()}`;
    const body = Buffer.from(`probe:${randomUUID()}`);
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${input.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey },
      requestHandler: { requestTimeout: 10_000, connectionTimeout: 5_000 },
    });
    try {
      await client.send(new PutObjectCommand({ Bucket: input.bucket, Key: key, Body: body }));
      await client.send(new HeadObjectCommand({ Bucket: input.bucket, Key: key }));
      const fetched = await client.send(new GetObjectCommand({ Bucket: input.bucket, Key: key }));
      const bytes = await fetched.Body?.transformToByteArray();
      if (!bytes || !Buffer.from(bytes).equals(body)) throw new Error('probe mismatch');
      return {
        status: 'CONNECTED', latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(), message: 'R2 connection succeeded',
      };
    } catch {
      throw new SettingsError('CONNECTION_TEST_FAILED', 'R2 connection failed');
    } finally {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: input.bucket, Key: key }));
      } catch { /* best-effort cleanup */ }
      client.destroy();
    }
  }
}
