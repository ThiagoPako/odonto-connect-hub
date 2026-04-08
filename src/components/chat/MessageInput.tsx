import { useState, useRef } from "react";
import { Send, Paperclip, Smile, Image } from "lucide-react";
import { AudioRecorder } from "./AudioRecorder";

interface MessageInputProps {
  onSendMessage: (content: string, type: "text" | "audio" | "image" | "file") => void;
  disabled?: boolean;
}

export function MessageInput({ onSendMessage, disabled }: MessageInputProps) {
  const [message, setMessage] = useState("");
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    if (!message.trim()) return;
    onSendMessage(message.trim(), "text");
    setMessage("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAudioComplete = (_blob: Blob, _duration: number) => {
    onSendMessage("🎤 Mensagem de áudio", "audio");
  };

  return (
    <div className="border-t border-border bg-card p-3">
      {/* Attach menu */}
      {showAttachMenu && (
        <div className="flex items-center gap-2 mb-2 px-2">
          <button
            onClick={() => {
              imageInputRef.current?.click();
              setShowAttachMenu(false);
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-accent text-muted-foreground hover:text-accent-foreground transition-colors"
          >
            <Image className="h-4 w-4" />
            Imagem
          </button>
          <button
            onClick={() => {
              fileInputRef.current?.click();
              setShowAttachMenu(false);
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-accent text-muted-foreground hover:text-accent-foreground transition-colors"
          >
            <Paperclip className="h-4 w-4" />
            Arquivo
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          onClick={() => setShowAttachMenu(!showAttachMenu)}
          className="p-2.5 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
        >
          <Paperclip className="h-5 w-5" />
        </button>

        <div className="flex-1 flex items-end gap-2">
          {message.length === 0 ? (
            <>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={disabled ? "Selecione um atendimento" : "Digite uma mensagem..."}
                disabled={disabled}
                rows={1}
                className="flex-1 resize-none bg-muted rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[40px] max-h-[120px] disabled:opacity-50"
              />
              <AudioRecorder onRecordingComplete={handleAudioComplete} />
            </>
          ) : (
            <>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Digite uma mensagem..."
                rows={1}
                className="flex-1 resize-none bg-muted rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[40px] max-h-[120px]"
              />
              <button
                onClick={handleSend}
                className="p-2.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
              >
                <Send className="h-5 w-5" />
              </button>
            </>
          )}
        </div>

        <button className="p-2.5 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0">
          <Smile className="h-5 w-5" />
        </button>
      </div>

      <input ref={fileInputRef} type="file" className="hidden" onChange={() => onSendMessage("📎 Arquivo anexado", "file")} />
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={() => onSendMessage("🖼️ Imagem enviada", "image")} />
    </div>
  );
}
