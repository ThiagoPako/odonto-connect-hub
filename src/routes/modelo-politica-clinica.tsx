import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Copy, Check } from "lucide-react";
import { LegalPageLayout } from "@/components/LegalPageLayout";
import { Button } from "@/components/ui/button";
import { LEGAL_INFO, MODELO_POLITICA_CLINICA_VERSAO } from "@/lib/legal";

export const Route = createFileRoute("/modelo-politica-clinica")({
  head: () => ({ meta: [{ title: "Modelo de política de privacidade para a clínica — Odonto Connect" }] }),
  component: ModeloPoliticaClinicaPage,
});

/** Campo que a clínica preenche: aparece destacado e entre chaves no texto copiado. */
function F({ children }: { children: string }) {
  return <mark className="rounded bg-warning/15 px-1 text-warning-text">{`{${children}}`}</mark>;
}

/** Modelo da Helena: docs/juridico/politica-e-termos-v2.md §5. */
function ModeloPoliticaClinicaPage() {
  const L = LEGAL_INFO;
  const texto = useRef<HTMLDivElement>(null);
  const [copiado, setCopiado] = useState<"ok" | "erro" | null>(null);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto.current?.innerText ?? "");
      setCopiado("ok");
    } catch {
      setCopiado("erro");
    }
  };

  return (
    <LegalPageLayout titulo="Modelo de política de privacidade para a clínica" versao={MODELO_POLITICA_CLINICA_VERSAO}>
      <div className="rounded-lg border border-warning/40 bg-warning/10 px-5 py-4 text-foreground">
        <p className="font-semibold">Isto é um modelo, não um parecer jurídico.</p>
        <p className="mt-1">
          A política para os pacientes é da clínica, que é a controladora dos dados (veja a{" "}
          <Link to="/privacidade">nossa Política</Link> e o <Link to="/termos" hash="anexo-i">Anexo I dos Termos</Link>).
          Copie o texto, troque cada campo destacado entre chaves pelos dados da sua clínica, revise com o seu
          advogado e publique no seu site, na recepção e no formulário de cadastro. Sem o CNPJ e o encarregado da
          clínica, não publique.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={copiar}>
          {copiado === "ok" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copiado === "ok" ? "Texto copiado" : "Copiar o modelo"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {copiado === "erro" && "Não foi possível copiar. Selecione o texto abaixo e copie manualmente."}
        </p>
      </div>

      <div ref={texto} className="rounded-lg border border-border bg-card p-5 sm:p-6 space-y-5">
        <h2 className="!mt-0">Política de privacidade da <F>clinica</F></h2>
        <p>Versão <F>versao</F>, de <F>data</F>.</p>

        <h3>1. Quem cuida dos seus dados</h3>
        <p>
          A <F>clinica</F> (<F>razao_social_clinica</F>, CNPJ <F>cnpj</F>, <F>endereco</F>) é a responsável
          (controladora) pelos seus dados. Encarregado de dados: <F>encarregado</F>, <F>email_encarregado</F>.
        </p>

        <h3>2. Para que usamos seus dados, e com qual base legal</h3>
        <ul>
          <li>
            <strong>Seu atendimento odontológico e seu prontuário:</strong> é a base da tutela da saúde (LGPD, art. 11,
            II, f) e o cumprimento da lei (art. 11, II, a).
          </li>
          <li>
            <strong>Lembretes e confirmação de consulta, e avisos de reagendamento:</strong> fazem parte do atendimento
            (art. 11, II, f, e art. 7º, V).
          </li>
          <li><strong>Cobrança e emissão de recibos:</strong> contrato e obrigação legal (art. 7º, II, V e X).</li>
          <li>
            <strong>Gravação e transcrição da consulta por inteligência artificial:</strong> <strong>só se você
            autorizar</strong> (art. 11, I). É opcional, e recusar não muda nada no seu atendimento.
          </li>
          <li>
            <strong>Novidades e campanhas da clínica:</strong> <strong>só se você autorizar</strong>. Você pode sair a
            qualquer momento respondendo SAIR. Essas mensagens nunca falam do seu tratamento.
          </li>
        </ul>

        <h3>3. Quem mais tem acesso</h3>
        <p>
          O sistema de gestão {L.marca}, que trata os dados em nosso nome. A OpenAI (Estados Unidos), só se você
          autorizar a gravação ou se usarmos a sugestão de mensagens de acompanhamento a partir do seu relatório. O
          WhatsApp (Meta), para as mensagens. <F>outros: laboratório, convênio, Clinicorp</F>. Autoridades, quando a
          lei exigir.
        </p>

        <h3>4. Dados enviados para fora do Brasil</h3>
        <p>
          OpenAI e Meta processam dados nos Estados Unidos, com garantias contratuais (LGPD, art. 33, II). Na gravação
          de consultas, também com a sua autorização específica (art. 33, VIII).
        </p>

        <h3>5. Por quanto tempo guardamos</h3>
        <ul>
          <li>Prontuário: no mínimo 20 anos desde o último registro (Lei nº 13.787/2018, art. 6º).</li>
          <li>Dados financeiros: pelo prazo da lei tributária.</li>
          <li>Conversas pelo WhatsApp: <F>prazo_conversas</F>.</li>
          <li>
            Áudio de consulta: não é guardado. É apagado logo depois da transcrição. O provedor de IA mantém registros
            técnicos por <F>retencao</F>.
          </li>
          <li>Depois dos prazos, os dados são eliminados ou, no caso do prontuário, podem ser devolvidos a você.</li>
        </ul>

        <h3>6. Seus direitos</h3>
        <p>
          Você pode pedir: confirmação e acesso aos seus dados; correção; eliminação do que não precisa ser guardado
          por lei; portabilidade; informação sobre compartilhamento; e revogação de autorizações (LGPD, art. 18).
          Respondemos em até 15 dias (art. 19). Quando algum dado precisa ser mantido por lei, explicamos qual, por quê
          e até quando. Você também pode reclamar à ANPD ou ao Procon.
        </p>

        <h3>7. Crianças e adolescentes</h3>
        <p>
          Dados de menores de 12 anos são tratados no melhor interesse deles. A gravação de consultas e as mensagens de
          campanha só ocorrem com autorização de um dos pais ou do responsável legal (LGPD, art. 14). O responsável
          exerce os direitos do item 6 pelo menor.
        </p>

        <h3>8. Inteligência artificial</h3>
        <p>
          A IA ajuda a escrever o registro e as orientações, mas <strong>quem decide é o dentista</strong>, que revisa
          tudo. Nenhuma decisão sobre você é tomada só por computador.
        </p>

        <h3>9. Segurança</h3>
        <p>
          Seus dados ficam em sistema com acesso restrito por senha e perfil, com registro de quem abriu seu
          prontuário. Se houver um incidente com risco para você, avisaremos (LGPD, art. 48).
        </p>

        <h3>10. Mudanças nesta política</h3>
        <p>
          Se mudarmos a forma de usar seus dados, avisaremos antes. Se a mudança depender da sua autorização, você
          poderá recusar.
        </p>
      </div>
    </LegalPageLayout>
  );
}
