import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names, resolving conflicting Tailwind utilities in favor of the
 * last one. Lets `ui/*` primitives expose a sane `className` override prop:
 * a caller's `px-6` wins over a variant's default `px-3` instead of both
 * landing in the class list with arbitrary cascade order.
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
