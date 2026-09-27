import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2Icon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { deleteLibraryVideo, LibraryApiError, type LibraryVideo } from '../api/library-api';
import { libraryKeys } from '../api/library-query';
import { hasActiveJob } from '../model/video-deletion';

export function DeleteVideoButton({ video }: { video: LibraryVideo }) {
  const [open, setOpen] = useState(false); const keys = useRef(new Map<string, string>());
  const client = useQueryClient(); const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => { const mapKey = `${video.id}:${video.version}`; const key = keys.current.get(mapKey) ?? crypto.randomUUID(); keys.current.set(mapKey, key); return deleteLibraryVideo(video, key); },
    onSuccess: async () => { setOpen(false); client.removeQueries({ queryKey: libraryKeys.detail(video.id) }); await client.invalidateQueries({ queryKey: libraryKeys.lists() }); toast.success('Đã xóa video. File sẽ được dọn trong nền.'); navigate('/library'); },
    onError: async (error) => { if (error instanceof LibraryApiError && error.code === 'VIDEO_VERSION_CONFLICT') await client.invalidateQueries({ queryKey: libraryKeys.detail(video.id) }); toast.error(error instanceof LibraryApiError ? error.message : 'Không thể xóa video.'); },
  });
  if (video.capabilities.deleteBlockedReason === 'DELETING') return null;
  if (video.capabilities.deleteBlockedReason === 'PUBLICATION_HISTORY') return <Tooltip><TooltipTrigger asChild><span tabIndex={0}><Button variant="destructive" disabled><Trash2Icon />Xóa video</Button></span></TooltipTrigger><TooltipContent>Video đã có bằng chứng đăng bài nên không thể xóa.</TooltipContent></Tooltip>;
  return <>
    <Button variant="destructive" onClick={() => setOpen(true)}><Trash2Icon />Xóa video</Button>
    <AlertDialog open={open} onOpenChange={setOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Xóa video này?</AlertDialogTitle><AlertDialogDescription>Xóa vĩnh viễn video gốc, audio, video kết quả, SRT và transcript. Không thể khôi phục.</AlertDialogDescription>{hasActiveJob(video) && <AlertDialogDescription>Job đang chạy sẽ bị hủy.</AlertDialogDescription>}</AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Quay lại</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={remove.isPending} onClick={(event) => { event.preventDefault(); remove.mutate(); }}>Xóa vĩnh viễn</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
