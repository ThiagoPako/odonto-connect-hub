import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Printer, Send, FileDown, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import odontogramaFullAsset from "@/assets/odontograma-full.png.asset.json";
import odontogramaAdultoAsset from "@/assets/odontograma-adulto.png.asset.json";

type ToothPos = { n: number; x: number };

type PedidoExameSearch = { prontuarioId?: string };

export const Route = createFileRoute("/pedido-exame")({
  validateSearch: (s: Record<string, unknown>): PedidoExameSearch => ({
    prontuarioId: typeof s.prontuarioId === "string" ? s.prontuarioId : undefined,
  }),
  component: PedidoExamePage,
});

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-orange-600 text-white px-3 py-1.5 text-xs font-bold uppercase tracking-wide rounded-t-sm inline-flex items-center gap-2">
      <span className="size-3 border-2 border-white bg-white/10 rounded-sm" />
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-orange-500 text-white px-3 py-1 text-xs font-bold uppercase rounded-sm inline-block">
      {children}
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-[13px] text-slate-700 hover:text-orange-700">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(!!v)}
        className="size-4 rounded-sm border-orange-400 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
      />
      {label}
    </label>
  );
}

function PedidoExamePage() {
  const printAreaRef = useRef<HTMLDivElement>(null);

  const syncPrintScale = useCallback(() => {
    if (typeof window === "undefined") return;
    const content = document.getElementById("print-content");
    if (!content) return;
    const CONTENT_WIDTH_PX = 1100;
    const A4_INNER_WIDTH_PX = (200 * 96) / 25.4;
    const A4_INNER_HEIGHT_PX = (287 * 96) / 25.4;
    const previousTransform = content.style.transform;
    content.style.transform = "none";
    const contentHeight = Math.max(content.scrollHeight, content.offsetHeight, 1);
    content.style.transform = previousTransform;
    const scaleX = A4_INNER_WIDTH_PX / CONTENT_WIDTH_PX;
    const scaleY = A4_INNER_HEIGHT_PX / contentHeight;
    const scale = Math.min(scaleX, scaleY) * 0.98;
    document.documentElement.style.setProperty("--print-scale", `${scale.toFixed(4)}`);
  }, []);

  // Header fields
  const [paciente, setPaciente] = useState("");
  const [endereco, setEndereco] = useState("");
  const [fone, setFone] = useState("");
  const [cpf, setCpf] = useState("");
  const [dataNasc, setDataNasc] = useState("");
  const [doutor, setDoutor] = useState("");
  const [cro, setCro] = useState("");

  // Odontograma
  const [teethSel, setTeethSel] = useState<Set<number>>(new Set());
  const toggleTooth = (n: number) => {
    setTeethSel((prev) => {
      const next = new Set(prev);
      next.has(n) ? next.delete(n) : next.add(n);
      return next;
    });
  };

  // Tomografia teeth
  const [tomoSel, setTomoSel] = useState<Set<number>>(new Set());
  const toggleTomo = (n: number) => {
    setTomoSel((prev) => {
      const next = new Set(prev);
      next.has(n) ? next.delete(n) : next.add(n);
      return next;
    });
  };

  const [chk, setChk] = useState<Record<string, boolean>>({});
  const set = (k: string) => (v: boolean) => setChk((p) => ({ ...p, [k]: v }));
  const get = (k: string) => !!chk[k];

  const [obs, setObs] = useState("");
  const [analise, setAnalise] = useState("");

  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<Array<{ name: string; url: string; path: string; file?: File }>>([]);

  const handleImprimir = async () => {
    const images = Array.from(printAreaRef.current?.querySelectorAll("img") ?? []);
    await Promise.all(
      images.map(async (image) => {
        if (image.complete && image.naturalWidth > 0) return;
        await image.decode?.().catch(() => undefined);
      }),
    );
    syncPrintScale();
    const originalTitle = document.title;
    const nomeArquivo = (paciente?.trim() || "pedido-exame").replace(/[\\/:*?"<>|]/g, "");
    document.title = nomeArquivo;
    const restore = () => {
      document.title = originalTitle;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.requestAnimationFrame(() => {
      syncPrintScale();
      window.print();
    });
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncOnNextFrame = () => window.requestAnimationFrame(syncPrintScale);
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncOnNextFrame) : null;
    const target = document.getElementById("print-content");
    if (target && resizeObserver) resizeObserver.observe(target);
    syncOnNextFrame();
    window.addEventListener("beforeprint", syncPrintScale);
    window.addEventListener("resize", syncOnNextFrame);
    window.addEventListener("load", syncPrintScale);
    return () => {
      window.removeEventListener("beforeprint", syncPrintScale);
      window.removeEventListener("resize", syncOnNextFrame);
      window.removeEventListener("load", syncPrintScale);
      resizeObserver?.disconnect();
      document.documentElement.style.removeProperty("--print-scale");
    };
  }, [syncPrintScale]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? "anon";
      const novos: Array<{ name: string; url: string; path: string; file?: File }> = [];
      for (const file of files) {
        const path = `${uid}/pedidos/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
        const { error } = await supabase.storage.from("exam-images").upload(path, file, {
          cacheControl: "3600",
          upsert: false,
        });
        if (error) {
          toast.error(`Falha ao enviar ${file.name}: ${error.message}`);
          continue;
        }
        const { data: pub } = supabase.storage.from("exam-images").getPublicUrl(path);
        novos.push({ name: file.name, url: pub.publicUrl, path, file });
      }
      if (novos.length) {
        setUploads((prev) => [...prev, ...novos]);
        toast.success(`${novos.length} arquivo(s) enviado(s)`);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeUpload = async (path: string) => {
    await supabase.storage.from("exam-images").remove([path]);
    setUploads((prev) => prev.filter((u) => u.path !== path));
  };

  const buildTiposExame = (): string[] => {
    const tipos: string[] = [];
    if (get("peri_total") || get("peri_indicados")) tipos.push("Periapical");
    if (get("int_pre_d") || get("int_pre_e") || get("int_mol_d") || get("int_mol_e")) tipos.push("Interproximais");
    if (get("pan_conv") || get("pan_tracado") || get("pan_laudo") || get("pan_carpal")) tipos.push("Panorâmica");
    if (get("tele_lateral") || get("tele_frontal") || get("tele_s_analise") || get("tele_c_analise")) tipos.push("Telerradiografia");
    if (
      get("tomo_implante") || get("tomo_fratura") || get("tomo_perf") || get("tomo_retido") ||
      get("tomo_supra") || get("tomo_patolog") || get("tomo_enxerto") || get("tomo_regiao") ||
      get("tomo_maxila") || get("tomo_mandibula") || get("tomo_seios") || get("tomo_atm") ||
      tomoSel.size > 0
    ) tipos.push("Tomografia");
    if (get("doc_t1") || get("doc_t2") || get("doc_t3") || get("doc_t4") || get("doc_t5")) tipos.push("Documentação Ortodôntica");
    if (get("mod_estudo") || get("mod_trabalho")) tipos.push("Modelo");
    if (get("foto_extra") || get("foto_intra") || get("foto_outros")) tipos.push("Fotografias");
    return tipos;
  };

  const handleSalvar = async () => {
    if (!paciente.trim()) return toast.error("Informe o nome do paciente");
    const tipos = buildTiposExame();
    if (tipos.length === 0) return toast.error("Selecione ao menos um exame");

    setSaving(true);
    try {
      let pacienteId: string | null = null;
      const cpfTrim = cpf.trim();
      if (cpfTrim) {
        const { data: existente } = await supabase
          .from("pacientes")
          .select("id")
          .eq("cpf", cpfTrim)
          .maybeSingle();
        if (existente?.id) pacienteId = existente.id;
      }

      const pacientePayload: any = {
        nome: paciente.trim(),
        cpf: cpfTrim || null,
        telefone: fone.trim() || null,
        endereco: endereco.trim() || null,
        data_nascimento: dataNasc || null,
      };

      if (pacienteId) {
        await supabase.from("pacientes").update(pacientePayload).eq("id", pacienteId);
      } else {
        const { data: novo, error: errPac } = await supabase
          .from("pacientes")
          .insert(pacientePayload)
          .select("id")
          .single();
        if (errPac) throw errPac;
        pacienteId = novo?.id ?? null;
      }

      const obsResumo = [
        fone && `Fone: ${fone}`,
        dataNasc && `Nasc: ${dataNasc}`,
        doutor && `Dr(a): ${doutor}`,
        cro && `CRO: ${cro}`,
        teethSel.size > 0 && `Dentes: ${Array.from(teethSel).sort((a,b)=>a-b).join(", ")}`,
        tomoSel.size > 0 && `Tomo: ${Array.from(tomoSel).sort((a,b)=>a-b).join(", ")}`,
        obs && `Obs: ${obs}`,
      ].filter(Boolean).join(" | ");

      const rows = tipos.map((t) => ({
        paciente_id: pacienteId,
        paciente_nome: paciente.trim(),
        tipo_exame: t,
        status: "pendente",
        observacoes: obsResumo || null,
      }));
      const { error } = await supabase.from("exames").insert(rows as any);
      if (error) throw error;

      toast.success(`Paciente cadastrado e pedido salvo (${rows.length} ${rows.length === 1 ? "exame" : "exames"})`);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao cadastrar paciente / salvar pedido");
    } finally {
      setSaving(false);
    }
  };

  const handleEnviar = () => {
    if (!paciente) return toast.error("Informe o nome do paciente");
    toast.success("Pedido enviado para o laboratório");
  };

  // Tooth positions over the odontograma image
  type T = { n: number; x: number; y: number };
  const allTeeth: T[] = [
    { n: 18, x: 6.84, y: 11.26 }, { n: 17, x: 13.26, y: 10.76 }, { n: 16, x: 19.41, y: 11.26 },
    { n: 15, x: 24.98, y: 11.52 }, { n: 14, x: 30.83, y: 11.52 }, { n: 13, x: 36.13, y: 11.74 },
    { n: 12, x: 41.68, y: 12.00 }, { n: 11, x: 47.70, y: 11.74 },
    { n: 21, x: 53.85, y: 11.77 }, { n: 22, x: 59.57, y: 12.00 }, { n: 23, x: 64.97, y: 12.23 },
    { n: 24, x: 70.41, y: 12.49 }, { n: 25, x: 75.98, y: 12.24 }, { n: 26, x: 81.98, y: 11.27 },
    { n: 27, x: 87.99, y: 11.52 }, { n: 28, x: 93.70, y: 10.75 },
    { n: 55, x: 24.84, y: 32.73 }, { n: 54, x: 31.27, y: 34.47 }, { n: 53, x: 36.84, y: 34.46 },
    { n: 52, x: 41.84, y: 34.72 }, { n: 51, x: 47.27, y: 34.48 },
    { n: 61, x: 53.55, y: 34.97 }, { n: 62, x: 59.12, y: 34.98 }, { n: 63, x: 64.41, y: 35.19 },
    { n: 64, x: 69.84, y: 35.22 }, { n: 65, x: 76.13, y: 34.47 },
    { n: 85, x: 23.56, y: 61.36 }, { n: 84, x: 30.69, y: 61.37 }, { n: 83, x: 36.70, y: 61.88 },
    { n: 82, x: 41.99, y: 62.38 }, { n: 81, x: 47.40, y: 62.38 },
    { n: 71, x: 53.70, y: 63.10 }, { n: 72, x: 58.98, y: 63.09 }, { n: 73, x: 64.41, y: 63.11 },
    { n: 74, x: 70.12, y: 62.12 }, { n: 75, x: 76.98, y: 62.13 },
    { n: 48, x: 6.28, y: 81.60 }, { n: 47, x: 13.26, y: 82.37 }, { n: 46, x: 19.70, y: 82.89 },
    { n: 45, x: 25.98, y: 84.11 }, { n: 44, x: 31.69, y: 84.57 }, { n: 43, x: 37.27, y: 85.09 },
    { n: 42, x: 42.55, y: 84.57 }, { n: 41, x: 47.55, y: 84.57 },
    { n: 31, x: 53.27, y: 84.11 }, { n: 32, x: 58.13, y: 84.58 }, { n: 33, x: 63.41, y: 85.09 },
    { n: 34, x: 69.12, y: 84.83 }, { n: 35, x: 74.71, y: 84.57 }, { n: 36, x: 81.13, y: 83.35 },
    { n: 37, x: 87.41, y: 82.13 }, { n: 38, x: 94.26, y: 81.62 },
  ];
  const selectedSorted = Array.from(teethSel).sort((a, b) => a - b);

  type TT = { n: number; x: number; y: number };
  const tomoTeeth: TT[] = [
    { n: 18, x: 4.63, y: 32.49 }, { n: 17, x: 11.72, y: 33.46 }, { n: 16, x: 18.94, y: 32.25 },
    { n: 15, x: 25.73, y: 31.75 }, { n: 14, x: 31.88, y: 32.26 }, { n: 13, x: 37.82, y: 31.75 },
    { n: 12, x: 43.97, y: 32.01 }, { n: 11, x: 49.49, y: 31.51 }, { n: 21, x: 54.57, y: 31.77 },
    { n: 22, x: 59.77, y: 32.00 }, { n: 23, x: 65.81, y: 31.51 }, { n: 24, x: 71.32, y: 32.52 },
    { n: 25, x: 77.16, y: 32.26 }, { n: 26, x: 83.19, y: 32.51 }, { n: 27, x: 89.57, y: 33.47 },
    { n: 28, x: 95.39, y: 32.74 },
    { n: 48, x: 4.83, y: 75.24 }, { n: 47, x: 11.95, y: 74.45 }, { n: 46, x: 19.46, y: 75.45 },
    { n: 45, x: 26.48, y: 75.19 }, { n: 44, x: 33.05, y: 75.45 }, { n: 43, x: 38.77, y: 75.22 },
    { n: 42, x: 44.38, y: 75.46 }, { n: 41, x: 49.48, y: 75.45 }, { n: 31, x: 54.78, y: 74.96 },
    { n: 32, x: 60.20, y: 75.22 }, { n: 33, x: 65.70, y: 75.45 }, { n: 34, x: 71.12, y: 75.71 },
    { n: 35, x: 76.64, y: 75.72 }, { n: 36, x: 82.89, y: 74.24 }, { n: 37, x: 89.57, y: 74.47 },
    { n: 38, x: 96.03, y: 74.97 },
  ];
  const tomoSorted = Array.from(tomoSel).sort((a, b) => a - b);

  return (
    <div className="bg-slate-100 min-h-full p-4">
      <style>{`
        @media print {
          @page { size: 210mm 297mm; margin: 0; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; forced-color-adjust: none !important; }
          html, body, #root { width: 210mm !important; height: 297mm !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; background: #fff !important; }
          body * { visibility: hidden !important; }
          .no-print, .no-print * { display: none !important; visibility: hidden !important; }
          #print-area, #print-area * { visibility: visible !important; }
          #print-area { position: fixed !important; left: 5mm !important; top: 5mm !important; width: 200mm !important; height: 287mm !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; box-sizing: border-box !important; box-shadow: none !important; border: 1px solid rgb(253 186 116) !important; border-radius: 0 !important; background: #fff !important; transform: none !important; }
          #print-content { width: 1100px !important; max-width: none !important; transform-origin: top left !important; transform: scale(var(--print-scale, 0.5)) !important; }
        }
      `}</style>
      <div ref={printAreaRef} id="print-area" className="max-w-[1100px] mx-auto bg-white shadow-xl rounded-md overflow-hidden border border-slate-200">
        <div className="no-print flex items-center justify-between px-4 py-2 bg-slate-50 border-b">
          <h1 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Pedido de Exame</h1>
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleUpload} accept="image/*,application/pdf" />
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              <Upload className="size-4 mr-1" /> {uploading ? "Enviando..." : "Upload"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleImprimir}>
              <Printer className="size-4 mr-1" /> Imprimir
            </Button>
            <Button variant="outline" size="sm" onClick={handleSalvar} disabled={saving}>
              <FileDown className="size-4 mr-1" /> {saving ? "Salvando..." : "Cadastrar"}
            </Button>
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600" onClick={handleEnviar}>
              <Send className="size-4 mr-1" /> Enviar
            </Button>
          </div>
        </div>
        {uploads.length > 0 && (
          <div className="no-print px-4 py-2 bg-slate-50 border-b flex flex-wrap gap-2">
            {uploads.map((u) => (
              <div key={u.path} className="inline-flex items-center gap-1 text-xs bg-white border rounded px-2 py-1 hover:bg-slate-100">
                <FileDown className="size-3" /> {u.name}
                <button type="button" onClick={() => removeUpload(u.path)} className="ml-1 text-slate-400 hover:text-red-500">
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div id="print-content">
          {/* Patient header */}
          <div className="bg-gradient-to-b from-orange-50 to-orange-100/60 p-4 space-y-2 border-b-2 border-orange-300">
            <div className="grid grid-cols-[110px_1fr_110px_220px] gap-2 items-center">
              <FieldLabel>Paciente:</FieldLabel>
              <Input value={paciente} onChange={(e) => setPaciente(e.target.value)} className="h-7 bg-white border-orange-200" />
              <FieldLabel>CPF:</FieldLabel>
              <Input value={cpf} onChange={(e) => setCpf(e.target.value)} className="h-7 bg-white border-orange-200" />
            </div>
            <div className="grid grid-cols-[110px_1fr] gap-2 items-center">
              <FieldLabel>Endereço:</FieldLabel>
              <Input value={endereco} onChange={(e) => setEndereco(e.target.value)} className="h-7 bg-white border-orange-200" />
            </div>
            <div className="grid grid-cols-[110px_1fr_140px_1fr] gap-2 items-center">
              <FieldLabel>Fone:</FieldLabel>
              <Input value={fone} onChange={(e) => setFone(e.target.value)} className="h-7 bg-white border-orange-200" />
              <FieldLabel>Data de Nasc.:</FieldLabel>
              <Input type="date" value={dataNasc} onChange={(e) => setDataNasc(e.target.value)} className="h-7 bg-white border-orange-200" />
            </div>
            <div className="grid grid-cols-[110px_1fr_110px_220px] gap-2 items-center">
              <FieldLabel>Dr(a):</FieldLabel>
              <Input value={doutor} onChange={(e) => setDoutor(e.target.value)} className="h-7 bg-white border-orange-200" />
              <FieldLabel>CRO:</FieldLabel>
              <Input value={cro} onChange={(e) => setCro(e.target.value)} className="h-7 bg-white border-orange-200" />
            </div>
          </div>

          {/* PERIAPICAL + INTERPROXIMAIS + Odontograma */}
          <div className="grid grid-cols-[260px_1fr] border-b-2 border-orange-300">
            <div className="p-3 border-r border-orange-200 space-y-3 bg-orange-50/40">
              <div>
                <SectionHeader>Periapical</SectionHeader>
                <div className="pl-2 pt-2 space-y-1">
                  <CheckRow checked={get("peri_total")} onChange={set("peri_total")} label="Total (Checkup)" />
                  <CheckRow checked={get("peri_indicados")} onChange={set("peri_indicados")} label="Dentes indicados" />
                  <CheckRow checked={get("peri_impresso")} onChange={set("peri_impresso")} label="Exame Impresso" />
                  <CheckRow checked={get("peri_email")} onChange={set("peri_email")} label="Exame Via E-mail" />
                </div>
              </div>
              <div>
                <SectionHeader>Interproximais</SectionHeader>
                <div className="pl-2 pt-2 space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] text-slate-700 w-20">Pré-molares</span>
                    <CheckRow checked={get("int_pre_d")} onChange={set("int_pre_d")} label="D" />
                    <CheckRow checked={get("int_pre_e")} onChange={set("int_pre_e")} label="E" />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] text-slate-700 w-20">Molares</span>
                    <CheckRow checked={get("int_mol_d")} onChange={set("int_mol_d")} label="D" />
                    <CheckRow checked={get("int_mol_e")} onChange={set("int_mol_e")} label="E" />
                  </div>
                  <CheckRow checked={get("int_impresso")} onChange={set("int_impresso")} label="Exame Impresso" />
                  <CheckRow checked={get("int_email")} onChange={set("int_email")} label="Exame Via E-mail" />
                </div>
              </div>
            </div>

            <div className="p-3 relative">
              <div className="relative w-full">
                <img src={odontogramaFullAsset.url} alt="Odontograma" className="w-full h-auto select-none pointer-events-none" draggable={false} />
                {allTeeth.map(({ n, x, y }) => {
                  const checked = teethSel.has(n);
                  return (
                    <button key={n} type="button" onClick={() => toggleTooth(n)} title={`Dente ${n}`}
                      className={cn(
                        "absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border transition-colors",
                        checked ? "bg-orange-500 border-orange-600" : "bg-white/90 border-slate-400 hover:border-orange-500"
                      )}
                      style={{ left: `${x}%`, top: `${y}%` }} />
                  );
                })}
              </div>
              <div className="mt-2 min-h-[28px] text-xs text-slate-700">
                <span className="font-semibold text-slate-600">Dentes selecionados: </span>
                {selectedSorted.length === 0 ? (
                  <span className="text-slate-400">nenhum</span>
                ) : (
                  <span className="font-mono text-orange-700">{selectedSorted.join(", ")}</span>
                )}
              </div>
            </div>
          </div>

          {/* PANORÂMICA + TELERRADIOGRAFIA */}
          <div className="grid grid-cols-2 border-b-2 border-orange-300">
            <div className="p-3 border-r border-orange-200">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <SectionHeader>Panorâmica</SectionHeader>
                <CheckRow checked={get("pan_laudo")} onChange={set("pan_laudo")} label="COM LAUDO" />
                <CheckRow checked={get("pan_carpal")} onChange={set("pan_carpal")} label="Carpal" />
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 pl-2">
                <CheckRow checked={get("pan_conv")} onChange={set("pan_conv")} label="Panorâmica Convencional" />
                <CheckRow checked={get("pan_impresso")} onChange={set("pan_impresso")} label="Exame Impresso" />
                <CheckRow checked={get("pan_tracado")} onChange={set("pan_tracado")} label="Panorâmica com Traçado para Implante" />
                <CheckRow checked={get("pan_email")} onChange={set("pan_email")} label="Exame Via E-mail" />
              </div>
            </div>
            <div className="p-3">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <SectionHeader>Telerradiografia</SectionHeader>
                <CheckRow checked={get("tele_lateral")} onChange={set("tele_lateral")} label="Lateral" />
                <CheckRow checked={get("tele_frontal")} onChange={set("tele_frontal")} label="Frontal" />
              </div>
              <div className="pl-2 space-y-1">
                <CheckRow checked={get("tele_s_analise")} onChange={set("tele_s_analise")} label="S/ Análise" />
                <div className="flex items-center gap-2">
                  <CheckRow checked={get("tele_c_analise")} onChange={set("tele_c_analise")} label="Análise" />
                  <Input value={analise} onChange={(e) => setAnalise(e.target.value)} className="h-7 bg-white border-orange-200 flex-1" />
                </div>
              </div>
            </div>
          </div>

          {/* TOMOGRAFIA */}
          <div className="border-b-2 border-orange-300">
            <div className="p-3 grid grid-cols-[1fr_2fr] gap-4">
              <div>
                <SectionHeader>Tomografia Computadorizada</SectionHeader>
                <div className="mt-2 bg-orange-500 text-white px-3 py-1 text-xs font-bold uppercase rounded-sm inline-block">Finalidade do Exame</div>
                <div className="pl-2 mt-2 space-y-1">
                  {([
                    ["tomo_implante", "Implante"],
                    ["tomo_fratura", "Fratura Radicular"],
                    ["tomo_perf", "Perfuração / Trepanação"],
                    ["tomo_retido", "Dente Retido"],
                    ["tomo_supra", "Localização de Supra Numerário"],
                    ["tomo_patolog", "Área Patológica"],
                    ["tomo_enxerto", "Área Doadora para Enxerto"],
                    ["tomo_regiao", "Região Assinalada"],
                  ] as const).map(([k, l]) => (
                    <CheckRow key={k} checked={get(k)} onChange={set(k)} label={l} />
                  ))}
                </div>
              </div>
              <div>
                <div className="relative w-full select-none">
                  <img src={odontogramaAdultoAsset.url} alt="Odontograma adulto" className="w-full h-auto block pointer-events-none" draggable={false} />
                  {tomoTeeth.map(({ n, x, y }) => {
                    const checked = tomoSel.has(n);
                    return (
                      <button key={n} type="button" onClick={() => toggleTomo(n)}
                        className={cn(
                          "absolute -translate-x-1/2 -translate-y-1/2 size-3 rounded-[2px] border-2 transition-colors",
                          checked ? "bg-orange-500 border-orange-600" : "bg-white border-orange-400 hover:border-orange-600"
                        )}
                        style={{ left: `${x}%`, top: `${y}%` }}
                        aria-label={`Dente ${n}`} title={`Dente ${n}`} />
                    );
                  })}
                </div>
                <div className="mt-2 text-xs text-slate-700">
                  <span className="font-semibold">Dentes selecionados: </span>
                  {tomoSorted.length > 0 ? tomoSorted.join(", ") : "—"}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 px-3 pb-3 pt-1 border-t border-orange-200">
              <div className="space-y-1">
                <CheckRow checked={get("tomo_maxila")} onChange={set("tomo_maxila")} label="Maxila Total" />
                <CheckRow checked={get("tomo_mandibula")} onChange={set("tomo_mandibula")} label="Mandíbula Total" />
              </div>
              <div className="space-y-1">
                <CheckRow checked={get("tomo_seios")} onChange={set("tomo_seios")} label="Seios Maxilares" />
                <CheckRow checked={get("tomo_atm")} onChange={set("tomo_atm")} label="ATM Bilateral" />
              </div>
              <div className="space-y-1">
                <CheckRow checked={get("tomo_impresso")} onChange={set("tomo_impresso")} label="Exame Impresso" />
                <CheckRow checked={get("tomo_email")} onChange={set("tomo_email")} label="Exame Via E-mail" />
              </div>
            </div>
          </div>

          {/* DOCUMENTAÇÃO ORTODÔNTICA + MODELO */}
          <div className="grid grid-cols-[1.6fr_1fr] border-b-2 border-orange-300">
            <div className="p-3 border-r border-orange-200">
              <SectionHeader>Documentação Ortodôntica</SectionHeader>
              <div className="pl-2 pt-2 space-y-1">
                <CheckRow checked={get("doc_t1")} onChange={set("doc_t1")} label="Tipo I - Pan + Tele + Fotos + Periapicais Incisivos" />
                <CheckRow checked={get("doc_t2")} onChange={set("doc_t2")} label="Tipo II - Pan + Periapicais Incisivos + Tele + Modelo + Fotos" />
                <CheckRow checked={get("doc_t3")} onChange={set("doc_t3")} label="Tipo III - Pan + Periapicais Incisivos + Interproximais + Tele + Modelo + Fotos" />
                <CheckRow checked={get("doc_t4")} onChange={set("doc_t4")} label="Tipo IV - Pan + Checkup Periapical + Tele + Modelo + Fotos" />
                <CheckRow checked={get("doc_t5")} onChange={set("doc_t5")} label="Tipo V - Pan + Checkup Periapical + Interproximais + Tele + Modelo + Fotos" />
              </div>
            </div>
            <div className="p-3">
              <SectionHeader>Modelo</SectionHeader>
              <div className="pl-2 pt-2 space-y-1">
                <CheckRow checked={get("mod_estudo")} onChange={set("mod_estudo")} label="Estudo" />
                <CheckRow checked={get("mod_trabalho")} onChange={set("mod_trabalho")} label="Trabalho" />
              </div>
            </div>
          </div>

          {/* FOTOGRAFIAS + ANÁLISES */}
          <div className="grid grid-cols-[1fr_1.6fr] border-b-2 border-orange-300">
            <div className="p-3 border-r border-orange-200">
              <SectionHeader>Fotografias</SectionHeader>
              <div className="pl-2 pt-2 space-y-1">
                <CheckRow checked={get("foto_extra")} onChange={set("foto_extra")} label="Extrabucal" />
                <CheckRow checked={get("foto_intra")} onChange={set("foto_intra")} label="Intrabucal" />
                <div className="flex items-center gap-2">
                  <CheckRow checked={get("foto_outros")} onChange={set("foto_outros")} label="Outros" />
                  <Input className="h-7 bg-white border-orange-200 flex-1" />
                </div>
              </div>
            </div>
            <div className="p-3 grid grid-cols-[1fr_1.2fr] gap-4">
              <div>
                <SectionHeader>Análises</SectionHeader>
                <div className="pl-2 pt-2 space-y-1">
                  <CheckRow checked={get("an_dent")} onChange={set("an_dent")} label="Análise Dentária" />
                  <CheckRow checked={get("an_facial")} onChange={set("an_facial")} label="Análise Facial" />
                  <CheckRow checked={get("an_modelo")} onChange={set("an_modelo")} label="Análise de Modelo" />
                </div>
              </div>
              <div className="flex flex-col">
                <div className="flex-1 border border-slate-300 rounded-sm bg-slate-50" />
                <span className="text-[10px] text-slate-500 text-center mt-1">Carimbo / assinatura</span>
              </div>
            </div>
          </div>

          {/* OBS */}
          <div className="p-3 border-b-2 border-orange-300">
            <FieldLabel>OBS:</FieldLabel>
            <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3} className="mt-2 bg-white border-orange-200" />
          </div>

          <div className="px-3 py-2 bg-orange-500 text-white text-right text-xs font-bold uppercase tracking-wide flex items-center justify-end gap-2">
            <span className="size-3 border-2 border-white bg-white/10 rounded-sm" />
            Favor enviar mais solicitações de exames
          </div>
        </div>
      </div>
    </div>
  );
}
