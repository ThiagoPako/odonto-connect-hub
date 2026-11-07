import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Star, UploadCloud } from "lucide-react";
import type { ItemPrevia, MembroEquipe, Previa, StatusItem } from "@/lib/comercialApi";

const ESTILO_STATUS: Record<StatusItem, { rotulo: string; classe: string }> = {
  novo: { rotulo: "Novo", classe: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" },
  duplicado: { rotulo: "Duplicado", classe: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20" },
  descartado: { rotulo: "Descartado", classe: "bg-muted text-muted-foreground" },
  nao_contatar: { rotulo: "Não contatar", classe: "bg-destructive/10 text-destructive border-destructive/20" },
};

type Filtro = "todos" | StatusItem;

export function PreviaLeads({
  previa, equipe, podeAtribuir, importando, onImportar, exigeOrigem,
}: {
  previa: Previa;
  equipe: MembroEquipe[];
  podeAtribuir: boolean;
  importando: boolean;
  exigeOrigem: boolean;
  onImportar: (args: { chaves: string[]; dono_id: string | null; campanha: string; origem_declarada: string; base_legal_confirmada: boolean }) => void;
}) {
  const novos = useMemo(() => previa.itens.filter(i => i.status === "novo").map(i => i.chave), [previa]);
  const [selecionados, setSelecionados] = useState<Set<string>>(() => new Set(novos));
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [dono, setDono] = useState<string>("sem");
  const [campanha, setCampanha] = useState("");
  const [origem, setOrigem] = useState(previa.formato === "google-maps-scraper-kit" ? "google-maps-scraper-kit rodado pelo dono" : "");
  const [baseLegal, setBaseLegal] = useState(false);

  const r = previa.resumo;
  const visiveis = filtro === "todos" ? previa.itens : previa.itens.filter(i => i.status === filtro);
  const alternar = (chave: string) => setSelecionados(s => { const n = new Set(s); if (n.has(chave)) n.delete(chave); else n.add(chave); return n; });
  const motivos = Object.entries(r.motivos_descarte);
  const podeImportar = selecionados.size > 0 && (!exigeOrigem || (origem.trim() && baseLegal));

  const chip = (f: Filtro, rotulo: string, n: number) => (
    <button
      type="button"
      onClick={() => setFiltro(f)}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filtro === f ? "bg-foreground text-background" : "bg-background hover:bg-muted"}`}
      aria-pressed={filtro === f}
    >
      {rotulo} <span className="tabular-nums">{n}</span>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar prévia">
        {chip("todos", "Todos", r.total)}
        {chip("novo", "Serão importados", r.novos)}
        {chip("duplicado", "Já no CRM / repetidos", r.duplicados)}
        {chip("descartado", "Fora do segmento", r.descartados)}
        {chip("nao_contatar", "Não contatar", r.nao_contatar)}
      </div>
      {(motivos.length > 0 || r.ja_clientes > 0 || previa.custo) && (
        <p className="text-xs text-muted-foreground">
          {motivos.length > 0 && <>Descartados: {motivos.map(([m, n]) => `${m} (${n})`).join(", ")}. </>}
          {r.ja_clientes > 0 && <>{r.ja_clientes} já {r.ja_clientes === 1 ? "é cliente" : "são clientes"} (marcado na lista). </>}
          {previa.custo && <>Consultas ao Google: {previa.custo.chamadas} (+{previa.custo.cache} do cache), gasto estimado US$ {previa.custo.gasto_usd.toFixed(3)}.{previa.custo.parou_por_limite_da_busca && " Parou no limite de custo por busca."}</>}
          {previa.excedeu_limite && <> O arquivo passou de {previa.limite_linhas} linhas: só as primeiras foram lidas.</>}
        </p>
      )}

      <div className="rounded-lg border bg-background overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><span className="sr-only">Importar</span></TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Clínica</TableHead>
              <TableHead className="hidden md:table-cell">Contato</TableHead>
              <TableHead className="hidden lg:table-cell">Avaliação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">Nada nesta categoria.</TableCell></TableRow>
            )}
            {visiveis.map(item => <LinhaPrevia key={item.chave} item={item} marcado={selecionados.has(item.chave)} onAlternar={alternar} />)}
          </TableBody>
        </Table>
      </div>
      {previa.fonte === "google_places" && (
        <p className="text-[11px] text-muted-foreground">Dados: Google Maps. Do Google só o identificador do local (place_id) fica guardado; nome e telefone voltam a ser consultados quando o vendedor abre o lead, até ele confirmar os dados com a clínica.</p>
      )}

      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {podeAtribuir && (
            <div className="grid gap-1.5">
              <Label htmlFor="imp-dono">Responsável</Label>
              <Select value={dono} onValueChange={setDono}>
                <SelectTrigger id="imp-dono"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sem">Sem responsável (fila do time)</SelectItem>
                  {equipe.filter(m => m.ativo).map(m => <SelectItem key={m.profile_id} value={m.profile_id}>{m.nome} · {m.papel}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="imp-campanha">Campanha (opcional)</Label>
            <Input id="imp-campanha" value={campanha} onChange={e => setCampanha(e.target.value)} placeholder="Ex.: Campinas novembro" maxLength={120} />
          </div>
          {exigeOrigem && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="imp-origem">De onde vieram estes contatos? (obrigatório)</Label>
              <Input id="imp-origem" value={origem} onChange={e => setOrigem(e.target.value)} placeholder="Ex.: base própria, evento CIOSP 2026, google-maps-scraper-kit" maxLength={200} />
            </div>
          )}
        </div>
        {exigeOrigem && (
          <div className="flex items-start gap-2 text-sm">
            <Checkbox id="imp-base-legal" checked={baseLegal} onCheckedChange={v => setBaseLegal(v === true)} className="mt-0.5" />
            <label htmlFor="imp-base-legal">Confirmo que estes contatos são de empresas (B2B), que temos base legal para contatá-los (legítimo interesse) e que a origem acima é verdadeira.</label>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Contato frio: só ligação ou e-mail 1 a 1. WhatsApp só depois de a clínica autorizar.</p>
          <Button
            disabled={!podeImportar || importando}
            onClick={() => onImportar({ chaves: [...selecionados], dono_id: dono === "sem" ? null : dono, campanha, origem_declarada: origem, base_legal_confirmada: baseLegal })}
            className="gap-2"
          >
            {importando ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            Importar {selecionados.size} {selecionados.size === 1 ? "lead" : "leads"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LinhaPrevia({ item, marcado, onAlternar }: { item: ItemPrevia; marcado: boolean; onAlternar: (c: string) => void }) {
  const est = ESTILO_STATUS[item.status];
  const importavel = item.status === "novo";
  return (
    <TableRow className={importavel ? "" : "opacity-70"}>
      <TableCell>
        {importavel && <Checkbox checked={marcado} onCheckedChange={() => onAlternar(item.chave)} aria-label={`Importar ${item.clinica_nome ?? "lead"}`} />}
      </TableCell>
      <TableCell className="align-top">
        <Badge variant="outline" className={est.classe}>{est.rotulo}</Badge>
        {item.motivo && <p className="mt-1 text-[11px] text-muted-foreground max-w-[14rem]">{item.motivo}</p>}
      </TableCell>
      <TableCell className="align-top">
        <p className="font-medium leading-tight">{item.clinica_nome || "—"}</p>
        <p className="text-xs text-muted-foreground">{[item.categoria, [item.cidade, item.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ")}</p>
        {item.ja_cliente && <Badge variant="outline" className="mt-1 text-[10px] border-primary/30 text-primary">Já é cliente: {item.ja_cliente.nome}</Badge>}
      </TableCell>
      <TableCell className="hidden md:table-cell align-top text-sm">
        {item.telefone_comercial && (
          <p className="tabular-nums">
            {item.telefone_comercial}
            {item.telefone_celular && <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-400" title="Celular: pode ser o número pessoal do dentista (dado pessoal, LGPD)">celular</span>}
          </p>
        )}
        {item.email_comercial && (
          <p className="text-xs break-all">
            {item.email_comercial}
            {item.email_pessoal && <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-400" title="E-mail pessoal (provedor gratuito): dado pessoal, LGPD">pessoal</span>}
          </p>
        )}
        {item.site && <a href={item.site.startsWith("http") ? item.site : `https://${item.site}`} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-primary hover:underline break-all">{item.site.replace(/^https?:\/\/(www\.)?/, "")}</a>}
      </TableCell>
      <TableCell className="hidden lg:table-cell align-top text-sm tabular-nums">
        {item.nota_avaliacao != null ? (
          <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{item.nota_avaliacao.toFixed(1)} <span className="text-xs text-muted-foreground">({item.total_avaliacoes ?? 0})</span></span>
        ) : "—"}
      </TableCell>
    </TableRow>
  );
}
