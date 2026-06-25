import { useEffect } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';

/**
 * Clears a stale `root` (server) error the moment the user edits any field,
 * so a failed submit message disappears as soon as they start correcting it.
 */
export function useClearFormError<T extends FieldValues>(form: UseFormReturn<T>): void {
  useEffect(() => {
    const sub = form.watch(() => {
      if (form.formState.errors.root) form.clearErrors('root');
    });
    return () => sub.unsubscribe();
  }, [form]);
}
