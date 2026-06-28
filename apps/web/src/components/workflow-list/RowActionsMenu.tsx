import type { ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { Copy, Download, Pencil, Trash2 } from 'lucide-react';

interface RowActionsMenuProps {
  onRename: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
  duplicating?: boolean;
  deleting?: boolean;
  children: ReactNode;
}

export function RowActionsMenu({
  onRename,
  onDuplicate,
  onExport,
  onDelete,
  duplicating,
  deleting,
  children,
}: RowActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label="Workflow actions"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuItem onSelect={onRename}>
          <Pencil size={12} strokeWidth={1.5} />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicate} disabled={duplicating}>
          <Copy size={12} strokeWidth={1.5} />
          {duplicating ? 'Duplicating…' : 'Duplicate'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onExport}>
          <Download size={12} strokeWidth={1.5} />
          Export
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} disabled={deleting} tone="danger">
          <Trash2 size={12} strokeWidth={1.5} />
          {deleting ? 'Deleting…' : 'Delete'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
