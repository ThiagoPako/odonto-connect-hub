import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Ban, Bot, CheckCircle2, FileSpreadsheet, Loader2, MapPin, RefreshCw, Search, ShieldCheck, XCircle } from "lucide-react";
import {
  comercialApi, ROTULO_ETAPA, ROTULO_ORIGEM,
  type AcessoComercial, type ConfigBuscador, type DadosGoogle, type JobScraper, type LeadComercial, type MembroEquipe, type Previa, type RegistroAuditoria, type StatusJobScraper,
} from "@/lib/comercialApi";
import { PreviaLeads } from "./PreviaLeads";

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

export default function BuscadorLeads() {
  const [acesso, setAcesso] = useState<AcessoComercial | null>(null);
  const [erroAcesso, setErroAcesso] = useState<string | null>(null);
  const [equipe, setEquipe] = useState<MembroEquipe[]>([]);
  const [aba, setAba] = useState("google");
  const [versaoLeads, setVersaoLeads] = useState(0);

  useEffect(() => {
    (async () => {
      const a = await comercialApi.acesso();
      if (a.error || !a.data) { setErroAcesso(a.error || "Sem acesso"); return; }
      setAcesso(a.data);
      if (!a.data.pode_buscar) setAba("leads");
      const e = await comercialApi.equipe();
      if (e.data) setEquipe(e.data.data);
    })();
  }, []);

  if (erroAcesso) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">Não foi possível abrir o comercial: {erroAcesso}</CardContent></Card>;
  }
  if (!acesso) {
    return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>;
  }

  const aoImportar = () => setVersaoLeads(v => v + 1);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm flex gap-3">
        <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-medium">Só clínicas odontológicas, radiologia odontológica e dentistas</p>
          <p className="text-muted-foreground">O resto é descartado e contado no resumo. Base legal: legítimo interesse (B2B). Quem pedir para não ser contatado vai para a lista de supressão e não volta em nenhuma importação.</p>
        </div>
      </div>

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList className="bg-background border h-auto p-1 flex-wrap justify-start">
          {acesso.pode_buscar && <TabsTrigger value="google" className="gap-1.5"><MapPin className="h-3.5 w-3.5" />Buscar no Google</TabsTrigger>}
          {acesso.pode_buscar && <TabsTrigger value="scraper" className="gap-1.5"><Bot className="h-3.5 w-3.5" />Google Maps (scraper)</TabsTrigger>}
          {acesso.pode_buscar && <TabsTrigger value="csv" className="gap-1.5"><FileSpreadsheet className="h-3.5 w-3.5" />Importar CSV</TabsTrigger>}
          <TabsTrigger value="leads">Leads</TabsTrigger>
          {acesso.ve_todos && <TabsTrigger value="config">Configurações</TabsTrigger>}
          {acesso.ve_todos && <TabsTrigger value="auditoria">Auditoria</TabsTrigger>}
        </TabsList>

        {acesso.pode_buscar && (
          <TabsContent value="google" className="mt-4">
            <BuscaGoogle acesso={acesso} equipe={equipe} onImportado={aoImportar} />
          </TabsContent>
        )}
        {acesso.pode_buscar && (
          <TabsContent value="scraper" className="mt-4">
            <BuscaScraper acesso={acesso} equipe={equipe} onImportado={aoImportar} />
          </TabsContent>
        )}
        {acesso.pode_buscar && (
          <TabsContent value="csv" className="mt-4">
            <ImportarCsv acesso={acesso} equipe={equipe} onImportado={aoImportar} />
          </TabsContent>
        )}
        <TabsContent value="leads" className="mt-4">
          <ListaLeads acesso={acesso} equipe={equipe} versao={versaoLeads} />
        </TabsContent>
        {acesso.ve_todos && (
          <TabsContent value="config" className="mt-4">
            <ConfiguracoesBuscador acesso={acesso} equipe={equipe} onEquipe={setEquipe} />
          </TabsContent>
        )}
        {acesso.ve_todos && (
          <TabsContent value="auditoria" className="mt-4">
            <Auditoria />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

type ImportarArgs = Parameters<ComponentProps<typeof PreviaLeads>["onImportar"]>[0];

function useImportacao(previa: Previa | null, onImportado: () => void, limpar: () => void) {
  const [importando, setImportando] = useState(false);
  const importar = async (args: ImportarArgs) => {
    if (!previa) return;
    setImportando(true);
    const r = await comercialApi.importar({ previa_id: previa.previa_id, ...args, dono_id: args.dono_id });
    setImportando(false);
    if (r.error || !r.data) return toast.error(r.error || "Falha ao importar");
    toast.success(`${r.data.importados} ${r.data.importados === 1 ? "lead importado" : "leads importados"}${r.data.pulados ? ` · ${r.data.pulados} pulados (já existiam ou entraram na lista de não contatar)` : ""}`);
    limpar();
    onImportado();
  };
  return { importando, importar };
}

function BuscaGoogle({ acesso, equipe, onImportado }: { acesso: AcessoComercial; equipe: MembroEquipe[]; onImportado: () => void }) {
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("SP");
  const [raio, setRaio] = useState("");
  const [tipos, setTipos] = useState<string[]>(acesso.tipos_busca.map(t => t.id));
  const [buscando, setBuscando] = useState(false);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const { importando, importar } = useImportacao(previa, onImportado, () => setPrevia(null));

  const buscar = async () => {
    if (!cidade.trim()) return toast.error("Informe a cidade");
    if (!tipos.length) return toast.error("Escolha ao menos um tipo");
    setBuscando(true);
    const r = await comercialApi.previaPlaces({ cidade: cidade.trim(), uf, tipos, raio_km: raio ? Number(raio) : null });
    setBuscando(false);
    if (r.error || !r.data) return toast.error(r.error || "Falha na busca");
    setPrevia(r.data);
  };

  if (!acesso.places_configurado) {
    return (
      <Card><CardContent className="p-6 text-sm space-y-2">
        <p className="font-medium flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" />Google Places ainda não configurado</p>
        <p className="text-muted-foreground">Falta a chave <code>GOOGLE_PLACES_API_KEY</code> no <code>.env</code> do servidor. Enquanto isso, use “Importar CSV”.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="shadow-sm">
        <CardContent className="p-4 sm:p-5 space-y-4">
          {acesso.places_simulado && <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">Modo simulado: resultados fictícios, sem custo</Badge>}
          <div className="grid gap-3 sm:grid-cols-[1fr_6rem_8rem]">
            <div className="grid gap-1.5">
              <Label htmlFor="bg-cidade">Cidade</Label>
              <Input id="bg-cidade" value={cidade} onChange={e => setCidade(e.target.value)} placeholder="Ex.: Campinas" onKeyDown={e => e.key === "Enter" && buscar()} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bg-uf">UF</Label>
              <Select value={uf} onValueChange={setUf}>
                <SelectTrigger id="bg-uf"><SelectValue /></SelectTrigger>
                <SelectContent>{UFS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bg-raio">Raio (km)</Label>
              <Input id="bg-raio" type="number" min={1} max={50} value={raio} onChange={e => setRaio(e.target.value)} placeholder="Cidade toda" />
            </div>
          </div>
          <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
            <legend className="text-sm font-medium mb-1.5">Tipo</legend>
            {acesso.tipos_busca.map(t => (
              <div key={t.id} className="flex items-center gap-2 text-sm">
                <Checkbox id={`bg-tipo-${t.id}`} checked={tipos.includes(t.id)} onCheckedChange={v => setTipos(s => v === true ? [...s, t.id] : s.filter(x => x !== t.id))} />
                <label htmlFor={`bg-tipo-${t.id}`}>{t.rotulo}</label>
              </div>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Cada tipo faz até 3 consultas de 20 resultados (≈ US$ 0,035 cada). Limites por busca e por dia em Configurações.</p>
            <Button onClick={buscar} disabled={buscando} className="gap-2">
              {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Ver prévia
            </Button>
          </div>
        </CardContent>
      </Card>
      {previa && <PreviaLeads key={previa.previa_id} previa={previa} equipe={equipe} podeAtribuir={acesso.papel !== "vendedor"} importando={importando} onImportar={importar} exigeOrigem={false} />}
    </div>
  );
}

const ROTULO_JOB: Record<StatusJobScraper, { rotulo: string; classe: string }> = {
  na_fila: { rotulo: "Na fila", classe: "bg-muted text-muted-foreground" },
  rodando: { rotulo: "Coletando", classe: "bg-primary/10 text-primary border-primary/20" },
  concluido: { rotulo: "Pronto para revisar", classe: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" },
  importado: { rotulo: "Importado", classe: "bg-muted text-muted-foreground" },
  falhou: { rotulo: "Falhou", classe: "bg-destructive/10 text-destructive border-destructive/20" },
  bloqueado: { rotulo: "Bloqueado pelo Google", classe: "bg-destructive/10 text-destructive border-destructive/20" },
  cancelado: { rotulo: "Cancelado", classe: "bg-muted text-muted-foreground" },
};

function BuscaScraper({ acesso, equipe, onImportado }: { acesso: AcessoComercial; equipe: MembroEquipe[]; onImportado: () => void }) {
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("SP");
  const [tipos, setTipos] = useState<string[]>(acesso.tipos_busca.map(t => t.id));
  const [depth, setDepth] = useState<number | null>(null);
  const [emails, setEmails] = useState(false);
  const [jobs, setJobs] = useState<JobScraper[]>([]);
  const [info, setInfo] = useState<{ hoje: number; limite_dia: number; depth_padrao: number; depth_max: number } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const { importando, importar } = useImportacao(previa, () => { onImportado(); carregar(); }, () => setPrevia(null));

  const carregar = useCallback(async () => {
    const r = await comercialApi.jobsScraper();
    if (r.error || !r.data) return toast.error(r.error || "Falha ao carregar a fila");
    setJobs(r.data.data);
    setInfo({ hoje: r.data.hoje, limite_dia: r.data.limite_dia, depth_padrao: r.data.depth_padrao, depth_max: r.data.depth_max });
  }, []);

  useEffect(() => { if (acesso.scraper_configurado) carregar(); }, [acesso.scraper_configurado, carregar]);
  const ativo = jobs.some(j => j.status === "na_fila" || j.status === "rodando");
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(carregar, 5000);
    return () => clearInterval(t);
  }, [ativo, carregar]);

  if (!acesso.scraper_configurado) {
    return (
      <Card><CardContent className="p-6 text-sm space-y-2">
        <p className="font-medium flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" />Scraper ainda não configurado</p>
        <p className="text-muted-foreground">Falta subir o engine do google-maps-scraper-kit na VPS e preencher <code>LEADS_SCRAPER_URL</code> no <code>.env</code> do servidor (guia em docs/operacao/scraper-leads.md).</p>
      </CardContent></Card>
    );
  }

  const profundidade = depth ?? info?.depth_padrao ?? 2;
  const criar = async () => {
    if (!cidade.trim()) return toast.error("Informe a cidade");
    if (!tipos.length) return toast.error("Escolha ao menos um tipo");
    setEnviando(true);
    const r = await comercialApi.criarJobScraper({ cidade: cidade.trim(), uf, tipos, depth: profundidade, coletar_emails: emails });
    setEnviando(false);
    if (r.error || !r.data) return toast.error(r.error || "Não foi possível criar a coleta");
    toast.success(r.data.data.status === "na_fila" ? "Coleta na fila: começa quando a anterior terminar" : "Coleta iniciada");
    carregar();
  };
  const cancelar = async (id: string) => {
    const r = await comercialApi.cancelarJobScraper(id);
    if (r.error) return toast.error(r.error);
    carregar();
  };
  const abrirPrevia = async (id: string) => {
    setAbrindo(id);
    const r = await comercialApi.previaJobScraper(id);
    setAbrindo(null);
    if (r.error || !r.data) return toast.error(r.error || "Não foi possível baixar o resultado");
    setPrevia(r.data);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm flex gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-muted-foreground">Coleta automática no Google Maps (google-maps-scraper-kit). Isso contraria os Termos do Google, e o Google pode bloquear o servidor; nesse caso a coleta para e não tentamos contornar. Para volume, prefira a Places API. Os dados passam pelo mesmo filtro, pela mesma checagem de duplicados e pela mesma prévia.</p>
      </div>
      <Card className="shadow-sm">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_6rem_9rem]">
            <div className="grid gap-1.5">
              <Label htmlFor="sc-cidade">Cidade</Label>
              <Input id="sc-cidade" value={cidade} onChange={e => setCidade(e.target.value)} placeholder="Ex.: Campinas" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sc-uf">UF</Label>
              <Select value={uf} onValueChange={setUf}>
                <SelectTrigger id="sc-uf"><SelectValue /></SelectTrigger>
                <SelectContent>{UFS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sc-depth">Profundidade</Label>
              <Input id="sc-depth" type="number" min={1} max={info?.depth_max ?? 5} value={profundidade} onChange={e => setDepth(Number(e.target.value) || 1)} />
            </div>
          </div>
          <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
            <legend className="text-sm font-medium mb-1.5">Tipo</legend>
            {acesso.tipos_busca.map(t => (
              <div key={t.id} className="flex items-center gap-2 text-sm">
                <Checkbox id={`sc-tipo-${t.id}`} checked={tipos.includes(t.id)} onCheckedChange={v => setTipos(s => v === true ? [...s, t.id] : s.filter(x => x !== t.id))} />
                <label htmlFor={`sc-tipo-${t.id}`}>{t.rotulo}</label>
              </div>
            ))}
          </fieldset>
          <div className="flex items-start gap-2 text-sm">
            <Checkbox id="sc-emails" checked={emails} onCheckedChange={v => setEmails(v === true)} className="mt-0.5" />
            <label htmlFor="sc-emails">Buscar e-mail no site de cada clínica <span className="text-muted-foreground">(mais lento; todo e-mail entra marcado como dado pessoal)</span></label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Cada nível de profundidade traz cerca de 20 locais por tipo. Um por vez{info ? ` · hoje ${info.hoje} de ${info.limite_dia} coletas` : ""}.</p>
            <Button onClick={criar} disabled={enviando} className="gap-2">{enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />} Iniciar coleta</Button>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-lg border bg-background overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Coleta</TableHead><TableHead>Situação</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
          <TableBody>
            {jobs.length === 0 && <TableRow><TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">Nenhuma coleta ainda.</TableCell></TableRow>}
            {jobs.map(j => {
              const est = ROTULO_JOB[j.status];
              return (
                <TableRow key={j.id}>
                  <TableCell className="align-top">
                    <p className="font-medium">{j.cidade}/{j.uf}</p>
                    <p className="text-xs text-muted-foreground">{j.tipos.map(t => acesso.tipos_busca.find(x => x.id === t)?.rotulo ?? t).join(", ")} · profundidade {j.depth}{j.coletar_emails ? " · com e-mails" : ""}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">{new Date(j.criado_em).toLocaleString("pt-BR")}{j.criado_por_nome ? ` · ${j.criado_por_nome}` : ""}</p>
                  </TableCell>
                  <TableCell className="align-top max-w-[22rem]">
                    <Badge variant="outline" className={est.classe}>{j.status === "rodando" && <Loader2 className="h-3 w-3 animate-spin mr-1" />}{est.rotulo}</Badge>
                    {j.status === "rodando" && <p className="mt-1 text-xs text-muted-foreground tabular-nums">{j.progresso.places ?? 0} locais · palavra {j.progresso.keywords_done ?? 0}/{j.progresso.keywords_total ?? j.palavras.length}</p>}
                    {j.linhas != null && j.status !== "rodando" && <p className="mt-1 text-xs text-muted-foreground">{j.linhas} locais coletados</p>}
                    {(j.erro || j.aviso) && <p className="mt-1 text-xs text-destructive">{j.erro || j.aviso}</p>}
                  </TableCell>
                  <TableCell className="align-top text-right">
                    {j.status === "concluido" && <Button size="sm" variant="outline" className="h-8 text-xs" disabled={abrindo === j.id} onClick={() => abrirPrevia(j.id)}>{abrindo === j.id && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}Revisar e importar</Button>}
                    {(j.status === "na_fila" || j.status === "rodando") && <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={() => cancelar(j.id)} aria-label={`Cancelar coleta de ${j.cidade}`}><XCircle className="h-3.5 w-3.5" />Cancelar</Button>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {previa?.aviso && <p className="text-xs text-amber-700 dark:text-amber-400">{previa.aviso}</p>}
      {previa && <PreviaLeads key={previa.previa_id} previa={previa} equipe={equipe} podeAtribuir={acesso.papel !== "vendedor"} importando={importando} onImportar={importar} exigeOrigem={false} />}
    </div>
  );
}

function ImportarCsv({ acesso, equipe, onImportado }: { acesso: AcessoComercial; equipe: MembroEquipe[]; onImportado: () => void }) {
  const [lendo, setLendo] = useState(false);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const { importando, importar } = useImportacao(previa, onImportado, () => setPrevia(null));

  const escolher = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    if (arquivo.size > 5 * 1024 * 1024) return toast.error("Arquivo maior que 5 MB: divida em partes");
    setLendo(true);
    const texto = await arquivo.text();
    const r = await comercialApi.previaCsv(texto, arquivo.name);
    setLendo(false);
    if (r.error || !r.data) return toast.error(r.error || "Não foi possível ler o CSV");
    setPrevia(r.data);
  };

  return (
    <div className="space-y-4">
      <Card className="shadow-sm">
        <CardContent className="p-4 sm:p-5 space-y-3">
          <p className="text-sm">Aceita o CSV do <strong>google-maps-scraper-kit</strong> (colunas <code>title, phone, emails, website, category, address, review_rating, review_count</code> e redes sociais) e planilhas com colunas como <code>nome, telefone, categoria, cidade, uf</code>.</p>
          <p className="text-xs text-muted-foreground">O raspador do Google Maps não roda no nosso servidor (é contra os Termos do Google). Quem rodar no próprio computador responde pela origem dos dados, que precisa ser informada na importação.</p>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-sm hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring">
            {lendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            {lendo ? "Lendo…" : "Escolher arquivo .csv"}
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={e => { escolher(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {previa?.formato && <Badge variant="outline">Formato detectado: {previa.formato}</Badge>}
        </CardContent>
      </Card>
      {previa && <PreviaLeads key={previa.previa_id} previa={previa} equipe={equipe} podeAtribuir={acesso.papel !== "vendedor"} importando={importando} onImportar={importar} exigeOrigem />}
    </div>
  );
}

function ListaLeads({ acesso, equipe, versao }: { acesso: AcessoComercial; equipe: MembroEquipe[]; versao: number }) {
  const [leads, setLeads] = useState<LeadComercial[]>([]);
  const [total, setTotal] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [etapa, setEtapa] = useState("todas");
  const [dono, setDono] = useState("todos");
  const [busca, setBusca] = useState("");
  const [google, setGoogle] = useState<Record<string, DadosGoogle>>({});
  const [confirmar, setConfirmar] = useState<LeadComercial | null>(null);
  const [optout, setOptout] = useState<LeadComercial | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const params: Record<string, string> = {};
    if (etapa !== "todas") params.etapa = etapa;
    if (dono !== "todos") params.dono_id = dono;
    if (busca.trim()) params.busca = busca.trim();
    const r = await comercialApi.leads(params);
    setCarregando(false);
    if (r.error || !r.data) return toast.error(r.error || "Falha ao carregar leads");
    setLeads(r.data.data);
    setTotal(r.data.total);
  }, [etapa, dono, busca]);

  useEffect(() => { carregar(); }, [carregar, versao]);

  const atualizar = async (id: string, body: { etapa?: string; dono_id?: string | null }) => {
    const r = await comercialApi.atualizarLead(id, body);
    if (r.error) return toast.error(r.error);
    setLeads(ls => ls.map(l => l.id === id ? { ...l, ...body, dono_nome: body.dono_id !== undefined ? equipe.find(m => m.profile_id === body.dono_id)?.nome ?? null : l.dono_nome } : l));
  };

  const verGoogle = async (l: LeadComercial) => {
    const r = await comercialApi.dadosGoogle(l.id);
    if (r.error || !r.data) return toast.error(r.error || "Falha ao consultar o Google");
    setGoogle(g => ({ ...g, [l.id]: r.data!.dados }));
  };

  const podeRedistribuir = acesso.ve_todos || acesso.papel === "sdr";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1 min-w-[12rem] flex-1">
          <Label htmlFor="ll-busca" className="text-xs">Buscar</Label>
          <Input id="ll-busca" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Nome, cidade ou telefone" />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Etapa</Label>
          <Select value={etapa} onValueChange={setEtapa}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {acesso.etapas.map(e => <SelectItem key={e} value={e}>{ROTULO_ETAPA[e] ?? e}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {acesso.ve_todos && (
          <div className="grid gap-1">
            <Label className="text-xs">Responsável</Label>
            <Select value={dono} onValueChange={setDono}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="sem">Sem responsável</SelectItem>
                {equipe.map(m => <SelectItem key={m.profile_id} value={m.profile_id}>{m.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <Button variant="outline" size="icon" onClick={carregar} aria-label="Atualizar lista"><RefreshCw className={`h-4 w-4 ${carregando ? "animate-spin" : ""}`} /></Button>
      </div>
      <p className="text-xs text-muted-foreground">{total} {total === 1 ? "lead" : "leads"}</p>

      <div className="rounded-lg border bg-background overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Clínica</TableHead>
              <TableHead className="hidden md:table-cell">Origem</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!carregando && leads.length === 0 && (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">Nenhum lead ainda. Busque no Google ou importe um CSV.</TableCell></TableRow>
            )}
            {leads.map(l => {
              const g = google[l.id] ?? l.dados_google;
              const doGoogle = l.origem === "google_places" && !l.dados_confirmados_em;
              const nome = l.clinica_nome || g?.clinica_nome;
              const tel = l.telefone_comercial || g?.telefone_comercial;
              return (
                <TableRow key={l.id} className={l.nao_contatar ? "opacity-60" : ""}>
                  <TableCell className="align-top">
                    <p className="font-medium leading-tight">{nome || <span className="text-muted-foreground">Clínica do Google</span>}</p>
                    <p className="text-xs text-muted-foreground">{[g?.categoria || l.categoria, [l.cidade, l.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ")}</p>
                    {tel && <p className="text-xs tabular-nums">{tel}{(l.telefone_celular || g?.telefone_celular) && <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-400">celular</span>}</p>}
                    {l.email_comercial && <p className="text-xs break-all">{l.email_comercial}{l.email_pessoal && <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-400">pessoal</span>}</p>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {l.nao_contatar && <Badge variant="outline" className="text-[10px] border-destructive/30 text-destructive">Não contatar</Badge>}
                      {l.tenant_id_cliente && <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">Já é cliente</Badge>}
                      {doGoogle && g && <span className="text-[10px] text-muted-foreground">Dados: Google Maps</span>}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell align-top text-xs">
                    <p>{ROTULO_ORIGEM[l.origem] ?? l.origem}</p>
                    {l.campanha && <p className="text-muted-foreground">{l.campanha}</p>}
                  </TableCell>
                  <TableCell className="align-top">
                    {podeRedistribuir ? (
                      <Select value={l.dono_id ?? "sem"} onValueChange={v => atualizar(l.id, { dono_id: v === "sem" ? null : v })}>
                        <SelectTrigger className="h-8 w-40 text-xs" aria-label="Responsável"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sem">Sem responsável</SelectItem>
                          {equipe.filter(m => m.ativo).map(m => <SelectItem key={m.profile_id} value={m.profile_id}>{m.nome}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : <span className="text-xs">{l.dono_nome ?? "—"}</span>}
                  </TableCell>
                  <TableCell className="align-top">
                    <Select value={l.etapa} onValueChange={v => atualizar(l.id, { etapa: v })} disabled={l.nao_contatar}>
                      <SelectTrigger className="h-8 w-40 text-xs" aria-label="Etapa"><SelectValue /></SelectTrigger>
                      <SelectContent>{acesso.etapas.map(e => <SelectItem key={e} value={e}>{ROTULO_ETAPA[e] ?? e}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="align-top text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      {doGoogle && !g && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => verGoogle(l)} aria-label={`Ver dados do Google de ${nome ?? "lead"}`}>Ver dados</Button>}
                      {doGoogle && <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => setConfirmar({ ...l, clinica_nome: nome ?? null, telefone_comercial: tel ?? null, site: l.site || g?.site || null, endereco: l.endereco || g?.endereco || null })} aria-label={`Confirmar dados de ${nome ?? "lead"} com a clínica`}><CheckCircle2 className="h-3.5 w-3.5" />Confirmar dados</Button>}
                      {!l.nao_contatar && <Button size="sm" variant="ghost" className="h-8 text-xs gap-1 text-destructive hover:text-destructive" onClick={() => setOptout(l)} aria-label={`Não contatar ${nome ?? "este lead"}`}><Ban className="h-3.5 w-3.5" />Não contatar</Button>}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {confirmar && <DialogConfirmar lead={confirmar} onClose={() => setConfirmar(null)} onSalvo={() => { setConfirmar(null); carregar(); }} />}
      {optout && <DialogNaoContatar lead={optout} onClose={() => setOptout(null)} onSalvo={() => { setOptout(null); carregar(); }} />}
    </div>
  );
}

function DialogConfirmar({ lead, onClose, onSalvo }: { lead: LeadComercial; onClose: () => void; onSalvo: () => void }) {
  const [f, setF] = useState({ clinica_nome: lead.clinica_nome ?? "", telefone_comercial: lead.telefone_comercial ?? "", site: lead.site ?? "", email_comercial: lead.email_comercial ?? "", endereco: lead.endereco ?? "", cnpj: "" });
  const [salvando, setSalvando] = useState(false);
  const campo = (k: keyof typeof f, rotulo: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`cf-${k}`}>{rotulo}</Label>
      <Input id={`cf-${k}`} value={f[k]} onChange={e => setF(s => ({ ...s, [k]: e.target.value }))} />
    </div>
  );
  const salvar = async () => {
    setSalvando(true);
    const r = await comercialApi.confirmarDados(lead.id, f);
    setSalvando(false);
    if (r.error) return toast.error(r.error);
    toast.success("Dados confirmados com a clínica");
    onSalvo();
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirmar dados com a clínica</DialogTitle>
          <DialogDescription>Use depois de falar com a clínica. Os dados confirmados passam a ser nossos e ficam salvos; antes disso, o que vem do Google não é guardado.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {campo("clinica_nome", "Nome da clínica")}
          <div className="grid gap-3 sm:grid-cols-2">{campo("telefone_comercial", "Telefone comercial")}{campo("cnpj", "CNPJ (opcional)")}</div>
          {campo("email_comercial", "E-mail comercial")}
          {campo("site", "Site")}
          {campo("endereco", "Endereço")}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando || !f.clinica_nome.trim()}>{salvando && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Salvar dados confirmados</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogNaoContatar({ lead, onClose, onSalvo }: { lead: LeadComercial; onClose: () => void; onSalvo: () => void }) {
  const [motivo, setMotivo] = useState("Pediu para não ser contatado");
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    setSalvando(true);
    const r = await comercialApi.naoContatar(lead.id, motivo);
    setSalvando(false);
    if (r.error) return toast.error(r.error);
    toast.success("Lead marcado como não contatar");
    onSalvo();
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Não contatar mais</DialogTitle>
          <DialogDescription>Bloqueia ligação, e-mail e WhatsApp para este lead e guarda o telefone, e-mail e CNPJ (cifrados) na lista de supressão: ele não volta em nenhuma importação.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="nc-motivo">Motivo</Label>
          <Input id="nc-motivo" value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={300} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="destructive" onClick={salvar} disabled={salvando}>{salvando && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const LISTAS: { chave: keyof ConfigBuscador; rotulo: string; ajuda: string }[] = [
  { chave: "categorias_aceitas", rotulo: "Categorias aceitas", ajuda: "Entra se a categoria contiver um destes termos (sem acento)." },
  { chave: "categorias_recusadas", rotulo: "Categorias recusadas", ajuda: "Têm prioridade: loja, laboratório de prótese, veterinária…" },
  { chave: "categorias_exigem_nome_odonto", rotulo: "Categorias genéricas", ajuda: "Radiologia/imagem/laboratório: só entram se o nome tiver termo odontológico." },
  { chave: "termos_nome_odonto", rotulo: "Termos odontológicos no nome", ajuda: "Comparados no início das palavras do nome." },
];
const NUMEROS: { chave: keyof ConfigBuscador; rotulo: string; passo: number }[] = [
  { chave: "places_limite_busca_usd", rotulo: "Limite por busca (US$)", passo: 0.05 },
  { chave: "places_limite_diario_usd", rotulo: "Limite por dia (US$)", passo: 1 },
  { chave: "places_max_paginas_por_busca", rotulo: "Páginas por tipo (1–3)", passo: 1 },
  { chave: "places_cache_minutos", rotulo: "Cache temporário (min)", passo: 5 },
];

function ConfiguracoesBuscador({ acesso, equipe, onEquipe }: { acesso: AcessoComercial; equipe: MembroEquipe[]; onEquipe: (m: MembroEquipe[]) => void }) {
  const [cfg, setCfg] = useState<ConfigBuscador | null>(null);
  const [uso, setUso] = useState<{ chamadas: number; custo_usd: number } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState("vendedor");
  const editavel = acesso.pode_configurar;

  useEffect(() => {
    comercialApi.config().then(r => {
      if (r.error || !r.data) return toast.error(r.error || "Falha ao carregar configuração");
      setCfg(r.data.config); setUso(r.data.uso_hoje);
    });
  }, []);

  const salvar = async () => {
    if (!cfg) return;
    setSalvando(true);
    const r = await comercialApi.salvarConfig(cfg);
    setSalvando(false);
    if (r.error || !r.data) return toast.error(r.error || "Falha ao salvar");
    setCfg(r.data.config);
    toast.success("Configuração salva");
  };

  const recarregarEquipe = async () => { const e = await comercialApi.equipe(); if (e.data) onEquipe(e.data.data); };
  const incluir = async () => {
    const r = await comercialApi.incluirNaEquipe(email.trim(), papel);
    if (r.error) return toast.error(r.error);
    toast.success("Incluído na equipe comercial");
    setEmail("");
    recarregarEquipe();
  };
  const remover = async (id: string) => {
    const r = await comercialApi.removerDaEquipe(id);
    if (r.error) return toast.error(r.error);
    recarregarEquipe();
  };

  if (!cfg) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="shadow-sm">
        <CardHeader className="border-b py-3"><CardTitle className="text-sm">Filtro de categorias</CardTitle></CardHeader>
        <CardContent className="p-4 space-y-4">
          {LISTAS.map(l => (
            <div key={l.chave} className="grid gap-1.5">
              <Label htmlFor={`cfg-${l.chave}`}>{l.rotulo}</Label>
              <Textarea id={`cfg-${l.chave}`} rows={3} disabled={!editavel} value={(cfg[l.chave] as string[]).join(", ")}
                onChange={e => setCfg({ ...cfg, [l.chave]: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} />
              <p className="text-[11px] text-muted-foreground">{l.ajuda}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="space-y-4">
        <Card className="shadow-sm">
          <CardHeader className="border-b py-3"><CardTitle className="text-sm">Custo do Google</CardTitle></CardHeader>
          <CardContent className="p-4 space-y-4">
            {uso && <p className="text-sm">Hoje: <strong className="tabular-nums">US$ {uso.custo_usd.toFixed(3)}</strong> em {uso.chamadas} {uso.chamadas === 1 ? "consulta" : "consultas"} (limite US$ {cfg.places_limite_diario_usd}).</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {NUMEROS.map(n => (
                <div key={n.chave} className="grid gap-1.5">
                  <Label htmlFor={`cfg-${n.chave}`}>{n.rotulo}</Label>
                  <Input id={`cfg-${n.chave}`} type="number" min={0} step={n.passo} disabled={!editavel} value={cfg[n.chave] as number}
                    onChange={e => setCfg({ ...cfg, [n.chave]: Number(e.target.value) })} />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">Preço de tabela do Google (Text Search Enterprise US$ 35 por 1.000 consultas; 1.000 grátis por mês). Configure também um teto de cota no Google Cloud.</p>
            {editavel && <Button onClick={salvar} disabled={salvando}>{salvando && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Salvar configuração</Button>}
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="border-b py-3"><CardTitle className="text-sm">Equipe comercial</CardTitle></CardHeader>
          <CardContent className="p-4 space-y-3">
            <ul className="divide-y text-sm">
              {equipe.map(m => (
                <li key={m.profile_id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0"><span className="font-medium">{m.nome}</span> <span className="text-xs text-muted-foreground">{m.email}</span></span>
                  <span className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline">{m.ativo ? m.papel : `${m.papel} (inativo)`}</Badge>
                    {editavel && m.papel !== "dono" && m.ativo && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => remover(m.profile_id)}>Desativar</Button>}
                  </span>
                </li>
              ))}
            </ul>
            {editavel && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1 flex-1 min-w-[12rem]">
                  <Label htmlFor="eq-email" className="text-xs">E-mail de uma conta interna (sem clínica)</Label>
                  <Input id="eq-email" value={email} onChange={e => setEmail(e.target.value)} placeholder="pessoa@odontoconnect.tech" />
                </div>
                <Select value={papel} onValueChange={setPapel}>
                  <SelectTrigger className="w-32" aria-label="Papel"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gestor">Gestor</SelectItem>
                    <SelectItem value="vendedor">Vendedor</SelectItem>
                    <SelectItem value="sdr">SDR</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={incluir} disabled={!email.trim()}>Incluir</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const ROTULO_ACAO: Record<string, string> = {
  busca_places: "Busca no Google", scraper_job_criado: "Coleta no Google Maps (scraper)", scraper_job_cancelado: "Coleta cancelada", previa_scraper: "Prévia de coleta", previa_csv: "Prévia de CSV", importacao: "Importação", lead_alterado: "Lead alterado",
  dados_confirmados: "Dados confirmados", nao_contatar: "Não contatar", detalhes_places: "Consulta ao Google",
  config_alterada: "Configuração alterada", equipe_incluida: "Pessoa incluída", equipe_desativada: "Pessoa desativada",
};

function Auditoria() {
  const [itens, setItens] = useState<RegistroAuditoria[] | null>(null);
  useEffect(() => { comercialApi.auditoria().then(r => r.error ? toast.error(r.error) : setItens(r.data?.data ?? [])); }, []);
  if (!itens) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>;
  const resumo = (d: Record<string, unknown>) => {
    const partes: string[] = [];
    if (d.cidade) partes.push(`${d.cidade}/${d.uf}`);
    if (d.importados != null) partes.push(`${d.importados} importados, ${d.pulados} pulados`);
    if (d.nome_arquivo) partes.push(String(d.nome_arquivo));
    if (d.gasto_usd != null) partes.push(`US$ ${Number(d.gasto_usd).toFixed(3)}`);
    if (d.origem_declarada) partes.push(`origem: ${d.origem_declarada}`);
    return partes.join(" · ");
  };
  return (
    <div className="rounded-lg border bg-background overflow-x-auto">
      <Table>
        <TableHeader><TableRow><TableHead>Quando</TableHead><TableHead>Quem</TableHead><TableHead>Ação</TableHead><TableHead className="hidden md:table-cell">Detalhe</TableHead></TableRow></TableHeader>
        <TableBody>
          {itens.length === 0 && <TableRow><TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">Nenhum registro ainda.</TableCell></TableRow>}
          {itens.map(a => (
            <TableRow key={a.id}>
              <TableCell className="text-xs tabular-nums whitespace-nowrap">{new Date(a.criado_em).toLocaleString("pt-BR")}</TableCell>
              <TableCell className="text-xs">{a.ator_nome ?? "—"} <span className="text-muted-foreground">({a.ator_papel})</span></TableCell>
              <TableCell className="text-xs">{ROTULO_ACAO[a.acao] ?? a.acao}</TableCell>
              <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{resumo(a.detalhe)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
