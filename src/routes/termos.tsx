import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPageLayout, Campo } from "@/components/LegalPageLayout";
import { LEGAL_INFO, TERMOS_VERSAO } from "@/lib/legal";

export const Route = createFileRoute("/termos")({
  head: () => ({ meta: [{ title: "Termos de Uso — Odonto Connect" }] }),
  component: TermosPage,
});

/** Redação v2 da Helena: docs/juridico/politica-e-termos-v2.md §4. */
function TermosPage() {
  const L = LEGAL_INFO;
  return (
    <LegalPageLayout titulo="Termos de Uso" versao={TERMOS_VERSAO}>
      <p>
        Estes Termos regem o uso do {L.marca}, plataforma online de gestão para clínicas odontológicas fornecida por{" "}
        <Campo v={L.razaoSocial} />, CNPJ <Campo v={L.cnpj} />, com sede em <Campo v={L.endereco} /> ("nós"). Ao
        criar uma conta ou aceitar esta versão, a clínica ("Cliente") e seus usuários concordam com estes Termos, com
        o <a href="#anexo-i"><strong>Anexo I (Acordo de Tratamento de Dados)</strong></a> e com a{" "}
        <Link to="/privacidade">Política de Privacidade</Link>.
      </p>

      <h2>1. O serviço</h2>
      <p>
        O {L.marca} oferece agenda, prontuário, odontograma, orçamentos, financeiro, CRM, atendimento por
        WhatsApp, campanhas, integrações e recursos de inteligência artificial, conforme o plano contratado. As
        funcionalidades de cada plano estão descritas na página de planos.
      </p>

      <h2>2. Conta e responsabilidades do Cliente</h2>
      <ul>
        <li>Manter os dados de cadastro corretos e as senhas em sigilo, e criar acessos apenas para pessoas autorizadas.</li>
        <li>Responder pelo uso da plataforma por seus usuários.</li>
        <li>
          Exercer a odontologia conforme a Lei nº 5.081/1966 e as normas do Conselho Federal de Odontologia. As
          decisões clínicas, os diagnósticos, as prescrições e o conteúdo do prontuário são de responsabilidade
          exclusiva do profissional.
        </li>
        <li>
          Revisar todo conteúdo gerado por IA (transcrições, relatórios, sugestões e mensagens) antes de usá-lo. A
          IA é uma ferramenta de apoio e pode cometer erros; ela não substitui o julgamento profissional.
        </li>
        <li>
          Ter base legal para os dados que cadastra e coletar os consentimentos necessários dos pacientes,
          inclusive para gravação de consultas e para mensagens de marketing.
        </li>
        <li>
          Não usar o WhatsApp ou as campanhas para enviar spam, mensagens a quem não autorizou ou pediu
          descadastro, nem publicidade odontológica proibida (por exemplo, promessa de resultado). O Cliente
          também deve seguir as políticas do WhatsApp/Meta.
        </li>
        <li>
          Publicar para seus pacientes uma política de privacidade própria. O {L.marca} oferece um{" "}
          <Link to="/modelo-politica-clinica">modelo</Link>, que o Cliente deve revisar e completar.
        </li>
        <li>Indicar um encarregado de dados e manter o contato dele atualizado na plataforma (LGPD, art. 41).</li>
        <li>
          Coletar e guardar as autorizações dos pacientes: gravação de consultas, marketing e, para menores, a
          autorização do responsável.
        </li>
      </ul>

      <h2>3. Conteúdo e textos escritos pelo Cliente</h2>
      <p>
        3.1. São de <strong>responsabilidade exclusiva do Cliente</strong>, perante pacientes, conselhos
        profissionais e autoridades, os textos e conteúdos que ele escreve, edita ou aprova na plataforma, entre eles:
      </p>
      <ul>
        <li>mensagens de boas-vindas e de fora do horário;</li>
        <li>nomes de setores e de profissionais;</li>
        <li>modelos de campanha, reativação, follow-up e cobrança;</li>
        <li>mensagens digitadas no chat;</li>
        <li>textos sugeridos pela IA e enviados pelo Cliente;</li>
        <li>imagens e arquivos.</li>
      </ul>
      <p>3.2. O Cliente se compromete a não incluir nesses textos:</p>
      <ul>
        <li>(a) diagnóstico, procedimento ou outro dado de saúde em mensagem de marketing ou de cobrança;</li>
        <li>
          (b) publicidade vedada pela Lei nº 5.081/1966 e pelas normas do Conselho Federal de Odontologia, como
          preço ou promoção como chamariz, promessa de resultado, "antes e depois", brindes e sorteios;
        </li>
        <li>(c) ameaça, constrangimento ou exposição do paciente na cobrança (Código de Defesa do Consumidor, art. 42);</li>
        <li>(d) mensagens a quem não autorizou ou pediu para sair.</li>
      </ul>
      <p>
        3.3. A plataforma oferece <strong>proteções automáticas</strong>: bloqueio de termos proibidos na régua de
        cobrança, opt-out ("SAIR") e limites de envio. Elas são apoio e <strong>não substituem a revisão do
        Cliente</strong>. Nós não lemos nem aprovamos previamente os textos do Cliente.
      </p>
      <p>
        3.4. Se recebermos denúncia ou ordem de autoridade sobre um conteúdo do Cliente, podemos suspender o envio
        daquele texto e avisaremos o Cliente.
      </p>
      <p>
        3.5. Esta cláusula não afasta a nossa responsabilidade pelo funcionamento da plataforma nem os direitos do
        Cliente previstos em lei.
      </p>

      <h2>4. Tratamento de dados pessoais</h2>
      <p>
        Para os dados de pacientes e contatos, o Cliente é o controlador e nós somos o operador. As obrigações de
        cada parte estão no <a href="#anexo-i">Anexo I</a>.
      </p>

      <h2>5. Planos, teste grátis e pagamento</h2>
      <ul>
        <li>O período de teste grátis e os preços são os informados na contratação. O teste não exige cartão de crédito.</li>
        <li>Os planos pagos são cobrados de forma recorrente (mensal ou anual), de forma antecipada.</li>
        <li>Mudanças de preço serão avisadas com pelo menos 30 dias de antecedência e só valem a partir do ciclo seguinte.</li>
        <li>Se houver atraso no pagamento, o acesso pode ser limitado após aviso. Os dados continuam preservados para regularização ou exportação.</li>
      </ul>

      <h2>6. Cancelamento</h2>
      <ul>
        <li>O Cliente pode cancelar a qualquer momento, sem multa, pela área de assinatura ou pelos nossos canais de contato.</li>
        <li>O cancelamento interrompe as próximas cobranças, e o acesso segue até o fim do período já pago.</li>
        <li>Na primeira contratação online, o Cliente pode desistir em até 7 dias e receber o valor pago de volta (Código de Defesa do Consumidor, art. 49).</li>
        <li>Depois do cancelamento, a clínica tem 30 dias para solicitar a exportação dos seus dados.</li>
        <li>
          <strong>A guarda do prontuário é dever do Cliente</strong>: no mínimo 20 anos a partir do último registro
          (Lei nº 13.787/2018, art. 6º). Antes de cancelar, exporte os dados. Enviaremos lembretes antes de eliminar.
        </li>
        <li>
          Depois de 30 dias do cancelamento, os dados são eliminados em até{" "}
          <Campo v={L.prazoEliminacaoPosCancelamentoDias} /> dias. Depois disso não é possível recuperá-los.
        </li>
      </ul>

      <h2>7. Disponibilidade e suporte</h2>
      <p>
        Trabalhamos para manter a plataforma disponível, mas podem ocorrer manutenções e falhas de serviços de
        terceiros (como WhatsApp, Meta, OpenAI ou sistemas integrados), que não controlamos. Garantias de nível de
        serviço (SLA) valem apenas quando previstas no plano contratado.
      </p>

      <h2>8. Responsabilidade</h2>
      <p>
        Respondemos pelos danos que causarmos por descumprimento destes Termos ou da lei. Não respondemos por
        decisões clínicas, pelo conteúdo inserido pelo Cliente, por uso indevido das contas do Cliente nem por
        indisponibilidade de serviços de terceiros. Nada nestes Termos afasta direitos garantidos por lei.
      </p>

      <h2>9. Propriedade intelectual</h2>
      <p>
        O software, a marca e o conteúdo da plataforma são nossos. Os dados inseridos pelo Cliente continuam sendo do
        Cliente e dos titulares.
      </p>

      <h2>10. Alterações</h2>
      <p>
        Podemos atualizar estes Termos. Mudanças relevantes serão avisadas com antecedência na plataforma ou por
        e-mail. Se o Cliente não concordar, pode cancelar sem multa.
      </p>

      <h2>11. Lei e foro</h2>
      <p>
        Estes Termos seguem a lei brasileira. Fica eleito o foro de <Campo v={L.foro} />, ressalvado o direito do
        consumidor de propor ação no foro do seu domicílio. Contato: <Campo v={L.emailContato} mailto />.
      </p>

      <h2 id="anexo-i" className="scroll-mt-6">Anexo I: Acordo de Tratamento de Dados (LGPD)</h2>
      <ol className="list-decimal pl-6 space-y-2">
        <li>
          <strong>Papéis.</strong> O Cliente é controlador e nós somos operador dos dados de pacientes e contatos
          (art. 5º, VI e VII).
        </li>
        <li>
          <strong>Instruções.</strong> Tratamos os dados apenas para prestar o serviço e conforme as instruções do
          Cliente, dadas por estes Termos e pelas configurações da plataforma (art. 39). Se uma instrução nos parecer
          contrária à lei, avisamos o Cliente.
        </li>
        <li>
          <strong>Suboperadores.</strong> O Cliente autoriza os suboperadores listados na{" "}
          <Link to="/privacidade">Política de Privacidade</Link> (item 8). Avisaremos com{" "}
          <Campo v={L.prazoSuboperadorDias} /> dias de antecedência qualquer inclusão ou troca. O Cliente pode se opor
          e, se não houver alternativa, cancelar sem multa. Exigimos dos suboperadores obrigações equivalentes às deste
          Anexo.
        </li>
        <li>
          <strong>Transferência internacional.</strong> Quando um suboperador estiver fora do Brasil, a transferência
          segue o art. 33 da LGPD, com cláusulas contratuais. Na gravação de consultas, ela também se apoia na
          autorização específica do paciente, que o Cliente coleta pela plataforma.
        </li>
        <li>
          <strong>Inteligência artificial.</strong> Os recursos de IA ficam desligados até o Cliente ligá-los. O
          provedor não usa os dados para treino. A retenção técnica no provedor é a informada na Política e será
          atualizada se mudar.
        </li>
        <li>
          <strong>Segurança.</strong> Mantemos medidas técnicas e administrativas adequadas (art. 46): criptografia em
          trânsito, isolamento por clínica, controle de acesso, registro de acesso ao prontuário, áudio apagado após a
          transcrição e logs sem dados de pacientes.
        </li>
        <li>
          <strong>Incidentes.</strong> Avisamos o Cliente em até <Campo v={L.prazoIncidenteHoras} /> horas depois de
          confirmar um incidente que afete os dados dele. O aviso traz o que se sabe sobre a natureza dos dados, os
          titulares afetados, as medidas tomadas e os riscos, para que o Cliente faça as comunicações do art. 48.
        </li>
        <li>
          <strong>Direitos dos titulares.</strong> Oferecemos ferramentas para o Cliente atender os pedidos de acesso,
          exportação, correção, exclusão e anonimização (arts. 18 e 19). Pedidos que chegarem a nós são encaminhados
          ao Cliente em até 2 dias úteis.
        </li>
        <li>
          <strong>Sigilo.</strong> Nossa equipe só acessa dados de pacientes quando necessário para suporte ou
          segurança, sob dever de sigilo e com registro.
        </li>
        <li>
          <strong>Sem uso próprio.</strong> Não usamos os dados do Cliente para fins próprios, publicidade, venda ou
          treino de IA.
        </li>
        <li>
          <strong>Fim do contrato.</strong> Disponibilizamos a exportação por 30 dias e depois eliminamos os dados,
          salvo o que a lei nos obrigue a guardar (art. 16, I).
        </li>
        <li>
          <strong>Prestação de contas.</strong> Mantemos registro das operações de tratamento (art. 37). Mediante
          pedido justificado, fornecemos ao Cliente as informações necessárias para demonstrar a conformidade e para o
          relatório de impacto (art. 38).
        </li>
        <li>
          <strong>Responsabilidade.</strong> Cada parte responde pelos danos que causar por descumprir a LGPD ou este
          Anexo. O operador responde solidariamente nos casos do art. 42, §1º, I, da LGPD.
        </li>
        <li>
          <strong>Pedidos de autoridades.</strong> Se uma autoridade pedir dados do Cliente, avisamos o Cliente antes
          de responder, salvo se a lei ou a ordem proibir.
        </li>
      </ol>
    </LegalPageLayout>
  );
}
