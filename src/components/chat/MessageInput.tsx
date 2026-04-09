import { useState, useRef, useMemo, useCallback } from "react";
import { Send, Paperclip, Smile, Image, MapPin, UserCircle, BarChart3, FileText, Video, Sticker, X, Bold, Italic, Strikethrough, Code, List, Zap, Loader2 } from "lucide-react";
import { AudioRecorder } from "./AudioRecorder";
import { getClinicLocation } from "@/components/ClinicLocationPanel";
import { getAttendanceSettings, type QuickReply } from "@/components/AttendanceSettingsPanel";
import type { MessageType, ChatMessage, LocationData, ContactData, PollData, ReplyData, ListData } from "@/data/chatMockData";
import { toast } from "sonner";

interface MessageInputProps {
  onSendMessage: (content: string, type: MessageType, extra?: Partial<ChatMessage>) => void;
  disabled?: boolean;
  replyingTo?: ReplyData | null;
  onCancelReply?: () => void;
}

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🎉", "🔥"];

interface MessageInputInternalProps extends MessageInputProps {
  attendantName?: string;
}

export function MessageInput({ onSendMessage, disabled, replyingTo, onCancelReply, attendantName }: MessageInputProps & { attendantName?: string }) {
  const [message, setMessage] = useState("");
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [showPollForm, setShowPollForm] = useState(false);
  const [showListForm, setShowListForm] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [quickReplyFilter, setQuickReplyFilter] = useState("");
  const [uploading, setUploading] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<{ file: File; previewUrl: string; type: MessageType } | null>(null);
  const [mediaCaption, setMediaCaption] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const attendanceSettings = useMemo(() => getAttendanceSettings(), []);
  const quickReplies = attendanceSettings.quickReplies;

  const filteredQuickReplies = useMemo(() => {
    if (!quickReplyFilter) return quickReplies;
    const lower = quickReplyFilter.toLowerCase();
    return quickReplies.filter(
      (qr) => qr.title.toLowerCase().includes(lower) || qr.category.toLowerCase().includes(lower)
    );
  }, [quickReplies, quickReplyFilter]);

  // Location form
  const [locName, setLocName] = useState("");
  const [locAddress, setLocAddress] = useState("");
  const [locLat, setLocLat] = useState("-23.5505");
  const [locLng, setLocLng] = useState("-46.6333");

  // Contact form
  const [ctName, setCtName] = useState("");
  const [ctPhone, setCtPhone] = useState("");
  const [ctEmail, setCtEmail] = useState("");
  const [ctCompany, setCtCompany] = useState("");
  const [ctUrl, setCtUrl] = useState("");

  // Poll form
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", "", ""]);

  // List form
  const [listTitle, setListTitle] = useState("");
  const [listButton, setListButton] = useState("Ver opções");
  const [listRows, setListRows] = useState([{ id: "1", title: "", description: "" }, { id: "2", title: "", description: "" }]);

  const handleSend = () => {
    if (!message.trim()) return;
    let finalMessage = message.trim();
    // Prepend attendant signature (e.g. "Julia:\nmensagem")
    if (attendanceSettings.signatureEnabled && attendantName) {
      const sig = attendanceSettings.signatureTemplate.replace("{name}", attendantName);
      finalMessage = `${sig}\n${finalMessage}`;
    }
    onSendMessage(finalMessage, "text");
    setMessage("");
  };

  const handleMessageChange = (value: string) => {
    setMessage(value);
    // Trigger quick replies on "/"
    if (value === "/" || (value.startsWith("/") && value.length <= 30)) {
      setShowQuickReplies(true);
      setQuickReplyFilter(value.slice(1));
    } else {
      setShowQuickReplies(false);
    }
  };

  const selectQuickReply = (qr: QuickReply) => {
    setMessage(qr.content);
    setShowQuickReplies(false);
    setQuickReplyFilter("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        const MAX_SIZE = 16 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
          toast.error("Imagem muito grande", { description: "Máximo: 16MB" });
          return;
        }
        const previewUrl = URL.createObjectURL(file);
        setMediaPreview({ file, previewUrl, type: "image" });
        setMediaCaption("");
        closeAllForms();
        return;
      }
    }
  }, []);

  const handleAudioComplete = (blob: Blob, recordedDuration: number) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(",")[1];
      // Clean MIME type — remove codecs params that break Evolution API data URI parsing
      const rawMime = blob.type || "audio/ogg";
      const cleanMime = rawMime.split(";")[0].trim(); // "audio/webm;codecs=opus" → "audio/webm"
      // WhatsApp prefers ogg/opus — map webm to ogg for better compatibility
      const finalMime = cleanMime === "audio/webm" ? "audio/ogg" : cleanMime;
      const ext = finalMime.includes("mp4") ? "m4a" : "ogg";
      onSendMessage("🎤 Mensagem de áudio", "audio", {
        duration: Math.max(1, Math.round(recordedDuration)),
        fileUrl: URL.createObjectURL(blob),
        mimeType: finalMime,
        fileName: `audio-${Date.now()}.${ext}`,
        _mediaBase64: base64,
      } as any);
    };
    reader.readAsDataURL(blob);
  };

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>, mediaType: MessageType) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // reset input

    const MAX_SIZE = 16 * 1024 * 1024; // 16MB
    if (file.size > MAX_SIZE) {
      toast.error("Arquivo muito grande", { description: "Tamanho máximo: 16MB" });
      return;
    }

    if (mediaType === "image" || mediaType === "video") {
      const previewUrl = URL.createObjectURL(file);
      setMediaPreview({ file, previewUrl, type: mediaType });
      setMediaCaption("");
      closeAllForms();
    } else {
      // Documents — send immediately
      sendFileAsMessage(file, "document", "");
    }
  }, []);

  const sendFileAsMessage = useCallback((file: File, type: MessageType, caption: string) => {
    setUploading(true);
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUri = reader.result as string;
      const base64 = dataUri.split(",")[1];

      const contentLabel = type === "image" ? "🖼️ Imagem" :
        type === "video" ? "🎬 Vídeo" :
        `📎 ${file.name}`;

      onSendMessage(caption || contentLabel, type, {
        fileName: file.name,
        fileUrl: dataUri,
        mimeType: file.type,
        _mediaBase64: base64,
      } as any);

      setUploading(false);
      setMediaPreview(null);
      setMediaCaption("");
    };
    reader.onerror = () => {
      toast.error("Erro ao ler arquivo");
      setUploading(false);
    };
    reader.readAsDataURL(file);
  }, [onSendMessage]);

  const handleSendMediaPreview = () => {
    if (!mediaPreview) return;
    sendFileAsMessage(mediaPreview.file, mediaPreview.type, mediaCaption);
  };

  const cancelMediaPreview = () => {
    if (mediaPreview) {
      URL.revokeObjectURL(mediaPreview.previewUrl);
    }
    setMediaPreview(null);
    setMediaCaption("");
  };

  const applyFormatting = (format: string) => {
    const textarea = document.querySelector("textarea");
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = message.substring(start, end);
    if (!selected) return;
    let wrapped = selected;
    switch (format) {
      case "bold": wrapped = `*${selected}*`; break;
      case "italic": wrapped = `_${selected}_`; break;
      case "strikethrough": wrapped = `~${selected}~`; break;
      case "monospace": wrapped = `\`\`\`${selected}\`\`\``; break;
    }
    setMessage(message.substring(0, start) + wrapped + message.substring(end));
  };

  const sendLocation = () => {
    const loc: LocationData = {
      latitude: parseFloat(locLat),
      longitude: parseFloat(locLng),
      name: locName || undefined,
      address: locAddress || undefined,
    };
    onSendMessage("📍 Localização", "location", { location: loc });
    setShowLocationForm(false);
    setLocName(""); setLocAddress("");
  };

  const sendContact = () => {
    if (!ctName || !ctPhone) return;
    const contact: ContactData = {
      fullName: ctName,
      phone: ctPhone,
      email: ctEmail || undefined,
      company: ctCompany || undefined,
      url: ctUrl || undefined,
    };
    onSendMessage("👤 Contato", "contact", { contact });
    setShowContactForm(false);
    setCtName(""); setCtPhone(""); setCtEmail(""); setCtCompany(""); setCtUrl("");
  };

  const sendPoll = () => {
    if (!pollQuestion || pollOptions.filter(o => o.trim()).length < 2) return;
    const poll: PollData = {
      question: pollQuestion,
      options: pollOptions.filter(o => o.trim()).map(o => ({ text: o.trim(), votes: 0 })),
    };
    onSendMessage("📊 Enquete", "poll", { poll });
    setShowPollForm(false);
    setPollQuestion(""); setPollOptions(["", "", ""]);
  };

  const sendList = () => {
    if (!listTitle || listRows.filter(r => r.title.trim()).length < 1) return;
    const list: ListData = {
      title: listTitle,
      buttonText: listButton || "Ver opções",
      sections: [{ title: listTitle, rows: listRows.filter(r => r.title.trim()) }],
    };
    onSendMessage("📋 Lista", "list", { list });
    setShowListForm(false);
    setListTitle(""); setListButton("Ver opções");
    setListRows([{ id: "1", title: "", description: "" }, { id: "2", title: "", description: "" }]);
  };

  const closeAllForms = () => {
    setShowAttachMenu(false);
    setShowLocationForm(false);
    setShowContactForm(false);
    setShowPollForm(false);
    setShowListForm(false);
    setShowEmojiPicker(false);
  };

  const formInputClass = "w-full bg-muted rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring";
  const formBtnClass = "px-4 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors";

  // If media preview is active, show fullscreen-ish preview panel
  if (mediaPreview) {
    return (
      <div className="border-t border-border bg-card">
        <div className="relative flex flex-col items-center p-4 bg-muted/30">
          <button onClick={cancelMediaPreview} className="absolute top-2 right-2 p-1.5 rounded-full bg-card/80 hover:bg-card text-muted-foreground hover:text-foreground z-10 shadow-sm">
            <X className="h-4 w-4" />
          </button>
          {mediaPreview.type === "image" ? (
            <img src={mediaPreview.previewUrl} alt="Preview" className="max-h-60 max-w-full rounded-lg object-contain shadow-md" />
          ) : (
            <video src={mediaPreview.previewUrl} controls className="max-h-60 max-w-full rounded-lg shadow-md" />
          )}
          <p className="text-[11px] text-muted-foreground mt-2 truncate max-w-[300px]">{mediaPreview.file.name} ({(mediaPreview.file.size / 1024).toFixed(0)} KB)</p>
        </div>
        <div className="flex items-center gap-2 p-3">
          <input
            value={mediaCaption}
            onChange={(e) => setMediaCaption(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMediaPreview(); } }}
            placeholder="Adicione uma legenda..."
            className="flex-1 bg-muted rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            autoFocus
          />
          <button
            onClick={handleSendMediaPreview}
            disabled={uploading}
            className="p-2.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-card">
      {/* Reply preview */}
      {replyingTo && (
        <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 border-b border-border">
          <div className="w-1 h-8 rounded-full bg-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-primary">{replyingTo.sender}</p>
            <p className="text-xs text-muted-foreground truncate">{replyingTo.content}</p>
          </div>
          <button onClick={onCancelReply} className="p-1 rounded hover:bg-muted">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      )}

      {/* Forms overlay */}
      {showLocationForm && (
        <div className="p-3 space-y-2 border-b border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Enviar Localização</span>
            <button onClick={() => setShowLocationForm(false)} className="p-1 rounded hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
          </div>
          {getClinicLocation() && (
            <button
              onClick={() => {
                const clinic = getClinicLocation()!;
                const loc: LocationData = {
                  latitude: -23.5505,
                  longitude: -46.6333,
                  name: clinic.name,
                  address: `${clinic.address}${clinic.city ? `, ${clinic.city}` : ""}${clinic.state ? ` - ${clinic.state}` : ""}`,
                };
                onSendMessage(`📍 ${clinic.name}\n${clinic.address}${clinic.googleMapsUrl ? `\n🗺️ ${clinic.googleMapsUrl}` : ""}`, "location", { location: loc });
                setShowLocationForm(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-chart-2/10 border border-chart-2/30 text-sm font-medium text-chart-2 hover:bg-chart-2/20 transition-colors"
            >
              <MapPin className="h-4 w-4" />
              Enviar localização da clínica
            </button>
          )}
          <input value={locName} onChange={e => setLocName(e.target.value)} placeholder="Nome do local" className={formInputClass} />
          <input value={locAddress} onChange={e => setLocAddress(e.target.value)} placeholder="Endereço" className={formInputClass} />
          <div className="flex gap-2">
            <input value={locLat} onChange={e => setLocLat(e.target.value)} placeholder="Latitude" className={formInputClass} />
            <input value={locLng} onChange={e => setLocLng(e.target.value)} placeholder="Longitude" className={formInputClass} />
          </div>
          <button onClick={sendLocation} className={formBtnClass}>Enviar Localização Manual</button>
        </div>
      )}

      {showContactForm && (
        <div className="p-3 space-y-2 border-b border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5"><UserCircle className="h-3.5 w-3.5" /> Enviar Contato</span>
            <button onClick={() => setShowContactForm(false)} className="p-1 rounded hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
          </div>
          <input value={ctName} onChange={e => setCtName(e.target.value)} placeholder="Nome completo *" className={formInputClass} />
          <input value={ctPhone} onChange={e => setCtPhone(e.target.value)} placeholder="Telefone *" className={formInputClass} />
          <input value={ctEmail} onChange={e => setCtEmail(e.target.value)} placeholder="E-mail" className={formInputClass} />
          <input value={ctCompany} onChange={e => setCtCompany(e.target.value)} placeholder="Empresa" className={formInputClass} />
          <input value={ctUrl} onChange={e => setCtUrl(e.target.value)} placeholder="URL" className={formInputClass} />
          <button onClick={sendContact} className={formBtnClass}>Enviar Contato</button>
        </div>
      )}

      {showPollForm && (
        <div className="p-3 space-y-2 border-b border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> Criar Enquete</span>
            <button onClick={() => setShowPollForm(false)} className="p-1 rounded hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
          </div>
          <input value={pollQuestion} onChange={e => setPollQuestion(e.target.value)} placeholder="Pergunta da enquete *" className={formInputClass} />
          {pollOptions.map((opt, i) => (
            <input key={i} value={opt} onChange={e => { const o = [...pollOptions]; o[i] = e.target.value; setPollOptions(o); }} placeholder={`Opção ${i + 1} ${i < 2 ? "*" : ""}`} className={formInputClass} />
          ))}
          <div className="flex gap-2">
            <button onClick={() => setPollOptions([...pollOptions, ""])} className="text-xs text-primary hover:underline">+ Adicionar opção</button>
          </div>
          <button onClick={sendPoll} className={formBtnClass}>Enviar Enquete</button>
        </div>
      )}

      {showListForm && (
        <div className="p-3 space-y-2 border-b border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5"><List className="h-3.5 w-3.5" /> Enviar Lista</span>
            <button onClick={() => setShowListForm(false)} className="p-1 rounded hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
          </div>
          <input value={listTitle} onChange={e => setListTitle(e.target.value)} placeholder="Título da lista *" className={formInputClass} />
          <input value={listButton} onChange={e => setListButton(e.target.value)} placeholder="Texto do botão" className={formInputClass} />
          {listRows.map((row, i) => (
            <div key={i} className="flex gap-2">
              <input value={row.title} onChange={e => { const r = [...listRows]; r[i] = { ...r[i], title: e.target.value }; setListRows(r); }} placeholder={`Item ${i + 1} *`} className={formInputClass} />
              <input value={row.description || ""} onChange={e => { const r = [...listRows]; r[i] = { ...r[i], description: e.target.value }; setListRows(r); }} placeholder="Descrição" className={formInputClass} />
            </div>
          ))}
          <button onClick={() => setListRows([...listRows, { id: String(listRows.length + 1), title: "", description: "" }])} className="text-xs text-primary hover:underline">+ Adicionar item</button>
          <button onClick={sendList} className={formBtnClass}>Enviar Lista</button>
        </div>
      )}

      {/* Attach menu */}
      {showAttachMenu && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
          {[
            { icon: Image, label: "Imagem", onClick: () => { imageInputRef.current?.click(); closeAllForms(); } },
            { icon: Video, label: "Vídeo", onClick: () => { videoInputRef.current?.click(); closeAllForms(); } },
            { icon: FileText, label: "Documento", onClick: () => { fileInputRef.current?.click(); closeAllForms(); } },
            { icon: MapPin, label: "Localização", onClick: () => { closeAllForms(); setShowLocationForm(true); } },
            { icon: UserCircle, label: "Contato", onClick: () => { closeAllForms(); setShowContactForm(true); } },
            { icon: BarChart3, label: "Enquete", onClick: () => { closeAllForms(); setShowPollForm(true); } },
            { icon: Sticker, label: "Sticker", onClick: () => { onSendMessage("😊", "sticker", { stickerUrl: "😊" }); closeAllForms(); } },
            { icon: List, label: "Lista", onClick: () => { closeAllForms(); setShowListForm(true); } },
          ].map(({ icon: Icon, label, onClick }) => (
            <button key={label} onClick={onClick} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-accent text-muted-foreground hover:text-accent-foreground transition-colors">
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      )}

      {/* Emoji quick picker */}
      {showEmojiPicker && (
        <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-muted/30">
          {QUICK_EMOJIS.map(emoji => (
            <button key={emoji} onClick={() => { setMessage(m => m + emoji); setShowEmojiPicker(false); }} className="text-xl hover:scale-125 transition-transform p-1">
              {emoji}
            </button>
          ))}
        </div>
      )}

      <div className="p-3">
        {/* Formatting toolbar */}
        {message.length > 0 && (
          <div className="flex items-center gap-1 mb-2 px-1">
            {[
              { icon: Bold, format: "bold", title: "*negrito*" },
              { icon: Italic, format: "italic", title: "_itálico_" },
              { icon: Strikethrough, format: "strikethrough", title: "~riscado~" },
              { icon: Code, format: "monospace", title: "```código```" },
            ].map(({ icon: Icon, format, title }) => (
              <button key={format} onClick={() => applyFormatting(format)} title={title} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <button
            onClick={() => { setShowAttachMenu(!showAttachMenu); setShowEmojiPicker(false); }}
            className="p-2.5 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
          >
            <Paperclip className="h-5 w-5" />
          </button>

          <div className="flex-1 flex items-end gap-2 relative">
            {/* Quick Replies Dropdown */}
            {showQuickReplies && filteredQuickReplies.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-xl shadow-lg max-h-60 overflow-y-auto z-50">
                <div className="p-2 border-b border-border">
                  <p className="text-[11px] text-muted-foreground font-medium flex items-center gap-1">
                    <Zap className="h-3 w-3" /> Respostas Rápidas
                  </p>
                </div>
                {filteredQuickReplies.map((qr) => (
                  <button
                    key={qr.id}
                    onClick={() => selectQuickReply(qr)}
                    className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{qr.title}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{qr.category}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{qr.content}</p>
                  </button>
                ))}
              </div>
            )}

            <textarea
              value={message}
              onChange={(e) => handleMessageChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={disabled ? "Selecione um atendimento" : 'Digite "/" para respostas rápidas...'}
              disabled={disabled}
              rows={1}
              className="flex-1 resize-none bg-muted rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[40px] max-h-[120px] disabled:opacity-50"
            />
            {message.length === 0 ? (
              <AudioRecorder onRecordingComplete={handleAudioComplete} />
            ) : (
              <button
                onClick={handleSend}
                className="p-2.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
              >
                <Send className="h-5 w-5" />
              </button>
            )}
          </div>

          <button
            onClick={() => { setShowEmojiPicker(!showEmojiPicker); setShowAttachMenu(false); }}
            className="p-2.5 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
          >
            <Smile className="h-5 w-5" />
          </button>
        </div>
      </div>

      <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => handleFileSelect(e, "document")} />
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFileSelect(e, "image")} />
      <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => handleFileSelect(e, "video")} />
    </div>
  );
}
