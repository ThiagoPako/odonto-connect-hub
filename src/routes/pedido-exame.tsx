import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Printer, Send, FileDown, Upload, X } from "lucide-react";
import { mediaApi, pacientesApi } from "@/lib/vpsApi";
import { examesApi } from "@/lib/examesApi";
import { OdontogramaSelecao } from "@/components/OdontogramaSelecao";
import { parsePedidoFile } from "@/lib/pedidoExameParser";

type ToothPos = { n: number; x: number };

type PedidoExameSearch = { prontuarioId?: string };

export const Route = createFileRoute("/pedido-exame")({
  validateSearch: (s: Record<string, unknown>): PedidoExameSearch => ({
    prontuarioId: typeof s.prontuarioId === "string" ? s.prontuarioId : undefined,
  }),
  component: PedidoExamePage,
});

// Rótulos dos checkboxes que detalham o pedido; vão para as observações do exame salvo
const DETALHES_PEDIDO: Array<{ secao: string; itens: Array<[string, string]> }> = [
  { secao: "Periapical", itens: [["peri_total", "Total (checkup)"], ["peri_indicados", "Dentes indicados"], ["peri_impresso", "Exame impresso"], ["peri_email", "Exame via e-mail"]] },
  { secao: "Interproximais", itens: [["int_pre_d", "Pré-molares D"], ["int_pre_e", "Pré-molares E"], ["int_mol_d", "Molares D"], ["int_mol_e", "Molares E"], ["int_impresso", "Exame impresso"], ["int_email", "Exame via e-mail"]] },
  { secao: "Panorâmica", itens: [["pan_conv", "Convencional"], ["pan_tracado", "Com traçado para implante"], ["pan_laudo", "Com laudo"], ["pan_carpal", "Carpal"], ["pan_impresso", "Exame impresso"], ["pan_email", "Exame via e-mail"]] },
  { secao: "Telerradiografia", itens: [["tele_lateral", "Lateral"], ["tele_frontal", "Frontal"], ["tele_s_analise", "Sem análise"], ["tele_c_analise", "Com análise"]] },
  { secao: "Tomografia", itens: [["tomo_implante", "Implante"], ["tomo_fratura", "Fratura radicular"], ["tomo_perf", "Perfuração / trepanação"], ["tomo_retido", "Dente retido"], ["tomo_supra", "Supranumerário"], ["tomo_patolog", "Área patológica"], ["tomo_enxerto", "Área doadora para enxerto"], ["tomo_regiao", "Região assinalada"], ["tomo_maxila", "Maxila total"], ["tomo_mandibula", "Mandíbula total"], ["tomo_seios", "Seios maxilares"], ["tomo_atm", "ATM bilateral"], ["tomo_impresso", "Exame impresso"], ["tomo_email", "Exame via e-mail"]] },
  { secao: "Documentação ortodôntica", itens: [["doc_t1", "Tipo I"], ["doc_t2", "Tipo II"], ["doc_t3", "Tipo III"], ["doc_t4", "Tipo IV"], ["doc_t5", "Tipo V"]] },
  { secao: "Modelo", itens: [["mod_estudo", "Estudo"], ["mod_trabalho", "Trabalho"]] },
  { secao: "Fotografias", itens: [["foto_extra", "Extrabucal"], ["foto_intra", "Intrabucal"], ["foto_outros", "Outros"]] },
  { secao: "Análises", itens: [["an_dent", "Análise dentária"], ["an_facial", "Análise facial"], ["an_modelo", "Análise de modelo"]] },
];

const LINHAS_PERMANENTES_SUP = { titulo: "Superiores", dir: [18, 17, 16, 15, 14, 13, 12, 11], esq: [21, 22, 23, 24, 25, 26, 27, 28] };
const LINHAS_PERMANENTES_INF = { titulo: "Inferiores", dir: [48, 47, 46, 45, 44, 43, 42, 41], esq: [31, 32, 33, 34, 35, 36, 37, 38] };
const LINHAS_ODONTOGRAMA_FULL = [
  LINHAS_PERMANENTES_SUP,
  { titulo: "Decíduos superiores", dir: [55, 54, 53, 52, 51], esq: [61, 62, 63, 64, 65] },
  { titulo: "Decíduos inferiores", dir: [85, 84, 83, 82, 81], esq: [71, 72, 73, 74, 75] },
  LINHAS_PERMANENTES_INF,
];
const LINHAS_ODONTOGRAMA_ADULTO = [LINHAS_PERMANENTES_SUP, LINHAS_PERMANENTES_INF];

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
  const [fotoOutros, setFotoOutros] = useState("");

  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<Array<{ name: string; url: string; path: string; type: string; file?: File }>>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const applyParsed = useCallback(async (u: { name: string; file?: File; url: string; type: string }) => {
    if (!u.file) {
      toast.error("Arquivo não disponível para leitura nesta sessão. Refaça o upload.");
      return;
    }
    try {
      const parsed = await parsePedidoFile(u.file);
      if (parsed.paciente) setPaciente(parsed.paciente);
      if (parsed.cpf) setCpf(parsed.cpf);
      if (parsed.endereco) setEndereco(parsed.endereco);
      if (parsed.fone) setFone(parsed.fone);
      if (parsed.dataNasc) setDataNasc(parsed.dataNasc);
      if (parsed.doutor) setDoutor(parsed.doutor);
      if (parsed.cro) setCro(parsed.cro);
      if (parsed.obs) setObs(parsed.obs);
      if (parsed.analise) setAnalise(parsed.analise);
      setTeethSel(new Set(parsed.teeth));
      setTomoSel(new Set(parsed.tomoTeeth));
      setChk(parsed.checks);
      setActiveFile(u.name);
      toast.success(`Conteúdo de "${u.name}" aplicado ao pedido`);
    } catch (err: any) {
      toast.error(`Não foi possível ler ${u.name}: ${err?.message ?? "erro"}`);
    }
  }, []);

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
      const novos: Array<{ name: string; url: string; path: string; type: string; file?: File }> = [];
      for (const file of files) {
        // Arquivos ficam em /uploads/media da VPS; a URL serve como identificador.
        const { url, error } = await mediaApi.upload(file);
        if (error || !url) {
          toast.error(`Falha ao enviar ${file.name}: ${error || "sem URL"}`);
          continue;
        }
        novos.push({ name: file.name, url, path: url, type: file.type || "application/octet-stream", file });
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
      let pacienteNovo = false;
      const cpfTrim = cpf.trim();
      const { data: lista, error: listaError } = await pacientesApi.list();
      // Sem a lista, não dá para saber se o paciente já existe: parar evita cadastro duplicado
      if (listaError) throw new Error("Não foi possível verificar se o paciente já está cadastrado: " + listaError);
      type PacienteLista = { id: string; nome?: string | null; cpf?: string | null; telefone?: string | null };
      const pacientesLista: PacienteLista[] = Array.isArray(lista) ? (lista as PacienteLista[]) : [];
      const soDigitos = (v?: string | null) => (v || "").replace(/\D/g, "");
      const normalizaNome = (v?: string | null) =>
        (v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

      // Mesmo telefone em formatos diferentes (com/sem DDI 55, com/sem DDD) conta como igual:
      // compara só os últimos 8 dígitos, como o servidor faz
      const mesmoTelefone = (a?: string | null, b?: string | null) => {
        const da = soDigitos(a);
        const db = soDigitos(b);
        if (!da || !db) return true;
        return da.slice(-8) === db.slice(-8);
      };

      if (cpfTrim) {
        const existente = pacientesLista.find(
          (p) => p.cpf === cpfTrim || (soDigitos(p.cpf) !== "" && soDigitos(p.cpf) === soDigitos(cpfTrim)),
        );
        // Paciente já cadastrado: só vincula o pedido. Não atualiza a ficha, para não apagar
        // e-mail, convênio, observações etc. que o pedido de exame não tem.
        if (existente?.id) pacienteId = existente.id;
      }

      if (!pacienteId) {
        // Sem CPF, ou CPF não encontrado: procura pelo nome (e telefone, se informado) antes de
        // criar outro cadastro. Com CPF informado, só entram fichas que ainda não têm CPF
        // (comum em quem veio do WhatsApp/CRM).
        const nomeBusca = normalizaNome(paciente);
        const candidatos = pacientesLista.filter((p) => {
          if (normalizaNome(p.nome) !== nomeBusca) return false;
          if (cpfTrim && soDigitos(p.cpf) !== "") return false;
          if (fone.trim() && !mesmoTelefone(p.telefone, fone)) return false;
          return true;
        });
        if (candidatos.length > 0) {
          const c = candidatos[0];
          const extra = candidatos.length > 1 ? ` (há ${candidatos.length} cadastros com esse nome)` : "";
          const semCpf = cpfTrim ? ", sem CPF na ficha" : "";
          const usar = window.confirm(
            `Já existe um paciente chamado "${c.nome}"${c.telefone ? `, telefone ${c.telefone}` : ""}${semCpf}${extra}.\n\n` +
              "OK: vincular o pedido a esse paciente.\nCancelar: cadastrar um paciente novo.",
          );
          if (usar) pacienteId = c.id;
        }
      }

      if (!pacienteId) {
        const pacientePayload = {
          nome: paciente.trim(),
          cpf: cpfTrim || null,
          telefone: fone.trim() || null,
          endereco: endereco.trim() || null,
          data_nascimento: dataNasc || null,
        };
        const { data: novo, error: errPac } = await pacientesApi.create(pacientePayload);
        if (errPac) throw new Error(errPac);
        pacienteId = (novo as { id?: string } | null)?.id ?? null;
        pacienteNovo = true;
      }

      // Detalhes marcados no pedido (laudo, e-mail, finalidade etc.), por seção
      const detalhes = DETALHES_PEDIDO.map(({ secao, itens }) => {
        const marcados = itens.filter(([k]) => get(k)).map(([, l]) => l);
        return marcados.length ? `${secao}: ${marcados.join(", ")}` : null;
      }).filter(Boolean);
      if (fotoOutros.trim() && get("foto_outros")) detalhes.push(`Fotos (outros): ${fotoOutros.trim()}`);

      // Ficha já existente não é alterada: CPF e endereço digitados vão junto no pedido,
      // para não se perderem.
      const obsResumo = [
        !pacienteNovo && cpfTrim && `CPF: ${cpfTrim}`,
        !pacienteNovo && endereco.trim() && `End: ${endereco.trim()}`,
        fone && `Fone: ${fone}`,
        dataNasc && `Nasc: ${dataNasc}`,
        doutor && `Dr(a): ${doutor}`,
        cro && `CRO: ${cro}`,
        teethSel.size > 0 && `Dentes: ${Array.from(teethSel).sort((a,b)=>a-b).join(", ")}`,
        tomoSel.size > 0 && `Tomo: ${Array.from(tomoSel).sort((a,b)=>a-b).join(", ")}`,
        ...detalhes,
        analise.trim() && `Análise (tele): ${analise.trim()}`,
        obs && `Obs: ${obs}`,
      ].filter(Boolean).join(" | ");

      const rows = tipos.map((t) => ({
        paciente_id: pacienteId,
        tipo_nome: t,
        observacoes: obsResumo || null,
      }));
      // examesApi.create lança com a mensagem amigável do servidor (unwrap). Confere cada
      // exame: sem isso, uma falha no meio aborta o laço e esconde quais já foram salvos.
      const falhas: { tipo: string; erro: string }[] = [];
      for (const row of rows) {
        try {
          await examesApi.create(row);
        } catch (e) {
          falhas.push({ tipo: row.tipo_nome, erro: e instanceof Error ? e.message : "Erro ao salvar o exame." });
        }
      }

      if (falhas.length > 0) {
        const salvos = rows.length - falhas.length;
        const inicio = pacienteNovo ? "Paciente cadastrado, mas " : "";
        toast.error(
          `${inicio}${falhas.length} de ${rows.length} ${rows.length === 1 ? "exame não foi salvo" : "exames não foram salvos"}`,
          {
            description:
              `Não salvos: ${falhas.map((f) => f.tipo).join(", ")}. ${falhas[0].erro}` +
              (salvos > 0 ? ` Os outros ${salvos} já estão na ficha; ao tentar de novo, marque só os que faltaram.` : ""),
            duration: 15000,
          },
        );
        return;
      }

      const qtd = `${rows.length} ${rows.length === 1 ? "exame" : "exames"}`;
      toast.success(
        pacienteNovo
          ? `Paciente cadastrado e pedido salvo (${qtd})`
          : `Pedido salvo na ficha do paciente já cadastrado (${qtd})`,
        pacienteNovo
          ? undefined
          : { description: "O cadastro do paciente não foi alterado. Os dados digitados (CPF, telefone, endereço, nascimento) ficaram só nas observações do pedido." },
      );
    } catch (e: any) {
      toast.error(e?.message || "Erro ao cadastrar paciente / salvar pedido");
    } finally {
      setSaving(false);
    }
  };


  const selectedSorted = Array.from(teethSel).sort((a, b) => a - b);

  const tomoSorted = Array.from(tomoSel).sort((a, b) => a - b);

  return (
    <div className="bg-slate-100 min-h-full p-2 sm:p-4">
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
        <div className="no-print flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-slate-50 border-b">
          <h1 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Pedido de Exame</h1>
          <div className="flex flex-wrap items-center gap-2">
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
            {/* O envio ao laboratório ainda não existe: antes o botão só mostrava "enviado" */}
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600" disabled title="Envio direto ao laboratório ainda não está disponível. Use Cadastrar e imprima o pedido.">
              <Send className="size-4 mr-1" /> Enviar (em breve)
            </Button>
          </div>
        </div>
        {uploads.length > 0 && (
          <div className="no-print px-4 py-2 bg-slate-50 border-b flex flex-wrap gap-2">
            {uploads.map((u) => {
              const isActive = activeFile === u.name;
              return (
                <div key={u.path} className={cn(
                  "inline-flex items-center gap-1 text-xs border rounded px-2 py-1 transition-colors",
                  isActive ? "bg-orange-100 border-orange-400 text-orange-800" : "bg-white text-slate-700 hover:bg-slate-100"
                )}>
                  <button
                    type="button"
                    onClick={() => applyParsed(u)}
                    className="inline-flex items-center gap-1 max-w-[240px] truncate hover:text-orange-600"
                    title={`Ler e aplicar conteúdo de ${u.name}`}
                  >
                    <FileDown className="size-3 shrink-0" />
                    <span className="truncate">{u.name}</span>
                  </button>
                  <button type="button" onClick={() => removeUpload(u.path)} aria-label={`Remover ${u.name}`} className="ml-1 -my-1 inline-flex size-7 items-center justify-center rounded text-slate-400 hover:text-red-500">
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div id="print-content">
          {/* Patient header */}
          <div className="bg-gradient-to-b from-orange-50 to-orange-100/60 p-4 space-y-2 border-b-2 border-orange-300">
            <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr_110px_220px] gap-2 sm:items-center">
              <FieldLabel>Paciente:</FieldLabel>
              <Input value={paciente} onChange={(e) => setPaciente(e.target.value)} className="h-7 bg-white border-orange-200" />
              <FieldLabel>CPF:</FieldLabel>
              <Input value={cpf} onChange={(e) => setCpf(e.target.value)} className="h-7 bg-white border-orange-200" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr] gap-2 sm:items-center">
              <FieldLabel>Endereço:</FieldLabel>
              <Input value={endereco} onChange={(e) => setEndereco(e.target.value)} className="h-7 bg-white border-orange-200" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr_140px_1fr] gap-2 sm:items-center">
              <FieldLabel>Fone:</FieldLabel>
              <Input value={fone} onChange={(e) => setFone(e.target.value)} className="h-7 bg-white border-orange-200" />
              <FieldLabel>Data de Nasc.:</FieldLabel>
              <Input type="date" value={dataNasc} onChange={(e) => setDataNasc(e.target.value)} className="h-7 bg-white border-orange-200" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr_110px_220px] gap-2 sm:items-center">
              <FieldLabel>Dr(a):</FieldLabel>
              <Input value={doutor} onChange={(e) => setDoutor(e.target.value)} className="h-7 bg-white border-orange-200" />
              <FieldLabel>CRO:</FieldLabel>
              <Input value={cro} onChange={(e) => setCro(e.target.value)} className="h-7 bg-white border-orange-200" />
            </div>
          </div>

          {/* PERIAPICAL + INTERPROXIMAIS + Odontograma */}
          <div className="grid grid-cols-1 sm:grid-cols-[260px_1fr] border-b-2 border-orange-300">
            <div className="p-3 border-b sm:border-b-0 sm:border-r border-orange-200 space-y-3 bg-orange-50/40">
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
              <div className="text-slate-700">
                <OdontogramaSelecao linhas={LINHAS_ODONTOGRAMA_FULL} selecionados={teethSel} onToggle={toggleTooth} rotulo="Dentes para radiografia periapical" />
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
          <div className="grid grid-cols-1 sm:grid-cols-2 border-b-2 border-orange-300">
            <div className="p-3 border-b sm:border-b-0 sm:border-r border-orange-200">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <SectionHeader>Panorâmica</SectionHeader>
                <CheckRow checked={get("pan_laudo")} onChange={set("pan_laudo")} label="COM LAUDO" />
                <CheckRow checked={get("pan_carpal")} onChange={set("pan_carpal")} label="Carpal" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 pl-2">
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
            <div className="p-3 grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-4">
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
                <div className="text-slate-700">
                  <OdontogramaSelecao linhas={LINHAS_ODONTOGRAMA_ADULTO} selecionados={tomoSel} onToggle={toggleTomo} rotulo="Dentes para tomografia" />
                </div>
                <div className="mt-2 text-xs text-slate-700">
                  <span className="font-semibold">Dentes selecionados: </span>
                  {tomoSorted.length > 0 ? tomoSorted.join(", ") : "—"}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-3 pb-3 pt-1 border-t border-orange-200">
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
          <div className="grid grid-cols-1 sm:grid-cols-[1.6fr_1fr] border-b-2 border-orange-300">
            <div className="p-3 border-b sm:border-b-0 sm:border-r border-orange-200">
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
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.6fr] border-b-2 border-orange-300">
            <div className="p-3 border-b sm:border-b-0 sm:border-r border-orange-200">
              <SectionHeader>Fotografias</SectionHeader>
              <div className="pl-2 pt-2 space-y-1">
                <CheckRow checked={get("foto_extra")} onChange={set("foto_extra")} label="Extrabucal" />
                <CheckRow checked={get("foto_intra")} onChange={set("foto_intra")} label="Intrabucal" />
                <div className="flex items-center gap-2">
                  <CheckRow checked={get("foto_outros")} onChange={set("foto_outros")} label="Outros" />
                  <Input value={fotoOutros} onChange={(e) => setFotoOutros(e.target.value)} aria-label="Outras fotografias" className="h-7 bg-white border-orange-200 flex-1" />
                </div>
              </div>
            </div>
            <div className="p-3 grid grid-cols-1 sm:grid-cols-[1fr_1.2fr] gap-4">
              <div>
                <SectionHeader>Análises</SectionHeader>
                <div className="pl-2 pt-2 space-y-1">
                  <CheckRow checked={get("an_dent")} onChange={set("an_dent")} label="Análise Dentária" />
                  <CheckRow checked={get("an_facial")} onChange={set("an_facial")} label="Análise Facial" />
                  <CheckRow checked={get("an_modelo")} onChange={set("an_modelo")} label="Análise de Modelo" />
                </div>
              </div>
              <div className="flex flex-col">
                <div className="flex-1 min-h-[80px] border border-slate-300 rounded-sm bg-slate-50" />
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
