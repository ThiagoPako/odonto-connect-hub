---
name: conformidade-legal
description: Use when reviewing, designing or writing any feature, screen, flow, text or contract of the Odonto Connect SaaS for legal risk under Brazilian law — LGPD and dados de saúde, prontuário, consentimento, termos de uso, política de privacidade, WhatsApp disparos/campanhas, IA, gravação de áudio clínico, assinatura eletrônica, orçamentos, cobrança, cancelamento, publicidade odontológica (CFO), Meta Ads, integrações (Clinicorp), retenção e exclusão de dados — or when the user asks "isso pode dar processo?", "está de acordo com a lei?", "auditoria jurídica/LGPD".
---

# Conformidade legal (Brasil) para o Odonto Connect

## Princípio

**Nenhum artigo é citado de memória.** Toda citação vem do texto oficial buscado no acervo
[ctresb/leis](https://github.com/ctresb/leis) pelo script desta skill, no momento da análise.
Se não conseguir buscar, diga "não verificado" ao lado da citação.

O acervo tem ~8,5 GB: **nunca clone**. Use o script, que busca só o arquivo necessário.

```bash
S=".claude/skills/conformidade-legal/scripts/lei.sh"   # a partir da raiz do projeto
bash $S lgpd 11                 # só o art. 11 da LGPD
bash $S cdc -g orçamento        # linhas da lei que contêm o termo
bash $S federal/leis-ordinarias/2019/lei-13853-2019-07-08.md   # qualquer arquivo do acervo
bash $S ls reguladores/conselhos-profissionais/resolucoes/2025 # listar pasta (API GitHub, 60 req/h)
```

Caminho no acervo: `federal/leis-ordinarias/AAAA/lei-NUMERO-AAAA-MM-DD.md` (número sem ponto).
Resoluções de conselhos: `reguladores/conselhos-profissionais/resolucoes/AAAA/resolucao-cfo-*.md`
(só há CFO de 2024 em diante). O cabeçalho YAML traz `versao_texto` (prefira "compilada") e `fonte`.

## Normas principais (atalhos do script)

| Atalho | Norma | Ponto de atenção no SaaS |
|---|---|---|
| `lgpd` | Lei 13.709/2018 | Dado de saúde = **dado sensível** (art. 5º II, art. 11). Princípios (6º), direitos do titular (18), controlador × operador (5º VI–VII, 37–39), encarregado (41), segurança e incidentes (46–49), transferência internacional (33), sanções (52) |
| `prontuario` | Lei 13.787/2018 | Prontuário digital: integridade, autenticidade, sigilo (2º, 4º); guarda mínima de 20 anos (6º) |
| `cdc` | Lei 8.078/1990 | Informação clara (6º, 31), práticas abusivas (39), **orçamento prévio** (40), cadastros (43), arrependimento em 7 dias (49), cláusulas abusivas (51), crédito/parcelamento (52) |
| `marco-civil` | Lei 12.965/2014 | Direitos do usuário e consentimento (7º), guarda de registros de acesso (15) |
| `assinatura` | Lei 14.063/2020 | Tipos de assinatura eletrônica; exigências para documentos de saúde (busque `-g saúde`) |
| `telessaude` | Lei 14.510/2022 | Atendimento remoto e teleorientação |
| `odontologia` | Lei 5.081/1966 | Exercício da odontologia e vedações ao cirurgião-dentista, incluindo publicidade |
| `cfo-lei` | Lei 4.324/1964 | Competência do CFO/CROs |
| `codigo-civil` | Lei 10.406/2002 | Responsabilidade civil (186, 187, 927) |
| `sac` | Lei 13.460/2017 | Só se houver cliente do setor público |

**Fora do acervo:** Código de Ética Odontológica (Res. CFO-118/2012), publicidade em redes sociais
(Res. CFO-196/2019) e teleodontologia (Res. CFO-226/2020). Cite essas normas como "conferir em
website.cfo.org.br". Antes, rode `bash $S ls reguladores/conselhos-profissionais/resolucoes/<ano>`
para ver se alguma resolução nova as alterou.

## Mapa de funcionalidades → riscos

| Área do código | Pergunta-chave | Normas |
|---|---|---|
| `LgpdConsent`, cadastro de paciente/lead | O consentimento para dado de saúde é específico e destacado? Ele é separado do consentimento de marketing? Pode ser revogado com a mesma facilidade? | LGPD 8º, 9º, 11, 18 |
| `disparos`, `campanhas`, `whatsapp`, `automacoes` | Há base legal e opt-out em toda mensagem? Lead sem consentimento recebe mensagem? | LGPD 7º, 18; CDC 39 III |
| `chat`, `AISettingsPanel`, IA | Dado de saúde vai para provedor de IA no exterior? Isso está informado e coberto por contrato? O paciente sabe que fala com IA? | LGPD 33, 39, 20 (decisões automatizadas), 46 |
| `ClinicalAudioRecorder` | Há aviso e consentimento antes de gravar? Qual o prazo de retenção? O áudio vai para IA ou terceiros? | LGPD 9º, 11, 15, 16 + linha de IA (33, 39, 46) |
| `OdontogramaChart`, prontuário, `ExameLaudoDialog` | Existe trilha de auditoria? O registro é imutável depois de assinado? Há retenção de 20 anos? E controle de acesso por perfil? | Lei 13.787 2º, 4º, 6º; LGPD 46 |
| `SignaturePad`, `CompleteDentistaDialog` | Desenhar no canvas vale como qual tipo de assinatura? Ela é suficiente para esse documento? | Lei 14.063; Lei 13.787 2º §2º |
| `orcamentos`, planos, cobrança | Valores, prazo de validade e condições ficam claros? Como funciona o cancelamento? Há multa abusiva? | CDC 31, 40, 49, 51, 52 |
| `meta-ads`, landing pages | Publicidade promete resultado? Mostra "antes e depois" ou preço de forma vedada? | Lei 5.081; Res. CFO-196/2019 |
| `clinicorp`, integrações, `admin-saas` | O SaaS atua como operador da clínica (controladora)? Existe contrato/DPA? O que a integração compartilha? | LGPD 5º VI–VII, 37–39, 42 |
| Logs, auditoria, sessões, `vpsApi` | Os logs de acesso são guardados por 6 meses? Há trilha de quem fez o quê (prova de consentimento)? Os segredos estão protegidos? Existe plano de incidente? | Marco Civil 15; LGPD 6º X, 46, 48 |

## Como fazer a análise

1. Leia o código, a tela ou o texto real envolvido; não avalie só pelo nome do arquivo. Siga o dado:
   ache quem usa o componente (`grep -rn NomeDoComponente src`) e para onde ele envia (`src/lib/vpsApi.ts`).
   O backend roda na VPS, fora deste repo: o que não der para ver vira premissa explícita ("a confirmar").
   Cruze linhas do mapa quando o dado passa por mais de uma área (ex.: áudio → IA).
2. Para cada risco, busque o artigo com o script e copie o trecho exato e curto que o fundamenta.
3. Entregue o resultado nesta forma (um bloco por achado, do mais grave ao menos grave):

```
### [ALTA|MÉDIA|BAIXA] <risco em uma linha>
- Onde: `caminho/arquivo.tsx:linha` (se o problema é algo que falta, aponte a linha onde deveria acontecer)
- Norma: Lei 13.709/2018, art. 11, I — "consentir, de forma específica e destacada"
- Verificado: sim (trecho buscado com lei.sh) | não (motivo)
- Cenário de processo/multa: <quem reclama, do quê>
- Correção: <mudança concreta no produto/código/texto>
```

4. Feche com: "Análise técnica de apoio; não substitui parecer de advogado." Se houver risco ALTO,
   recomende revisão jurídica antes de lançar a funcionalidade.

## Erros comuns

- Tratar dado de saúde como dado pessoal comum. A base legal precisa vir do art. 11, não do art. 7º.
- Usar um único "aceito os termos" para tudo. Uso clínico e marketing precisam de consentimentos separados.
- Citar uma lei compilada antiga ou uma versão "original" quando existe redação alterada. Confira `versao_texto` e as notas *(redação dada pela Lei…)*.
- Esquecer que a clínica é a controladora e o SaaS é o operador. Isso muda quem responde pelo quê, mas não isenta o SaaS (LGPD 42).
- Prometer em textos de marketing do SaaS que ele "deixa a clínica 100% LGPD".
