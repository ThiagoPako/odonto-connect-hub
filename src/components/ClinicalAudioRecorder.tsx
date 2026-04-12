import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, Square, Trash2, Check } from "lucide-react";

interface ClinicalAudioRecorderProps {
  onRecordingComplete: (blob: Blob, duration: number) => void;
}

export function ClinicalAudioRecorder({ onRecordingComplete }: ClinicalAudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [waveformBars, setWaveformBars] = useState<number[]>(Array(40).fill(6));
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | undefined>(undefined);
  const durationRef = useRef(0);
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : undefined;

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      durationRef.current = 0;
      sendRequestedRef.current = false;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      analyserRef.current = analyser;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        if (sendRequestedRef.current && chunksRef.current.length > 0) {
          const actualMime = mediaRecorder.mimeType || "audio/webm";
          const blob = new Blob(chunksRef.current, { type: actualMime });
          onRecordingComplete(blob, Math.max(1, durationRef.current));
        }
        stream.getTracks().forEach(t => t.stop());
        audioCtx.close().catch(() => {});
        streamRef.current = null;
        audioCtxRef.current = null;
      };

      mediaRecorder.start(250);
      setIsRecording(true);
      setDuration(0);

      intervalRef.current = setInterval(() => {
        durationRef.current += 1;
        setDuration(d => d + 1);
      }, 1000);

      const updateWaveform = () => {
        if (!analyserRef.current) return;
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        const bars = Array.from({ length: 40 }, (_, i) => {
          const idx = Math.floor((i / 40) * data.length);
          return Math.max(6, (data[idx] / 255) * 56);
        });
        setWaveformBars(bars);
        animFrameRef.current = requestAnimationFrame(updateWaveform);
      };
      updateWaveform();
    } catch (err) {
      console.error("Audio recording error:", err);
    }
  }, [onRecordingComplete]);

  const stopAndSave = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      sendRequestedRef.current = true;
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setWaveformBars(Array(40).fill(6));
  }, []);

  const cancelRecording = useCallback(() => {
    sendRequestedRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    } else {
      streamRef.current?.getTracks().forEach(t => t.stop());
      audioCtxRef.current?.close().catch(() => {});
      streamRef.current = null;
      audioCtxRef.current = null;
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setDuration(0);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setWaveformBars(Array(40).fill(6));
  }, []);

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  if (!isRecording) {
    return (
      <button
        onClick={startRecording}
        className="group flex items-center gap-3 h-14 px-6 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all shadow-md hover:shadow-lg active:scale-[0.97]"
      >
        <div className="h-9 w-9 rounded-xl bg-primary-foreground/20 flex items-center justify-center group-hover:bg-primary-foreground/30 transition-colors">
          <Mic className="h-5 w-5" />
        </div>
        Gravar Consulta
      </button>
    );
  }

  return (
    <div className="w-full space-y-3">
      {/* Recording indicator + timer */}
      <div className="flex items-center gap-3">
        <div className="h-3 w-3 rounded-full bg-destructive animate-pulse shadow-[0_0_8px_2px_hsl(var(--destructive)/0.4)]" />
        <span className="text-xs font-semibold text-destructive uppercase tracking-wider">Gravando</span>
        <span className="font-mono text-2xl font-bold text-foreground tabular-nums tracking-tight">
          {formatTime(duration)}
        </span>
      </div>

      {/* Large waveform */}
      <div className="flex items-end justify-center gap-[3px] h-16 bg-destructive/5 rounded-xl px-4 py-2 border border-destructive/15">
        {waveformBars.map((h, i) => (
          <div
            key={i}
            className="rounded-full transition-all duration-75"
            style={{
              width: 4,
              height: h,
              minHeight: 6,
              background: `hsl(var(--destructive) / ${0.3 + (h / 56) * 0.5})`,
            }}
          />
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={cancelRecording}
          className="flex items-center gap-2 h-10 px-4 rounded-xl border border-border text-muted-foreground text-sm font-medium hover:bg-muted/60 hover:text-foreground transition-all"
        >
          <Trash2 className="h-4 w-4" /> Descartar
        </button>
        <button
          onClick={stopAndSave}
          className="flex items-center gap-2 h-10 px-5 rounded-xl bg-success text-success-foreground text-sm font-semibold hover:bg-success/90 transition-all shadow-md"
        >
          <Square className="h-4 w-4" /> Parar e Salvar
        </button>
      </div>
    </div>
  );
}
