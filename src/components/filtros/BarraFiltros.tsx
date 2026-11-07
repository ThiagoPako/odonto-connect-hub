import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, SlidersHorizontal, X, RotateCcw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * Barra de filtros padrão das telas internas.
 *
 * - Busca com debounce (o pai recebe o termo já "assentado").
 * - Filtros em select com rótulo visível; "Todos" é o valor neutro ("").
 * - Contagem de filtros ativos e "Limpar filtros".
 * - No celular (< 768 px) os filtros ficam num Sheet "Filtros (n)".
 * - Nada de reticências: tudo quebra linha.
 *
 * O termo de busca NUNCA deve ir para a URL (pode conter nome/telefone/CPF de paciente — LGPD).
 * Para filtros não sensíveis (status, período, tipo) use `useFiltroUrl`.
 */

export interface OpcaoFiltro {
  valor: string;
  rotulo: string;
}

export interface FiltroSelect {
  id: string;
  rotulo: string;
  /** "" = todos */
  valor: string;
  opcoes: OpcaoFiltro[];
  onChange: (valor: string) => void;
  /** Texto da opção neutra. Padrão: "Todos". Use `null` para não oferecer opção neutra. */
  rotuloTodos?: string | null;
  /** Largura mínima no desktop (classe Tailwind). Padrão: min-w-[10rem]. */
  className?: string;
}

const TODOS = "__todos__";

export interface BarraFiltrosProps {
  busca?: {
    valor: string;
    onChange: (valor: string) => void;
    placeholder: string;
    /** Rótulo acessível (leitor de tela). Padrão: placeholder. */
    rotulo?: string;
    /** ms; padrão 250 */
    debounce?: number;
  };
  filtros?: FiltroSelect[];
  /** Controles de filtro extras (ex.: faixa de idade). Aparecem junto dos selects e dentro do Sheet. */
  extras?: ReactNode;
  /** Quantos dos `extras` estão ativos (somado à contagem). */
  extrasAtivos?: number;
  /** Zera todos os filtros (inclusive a busca, se o pai quiser). */
  onLimpar?: () => void;
  /** Ex.: "12 pacientes". Mostrado quando há filtro ativo. */
  resultado?: string;
  /** Botões de ação principais (ex.: "Novo paciente"), à direita. */
  acoes?: ReactNode;
  /** "auto": selects na linha no desktop e Sheet no celular. "sheet": sempre no Sheet (painéis estreitos, ex.: lista do chat). */
  modo?: "auto" | "sheet";
  className?: string;
}

function contarFiltrosAtivos(filtros: FiltroSelect[] = [], extras = 0) {
  return filtros.filter((f) => f.valor !== "").length + extras;
}

function CampoBusca({ busca }: { busca: NonNullable<BarraFiltrosProps["busca"]> }) {
  const [local, setLocal] = useState(busca.valor);
  const ultimoEnviado = useRef(busca.valor);
  const { onChange, debounce = 250 } = busca;

  // O pai zerou/alterou o valor (ex.: "Limpar filtros"): reflete no campo.
  useEffect(() => {
    if (busca.valor !== ultimoEnviado.current) {
      ultimoEnviado.current = busca.valor;
      setLocal(busca.valor);
    }
  }, [busca.valor]);

  useEffect(() => {
    if (local === ultimoEnviado.current) return;
    const t = setTimeout(() => {
      ultimoEnviado.current = local;
      onChange(local);
    }, debounce);
    return () => clearTimeout(t);
  }, [local, debounce, onChange]);

  return (
    <div className="relative flex-1 min-w-[min(100%,14rem)] sm:max-w-md">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden />
      <input
        type="search"
        aria-label={busca.rotulo ?? busca.placeholder}
        placeholder={busca.placeholder}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        className="w-full h-10 pl-10 pr-9 rounded-xl bg-card border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 [&::-webkit-search-cancel-button]:hidden"
      />
      {local && (
        <button
          type="button"
          onClick={() => {
            setLocal("");
            ultimoEnviado.current = "";
            onChange("");
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label="Limpar busca"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function CampoSelect({ f, empilhado }: { f: FiltroSelect; empilhado?: boolean }) {
  const id = `filtro-${f.id}`;
  const semTodos = f.rotuloTodos === null;
  const ativo = f.valor !== "";
  return (
    <div className={cn("flex flex-col gap-1", empilhado ? "w-full" : cn("min-w-[10rem]", f.className))}>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {f.rotulo}
      </label>
      <Select value={f.valor === "" && !semTodos ? TODOS : f.valor} onValueChange={(v) => f.onChange(v === TODOS ? "" : v)}>
        <SelectTrigger
          id={id}
          className={cn(
            "min-h-10 h-auto py-2 rounded-xl bg-card border-border/60 text-left whitespace-normal [&>span]:line-clamp-none",
            ativo && !semTodos && "border-primary/40 bg-primary/5 text-primary font-medium",
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {!semTodos && <SelectItem value={TODOS}>{f.rotuloTodos ?? "Todos"}</SelectItem>}
          {f.opcoes.map((o) => (
            <SelectItem key={o.valor} value={o.valor}>
              {o.rotulo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function BarraFiltros({
  busca,
  filtros = [],
  extras,
  extrasAtivos = 0,
  onLimpar,
  resultado,
  acoes,
  modo = "auto",
  className,
}: BarraFiltrosProps) {
  const telaPequena = useIsMobile();
  const isMobile = modo === "sheet" || telaPequena;
  const [sheetAberto, setSheetAberto] = useState(false);
  const ativos = contarFiltrosAtivos(filtros, extrasAtivos);
  const temFiltros = filtros.length > 0 || !!extras;
  const algoAtivo = ativos > 0 || !!busca?.valor;

  const botaoLimpar = onLimpar && algoAtivo && (
    <Button type="button" variant="ghost" size="sm" onClick={onLimpar} className="h-10 gap-1.5 text-muted-foreground hover:text-foreground">
      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
      Limpar filtros
    </Button>
  );

  return (
    <div className={cn("space-y-2", className)} role="search">
      <div className="flex flex-wrap items-end gap-3">
        {busca && <CampoBusca busca={busca} />}

        {temFiltros && isMobile && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setSheetAberto(true)}
            className={cn("h-10 rounded-xl gap-2", ativos > 0 && "border-primary/40 bg-primary/5 text-primary")}
            aria-label={ativos > 0 ? `Filtros, ${ativos} ativo${ativos > 1 ? "s" : ""}` : "Filtros"}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            Filtros{ativos > 0 ? ` (${ativos})` : ""}
          </Button>
        )}

        {temFiltros && !isMobile && (
          <>
            {filtros.map((f) => (
              <CampoSelect key={f.id} f={f} />
            ))}
            {extras}
          </>
        )}

        {!isMobile && botaoLimpar}

        {acoes && <div className="flex flex-wrap items-center gap-2 ml-auto">{acoes}</div>}
      </div>

      {algoAtivo && resultado && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {resultado}
          {isMobile && onLimpar && (
            <button type="button" onClick={onLimpar} className="ml-2 font-medium text-primary underline-offset-2 hover:underline">
              Limpar filtros
            </button>
          )}
        </p>
      )}

      {temFiltros && isMobile && (
        <Sheet open={sheetAberto} onOpenChange={setSheetAberto}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
            <SheetHeader className="text-left">
              <SheetTitle>Filtros{ativos > 0 ? ` (${ativos})` : ""}</SheetTitle>
              <SheetDescription>Escolha como quer ver a lista.</SheetDescription>
            </SheetHeader>
            <div className="mt-4 flex flex-col gap-4">
              {filtros.map((f) => (
                <CampoSelect key={f.id} f={f} empilhado />
              ))}
              {extras}
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              {onLimpar && (
                <Button type="button" variant="outline" className="flex-1" onClick={onLimpar} disabled={ativos === 0}>
                  Limpar filtros
                </Button>
              )}
              <Button type="button" className="flex-1" onClick={() => setSheetAberto(false)}>
                {resultado ? `Ver ${resultado}` : "Ver resultados"}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
