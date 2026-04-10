import { useState } from "react";

interface LeadAvatarProps {
  initials: string;
  avatarUrl?: string | null;
  avatarColor?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "h-8 w-8 text-[10px]",
  md: "h-10 w-10 text-xs",
  lg: "h-14 w-14 text-lg",
};


export function LeadAvatar({ initials, avatarUrl, avatarColor = "bg-primary/20", size = "md", className = "" }: LeadAvatarProps) {
  const [imgError, setImgError] = useState(false);

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
    </div>
  );
}
