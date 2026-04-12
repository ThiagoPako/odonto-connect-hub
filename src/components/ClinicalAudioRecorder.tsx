import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, Pause, Play, Square, Trash2, Volume2 } from "lucide-react";

interface ClinicalAudioRecorderProps {
  onRecordingComplete: (blob: Blob, duration: number) => void;
}

type RecState = "idle" | "recording" | "paused" | "review";

export function ClinicalAudioRecorder({ onRecordingComplete }: ClinicalAudioRecorderProps) {
  const [state, setState] = useState<RecState>("idle");
  const [duration, setDuration] = useState(0);
  const [waveformBars, setWaveformBars] = useState<number[]>(Array(40).fill(6));
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [reviewBlob, setReviewBlob] = useState<Blob | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | undefined>(undefined);
  const durationRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const stateRef = useRef<RecState>("idle");
  stateRef.current = state;

  useEffect(() => {
    return () => {
      cleanup();
      if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    };
  }, []);

  // Keyboard shortcuts: Space = pause/resume/play, Escape = discard
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Skip if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const s = stateRef.current;

      if (e.code === "Space") {
        e.preventDefault();
        if (s === "recording") pauseRecording();
        else if (s === "paused") resumeRecording();
        else if (s === "review") togglePlay();
      }

      if (e.code === "Escape") {
        if (s === "recording" || s === "paused") cancelRecording();
        else if (s === "review") discardReview();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  function cleanup() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (playTimerRef.current) clearInterval(playTimerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    audioElRef.current?.pause();
  }

  const startWaveform = useCallback(() => {
    const update = () => {
      if (!analyserRef.current) return;
      const data = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(data);
      const bars = Array.from({ length: 40 }, (_, i) => {
        const idx = Math.floor((i / 40) * data.length);
        return Math.max(6, (data[idx] / 255) * 56);
      });
      setWaveformBars(bars);
      animFrameRef.current = requestAnimationFrame(update);
    };
    update();
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
        streamRef.current?.getTracks().forEach(t => t.stop());
        audioCtxRef.current?.close().catch(() => {});
        streamRef.current = null;
        audioCtxRef.current = null;

        if (chunksRef.current.length > 0) {
          const actualMime = mediaRecorder.mimeType || "audio/webm";
          const blob = new Blob(chunksRef.current, { type: actualMime });
          const url = URL.createObjectURL(blob);
          if (reviewUrl) URL.revokeObjectURL(reviewUrl);
          setReviewBlob(blob);
          setReviewUrl(url);
          setState("review");
        } else {
          setState("idle");
        }
      };

      mediaRecorder.start(250);
      setState("recording");
      setDuration(0);
      setReviewBlob(null);
      setReviewUrl(null);
      setPlayProgress(0);

      intervalRef.current = setInterval(() => {
        durationRef.current += 1;
        setDuration(d => d + 1);
      }, 1000);

      startWaveform();
    } catch (err) {
      console.error("Audio recording error:", err);
    }
  }, [startWaveform, reviewUrl]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      setWaveformBars(prev => prev.map(h => Math.max(6, h * 0.4)));
      setState("paused");
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      intervalRef.current = setInterval(() => {
        durationRef.current += 1;
        setDuration(d => d + 1);
      }, 1000);
      startWaveform();
      setState("recording");
    }
  }, [startWaveform]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setWaveformBars(Array(40).fill(6));
  }, []);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      chunksRef.current = []; // prevent onstop from creating blob
      mediaRecorderRef.current.stop();
    } else {
      streamRef.current?.getTracks().forEach(t => t.stop());
      audioCtxRef.current?.close().catch(() => {});
      streamRef.current = null;
      audioCtxRef.current = null;
    }
    mediaRecorderRef.current = null;
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    setWaveformBars(Array(40).fill(6));
    setDuration(0);
    setState("idle");
  }, []);

  const confirmSave = useCallback(() => {
    if (reviewBlob) {
      onRecordingComplete(reviewBlob, Math.max(1, durationRef.current));
    }
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    setReviewBlob(null);
    setReviewUrl(null);
    setPlayProgress(0);
    setDuration(0);
    setState("idle");
    audioElRef.current?.pause();
    if (playTimerRef.current) clearInterval(playTimerRef.current);
  }, [reviewBlob, reviewUrl, onRecordingComplete]);

  const discardReview = useCallback(() => {
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    setReviewBlob(null);
    setReviewUrl(null);
    setPlayProgress(0);
    setDuration(0);
    setState("idle");
    audioElRef.current?.pause();
    if (playTimerRef.current) clearInterval(playTimerRef.current);
  }, [reviewUrl]);

  const togglePlay = useCallback(() => {
    if (!reviewUrl) return;
    if (!audioElRef.current) {
      audioElRef.current = new Audio(reviewUrl);
      audioElRef.current.onended = () => {
        setIsPlaying(false);
        setPlayProgress(0);
        if (playTimerRef.current) clearInterval(playTimerRef.current);
      };
    }
    if (isPlaying) {
      audioElRef.current.pause();
      setIsPlaying(false);
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    } else {
      audioElRef.current.play();
      setIsPlaying(true);
      playTimerRef.current = setInterval(() => {
        const el = audioElRef.current;
        if (el && el.duration) {
          setPlayProgress((el.currentTime / el.duration) * 100);
        }
      }, 100);
    }
  }, [reviewUrl, isPlaying]);

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  // ─── IDLE ─────────────────────────────────────────────────
  if (state === "idle") {
    return (
      <button
        onClick={startRecording}
        className="group flex items-center gap-4 w-full py-5 px-6 rounded-2xl bg-destructive/10 border-2 border-dashed border-destructive/30 hover:border-destructive/60 hover:bg-destructive/15 transition-all active:scale-[0.98] cursor-pointer"
      >
        <div className="h-16 w-16 rounded-full bg-destructive flex items-center justify-center shadow-lg group-hover:shadow-[0_0_20px_4px_hsl(var(--destructive)/0.35)] transition-all">
          <Mic className="h-7 w-7 text-destructive-foreground" />
        </div>
        <div className="text-left">
          <p className="text-base font-bold text-foreground">Gravar Consulta</p>
          <p className="text-xs text-muted-foreground mt-0.5">Clique para iniciar a gravação do áudio da consulta</p>
        </div>
      </button>
    );
  }

  // ─── REVIEW ───────────────────────────────────────────────
  if (state === "review") {
    return (
      <div className="w-full space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Volume2 className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">Gravação finalizada</p>
            <p className="text-xs text-muted-foreground">Duração: {formatTime(duration)} — ouça antes de salvar</p>
          </div>
        </div>

        {/* Player */}
        <div className="bg-muted/40 rounded-2xl border border-border/60 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="h-10 w-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
            </button>
            <div className="flex-1 space-y-1">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-100"
                  style={{ width: `${playProgress}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                <span>{formatTime(Math.round((playProgress / 100) * duration))}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={discardReview}
            className="flex items-center gap-2 h-11 px-5 rounded-xl border border-border text-muted-foreground text-sm font-medium hover:bg-muted/60 hover:text-foreground transition-all"
          >
            <Trash2 className="h-4 w-4" /> Descartar
          </button>
          <button
            onClick={startRecording}
            className="flex items-center gap-2 h-11 px-5 rounded-xl border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/10 transition-all"
          >
            <Mic className="h-4 w-4" /> Regravar
          </button>
          <button
            onClick={confirmSave}
            className="flex items-center gap-2 h-11 px-6 rounded-xl bg-success text-success-foreground text-sm font-bold hover:bg-success/90 transition-all shadow-md hover:shadow-lg"
          >
            <Square className="h-4 w-4" /> Salvar Gravação
          </button>
        </div>
      </div>
    );
  }

  // ─── RECORDING / PAUSED ───────────────────────────────────
  const isPaused = state === "paused";

  return (
    <div className="w-full space-y-4">
      {/* Timer row */}
      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          {!isPaused && <div className="absolute inset-0 rounded-full bg-destructive/30 animate-ping" />}
          <div className={`relative h-16 w-16 rounded-full flex items-center justify-center transition-all ${
            isPaused
              ? "bg-warning shadow-[0_0_16px_4px_hsl(var(--warning)/0.3)]"
              : "bg-destructive shadow-[0_0_24px_6px_hsl(var(--destructive)/0.4)]"
          }`}>
            {isPaused ? <Pause className="h-7 w-7 text-warning-foreground" /> : <Mic className="h-7 w-7 text-destructive-foreground" />}
          </div>
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <div className={`h-2.5 w-2.5 rounded-full ${isPaused ? "bg-warning" : "bg-destructive animate-pulse"}`} />
            <span className={`text-xs font-bold uppercase tracking-widest ${isPaused ? "text-warning" : "text-destructive"}`}>
              {isPaused ? "Pausado" : "Gravando consulta"}
            </span>
          </div>
          <span className="font-mono text-3xl font-black text-foreground tabular-nums tracking-tight">
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Waveform */}
      <div className={`flex items-end justify-center gap-[3px] h-20 rounded-2xl px-5 py-3 border transition-colors ${
        isPaused
          ? "bg-warning/5 border-warning/20"
          : "bg-destructive/5 border-destructive/20"
      }`}>
        {waveformBars.map((h, i) => (
          <div
            key={i}
            className="rounded-full transition-all duration-75"
            style={{
              width: 5,
              height: isPaused ? 8 : h * 1.3,
              minHeight: 6,
              background: isPaused
                ? `hsl(var(--warning) / 0.3)`
                : `hsl(var(--destructive) / ${0.25 + (h / 56) * 0.55})`,
            }}
          />
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={cancelRecording}
          className="flex items-center gap-2 h-11 px-5 rounded-xl border border-border text-muted-foreground text-sm font-medium hover:bg-muted/60 hover:text-foreground transition-all"
        >
          <Trash2 className="h-4 w-4" /> Descartar
        </button>
        {isPaused ? (
          <button
            onClick={resumeRecording}
            className="flex items-center gap-2 h-11 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-all shadow-md"
          >
            <Play className="h-4 w-4" /> Retomar
          </button>
        ) : (
          <button
            onClick={pauseRecording}
            className="flex items-center gap-2 h-11 px-5 rounded-xl bg-warning text-warning-foreground text-sm font-bold hover:bg-warning/90 transition-all shadow-md"
          >
            <Pause className="h-4 w-4" /> Pausar
          </button>
        )}
        <button
          onClick={stopRecording}
          className="flex items-center gap-2 h-11 px-6 rounded-xl bg-success text-success-foreground text-sm font-bold hover:bg-success/90 transition-all shadow-md hover:shadow-lg"
        >
          <Square className="h-4 w-4" /> Parar e Revisar
        </button>
      </div>
    </div>
  );
}
