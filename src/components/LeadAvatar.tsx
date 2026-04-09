import { useState } from "react";

interface LeadAvatarProps {
  initials: string;
  avatarUrl?: string | null;
  avatarColor?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  hasWhatsApp?: boolean;
}

const sizeClasses = {
  sm: "h-8 w-8 text-[10px]",
  md: "h-10 w-10 text-xs",
  lg: "h-14 w-14 text-lg",
};

const badgeSizes = {
  sm: "h-2.5 w-2.5 border-[1.5px]",
  md: "h-3 w-3 border-2",
  lg: "h-4 w-4 border-2",
};

export function LeadAvatar({ initials, avatarUrl, avatarColor = "bg-primary/20", size = "md", className = "", hasWhatsApp }: LeadAvatarProps) {
  const [imgError, setImgError] = useState(false);

  const showWhatsApp = hasWhatsApp ?? !!avatarUrl;

  const avatar = avatarUrl && !imgError ? (
    <img
      src={avatarUrl}
      alt={initials}
      onError={() => setImgError(true)}
      className={`${sizeClasses[size]} rounded-full object-cover shrink-0`}
    />
  ) : (
    <div className={`${sizeClasses[size]} rounded-full ${avatarColor} flex items-center justify-center font-bold text-primary-foreground shrink-0`}>
      {initials}
    </div>
  );

  return (
    <div className={`relative shrink-0 ${className}`}>
      {avatar}
      {showWhatsApp && (
        <span
          className={`absolute bottom-0 right-0 rounded-full bg-success border-card ${badgeSizes[size]}`}
          title="WhatsApp conectado"
        />
      )}
    </div>
  );
}
