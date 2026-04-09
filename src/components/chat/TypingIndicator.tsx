interface TypingIndicatorProps {
  name: string;
}

export function TypingIndicator({ name }: TypingIndicatorProps) {
  return (
    <div className="flex justify-start mt-3 animate-fade-in">
      <div className="max-w-[70%]">
        <div className="bg-card border border-border/50 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-[3px]">
              <span className="h-[7px] w-[7px] rounded-full bg-muted-foreground/50 animate-[typingDot_1.4s_ease-in-out_infinite]" />
              <span className="h-[7px] w-[7px] rounded-full bg-muted-foreground/50 animate-[typingDot_1.4s_ease-in-out_0.2s_infinite]" />
              <span className="h-[7px] w-[7px] rounded-full bg-muted-foreground/50 animate-[typingDot_1.4s_ease-in-out_0.4s_infinite]" />
            </div>
            <span className="text-[11px] text-muted-foreground/60 font-medium ml-1">{name} está digitando</span>
          </div>
        </div>
      </div>
    </div>
  );
}
