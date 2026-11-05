import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPageLayout } from "@/components/LegalPageLayout";
import { LEGAL_INFO, TERMOS_VERSAO } from "@/lib/legal";

export const Route = createFileRoute("/termos")({
  head: () => ({ meta: [{ title: "Termos de Uso — Odonto Connect" }] }),
  component: TermosPage,
});

function TermosPage() {
  const L = LEGAL_INFO;
  return (
    <LegalPageLayout titulo="Termos de Uso" versao={TERMOS_VERSAO}>
      <p>
        Estes Termos regem o uso do {L.marca}, plataforma online de gestão para clínicas odontológicas, fornecida
        por {L.razaoSocial}, CNPJ {L.cnpj} ("nós"). Ao criar uma conta, a clínica ("Cliente") e seus usuários
        concordam com estes Termos e com a <Link to="/privacidade">Política de Privacidade</Link>.
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
      </ul>

      <h2>3. Tratamento de dados pessoais (acordo de operador)</h2>
      <p>
        Em relação aos dados de pacientes e contatos, o Cliente é o <strong>controlador</strong> e nós somos o{" "}
        <strong>operador</strong> (LGPD, arts. 5º, VI e VII, e 39). Nós nos comprometemos a:
      </p>
      <ul>
        <li>tratar os dados apenas para prestar o serviço e conforme as instruções do Cliente;</li>
        <li>manter sigilo e medidas de segurança técnicas e administrativas adequadas (art. 46);</li>
        <li>usar apenas os suboperadores listados na Política de Privacidade, exigindo deles obrigações equivalentes;</li>
        <li>avisar o Cliente sem demora indevida sobre incidente de segurança que afete seus dados (art. 48);</li>
        <li>apoiar o Cliente no atendimento aos pedidos dos titulares (art. 18);</li>
        <li>não usar dados de pacientes para fins próprios nem para treinar modelos de IA;</li>
        <li>ao fim do contrato, disponibilizar a exportação dos dados e depois eliminá-los, salvo guarda exigida por lei.</li>
      </ul>

      <h2>4. Planos, teste grátis e pagamento</h2>
      <ul>
        <li>O período de teste grátis e os preços são os informados na contratação. O teste não exige cartão de crédito.</li>
        <li>Os planos pagos são cobrados de forma recorrente (mensal ou anual), de forma antecipada.</li>
        <li>Mudanças de preço serão avisadas com pelo menos 30 dias de antecedência e só valem a partir do ciclo seguinte.</li>
        <li>Se houver atraso no pagamento, o acesso pode ser limitado após aviso. Os dados continuam preservados para regularização ou exportação.</li>
      </ul>

      <h2>5. Cancelamento</h2>
      <ul>
        <li>O Cliente pode cancelar a qualquer momento, sem multa, pela área de assinatura ou pelos nossos canais de contato.</li>
        <li>O cancelamento interrompe as próximas cobranças, e o acesso segue até o fim do período já pago.</li>
        <li>Na primeira contratação online, o Cliente pode desistir em até 7 dias e receber o valor pago de volta (Código de Defesa do Consumidor, art. 49).</li>
        <li>Depois do cancelamento, a clínica tem 30 dias para solicitar a exportação dos seus dados.</li>
      </ul>

      <h2>6. Disponibilidade e suporte</h2>
      <p>
        Trabalhamos para manter a plataforma disponível, mas podem ocorrer manutenções e falhas de serviços de
        terceiros (como WhatsApp, Meta, OpenAI ou sistemas integrados), que não controlamos. Garantias de nível
        de serviço (SLA) valem apenas quando previstas no plano contratado.
      </p>

      <h2>7. Responsabilidade</h2>
      <p>
        Respondemos pelos danos que causarmos por descumprimento destes Termos ou da lei. Não respondemos por
        decisões clínicas, pelo conteúdo inserido pelo Cliente, por uso indevido das contas do Cliente nem por
        indisponibilidade de serviços de terceiros. Nada nestes Termos afasta direitos garantidos por lei.
      </p>

      <h2>8. Propriedade intelectual</h2>
      <p>
        O software, a marca e o conteúdo da plataforma são nossos. Os dados inseridos pelo Cliente continuam
        sendo do Cliente e dos titulares.
      </p>

      <h2>9. Alterações</h2>
      <p>
        Podemos atualizar estes Termos. Mudanças relevantes serão avisadas com antecedência na plataforma ou por
        e-mail. Se o Cliente não concordar, pode cancelar sem multa.
      </p>

      <h2>10. Lei e foro</h2>
      <p>
        Estes Termos seguem a lei brasileira. Fica eleito o foro de {L.foro}, ressalvado o direito do consumidor
        de propor ação no foro do seu domicílio. Contato:{" "}
        <a href={`mailto:${L.emailContato}`}>{L.emailContato}</a>.
      </p>
    </LegalPageLayout>
  );
}
