import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2Icon } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { deleteLibraryVideo, deleteLibraryVideos, type LibraryVideo } from '../api/library-api';
import { libraryKeys } from '../api/library-query';
import { deletionErrorMessage, hasActiveJob, summarizeBulkDeletion } from '../model/video-deletion';

export function LibraryBulkDelete({ videos, onDone }: { videos: LibraryVideo[]; onDone: () => void }) {
  const [open, setOpen] = useState(false); const keys = useRef(new Map<string, string>()); const client = useQueryClient();
  const items = videos.map((video) => ({ videoId: video.id, version: video.version }));
  const running = videos.filter(hasActiveJob).length;
  const remove = useMutation({
    mutationFn: () => { const mapKey = JSON.stringify(items); const key = keys.current.get(mapKey) ?? crypto.randomUUID(); keys.current.set(mapKey, key); return deleteLibraryVideos(items, key); },
    onSuccess: async (results) => { setOpen(false); onDone(); await client.invalidateQueries({ queryKey: libraryKeys.lists() }); const summary = summarizeBulkDeletion(results); if (summary.tone === 'success') toast.success(summary.message); else toast.warning(summary.message); },
    onError: (error) => { toast.error(deletionErrorMessage(error, 'Không thể xóa các video đã chọn.')); },
  });
  if (!videos.length) return null;
  return <div className="library-bulk-bar" role="region" aria-label="Thao tác hàng loạt">
    <span>Đã chọn {videos.length} video</span>
    <Button variant="destructive" size="sm" onClick={() => setOpen(true)}><Trash2Icon />Xóa {videos.length} video</Button>
    <AlertDialog open={open} onOpenChange={setOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Xóa {videos.length} video?</AlertDialogTitle><AlertDialogDescription>Xóa vĩnh viễn video gốc, audio, video kết quả, SRT và transcript của các video đã chọn. Không thể khôi phục.</AlertDialogDescription>{running > 0 && <AlertDialogDescription>{running} video đang có job chạy, job sẽ bị hủy.</AlertDialogDescription>}</AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Quay lại</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={remove.isPending} onClick={(event) => { event.preventDefault(); remove.mutate(); }}>Xóa vĩnh viễn</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

export function RetryDeleteButton({ video }: { video: LibraryVideo }) {
  const client = useQueryClient(); const key = useRef<string | null>(null);
  const retry = useMutation({
    mutationFn: () => { key.current ??= crypto.randomUUID(); return deleteLibraryVideo(video, key.current); },
    onSuccess: async () => { key.current = null; await client.invalidateQueries({ queryKey: libraryKeys.lists() }); toast.success('Đã yêu cầu xóa lại video.'); },
    onError: (error) => { key.current = null; toast.error(deletionErrorMessage(error, 'Không thể xóa video.')); },
  });
  return <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}>Thử xóa lại</Button>;
}
