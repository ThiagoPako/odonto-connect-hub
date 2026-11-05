import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPageLayout } from "@/components/LegalPageLayout";
import { LEGAL_INFO, POLITICA_VERSAO } from "@/lib/legal";

export const Route = createFileRoute("/privacidade")({
  head: () => ({ meta: [{ title: "Política de Privacidade — Odonto Connect" }] }),
  component: PrivacidadePage,
});

function PrivacidadePage() {
  const L = LEGAL_INFO;
  return (
    <LegalPageLayout titulo="Política de Privacidade" versao={POLITICA_VERSAO}>
      <p>
        Esta Política explica como o {L.marca} trata dados pessoais, em conformidade com a Lei Geral de
        Proteção de Dados Pessoais (Lei nº 13.709/2018 — LGPD), o Marco Civil da Internet (Lei nº 12.965/2014)
        e a Lei nº 13.787/2018 (prontuário eletrônico).
      </p>

      <h2>1. Quem somos e qual é o nosso papel</h2>
      <p>
        O {L.marca} é operado por {L.razaoSocial}, CNPJ {L.cnpj}, com sede em {L.endereco}.
      </p>
      <ul>
        <li>
          <strong>Somos controladores</strong> dos dados das clínicas clientes e de seus usuários (nome, e-mail,
          telefone, dados de cobrança e de uso da plataforma) e dos visitantes do nosso site.
        </li>
        <li>
          <strong>Somos operadores</strong> dos dados dos pacientes e contatos que cada clínica cadastra na
          plataforma. Nesse caso, a <strong>clínica é a controladora</strong>: ela decide para que os dados são
          usados, e nós os tratamos apenas para prestar o serviço, conforme as instruções dela (LGPD, arts. 5º,
          VI e VII, e 39). Pedidos de pacientes sobre seus dados devem ser feitos à clínica; se chegarem a nós,
          encaminharemos a ela.
        </li>
      </ul>

      <h2>2. Dados que tratamos</h2>
      <h3>Clínicas e usuários</h3>
      <ul>
        <li>Cadastro: nome, e-mail, telefone, nome e CNPJ da clínica, cargo/perfil de acesso.</li>
        <li>Acesso: endereço IP, data e hora, navegador e registros de uso, para segurança e para cumprir o Marco Civil da Internet.</li>
        <li>Cobrança: plano contratado e histórico de pagamentos.</li>
      </ul>
      <h3>Pacientes e contatos (em nome da clínica)</h3>
      <ul>
        <li>Identificação e contato: nome, telefone, e-mail, documento, endereço.</li>
        <li>
          <strong>Dados de saúde (dados sensíveis)</strong>: prontuário, anamnese, odontograma, exames, laudos,
          imagens clínicas, prescrições, orçamentos e tratamentos.
        </li>
        <li>Mensagens trocadas com a clínica pelo WhatsApp e pelos canais integrados.</li>
        <li>Assinatura eletrônica, com data, hora, IP e geolocalização no momento da assinatura.</li>
        <li>
          Áudio da consulta, <strong>somente</strong> quando a clínica registra a autorização do paciente. O áudio é
          enviado para transcrição e descartado; apenas o texto revisado pelo dentista fica no prontuário.
        </li>
      </ul>

      <h2>3. Para que usamos os dados e com qual base legal</h2>
      <ul>
        <li>Prestar o serviço contratado pela clínica — execução de contrato (art. 7º, V).</li>
        <li>
          Prontuário e atendimento odontológico — tutela da saúde por profissionais de saúde (art. 11, II, "f") e
          cumprimento de obrigação legal (art. 11, II, "a"), sob responsabilidade da clínica.
        </li>
        <li>Gravação e transcrição de consultas por IA — consentimento específico do paciente (art. 11, I).</li>
        <li>Mensagens de marketing e campanhas da clínica — consentimento ou legítimo interesse da clínica, sempre com opção de descadastro (arts. 7º, I e IX, e 18).</li>
        <li>Segurança, prevenção a fraude e guarda de registros de acesso — obrigação legal (Marco Civil, art. 15) e legítimo interesse.</li>
        <li>Cobrança e obrigações fiscais — execução de contrato e obrigação legal.</li>
      </ul>
      <p>
        Não vendemos dados pessoais e não usamos dados de pacientes para fins próprios, publicidade ou
        treinamento de modelos de IA.
      </p>

      <h2>4. Com quem compartilhamos</h2>
      <p>Apenas com fornecedores necessários para o funcionamento da plataforma (suboperadores):</p>
      <ul>
        <li>Provedores de hospedagem, banco de dados e entrega de conteúdo (infraestrutura da plataforma).</li>
        <li>OpenAI (Estados Unidos) — transcrição de áudio e recursos de inteligência artificial, sem uso dos dados para treinamento.</li>
        <li>WhatsApp/Meta — envio e recebimento de mensagens, quando a clínica conecta o seu número.</li>
        <li>Meta Ads — métricas de campanhas, quando a clínica conecta a sua conta de anúncios.</li>
        <li>Clinicorp e outros sistemas que a própria clínica decide integrar.</li>
        <li>Autoridades públicas, quando houver obrigação legal ou ordem judicial.</li>
      </ul>

      <h2>5. Transferência internacional</h2>
      <p>
        Alguns fornecedores (como OpenAI e Meta) processam dados fora do Brasil. Essas transferências ocorrem com
        base no art. 33 da LGPD, com fornecedores que adotam garantias contratuais e de segurança compatíveis com
        a lei.
      </p>

      <h2>6. Por quanto tempo guardamos</h2>
      <ul>
        <li>Prontuário do paciente: no mínimo 20 anos a partir do último registro (Lei nº 13.787/2018, art. 6º), ou o prazo definido pela clínica, se maior.</li>
        <li>Registros de acesso à aplicação: 6 meses (Marco Civil da Internet, art. 15).</li>
        <li>Áudio de consultas: não é armazenado; é descartado depois da transcrição.</li>
        <li>Dados da conta da clínica: enquanto o contrato durar e, depois, pelo prazo necessário para obrigações legais e para o exercício de direitos.</li>
      </ul>
      <p>
        Ao fim do contrato, a clínica pode solicitar a exportação dos seus dados. Depois do prazo de exportação, eliminamos ou anonimizamos os
        dados, salvo os que a lei manda guardar.
      </p>

      <h2>7. Segurança</h2>
      <p>
        Usamos conexão criptografada (HTTPS), isolamento dos dados de cada clínica, controle de acesso por perfil,
        senhas protegidas por hash e registros de auditoria. Se ocorrer um incidente de segurança com risco
        relevante, comunicaremos a clínica, a Autoridade Nacional de Proteção de Dados (ANPD) e os titulares
        afetados, conforme o art. 48 da LGPD.
      </p>

      <h2>8. Seus direitos</h2>
      <p>Conforme o art. 18 da LGPD, você pode, a qualquer momento:</p>
      <ul>
        <li>confirmar se tratamos seus dados e acessá-los;</li>
        <li>corrigir dados incompletos, inexatos ou desatualizados;</li>
        <li>pedir anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade;</li>
        <li>pedir a portabilidade dos dados;</li>
        <li>saber com quem compartilhamos seus dados;</li>
        <li>revogar o consentimento e saber as consequências de não consentir;</li>
        <li>apresentar reclamação à ANPD.</li>
      </ul>
      <p>
        Se você é paciente de uma clínica, faça o pedido diretamente a ela, que é a controladora. Nós a apoiamos
        para responder.
      </p>

      <h2>9. Cookies</h2>
      <p>
        Usamos apenas o armazenamento local necessário para manter você conectado e guardar suas preferências.
        No site público, podemos registrar a origem da visita (parâmetros UTM) para medir campanhas.
      </p>

      <h2>10. Encarregado (DPO) e contato</h2>
      <p>
        Encarregado pelo tratamento de dados: {L.encarregadoNome} — {L.emailPrivacidade}. Outros assuntos:{" "}
        <a href={`mailto:${L.emailContato}`}>{L.emailContato}</a>.
      </p>

      <h2>11. Alterações</h2>
      <p>
        Podemos atualizar esta Política. Mudanças relevantes serão avisadas na plataforma ou por e-mail. Veja
        também os <Link to="/termos">Termos de Uso</Link>.
      </p>
    </LegalPageLayout>
  );
}
