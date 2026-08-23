import type { ProviderId } from '../../styles/theme.js';

interface LogoProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
}

export function Logo({
  size = 14,
  color = 'currentColor',
  strokeWidth = 1.8,
  className,
}: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 7c4 0 4 10 8 10s4-10 8-10" />
      <circle cx="5" cy="7" r="1.6" fill={color} stroke="none" />
      <circle cx="21" cy="17" r="1.6" fill={color} stroke="none" />
    </svg>
  );
}

interface ProviderGlyphProps {
  provider: ProviderId;
  size?: number;
  color?: string;
}

export function ProviderGlyph({ provider, size = 12, color = '#FFFFFF' }: ProviderGlyphProps) {
  if (provider === 'codex') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 7l-5 5 5 5" />
        <path d="M16 7l5 5-5 5" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M12 2 L13.2 9.5 L20.5 11 L13.2 12.5 L12 20 L10.8 12.5 L3.5 11 L10.8 9.5 Z" />
    </svg>
  );
}
