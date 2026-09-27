#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const api = (process.env.CONTROL_PLANE_URL ?? 'http://localhost:3100/v1').replace(/\/$/u, '');
const workerApi = api.replace(/\/v1$/u, '/worker/v1');
const videoPath = process.env.LOCAL_VIDEO_PATH ?? '/Users/genkisystem/Downloads/video.mp4';
const workspace = mkdtempSync(join(tmpdir(), 'reup-local-smoke-'));
const createdWorkers = [];

try {
  const video = readFileSync(videoPath);
  const profiles = await request(`${api}/channel-profiles?status=ACTIVE&readiness=READY&limit=100`);
  const channelProfileId = process.env.CHANNEL_PROFILE_ID ?? profiles.items?.[0]?.id;
  if (!channelProfileId) throw new Error('No READY Channel Profile is available');

  const upload = await request(`${api}/local-imports/uploads`, {
    method: 'POST', idempotency: true, body: {
      channelProfileId, title: `Local pipeline smoke ${new Date().toISOString()}`,
      sourceLanguage: 'vi', fileName: basename(videoPath), contentType: 'video/mp4',
      byteSize: video.byteLength, checksumSha256: sha256(video),
      durationMs: 119_633, width: 1920, height: 1080,
    },
  });
  await put(upload.url, upload.headers, video);
  const imported = await request(`${api}/local-imports/uploads/${upload.assetId}/commit`, { method: 'POST', idempotency: true });

  const batch = await createWorker('BATCH_MEDIA', ['transcript.asr.v1', 'audio.separate.demucs.v1', 'media.render.ffmpeg.v1']);
  const tts = await createWorker('INTERACTIVE_TTS', ['tts.omnivoice.v1']);
  let reviewed = false;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    let worked = false;
    for (const agent of [batch, tts]) {
      await heartbeat(agent);
      const claim = await workerRequest(agent, '/tasks/claim', { sessionId: agent.sessionId, waitSeconds: 0 });
      if (!claim.task) continue;
      worked = true;
      await execute(agent, claim.task);
    }
    const job = await request(`${api}/queue/jobs/${imported.jobId}`);
    if (job.status === 'WAITING_FOR_REVIEW' && !reviewed) {
      const studioResponse = await fetch(`${api}/videos/${imported.videoId}/studio`);
      const studioBody = await response(studioResponse);
      const version = studioBody.video.version;
      await request(`${api}/videos/${imported.videoId}/review-decisions`, {
        method: 'POST', headers: { 'If-Match': `"${version}"` },
        body: { scope: 'TTS', subjectVersion: String(version), decision: 'APPROVED' },
      });
      reviewed = true; worked = true;
    }
    if (job.status === 'SUCCEEDED') {
      const library = await request(`${api}/videos/${imported.videoId}`);
      const kinds = new Set(library.assets.map((item) => item.kind));
      if (!kinds.has('OUTPUT_VIDEO') || !kinds.has('OUTPUT_SUBTITLE')) throw new Error('Pipeline succeeded without MP4 and SRT assets');
      process.stdout.write(`${JSON.stringify({ videoId: imported.videoId, jobId: imported.jobId, status: job.status, outputs: [...kinds].filter((kind) => kind.startsWith('OUTPUT_')) })}\n`);
      break;
    }
    if (job.status === 'FAILED' || job.status === 'CANCELLED') throw new Error(`Pipeline ended with ${job.status}: ${job.failureDetail ?? ''}`);
    await delay(worked ? 250 : 1_000);
  }
  const finalJob = await request(`${api}/queue/jobs/${imported.jobId}`);
  if (finalJob.status !== 'SUCCEEDED') throw new Error(`Pipeline smoke timed out in ${finalJob.status}`);
} finally {
  for (const worker of createdWorkers) await terminate(worker).catch(() => undefined);
  rmSync(workspace, { recursive: true, force: true });
}

async function createWorker(role, capabilities) {
  const digest = `sha256:${randomBytes(32).toString('hex')}`;
  const image = await request(`${api}/worker-images`, { method: 'POST', idempotency: true, body: {
    role, semanticVersion: '0.0.0-local-smoke', imageDigest: digest,
    registryRef: `local/reup-smoke@${digest}`, contractVersion: 1, capabilities,
  } });
  const created = await request(`${api}/workers`, { method: 'POST', idempotency: true, body: {
    displayName: `Local smoke ${role} ${Date.now()}`, role, provider: 'LOCAL_SMOKE',
    approvedImageId: image.id, expectedGpuModel: 'Fixture GPU', expectedVramMb: 24_576,
    hourlyRateCp: '0.000001', billingStartedAt: new Date().toISOString(),
  } });
  const identity = {
    sessionNonce: uuidV7(), role, imageDigest: digest, agentVersion: 'local-smoke', contractVersion: 1,
    capabilities, gpuInventory: [{ model: 'Fixture GPU', vramMb: 24_576 }], cpuInventory: { cores: 1 },
    capacity: { maxConcurrentTasks: 1, availableTaskSlots: 1, scratchFreeBytes: '107374182400', vramFreeMb: 24_576 },
  };
  const enrolled = await request(`${workerApi}/enroll`, { method: 'POST', headers: { Authorization: `Bearer ${created.enrollment.token}` }, body: identity });
  const agent = { workerId: created.worker.id, role, credential: enrolled.credential, sessionId: enrolled.session.id, identity, sequence: 0 };
  createdWorkers.push(agent);
  return agent;
}

async function heartbeat(agent) {
  agent.sequence += 1;
  await workerRequest(agent, `/sessions/${agent.sessionId}/heartbeat`, {
    sequence: String(agent.sequence), sentAt: new Date().toISOString(), capacity: agent.identity.capacity,
    currentTaskCount: 0, activeLeaseIds: [], telemetry: {}, agentVersion: 'local-smoke', contractVersion: 1,
  });
}

async function execute(agent, task) {
  const lease = { leaseId: task.leaseId, fencingToken: task.fencingToken };
  const base = `/tasks/${task.taskId}/attempts/${task.attemptId}`;
  await workerRequest(agent, `${base}/start`, lease);
  const outputs = [];
  for (const spec of task.outputs) {
    const value = await fixture(task, spec);
    const grant = await workerRequest(agent, `${base}/outputs`, {
      ...lease, slot: spec.slot, fileName: value.fileName, contentType: value.contentType,
      byteSize: String(value.body.byteLength), checksumSha256: sha256(value.body), metadata: value.metadata,
    });
    await put(grant.url, grant.headers, value.body);
    await workerRequest(agent, `${base}/outputs/${grant.assetId}/commit`, {
      ...lease, byteSize: String(value.body.byteLength), checksumSha256: sha256(value.body),
    });
    outputs.push({ slot: spec.slot, assetId: grant.assetId });
  }
  await workerRequest(agent, `${base}/complete`, { ...lease, outputs, result: { fixture: true }, metrics: { executionMs: 1, exitCode: 0 } });
}

async function fixture(task, spec) {
  if (task.taskType === 'TRANSCRIBE_ASR') return {
    fileName: 'asr.json', contentType: 'application/json', metadata: { schemaVersion: 1 },
    body: Buffer.from(JSON.stringify({ version: 1, source: 'ASR', segments: [
      { startMs: 0, endMs: 4_000, text: 'Đây là transcript fixture cho bài kiểm tra pipeline.', confidence: 0.99 },
      { startMs: 4_000, endMs: 8_000, text: 'Nội dung được giữ nguyên vì ngôn ngữ nguồn là tiếng Việt.', confidence: 0.98 },
    ] })),
  };
  if (task.taskType === 'GENERATE_INITIAL_TTS' || task.taskType === 'REGENERATE_SEGMENT') {
    return { fileName: `${spec.slot}.wav`, contentType: 'audio/wav', metadata: {}, body: silentWav(spec.slot, 1) };
  }
  if (task.taskType === 'SEPARATE_AUDIO') return { fileName: 'background.wav', contentType: 'audio/wav', metadata: {}, body: silentWav('background', 9) };
  if (task.taskType === 'RENDER') {
    const raw = task.inputs.find((item) => item.kind === 'RAW');
    if (!raw) throw new Error('Render claim has no RAW input');
    const downloaded = await fetch(raw.download.url, { headers: raw.download.headers });
    if (!downloaded.ok) throw new Error(`RAW download failed: ${downloaded.status}`);
    return { fileName: `${spec.slot}.mp4`, contentType: 'video/mp4', metadata: {}, body: Buffer.from(await downloaded.arrayBuffer()) };
  }
  throw new Error(`No fixture for ${task.taskType}`);
}

function silentWav(name, seconds) {
  const path = join(workspace, `${name}.wav`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(seconds), '-c:a', 'pcm_s16le', path]);
  return readFileSync(path);
}

async function workerRequest(agent, path, body) {
  return request(`${workerApi}${path}`, { method: 'POST', idempotency: true, headers: { Authorization: `Bearer ${agent.credential}` }, body });
}

async function terminate(agent) {
  const detailResponse = await fetch(`${api}/workers/${agent.workerId}`); const detail = await response(detailResponse);
  const drained = await request(`${api}/workers/${agent.workerId}/drain`, { method: 'POST', idempotency: true, headers: { 'If-Match': detailResponse.headers.get('etag') }, body: undefined });
  await request(`${api}/workers/${agent.workerId}/confirm-termination`, { method: 'POST', idempotency: true, headers: { 'If-Match': `"${drained.version}"` }, body: undefined });
}

async function request(url, options = {}) {
  const headers = { ...(options.body === undefined ? {} : { 'content-type': 'application/json' }), ...(options.idempotency ? { 'idempotency-key': randomUUID() } : {}), ...options.headers };
  const result = await fetch(url, { method: options.method ?? 'GET', headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  return response(result);
}
async function response(result) { const value = await result.json(); if (!result.ok) throw new Error(`${result.status} ${value.code ?? ''} ${value.detail ?? value.title ?? ''}`); return value.data; }
async function put(url, headers, body) {
  const result = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Length': String(body.byteLength) },
    body,
  });
  if (!result.ok) throw new Error(`Object upload failed with ${result.status}`);
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function uuidV7() { const time = Date.now().toString(16).padStart(12, '0'); const random = randomBytes(10).toString('hex'); return `${time.slice(0, 8)}-${time.slice(8)}-7${random.slice(0, 3)}-${(8 + Number.parseInt(random[3], 16) % 4).toString(16)}${random.slice(4, 7)}-${random.slice(7, 19)}`; }
