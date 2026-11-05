import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, Square, Trash2, Send } from "lucide-react";
import { toast } from "sonner";

const MIC_BLOCKED_TITLE = "Microfone bloqueado";
const MIC_BLOCKED_DESCRIPTION = "Libere o microfone nas configurações do navegador para gravar áudio.";

interface AudioRecorderProps {
  onRecordingComplete: (blob: Blob, duration: number) => void;
  onRecordingStateChange?: (status: "recording" | "paused") => void;
  /** Só visual: desativa o botão de gravar (ex.: conversa ainda na fila). */
  disabled?: boolean;
}

export function AudioRecorder({ onRecordingComplete, onRecordingStateChange, disabled }: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [waveformBars, setWaveformBars] = useState<number[]>(Array(24).fill(4));
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | undefined>(undefined);
  const durationRef = useRef(0); // non-stale duration for onstop callback
  const streamRef = useRef<MediaStream | null>(null);
  const sendRequestedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      // Check permissions first
      if (navigator.permissions) {
        try {
          const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
          if (status.state === "denied") {
            console.error("Microphone blocked");
            toast.error(MIC_BLOCKED_TITLE, { description: MIC_BLOCKED_DESCRIPTION });
            return;
          }
        } catch {
          // permissions API not supported for microphone, proceed
        }
      }

      // Get stream synchronously within gesture handler
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Prefer OGG/Opus for WhatsApp voice-note compatibility
      const mimeType = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : undefined;

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      durationRef.current = 0;
      sendRequestedRef.current = false;

      // Setup analyser for waveform visualization
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        // Only send if user pressed send (not cancel)
        if (sendRequestedRef.current && chunksRef.current.length > 0) {
          const actualMime = mediaRecorder.mimeType || "audio/webm";
          const blob = new Blob(chunksRef.current, { type: actualMime });
          onRecordingComplete(blob, Math.max(1, durationRef.current));
        }
        // Cleanup
        stream.getTracks().forEach(t => t.stop());
        audioCtx.close().catch(() => {});
        streamRef.current = null;
        audioCtxRef.current = null;
      };

      mediaRecorder.start(250); // collect data every 250ms
      setIsRecording(true);
      onRecordingStateChange?.("recording");
      setDuration(0);

      intervalRef.current = setInterval(() => {
        durationRef.current += 1;
        setDuration(d => d + 1);
      }, 1000);

      const updateWaveform = () => {
        if (!analyserRef.current) return;
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        const bars = Array.from({ length: 24 }, (_, i) => {
          const idx = Math.floor((i / 24) * data.length);
          return Math.max(4, (data[idx] / 255) * 32);
        });
        setWaveformBars(bars);
        animFrameRef.current = requestAnimationFrame(updateWaveform);
      };
      updateWaveform();
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        console.error("Permission denied for microphone");
        toast.error(MIC_BLOCKED_TITLE, { description: MIC_BLOCKED_DESCRIPTION });
      } else if (err.name === "NotFoundError") {
        console.error("No microphone found");
        toast.error("Nenhum microfone encontrado", { description: "Conecte um microfone e tente de novo." });
      } else if (err.name === "NotReadableError") {
        console.error("Microphone in use:", err);
        toast.error("Microfone em uso", { description: "Feche outros apps que usam o microfone e tente de novo." });
      } else {
        console.error("Audio recording error:", err);
        toast.error("Não foi possível gravar o áudio", { description: "Tente de novo." });
      }
    }
  }, [onRecordingComplete]);

  const stopAndSend = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      sendRequestedRef.current = true;
      mediaRecorderRef.current.stop();
    }
    onRecordingStateChange?.("paused");
    setIsRecording(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setWaveformBars(Array(24).fill(4));
  }, []);

  const cancelRecording = useCallback(() => {
    sendRequestedRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      // Stop without sending
      mediaRecorderRef.current.stop();
    } else {
      // Already stopped, just cleanup stream
      streamRef.current?.getTracks().forEach(t => t.stop());
      audioCtxRef.current?.close().catch(() => {});
      streamRef.current = null;
      audioCtxRef.current = null;
    }
    mediaRecorderRef.current = null;
    onRecordingStateChange?.("paused");
    setIsRecording(false);
    setDuration(0);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setWaveformBars(Array(24).fill(4));
  }, [onRecordingStateChange]);

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  if (!isRecording) {
    return (
      <button
        type="button"
        onClick={startRecording}
        disabled={disabled}
        aria-label="Gravar áudio"
        title="Gravar áudio"
        className="inline-flex size-11 md:size-10 shrink-0 items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Mic className="size-5" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Gravando áudio"
      data-recording=""
      className="flex min-h-11 md:min-h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-destructive/10 px-0.5"
    >
      <button
        type="button"
        onClick={cancelRecording}
        aria-label="Descartar gravação"
        title="Descartar gravação"
        className="inline-flex size-11 md:size-10 shrink-0 items-center justify-center rounded-full text-destructive hover:bg-destructive/10 transition-colors"
      >
        <Trash2 className="size-5" aria-hidden="true" />
      </button>

      <span className="flex items-center gap-1.5 shrink-0 text-sm font-medium tabular-nums text-destructive min-w-[3.25rem]">
        <span className="size-2 rounded-full bg-destructive motion-safe:animate-pulse" aria-hidden="true" />
        <span className="sr-only">Gravando</span>
        {formatTime(duration)}
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-[2px] h-8 overflow-hidden" aria-hidden="true">
        {waveformBars.map((h, i) => (
          <div
            key={i}
            className="bg-destructive/60 rounded-full transition-all duration-75 shrink-0"
            style={{ width: 3, height: h, minHeight: 4 }}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={stopAndSend}
        aria-label="Enviar áudio"
        title="Enviar áudio"
        className="inline-flex size-11 md:size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 active:translate-y-px transition-colors"
      >
        <Send className="size-5" aria-hidden="true" />
      </button>
    </div>
  );
}
