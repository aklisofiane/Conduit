import clsx, { type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge only knows Tailwind's built-in font sizes (`text-xs`,
 * `text-base`, …). Our type scale adds custom names (`text-small`,
 * `text-caption`, `text-lead`, …) in `styles/globals.css`. Without registering
 * them here, tailwind-merge can't tell `text-small` is a font-size and treats
 * it as conflicting with a `text-[color]` class in the same `cn()` call —
 * silently dropping the size so the element falls back to the inherited body
 * size. Registering them in the `font-size` group keeps size + color distinct.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['caption', 'small', 'lead', 'heading', 'title', 'display', 'hero'] },
      ],
    },
  },
});

/**
 * Merge class names, resolving conflicting Tailwind utilities in favor of the
 * last one. Lets `ui/*` primitives expose a sane `className` override prop:
 * a caller's `px-6` wins over a variant's default `px-3` instead of both
 * landing in the class list with arbitrary cascade order.
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
