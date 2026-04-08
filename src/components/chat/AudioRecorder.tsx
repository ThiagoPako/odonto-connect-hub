import { useState, useRef, useEffect } from "react";
import { Mic, Square, Trash2 } from "lucide-react";

interface AudioRecorderProps {
  onRecordingComplete: (blob: Blob, duration: number) => void;
}

export function AudioRecorder({ onRecordingComplete }: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [waveformBars, setWaveformBars] = useState<number[]>(Array(24).fill(4));
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      // Setup analyser for waveform
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        onRecordingComplete(blob, duration);
        stream.getTracks().forEach((t) => t.stop());
        audioCtx.close();
      };

      mediaRecorder.start();
      setIsRecording(true);
      setDuration(0);

      intervalRef.current = setInterval(() => {
        setDuration((d) => d + 1);
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
    } catch {
      console.error("Microphone access denied");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      setWaveformBars(Array(24).fill(4));
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      mediaRecorderRef.current = null;
      setIsRecording(false);
      setDuration(0);
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      setWaveformBars(Array(24).fill(4));
    }
  };

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  if (!isRecording) {
    return (
      <button
        onClick={startRecording}
        className="p-2.5 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        title="Gravar áudio"
      >
        <Mic className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3 bg-destructive/5 rounded-full px-4 py-2 flex-1">
      <button onClick={cancelRecording} className="text-destructive hover:text-destructive/80 transition-colors">
        <Trash2 className="h-4 w-4" />
      </button>

      <span className="text-xs font-mono text-destructive font-medium min-w-[40px]">
        {formatTime(duration)}
      </span>

      <div className="flex items-center gap-[2px] flex-1 h-8">
        {waveformBars.map((h, i) => (
          <div
            key={i}
            className="bg-destructive/60 rounded-full transition-all duration-75"
            style={{ width: 3, height: h, minHeight: 4 }}
          />
        ))}
      </div>

      <button
        onClick={stopRecording}
        className="h-8 w-8 rounded-full bg-destructive flex items-center justify-center text-destructive-foreground hover:bg-destructive/90 transition-colors"
      >
        <Square className="h-3 w-3 fill-current" />
      </button>
    </div>
  );
}
