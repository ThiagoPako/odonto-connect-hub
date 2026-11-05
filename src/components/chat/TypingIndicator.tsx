import { Mic } from "lucide-react";

interface TypingIndicatorProps {
  name: string;
  mode?: "typing" | "recording";
}

export function TypingIndicator({ name, mode = "typing" }: TypingIndicatorProps) {
  const isRecording = mode === "recording";

  return (
    <div className="flex justify-start mt-3 animate-fade-in" role="status" aria-live="polite">
      <div className="max-w-[70%]">
        <div className="bg-card border border-border/50 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2">
            {isRecording ? (
              <>
                <Mic className="h-4 w-4 text-destructive animate-pulse motion-reduce:animate-none" aria-hidden="true" />
                <div className="flex items-center gap-[2px]" aria-hidden="true">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <span
                      key={i}
                      className="w-[3px] rounded-full bg-destructive/60"
                      style={{
                        height: `${6 + Math.sin(i * 0.8) * 6}px`,
                        animation: `recordingWave 1.2s ease-in-out ${i * 0.08}s infinite alternate`,
                      }}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-[3px]" aria-hidden="true">
                <span className="h-[7px] w-[7px] rounded-full bg-muted-foreground/50 animate-[typingDot_1.4s_ease-in-out_infinite]" />
                <span className="h-[7px] w-[7px] rounded-full bg-muted-foreground/50 animate-[typingDot_1.4s_ease-in-out_0.2s_infinite]" />
                <span className="h-[7px] w-[7px] rounded-full bg-muted-foreground/50 animate-[typingDot_1.4s_ease-in-out_0.4s_infinite]" />
              </div>
            )}
            <span className="text-xs text-muted-foreground font-medium ml-1">
              {name} {isRecording ? "está gravando áudio…" : "está digitando…"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
