import { ArrowRightIcon, SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';

import { navigationGroups } from '../router/route-metadata';

export function AppCommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const select = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return <>
    <Button className="app-command-trigger" variant="outline" onClick={() => setOpen(true)} aria-label="Tìm màn hình và thao tác"><SearchIcon /><span>Tìm màn hình…</span><kbd>⌘K</kbd></Button>
    <CommandDialog open={open} onOpenChange={setOpen} title="Tìm màn hình và thao tác" description="Nhập tên module để điều hướng trong Reup Dubbing Studio.">
      <Command loop>
        <CommandInput autoFocus placeholder="Nhập tên màn hình…" />
        <CommandList>
          <CommandEmpty>Không tìm thấy màn hình phù hợp.</CommandEmpty>
          {navigationGroups.map((group) => <CommandGroup heading={group.label} key={group.label}>{group.items.map((item) => <CommandItem key={item.path} value={`${item.label} ${item.keywords.join(' ')}`} onSelect={() => select(item.path)}><span>{item.label}</span><CommandShortcut><ArrowRightIcon /></CommandShortcut></CommandItem>)}</CommandGroup>)}
        </CommandList>
      </Command>
    </CommandDialog>
  </>;
}
