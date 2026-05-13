import type { ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../common/DropdownMenu.js';
import { Icon } from '../canvas/Icon.js';

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
          <Icon name="pencil" size={12} />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicate} disabled={duplicating}>
          <Icon name="copy" size={12} />
          {duplicating ? 'Duplicating…' : 'Duplicate'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} disabled={deleting} tone="danger">
          <Icon name="trash" size={12} />
          {deleting ? 'Deleting…' : 'Delete'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
