import { useMutation } from '@tanstack/react-query';
import { DownloadIcon, FileTextIcon, FileVideoIcon, PlayIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { requestOutputFile, type LibraryVideo, type OutputPart, type VideoOutput } from '@/features/library/api/library-api';

const VARIANT_LABELS: Record<string, string> = { FULL_16X9: '16:9', FULL_9X16: '9:16' };
const READY = new Set(['READY', 'APPROVED']);

/** Rendered outputs of a video. Signed URLs are requested per click and never cached: they expire. */
export function VideoOutputs({ video, onDownload = (url) => window.location.assign(url) }: { video: LibraryVideo; onDownload?: (url: string) => void }) {
  const outputs = video.outputs.filter((output) => READY.has(output.status) && output.video);
  return <section className="queue-list-card video-outputs" aria-labelledby="video-outputs-title">
    <div className="video-outputs-heading"><h2 id="video-outputs-title">Kết quả xử lý</h2></div>
    {outputs.length === 0
      ? <p className="video-outputs-empty">Chưa có video kết quả. Video sẽ hiện ở đây khi pipeline render xong.</p>
      : outputs.map((output) => <OutputCard key={output.id} videoId={video.id} output={output} onDownload={onDownload} />)}
  </section>;
}

function OutputCard({ videoId, output, onDownload }: { videoId: string; output: VideoOutput; onDownload: (url: string) => void }) {
  const variant = VARIANT_LABELS[output.variant] ?? output.variant;
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const request = useMutation({
    mutationFn: ({ part, purpose }: { part: OutputPart; purpose: 'preview' | 'download' }) => requestOutputFile(videoId, output.id, part, purpose),
    onMutate: () => setError(undefined),
    onSuccess: (file, { purpose }) => { if (purpose === 'preview') setPreviewUrl(file.url); else onDownload(file.url); },
    onError: (failure) => setError(failure instanceof Error && failure.message ? failure.message : 'Không thể tạo link tải. Thử lại.'),
  });
  const busy = (part: OutputPart, purpose: 'preview' | 'download') => request.isPending && request.variables?.part === part && request.variables.purpose === purpose;
  const videoLabel = `Video đã lồng tiếng ${variant}`;

  return <div className="video-output">
    <div className="output-stage">
      {previewUrl
        ? <video aria-label={videoLabel} src={previewUrl} controls autoPlay playsInline preload="metadata" />
        : <Button type="button" variant="secondary" disabled={busy('video', 'preview')} onClick={() => request.mutate({ part: 'video', purpose: 'preview' })} aria-label={`Xem trước video ${variant}`}>
          <PlayIcon />{busy('video', 'preview') ? 'Đang mở…' : 'Xem trước video'}
        </Button>}
    </div>
    <div className="output-list">
      <OutputRow icon={<FileVideoIcon />} title={videoLabel} fileName={output.video?.fileName ?? null} actionLabel={`Tải MP4 ${variant}`} actionText="Tải MP4" pending={busy('video', 'download')} onClick={() => request.mutate({ part: 'video', purpose: 'download' })} />
      {output.subtitle && <OutputRow icon={<FileTextIcon />} title={`File SRT ${variant}`} fileName={output.subtitle.fileName} actionLabel={`Tải SRT ${variant}`} actionText="Tải SRT" pending={busy('subtitle', 'download')} onClick={() => request.mutate({ part: 'subtitle', purpose: 'download' })} />}
    </div>
    {error && <p className="output-error" role="alert">{error}</p>}
  </div>;
}

function OutputRow({ icon, title, fileName, actionLabel, actionText, pending, onClick }: { icon: ReactNode; title: string; fileName: string | null; actionLabel: string; actionText: string; pending: boolean; onClick: () => void }) {
  return <div className="output-item">
    <span className="output-icon" aria-hidden="true">{icon}</span>
    <span className="output-info"><strong>{title}</strong>{fileName && <span className="font-mono">{fileName}</span>}</span>
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onClick} aria-label={actionLabel}><DownloadIcon />{pending ? 'Đang tạo link…' : actionText}</Button>
  </div>;
}
