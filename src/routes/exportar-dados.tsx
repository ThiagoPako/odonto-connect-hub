import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Download, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { exportacaoApi, type ExportacaoGrupo } from "@/lib/vpsApi";

export const Route = createFileRoute("/exportar-dados")({
  ssr: false,
  component: ExportarDadosPage,
});

function ExportarDadosPage() {
  const [grupos, setGrupos] = useState<ExportacaoGrupo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);

  const carregar = async () => {
    setErro(null);
    setGrupos(null);
    const r = await exportacaoApi.listar();
    if (r.error || !r.data) { setErro(r.error || "Não foi possível carregar"); setGrupos([]); return; }
    setGrupos(r.data.grupos);
  };
  useEffect(() => { void carregar(); }, []);

  const baixar = async (tabela: string, nome: string) => {
    setBaixando(tabela);
    const r = await exportacaoApi.baixar(tabela);
    setBaixando(null);
    if (r.error) toast.error(`${nome}: ${r.error}`);
    else toast.success(`${nome} baixado`);
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Exportar dados" />
      <div className="flex-1 p-4 sm:p-6 overflow-auto space-y-6 max-w-5xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden /> Seus dados são da clínica
            </CardTitle>
            <CardDescription className="text-pretty">
              Baixe uma cópia em planilha (CSV) de cada conjunto de dados. A exportação fica disponível sempre,
              inclusive com a assinatura vencida. A guarda do prontuário por no mínimo 20 anos é obrigação da clínica
              (Lei 13.787/2018): guarde os arquivos em local seguro, pois contêm dados de saúde.
            </CardDescription>
          </CardHeader>
        </Card>

        {grupos === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando…
          </div>
        ) : erro ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <span className="text-destructive">{erro}</span>
            <Button size="sm" variant="outline" onClick={() => void carregar()}>
              <RefreshCw className="h-4 w-4 mr-2" aria-hidden /> Tentar de novo
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {grupos.map((g) => (
              <Card key={g.grupo}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">{g.grupo}</CardTitle>
                </CardHeader>
                <CardContent className="divide-y">
                  {g.tabelas.map((t) => (
                    <div key={t.tabela} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{t.nome}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.registros.toLocaleString("pt-BR")} registro{t.registros !== 1 ? "s" : ""}
                        </div>
                      </div>
                      <Button
                        size="sm" variant="outline"
                        disabled={baixando !== null || t.registros === 0}
                        onClick={() => void baixar(t.tabela, t.nome)}
                        aria-label={`Baixar ${t.nome} em CSV`}
                      >
                        {baixando === t.tabela
                          ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          : <Download className="h-4 w-4" aria-hidden />}
                        <span className="ml-2">CSV</span>
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
