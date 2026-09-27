import type { Prisma } from '@prisma/client';

/**
 * The single definition of "the files of video V": its links, segment audio, transcript raw files and
 * everything its attempts created (PENDING uploads included), minus any asset another aggregate
 * (voice sample, channel, series, another video) still references.
 */
export async function collectVideoAssetIds(tx: Prisma.TransactionClient, videoId: string): Promise<string[]> {
  const links = await tx.videoAsset.findMany({ where: { videoId }, select: { assetId: true } });
  const audio = await tx.segmentAudioRevision.findMany({ where: { segment: { videoId }, assetId: { not: null } }, select: { assetId: true } });
  const runs = await tx.transcriptRun.findMany({ where: { videoId, rawAssetId: { not: null } }, select: { rawAssetId: true } });
  const created = await tx.asset.findMany({ where: { createdByAttempt: { pipelineTask: { pipelineJob: { videoId } } } }, select: { id: true } });
  const candidates = [...new Set([...links.map((row) => row.assetId), ...audio.map((row) => row.assetId!), ...runs.map((row) => row.rawAssetId!), ...created.map((row) => row.id)])];
  if (!candidates.length) return [];
  const shared = await tx.asset.findMany({ where: { id: { in: candidates }, OR: [
    { voiceSamples: { some: {} } }, { channelLinks: { some: {} } }, { seriesLinks: { some: {} } },
    { videoAssets: { some: { videoId: { not: videoId } } } },
    { transcriptRuns: { some: { videoId: { not: videoId } } } },
    { segmentAudioRevisions: { some: { segment: { videoId: { not: videoId } } } } },
  ] }, select: { id: true } });
  const keep = new Set(shared.map((row) => row.id));
  return candidates.filter((id) => !keep.has(id)).sort();
}

/** Moves AVAILABLE/PENDING/FAILED assets to DELETING and remembers the status each one came from. */
export async function markAssetsDeleting(tx: Prisma.TransactionClient, assetIds: string[]): Promise<{ pending: number }> {
  if (!assetIds.length) return { pending: 0 };
  const pending = await tx.asset.count({ where: { id: { in: assetIds }, status: 'PENDING' } });
  await tx.$executeRaw`UPDATE "assets" SET "status" = 'DELETING', "metadata" = "metadata" || jsonb_build_object('deletion', jsonb_build_object('previousStatus', "status"::text)), "version" = "version" + 1, "updated_at" = now() WHERE "id" = ANY(${assetIds}::uuid[]) AND "status" IN ('AVAILABLE', 'PENDING', 'FAILED')`;
  return { pending };
}
