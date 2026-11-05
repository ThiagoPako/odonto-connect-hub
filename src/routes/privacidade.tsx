import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPageLayout, Campo } from "@/components/LegalPageLayout";
import { LEGAL_INFO, POLITICA_VERSAO, DOCUMENTOS_ATUALIZADOS_EM, pendente } from "@/lib/legal";

export const Route = createFileRoute("/privacidade")({
  head: () => ({ meta: [{ title: "Política de Privacidade — Odonto Connect" }] }),
  component: PrivacidadePage,
});

/** Redação v2 da Helena: docs/juridico/politica-e-termos-v2.md §3. */
function PrivacidadePage() {
  const L = LEGAL_INFO;
  return (
    <LegalPageLayout titulo={`Política de Privacidade do ${L.marca}`} versao={POLITICA_VERSAO}>
      <p>
        Esta Política explica como o {L.marca}, fornecido por <Campo v={L.razaoSocial} />, CNPJ <Campo v={L.cnpj} />,
        com sede em <Campo v={L.endereco} />, trata dados pessoais, de acordo com a Lei Geral de Proteção de Dados
        Pessoais (Lei nº 13.709/2018, LGPD), o Marco Civil da Internet (Lei nº 12.965/2014) e a Lei nº 13.787/2018.
      </p>

      <aside className="rounded-lg border border-primary/30 bg-accent px-5 py-4 text-accent-foreground" aria-label="Aviso para pacientes">
        <p className="font-semibold">É paciente de uma clínica?</p>
        <p className="mt-1">
          Quem decide como seus dados de saúde são usados é a <strong>sua clínica</strong>, e a política que vale
          para você é a dela. Nós somos o sistema que a clínica usa. Para pedir acesso, correção ou exclusão dos
          seus dados, fale com a clínica. Se o pedido chegar a nós, encaminhamos a ela em até 2 dias úteis.
        </p>
      </aside>

      <h2>Parte A: quando somos controladores</h2>

      <h3>1. De quem são os dados</h3>
      <p>Das clínicas clientes e de seus usuários (dentistas, recepção e administradores) e dos visitantes do nosso site.</p>

      <h3>2. Quais dados</h3>
      <ul>
        <li>Cadastro: nome, e-mail, telefone, cargo ou perfil de acesso, nome e CNPJ da clínica.</li>
        <li>Acesso e segurança: IP, data e hora, navegador e ações na plataforma.</li>
        <li>
          Assinatura: plano, histórico de pagamentos e dados de faturamento.
          {pendente(L.pagamentos) ? (
            <> <Campo v={L.pagamentos} /></>
          ) : L.pagamentos ? (
            <> O pagamento é processado por {L.pagamentos}; não guardamos o número do cartão.</>
          ) : null}
        </li>
        <li>Site: páginas visitadas e origem da visita (parâmetros UTM).</li>
      </ul>

      <h3>3. Para quê e com qual base legal</h3>
      <ul>
        <li>Prestar o serviço e administrar a conta: execução de contrato (art. 7º, V).</li>
        <li>Cobrança e obrigações fiscais: execução de contrato e obrigação legal (art. 7º, II e V).</li>
        <li>
          Segurança, prevenção a fraude e guarda dos registros de acesso: obrigação legal (Marco Civil, art. 15) e
          legítimo interesse (art. 7º, IX).
        </li>
        <li>Avisos sobre o serviço, como mudanças, incidentes e cobrança: execução de contrato.</li>
        <li>
          Comunicações comerciais do {L.marca} para as clínicas: legítimo interesse, com opção de descadastro em
          toda mensagem.
        </li>
      </ul>

      <h3>4. Por quanto tempo</h3>
      <ul>
        <li>Registros de acesso à aplicação: 6 meses (Marco Civil, art. 15) ou mais, se houver ordem ou processo.</li>
        <li>Dados da conta: enquanto o contrato durar.</li>
        <li>
          Dados fiscais: pelo prazo da legislação tributária, que é de 5 anos contados do ano seguinte ao do
          lançamento (CTN, arts. 173 e 195).
        </li>
      </ul>

      <h2>Parte B: quando somos operadores (dados de pacientes)</h2>

      <h3>5. Nosso papel</h3>
      <p>
        Os dados de pacientes e contatos que a clínica cadastra pertencem à relação entre a clínica e o paciente.
        A <strong>clínica é a controladora</strong>, e nós tratamos esses dados <strong>apenas para prestar o
        serviço e conforme as instruções dela</strong> (LGPD, arts. 5º, VI e VII, e 39). As regras completas estão
        no Acordo de Tratamento de Dados (<Link to="/termos" hash="anexo-i">Anexo I dos Termos de Uso</Link>).
      </p>

      <h3>6. Quais dados passam pelo sistema</h3>
      <ul>
        <li>Identificação e contato do paciente.</li>
        <li>
          <strong>Dados de saúde (dados sensíveis):</strong> prontuário, anamnese, odontograma, exames, laudos,
          imagens, prescrições, planos de tratamento e orçamentos.
        </li>
        <li>Mensagens trocadas com a clínica pelo WhatsApp.</li>
        <li>
          Assinatura eletrônica, com data, hora, IP e, quando a clínica usa, a localização no momento da assinatura.
        </li>
        <li>
          Áudio da consulta, <strong>só com a autorização do paciente</strong>. O áudio é apagado logo depois da
          transcrição.
        </li>
      </ul>

      <h3>7. Recursos de inteligência artificial</h3>
      <p>Eles só funcionam quando a clínica os liga:</p>
      <ul>
        <li>
          <strong>Transcrição de consulta:</strong> o áudio vai para a OpenAI (EUA) e volta como texto. Exige a
          autorização do paciente.
        </li>
        <li>
          <strong>Relatório clínico:</strong> o texto transcrito vai para a OpenAI, que monta um rascunho. O
          dentista revisa antes de salvar.
        </li>
        <li>
          <strong>Sugestão de mensagens de acompanhamento:</strong> usa o relatório clínico (dado de saúde),
          envia-o à OpenAI e devolve sugestões de texto. A equipe revisa antes de qualquer envio.
        </li>
        <li>
          <strong>Análise de campanhas de anúncios:</strong> envia à OpenAI só números agregados das campanhas
          (gasto, cliques, leads), <strong>sem dado de paciente</strong>.
        </li>
      </ul>
      <p>
        A IA não toma decisões sobre ninguém: tudo é revisado por uma pessoa da clínica. A OpenAI não usa os dados
        para treinar modelos.{" "}
        {L.iaRetencao === "30 dias" ? (
          "Ela mantém registros técnicos de segurança por até 30 dias e depois os apaga."
        ) : L.iaRetencao === "zero" ? (
          "Contratamos retenção zero: a OpenAI não guarda o conteúdo."
        ) : (
          <Campo v={L.iaRetencao} />
        )}
      </p>

      <h3>8. Com quem os dados são compartilhados (suboperadores)</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse [&_th]:py-2 [&_th]:pr-4 [&_th]:font-semibold [&_th]:border-b [&_th]:border-border [&_td]:py-2 [&_td]:pr-4 [&_td]:align-top [&_td]:border-b [&_td]:border-border">
          <thead>
            <tr><th>Fornecedor</th><th>Para quê</th><th>País</th></tr>
          </thead>
          <tbody>
            <tr><td><Campo v={L.hospedagem} /></td><td>Servidores e banco de dados</td><td><Campo v={L.hospedagemPais} /></td></tr>
            <tr><td><Campo v={L.backups} /></td><td>Cópias de segurança</td><td><Campo v={L.backupsPais} /></td></tr>
            <tr><td>OpenAI</td><td>Recursos de IA do item 7</td><td>Estados Unidos</td></tr>
            <tr><td>WhatsApp / Meta</td><td>Envio e recebimento de mensagens, quando a clínica conecta o número</td><td>Estados Unidos</td></tr>
            <tr><td>Meta (anúncios)</td><td>Métricas de campanhas, quando a clínica conecta a conta</td><td>Estados Unidos</td></tr>
            <tr><td>Clinicorp</td><td>Sincronização de cadastro e agenda, quando a clínica ativa a integração</td><td>Brasil</td></tr>
            <tr><td>Serviços de notificação dos navegadores (Google, Apple, Mozilla)</td><td>Avisos na tela da equipe da clínica</td><td>Variável</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Também compartilhamos com autoridades públicas quando houver obrigação legal ou ordem judicial. Não vendemos
        dados. Não usamos dados de pacientes para fins próprios, publicidade ou treino de IA.
      </p>

      <h3>9. Transferência internacional</h3>
      <p>
        Os fornecedores fora do Brasil recebem dados com base no art. 33 da LGPD: cláusulas contratuais (inciso II)
        e, na gravação de consultas, também a autorização específica do paciente (inciso VIII).
      </p>

      <h3>10. Por quanto tempo, em nome da clínica</h3>
      <p>Quem define os prazos é a clínica, respeitando a lei:</p>
      <ul>
        <li>Prontuário: <strong>no mínimo 20 anos</strong> a partir do último registro (Lei nº 13.787/2018, art. 6º).</li>
        <li>Registro de quem abriu cada prontuário: 5 anos.</li>
        {/* Depois do merge do PR #59: "conversas 5 anos; leads e contatos 2 anos sem interação; fila de envios 1 ano". */}
        <li>Conversas, leads e fila de mensagens: conforme a configuração de retenção da clínica.</li>
        <li>Áudio: não é guardado.</li>
      </ul>

      <h3>11. Quando a clínica deixa de usar o {L.marca}</h3>
      <p>
        A clínica tem 30 dias para exportar os dados. Depois disso, e de lembretes enviados a ela, eliminamos os
        dados em até <Campo v={L.prazoEliminacaoPosCancelamentoDias} /> dias. A guarda do prontuário continua sendo
        dever da clínica.
      </p>

      <h2>Para todos</h2>

      <h3>12. Segurança</h3>
      <p>
        Usamos conexão criptografada, isolamento dos dados de cada clínica, controle de acesso por perfil, senhas
        guardadas com hash (bcrypt), registro de acesso ao prontuário e logs sem dados de pacientes. Se houver um
        incidente com risco relevante, avisamos a clínica em até <Campo v={L.prazoIncidenteHoras} /> horas e a
        apoiamos na comunicação à ANPD e aos titulares (LGPD, art. 48).
      </p>

      <h3>13. Seus direitos</h3>
      <p>
        Pela LGPD (art. 18), você pode: confirmar se tratamos seus dados e acessá-los; corrigi-los; pedir
        anonimização, bloqueio ou eliminação do que for desnecessário; pedir portabilidade; saber com quem
        compartilhamos; revogar consentimentos e saber as consequências; e reclamar à ANPD ou aos órgãos de defesa
        do consumidor. <strong>Pacientes:</strong> façam o pedido à clínica (ver o aviso no topo).
      </p>

      <h3>14. Cookies e recursos de terceiros</h3>
      <p>
        Usamos apenas o armazenamento local necessário para manter você conectado e guardar preferências. As
        fontes do site são carregadas do Google Fonts, o que envia seu endereço IP ao Google. Se você ativar as
        notificações, o navegador usa o serviço de notificação do fabricante.
      </p>

      <h3>15. Encarregado (DPO) e contato</h3>
      <p>
        Encarregado: <Campo v={L.encarregadoNome} />, <Campo v={L.emailPrivacidade} mailto />. Outros assuntos:{" "}
        <Campo v={L.emailContato} mailto />.
      </p>

      <h3>16. Alterações</h3>
      <p>
        Mudanças relevantes são avisadas na plataforma e por e-mail com antecedência. Versão {POLITICA_VERSAO}, de{" "}
        <Campo v={DOCUMENTOS_ATUALIZADOS_EM} />.
      </p>

      <p className="text-sm text-muted-foreground">
        Clínicas: o modelo de política de privacidade para os seus pacientes está em{" "}
        <Link to="/modelo-politica-clinica">modelo de política para a clínica</Link>.
      </p>
    </LegalPageLayout>
  );
}
