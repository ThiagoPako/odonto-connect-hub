/**
 * Autorização do paciente (ou do responsável) para gravação e transcrição por IA — versão 2.0.
 * Texto: docs/juridico/consentimento-transcricao-ia.md (Helena).
 *
 * - O texto vem do servidor (catálogo de versões), que grava o SHA-256 do texto que ele montou.
 * - "Autorizo" e "Não autorizo" têm o mesmo peso e nada vem marcado (LGPD 8º §3º).
 * - Quem decide assina na tela (assinatura eletrônica simples, Lei 14.063 art. 4º, I).
 * - Menor de 12: o responsável assina e informa o documento; 12 a 17: o adolescente fica ciente.
 * - Sem encarregado de dados cadastrado (LGPD 41), a gravação fica bloqueada.
 * - A recusa também é registrada.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck, Loader2, AlertCircle, ChevronDown, Printer, Lock } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { SignaturePad, type SignatureResult } from "@/components/SignaturePad";
import { useAuth } from "@/hooks/useAuth";
import {
  consentimentosApi,
  type ConsentimentoPaciente,
  type ConsentimentoTexto,
} from "@/lib/vpsApi";

const TIPO = "gravacao_transcricao_ia" as const;

interface Props {
  open: boolean;
  pacienteId?: string;
  pacienteNome?: string;
  /** Recusa anterior (para avisar que já foi perguntado). */
  recusaEm?: string | null;
  /** Fecha o diálogo: consent preenchido = autorizou; null = não autorizou ou cancelou. */
  onDone: (consent: ConsentimentoPaciente | null, decisao: "autorizo" | "nao_autorizo" | null) => void;
}

type Decisao = "autorizo" | "nao_autorizo";
type Assinante = "paciente" | "responsavel";

function imprimirCopia(texto: ConsentimentoTexto, pacienteNome?: string) {
  const w = window.open("", "_blank", "width=720,height=900");
  if (!w) {
    toast.error("O navegador bloqueou a janela de impressão. Permita pop-ups para imprimir a cópia.");
    return;
  }
  const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Autorização — ${esc(pacienteNome || "paciente")}</title>
    <style>body{font:14px/1.5 system-ui,sans-serif;max-width:680px;margin:24px auto;padding:0 16px;white-space:pre-wrap}small{color:#555}</style></head>
    <body>${esc(texto.curta || "")}\n\n${esc(texto.completa || "")}\n\n<small>Versão ${esc(texto.versao)} · Código do texto (SHA-256): ${esc(texto.hash || "")}</small></body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

export function GravacaoConsentDialog({ open, pacienteId, pacienteNome, recusaEm, onDone }: Props) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || !!user?.is_super_admin;

  const [texto, setTexto] = useState<ConsentimentoTexto | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saibaMais, setSaibaMais] = useState(false);

  const [idadeInformada, setIdadeInformada] = useState("");
  const [decisao, setDecisao] = useState<Decisao | null>(null);
  const [assinante, setAssinante] = useState<Assinante | null>(null);
  const [nome, setNome] = useState("");
  const [vinculo, setVinculo] = useState("");
  const [documento, setDocumento] = useState("");
  const [adolescenteCiente, setAdolescenteCiente] = useState(false);
  const [copiaOferecida, setCopiaOferecida] = useState(false);
  const [temAssinatura, setTemAssinatura] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const signatureRef = useRef<(() => SignatureResult | null) | null>(null);

  // Encarregado (só admin, quando falta)
  const [encNome, setEncNome] = useState("");
  const [encContato, setEncContato] = useState("");
  const [encSaving, setEncSaving] = useState(false);

  const load = useCallback(async () => {
    if (!pacienteId) return;
    setLoading(true);
    setLoadError(null);
    const { data, error } = await consentimentosApi.getTexto(pacienteId, TIPO);
    setLoading(false);
    if (error || !data) {
      setLoadError(error || "Não foi possível carregar o texto da autorização.");
      return;
    }
    setTexto(data);
  }, [pacienteId]);

  useEffect(() => {
    if (!open) return;
    // Cada abertura começa do zero: nada pré-marcado.
    setTexto(null);
    setSaibaMais(false);
    setIdadeInformada("");
    setDecisao(null);
    setAssinante(null);
    setNome("");
    setVinculo("");
    setDocumento("");
    setAdolescenteCiente(false);
    setCopiaOferecida(false);
    setTemAssinatura(false);
    setErro(null);
    void load();
  }, [open, load]);

  const incompleto = !!texto && texto.faltando.length > 0;
  const idade = texto?.idade ?? (idadeInformada.trim() !== "" && Number.isFinite(Number(idadeInformada)) ? Number(idadeInformada) : null);
  const menor = idade != null && idade < 18;
  const menorDe12 = idade != null && idade < 12;
  const adolescente = idade != null && idade >= 12 && idade < 18;
  const assinanteEfetivo: Assinante | null = menor ? "responsavel" : assinante;

  const salvarEncarregado = async () => {
    if (!encNome.trim() || !encContato.trim()) {
      toast.error("Informe o nome e um contato (e-mail ou telefone) do encarregado.");
      return;
    }
    setEncSaving(true);
    const { error } = await consentimentosApi.setEncarregado({ nome: encNome.trim(), contato: encContato.trim() });
    setEncSaving(false);
    if (error) {
      toast.error(`Não foi possível salvar o encarregado: ${error}`);
      return;
    }
    toast.success("Encarregado de dados cadastrado.");
    void load();
  };

  const registrar = async () => {
    if (!texto || !texto.hash || !pacienteId || saving) return;
    setErro(null);
    if (idade == null) return setErro("Informe a idade do paciente.");
    if (!decisao) return setErro("Marque \"Autorizo\" ou \"Não autorizo\".");
    if (!assinanteEfetivo) return setErro("Diga quem está assinando: o paciente ou o responsável legal.");
    if (!nome.trim()) return setErro("Informe o nome de quem assina.");
    if (assinanteEfetivo === "responsavel" && !vinculo.trim()) return setErro("Informe o vínculo do responsável (ex.: mãe, pai, tutor).");
    if (menorDe12 && !documento.trim()) return setErro("Paciente menor de 12 anos: informe o documento do responsável.");
    if (decisao === "autorizo" && adolescente && !adolescenteCiente) return setErro("Confirme que o adolescente foi informado e está ciente.");
    const assinatura = decisao === "autorizo" ? signatureRef.current?.() : null;
    if (decisao === "autorizo" && !assinatura) return setErro("Falta a assinatura de quem autoriza.");

    setSaving(true);
    const { data, error } = await consentimentosApi.registrar(pacienteId, {
      tipo: TIPO,
      decisao,
      texto_hash: texto.hash,
      assinante_tipo: assinanteEfetivo,
      assinante_nome: nome.trim(),
      assinante_vinculo: assinanteEfetivo === "responsavel" ? vinculo.trim() : undefined,
      responsavel_documento: documento.trim() || undefined,
      adolescente_ciente: adolescente ? adolescenteCiente : undefined,
      idade_informada: texto.idade == null ? idade : undefined,
      assinatura: assinatura ? { base64: assinatura.base64 } : undefined,
      profissional_presente_nome: user?.name || undefined,
      copia_oferecida: copiaOferecida,
    });
    setSaving(false);
    if (error || !data) {
      setErro(error || "Não foi possível registrar a decisão.");
      if (/mudou|recarregue/i.test(error || "")) void load();
      return;
    }
    toast.success(decisao === "autorizo" ? "Autorização registrada." : "Recusa registrada. A consulta segue sem gravação.");
    onDone(data.consent, decisao);
  };

  const opcao = (valor: Decisao, rotulo: string, desabilitada = false) => {
    const ativo = decisao === valor;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={ativo}
        aria-disabled={desabilitada}
        disabled={desabilitada}
        onClick={() => setDecisao(valor)}
        className={`flex-1 rounded-xl border-2 p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
          ativo ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-foreground hover:bg-muted/50"
        }`}
      >
        <span className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${ativo ? "border-primary bg-primary shadow-[inset_0_0_0_3px_hsl(var(--card))]" : "border-muted-foreground/60"}`}
          />
          <span>{rotulo}</span>
        </span>
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onDone(null, null); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            Autorização para gravar{pacienteNome ? ` — ${pacienteNome}` : ""}
          </DialogTitle>
          <DialogDescription>
            Entregue o aparelho ao paciente ou ao responsável para ler e decidir. Recusar não muda o atendimento.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando o texto da autorização...
          </p>
        )}

        {loadError && (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-2">
            <p className="flex items-center gap-2 text-foreground"><AlertCircle className="h-4 w-4 text-destructive" /> {loadError}</p>
            <Button size="sm" variant="outline" onClick={() => void load()}>Tentar novamente</Button>
          </div>
        )}

        {texto && incompleto && (
          <div role="alert" className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm space-y-3">
            <p className="flex items-start gap-2 text-foreground">
              <Lock className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                A gravação está bloqueada: a autorização precisa identificar a clínica e o encarregado de dados
                (LGPD, art. 9º, III e IV). Falta: {texto.faltando_rotulos.join("; ")}.
                {" "}O paciente ainda pode registrar que não autoriza.
              </span>
            </p>
            {isAdmin && texto.faltando.includes("contato_encarregado") && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="enc-nome">Nome do encarregado</Label>
                  <Input id="enc-nome" value={encNome} onChange={(e) => setEncNome(e.target.value)} maxLength={120} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="enc-contato">E-mail ou telefone</Label>
                  <Input id="enc-contato" value={encContato} onChange={(e) => setEncContato(e.target.value)} maxLength={160} />
                </div>
                <Button size="sm" className="sm:col-span-2" onClick={() => void salvarEncarregado()} disabled={encSaving}>
                  {encSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar encarregado
                </Button>
              </div>
            )}
            {!isAdmin && (
              <p className="text-xs text-muted-foreground">Peça ao administrador da clínica para completar o cadastro.</p>
            )}
          </div>
        )}

        {texto && texto.curta && (
          <div className="space-y-4">
            {recusaEm && (
              <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
                Este paciente não autorizou em {new Date(recusaEm).toLocaleDateString("pt-BR")}. Registre uma nova decisão só se ele mudou de ideia.
              </p>
            )}

            {texto.idade == null && (
              <div className="space-y-1">
                <Label htmlFor="consent-idade">Idade do paciente (o cadastro não tem data de nascimento)</Label>
                <Input
                  id="consent-idade"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={129}
                  value={idadeInformada}
                  onChange={(e) => setIdadeInformada(e.target.value)}
                  className="w-32"
                />
              </div>
            )}

            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed text-foreground whitespace-pre-line">
              {texto.curta}
            </div>

            {texto.completa && <div>
              <button
                type="button"
                onClick={() => setSaibaMais((v) => !v)}
                aria-expanded={saibaMais}
                className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Saiba mais <ChevronDown className={`h-4 w-4 transition-transform ${saibaMais ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
              {saibaMais && (
                <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-border p-3 text-xs leading-relaxed text-foreground whitespace-pre-line">
                  {texto.completa}
                </div>
              )}
            </div>}

            <div role="radiogroup" aria-label="Decisão sobre a gravação" className="flex flex-col gap-2 sm:flex-row">
              {opcao("autorizo", texto.opcoes.autorizo, incompleto)}
              {opcao("nao_autorizo", texto.opcoes.nao_autorizo)}
            </div>

            {decisao && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                {menor ? (
                  <p className="text-xs text-muted-foreground">
                    Paciente com {idade} anos: quem {decisao === "autorizo" ? "autoriza" : "decide"} é o pai, a mãe ou o responsável legal.
                  </p>
                ) : (
                  <div role="radiogroup" aria-label="Quem está assinando" className="flex flex-wrap gap-4 text-sm">
                    {(["paciente", "responsavel"] as const).map((t) => (
                      <label key={t} className="flex items-center gap-2">
                        <input type="radio" name="assinante" checked={assinante === t} onChange={() => setAssinante(t)} />
                        {t === "paciente" ? "Sou o paciente" : "Sou o responsável legal"}
                      </label>
                    ))}
                  </div>
                )}

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="consent-nome">Nome de quem assina</Label>
                    <Input id="consent-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={160} autoComplete="name" />
                  </div>
                  {assinanteEfetivo === "responsavel" && (
                    <div className="space-y-1">
                      <Label htmlFor="consent-vinculo">Vínculo com o paciente</Label>
                      <Input id="consent-vinculo" value={vinculo} onChange={(e) => setVinculo(e.target.value)} placeholder="mãe, pai, tutor..." maxLength={60} />
                    </div>
                  )}
                  {menorDe12 && (
                    <div className="space-y-1">
                      <Label htmlFor="consent-doc">Documento do responsável (RG ou CPF)</Label>
                      <Input id="consent-doc" value={documento} onChange={(e) => setDocumento(e.target.value)} maxLength={40} />
                    </div>
                  )}
                </div>

                {adolescente && decisao === "autorizo" && (
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox checked={adolescenteCiente} onCheckedChange={(v) => setAdolescenteCiente(v === true)} className="mt-0.5" />
                    O adolescente foi informado, está ciente e não se opôs.
                  </label>
                )}

                {decisao === "autorizo" && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">Assinatura de quem autoriza</p>
                    <SignaturePad
                      signatureRef={signatureRef}
                      onChange={setTemAssinatura}
                      coletarLocalizacao={false}
                      height={150}
                      ariaLabel="Assinatura de quem autoriza"
                    />
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={copiaOferecida} onCheckedChange={(v) => setCopiaOferecida(v === true)} />
                    Ofereci uma cópia ao paciente
                  </label>
                  <Button type="button" size="sm" variant="outline" onClick={() => imprimirCopia(texto, pacienteNome)} disabled={!texto.completa}>
                    <Printer className="h-4 w-4 mr-1.5" aria-hidden="true" /> Imprimir cópia
                  </Button>
                </div>
              </div>
            )}

            {erro && (
              <p role="alert" className="text-sm text-destructive">{erro}</p>
            )}

            <p className="text-[11px] text-muted-foreground">
              Versão {texto.versao} · código do texto {texto.hash?.slice(0, 12)}…
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onDone(null, null)} disabled={saving}>
            Voltar
          </Button>
          {texto?.hash && (
            <Button
              onClick={() => void registrar()}
              disabled={saving || !decisao || (decisao === "autorizo" && !temAssinatura)}
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Registrar decisão
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
