import type { ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../common/DropdownMenu.js';
import { Copy, Pencil, Trash2 } from 'lucide-react';

interface RowActionsMenuProps {
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  duplicating?: boolean;
  deleting?: boolean;
  children: ReactNode;
}

export function RowActionsMenu({
  onRename,
  onDuplicate,
  onDelete,
  duplicating,
  deleting,
  children,
}: RowActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label="Workflow actions">
        <DropdownMenuItem onSelect={onRename}>
          <Pencil size={12} strokeWidth={1.5} />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicate} disabled={duplicating}>
          <Copy size={12} strokeWidth={1.5} />
          {duplicating ? 'Duplicating…' : 'Duplicate'}
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
