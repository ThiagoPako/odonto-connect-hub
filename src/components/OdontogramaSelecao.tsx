import { LateralToothSVG } from "@/components/OdontogramaChart";
import { cn } from "@/lib/utils";

/**
 * Odontograma em SVG para marcar dentes (pedido de exame). Substitui as imagens PNG que vinham do
 * Lovable (`src/assets/odontograma-*.png.asset.json`, caminho /__l5e/… que dá 404 em produção).
 * Usa o mesmo traçado de dente do OdontogramaChart (vista lateral). Numeração FDI; cada linha é
 * uma fileira: lado direito do paciente (à esquerda na tela) | lado esquerdo.
 *
 * Cores: traço e número herdam a cor do texto do lugar (currentColor), para funcionar tanto em telas
 * com tokens quanto no formulário de pedido (sempre branco, para impressão); o dente marcado usa
 * --primary. A marcação também é indicada por aria-pressed e pelo número em negrito.
 */
export interface LinhaDentes {
  titulo: string;
  dir: number[];
  esq: number[];
}

/** Decíduo (51–85) desenhado com o formato do permanente equivalente: 5x→1x, 6x→2x, 7x→3x, 8x→4x; molares 4–5 → 6–7. */
function numeroDoDesenho(n: number): number {
  const q = Math.floor(n / 10);
  const u = n % 10;
  if (q < 5) return n;
  const qp = q - 4;
  const up = u >= 4 ? u + 2 : u;
  return qp * 10 + up;
}

function Dente({ n, marcado, onToggle }: { n: number; marcado: boolean; onToggle: (n: number) => void }) {
  const deciduo = n >= 51;
  const superior = Math.floor(numeroDoDesenho(n) / 10) <= 2;
  const desenho = (
    <span className={cn("block mx-auto", deciduo ? "w-[78%]" : "w-full")} style={{ aspectRatio: "28 / 52" }} aria-hidden="true">
      <LateralToothSVG
        numero={numeroDoDesenho(n)}
        status="saudavel"
        color={marcado ? "var(--color-primary)" : "currentColor"}
        fillColor={marcado ? "color-mix(in srgb, var(--color-primary) 28%, transparent)" : "transparent"}
      />
    </span>
  );
  const numero = (
    <span className={cn("block text-center text-xs leading-4 tabular-nums", marcado ? "font-bold" : "font-medium opacity-80")}>{n}</span>
  );
  return (
    <button
      type="button"
      onClick={() => onToggle(n)}
      aria-pressed={marcado}
      aria-label={`Dente ${n}`}
      title={`Dente ${n}`}
      className={cn(
        "min-w-0 min-h-11 rounded-md px-0.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        marcado ? "bg-primary/10" : "hover:bg-black/5",
      )}
    >
      {/* Superior: coroa embaixo, número em cima (perto da coroa fica a linha de oclusão) */}
      {superior ? (<>{numero}{desenho}</>) : (<>{desenho}{numero}</>)}
    </button>
  );
}

export function OdontogramaSelecao({
  linhas,
  selecionados,
  onToggle,
  rotulo = "Odontograma",
}: {
  linhas: LinhaDentes[];
  selecionados: Set<number>;
  onToggle: (n: number) => void;
  rotulo?: string;
}) {
  return (
    <div role="group" aria-label={rotulo} className="space-y-3 select-none">
      {linhas.map((l) => {
        // Mesmo número de colunas em todas as fileiras: os decíduos ficam alinhados junto da linha média
        const max = Math.max(...linhas.flatMap((x) => [x.dir.length, x.esq.length]));
        return (
          <div key={l.titulo}>
            <p className="text-xs font-semibold opacity-80 mb-1">{l.titulo}</p>
            {/* No celular, cada lado numa linha; a partir de 640 px, os dois lados lado a lado */}
            <div className="flex flex-col sm:flex-row sm:items-end gap-1 sm:gap-0">
              <div className="grid flex-1 gap-0.5 sm:pr-1.5 sm:border-r-2 sm:border-current/30" style={{ gridTemplateColumns: `repeat(${max}, minmax(0, 1fr))` }}>
                {l.dir.length < max && <span style={{ gridColumn: `span ${max - l.dir.length}` }} />}
                {l.dir.map((n) => <Dente key={n} n={n} marcado={selecionados.has(n)} onToggle={onToggle} />)}
              </div>
              <div className="grid flex-1 gap-0.5 sm:pl-1.5" style={{ gridTemplateColumns: `repeat(${max}, minmax(0, 1fr))` }}>
                {l.esq.map((n) => <Dente key={n} n={n} marcado={selecionados.has(n)} onToggle={onToggle} />)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
