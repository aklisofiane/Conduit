import type { ProviderId } from '../../styles/theme.js';

export type IconName =
  | 'clock'
  | 'plus'
  | 'dot'
  | 'home'
  | 'settings'
  | 'logo'
  | 'history'
  | 'agent'
  | 'search'
  | 'grid'
  | 'webhook'
  | 'minus'
  | 'fit'
  | 'close'
  | 'chevron-down'
  | 'check'
  | 'more-vertical'
  | 'trash'
  | 'pencil'
  | 'copy';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
}

export function Icon({
  name,
  size = 14,
  color = 'currentColor',
  strokeWidth = 1.5,
  className,
}: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
  };
  switch (name) {
    case 'clock':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'minus':
      return (
        <svg {...common}>
          <path d="M5 12h14" />
        </svg>
      );
    case 'dot':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" fill={color} />
        </svg>
      );
    case 'home':
      return (
        <svg {...common}>
          <path d="M3 11l9-8 9 8" />
          <path d="M5 10v10h14V10" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 13.5a7.5 7.5 0 0 0 0-3l2.1-1.6-2-3.5-2.5 1a7.5 7.5 0 0 0-2.6-1.5L14 2h-4l-.4 2.9a7.5 7.5 0 0 0-2.6 1.5l-2.5-1-2 3.5L4.6 10.5a7.5 7.5 0 0 0 0 3l-2.1 1.6 2 3.5 2.5-1a7.5 7.5 0 0 0 2.6 1.5L10 22h4l.4-2.9a7.5 7.5 0 0 0 2.6-1.5l2.5 1 2-3.5z" />
        </svg>
      );
    case 'logo':
      return (
        <svg {...common}>
          <path d="M5 7c4 0 4 10 8 10s4-10 8-10" />
          <circle cx="5" cy="7" r="1.6" fill={color} stroke="none" />
          <circle cx="21" cy="17" r="1.6" fill={color} stroke="none" />
        </svg>
      );
    case 'history':
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5" />
          <path d="M12 8v4l3 2" />
        </svg>
      );
    case 'agent':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 21c0-3.5 3-6 7-6s7 2.5 7 6" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20l-4.5-4.5" />
        </svg>
      );
    case 'grid':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case 'webhook':
      return (
        <svg {...common}>
          <path d="M14 14a4 4 0 1 0-7-3" />
          <path d="M9 17l5-9" />
          <path d="M14 14l4-7" />
        </svg>
      );
    case 'fit':
      return (
        <svg {...common}>
          <path d="M4 9V4h5" />
          <path d="M20 9V4h-5" />
          <path d="M4 15v5h5" />
          <path d="M20 15v5h-5" />
        </svg>
      );
    case 'close':
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case 'chevron-down':
      return (
        <svg {...common}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="M5 12l4.5 4.5L19 7" />
        </svg>
      );
    case 'more-vertical':
      return (
        <svg {...common}>
          <circle cx="12" cy="5" r="1.4" fill={color} stroke="none" />
          <circle cx="12" cy="12" r="1.4" fill={color} stroke="none" />
          <circle cx="12" cy="19" r="1.4" fill={color} stroke="none" />
        </svg>
      );
    case 'trash':
      return (
        <svg {...common}>
          <path d="M4 7h16" />
          <path d="M10 11v6M14 11v6" />
          <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
          <path d="M9 7V4h6v3" />
        </svg>
      );
    case 'pencil':
      return (
        <svg {...common}>
          <path d="M4 20h4l10-10-4-4L4 16v4z" />
          <path d="M14 6l4 4" />
        </svg>
      );
    case 'copy':
      return (
        <svg {...common}>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V6a2 2 0 0 1 2-2h9" />
        </svg>
      );
    default:
      return null;
  }
}

interface ProviderGlyphProps {
  provider: ProviderId;
  size?: number;
  color?: string;
}

export function ProviderGlyph({
  provider,
  size = 12,
  color = '#FFFFFF',
}: ProviderGlyphProps) {
  if (provider === 'codex') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="2.5"
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
