/**
 * Real brand logos (SVG) for each marketing channel.
 * Centralized so all campanha components share the same visuals.
 */
import type { CanalCampanha } from "@/data/campanhasStore";

interface Props {
  canal: CanalCampanha;
  size?: number;
  className?: string;
}

/* ─────────────── Standardized Badge wrapper ─────────────── */

export type ChannelBadgeSize = "sm" | "md" | "lg";

interface BadgeProps {
  canal: CanalCampanha;
  size?: ChannelBadgeSize;
  title?: string;
  className?: string;
}

/** Standardized container for channel logos: ring, shadow, padding, rounded.
 *  Sizes — sm: 28px box / 16px logo · md: 36px box / 20px logo · lg: 44px box / 24px logo. */
export function ChannelBadge({ canal, size = "md", title, className = "" }: BadgeProps) {
  const dims =
    size === "sm"
      ? { box: "h-7 w-7", logo: 16 }
      : size === "lg"
        ? { box: "h-11 w-11", logo: 24 }
        : { box: "h-9 w-9", logo: 20 };

  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border shadow-sm ${dims.box} ${className}`}
    >
      <ChannelLogo canal={canal} size={dims.logo} />
    </span>
  );
}

export function ChannelLogo({ canal, size = 20, className = "" }: Props) {
  const s = { width: size, height: size };
  switch (canal) {
    case "meta_ads":
      // Meta logo (infinity-like)
      return (
        <svg viewBox="0 0 287.56 191" {...s} className={className} aria-label="Meta">
          <defs>
            <linearGradient id="meta-a" x1="62.34" y1="101.45" x2="260.34" y2="91.45" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#0064e1" />
              <stop offset=".4" stopColor="#0064e1" />
              <stop offset=".83" stopColor="#0073ee" />
              <stop offset="1" stopColor="#0082fb" />
            </linearGradient>
            <linearGradient id="meta-b" x1="41.42" y1="53" x2="41.42" y2="126" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#0082fb" />
              <stop offset="1" stopColor="#0064e0" />
            </linearGradient>
          </defs>
          <path fill="#0081fb" d="M31.06 126c0 11 2.41 19.41 5.56 24.51A19 19 0 0 0 53.19 160c8.1 0 15.51-2 29.79-21.76 11.44-15.83 24.92-38 34-52l15.36-23.6c10.67-16.39 23-34.61 37.18-47C181.07 5.6 193.54 0 206.09 0c21.07 0 41.14 12.21 56.5 35.11 16.81 25.08 25 56.67 25 89.27 0 19.38-3.82 33.62-10.32 44.87C271 180.13 258.72 191 238.13 191v-31c17.63 0 22-16.2 22-34.74 0-26.42-6.16-55.74-19.73-76.69-9.63-14.86-22.11-23.94-35.84-23.94-14.85 0-26.8 11.2-40.23 31.17-7.14 10.61-14.47 23.54-22.7 38.13l-9.06 16.05c-18.2 32.27-22.81 39.62-31.91 51.75C84.74 183 71.12 191 53.19 191c-21.27 0-34.72-9.21-43-23.09C3.34 156.6 0 141.76 0 124.85z" />
          <path fill="url(#meta-a)" d="M24.49 37.3C38.73 15.35 59.28 0 82.85 0c13.65 0 27.22 4 41.39 15.61 15.5 12.65 32 33.48 52.63 67.81l7.39 12.32c17.84 29.72 28 45 33.93 52.22 7.64 9.26 13 12 19.94 12 17.63 0 22-16.2 22-34.74l27.4-.86c0 19.38-3.82 33.62-10.32 44.87C271 180.13 258.72 191 238.13 191c-12.8 0-24.14-2.78-36.68-14.61-9.64-9.08-20.91-25.21-29.58-39.71L146.08 93.6c-13-21.74-24.92-37.93-31.81-45.27-7.41-7.89-16.93-17.41-32.13-17.41-12.3 0-22.74 8.63-31.48 21.84z" />
          <path fill="url(#meta-b)" d="M82.35 31c-12.3 0-22.74 8.63-31.48 21.84C38.51 71.5 31 99.31 31 126c0 11 2.41 19.41 5.56 24.51L10.14 167.91C3.34 156.6 0 141.76 0 124.85 0 94 8.48 61.84 24.49 37.3 38.73 15.35 59.28 0 82.85 0z" />
        </svg>
      );

    case "google_ads":
      return (
        <svg viewBox="0 0 192 192" {...s} className={className} aria-label="Google Ads">
          <path fill="#FBBC04" d="M67.99 12.42L7.6 116.99c-8.34 14.45-3.39 32.87 11.07 41.21 14.45 8.34 32.87 3.39 41.21-11.07L120.27 42.56C128.61 28.1 123.66 9.69 109.21 1.35 94.75-7 76.34-2.04 67.99 12.42z" />
          <circle cx="34.32" cy="146.32" r="30.18" fill="#34A853" />
          <path fill="#4285F4" d="M184.4 116.99L124 12.42c-8.34-14.46-26.76-19.41-41.21-11.07S63.39 28.1 71.73 42.56l60.39 104.57c8.34 14.46 26.76 19.41 41.21 11.07s19.41-26.76 11.07-41.21z" />
        </svg>
      );

    case "tiktok":
      return (
        <svg viewBox="0 0 256 256" {...s} className={className} aria-label="TikTok">
          <path fill="currentColor" d="M232 84a76.1 76.1 0 0 1-76-76 8 8 0 0 0-8-8h-40a8 8 0 0 0-8 8v152a28 28 0 1 1-40-25.31 8 8 0 0 0 4.59-7.24V84a8 8 0 0 0-9.4-7.88A92 92 0 1 0 196 160V108.7a107 107 0 0 0 36 6.3 8 8 0 0 0 8-8V92a8 8 0 0 0-8-8" />
        </svg>
      );

    case "instagram":
      return (
        <svg viewBox="0 0 24 24" {...s} className={className} aria-label="Instagram">
          <defs>
            <radialGradient id="ig-grad" cx="0.3" cy="1.05" r="1.2">
              <stop offset="0" stopColor="#fdf497" />
              <stop offset="0.05" stopColor="#fdf497" />
              <stop offset="0.45" stopColor="#fd5949" />
              <stop offset="0.6" stopColor="#d6249f" />
              <stop offset="0.9" stopColor="#285AEB" />
            </radialGradient>
          </defs>
          <rect x="2" y="2" width="20" height="20" rx="5" fill="url(#ig-grad)" />
          <circle cx="12" cy="12" r="4.2" fill="none" stroke="#fff" strokeWidth="1.8" />
          <circle cx="17.5" cy="6.5" r="1.2" fill="#fff" />
        </svg>
      );

    case "youtube":
      return (
        <svg viewBox="0 0 24 24" {...s} className={className} aria-label="YouTube">
          <path fill="#FF0000" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8z" />
          <path fill="#fff" d="M9.6 15.6V8.4l6.3 3.6z" />
        </svg>
      );

    case "linkedin":
      return (
        <svg viewBox="0 0 24 24" {...s} className={className} aria-label="LinkedIn">
          <rect width="24" height="24" rx="3" fill="#0A66C2" />
          <path fill="#fff" d="M7.1 9.6h2.7v8.7H7.1zM8.45 5.6a1.55 1.55 0 1 1 0 3.1 1.55 1.55 0 0 1 0-3.1zM11.5 9.6h2.6v1.2h.04c.36-.68 1.24-1.4 2.55-1.4 2.73 0 3.23 1.8 3.23 4.13v4.77h-2.7v-4.23c0-1 0-2.3-1.4-2.3s-1.62 1.1-1.62 2.23v4.3h-2.7z" />
        </svg>
      );

    case "email":
      return (
        <svg viewBox="0 0 24 24" {...s} className={className} aria-label="E-mail">
          <rect width="24" height="24" rx="4" fill="#EA4335" />
          <path fill="#fff" d="M5 8.2 12 13l7-4.8V8a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1zM5 10v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6l-7 4.8z" />
        </svg>
      );

    case "whatsapp":
      return (
        <svg viewBox="0 0 24 24" {...s} className={className} aria-label="WhatsApp">
          <path fill="#25D366" d="M.057 24l1.687-6.163a11.87 11.87 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 0 1 8.413 3.488A11.82 11.82 0 0 1 23.95 11.9c-.003 6.557-5.338 11.892-11.893 11.892h-.005a11.9 11.9 0 0 1-5.688-1.448z" />
          <path fill="#fff" d="M12.05 21.785h-.004a9.87 9.87 0 0 1-5.03-1.378l-.36-.214-3.74.98 1-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.437-9.884 9.892-9.884 2.64 0 5.122 1.03 6.988 2.898a9.83 9.83 0 0 1 2.892 6.994c-.003 5.45-4.437 9.884-9.893 9.884z" />
          <path fill="#25D366" d="M9.536 7.323c-.198-.44-.405-.45-.595-.456l-.51-.01a.98.98 0 0 0-.71.33c-.245.27-.933.91-.933 2.222s.954 2.578 1.087 2.756c.133.18 1.842 2.95 4.55 4.018 2.252.888 2.71.71 3.2.665.488-.044 1.575-.643 1.797-1.265.222-.622.222-1.155.155-1.265-.066-.11-.244-.176-.51-.31-.266-.132-1.575-.776-1.82-.865-.244-.088-.422-.132-.6.133-.18.265-.687.865-.842 1.044-.155.18-.31.198-.576.066-.266-.133-1.122-.414-2.137-1.319-.79-.704-1.323-1.573-1.478-1.84-.155-.265-.017-.408.116-.54.12-.12.266-.31.4-.466.132-.155.176-.265.265-.443.088-.18.044-.333-.022-.466z" />
        </svg>
      );

    case "site_organico":
      return (
        <svg viewBox="0 0 24 24" {...s} className={className} aria-label="Site / SEO">
          <circle cx="12" cy="12" r="10" fill="#0EA5E9" />
          <path fill="none" stroke="#fff" strokeWidth="1.4" d="M2 12h20M12 2c3 3.5 3 16.5 0 20M12 2c-3 3.5-3 16.5 0 20" />
        </svg>
      );

    case "indicacao":
      return (
        <svg viewBox="0 0 24 24" {...s} className={className} aria-label="Indicação">
          <rect width="24" height="24" rx="6" fill="#7C3AED" />
          <path fill="#fff" d="M9 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm6.5 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM9 12.5c-2.5 0-5 1.25-5 3.75V18h7.5v-1.75c0-.95.36-1.85.97-2.6A6.7 6.7 0 0 0 9 12.5zm6.5 0c-.62 0-1.27.08-1.9.23 1.16.85 1.9 2.05 1.9 3.52V18H21v-1.75c0-2.5-2.5-3.75-5.5-3.75z" />
        </svg>
      );

    default:
      return null;
  }
}
