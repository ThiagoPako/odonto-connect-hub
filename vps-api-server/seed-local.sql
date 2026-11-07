-- Seed 100% FICTÍCIO para o ambiente LOCAL de testes (nunca rodar em produção).
-- Pré-requisito: migrations + schema-complementar-local.sql. Idempotente (ON CONFLICT DO NOTHING).
-- Senha de TODOS os usuários de teste: Teste@123
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO tenants (id, nome, slug, status, trial_ends_at, plan_id, email_contato) VALUES
 ('aaaaaaaa-0000-0000-0000-00000000000a','Clínica Alfa (TESTE)','clinica-alfa','active', NOW()+interval '30 days',(SELECT id FROM plans WHERE slug='pro'),'admin.alfa@teste.local'),
 ('bbbbbbbb-0000-0000-0000-00000000000b','Clínica Beta (TESTE)','clinica-beta','trial', NOW()+interval '14 days',(SELECT id FROM plans WHERE slug='starter'),'admin.beta@teste.local')
ON CONFLICT DO NOTHING;
INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_end, gateway)
SELECT t.id, t.plan_id, 'active', NOW()+interval '30 days', 'manual' FROM tenants t
WHERE t.slug IN ('clinica-alfa','clinica-beta') AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id=t.id);

-- Usuários: super-admin + por clínica admin / dentista / recepcionista / comercial (profiles.role='comercial'; o enum app_role do banco NÃO tem 'comercial')
INSERT INTO profiles (id, name, email, role, password_hash, active, tenant_id, is_super_admin) VALUES
 ('00000000-0000-0000-0000-0000000000a0','Super Admin Teste','super@teste.local','admin',crypt('Teste@123',gen_salt('bf',10)),true,'aaaaaaaa-0000-0000-0000-00000000000a',true),
 ('a0000000-0000-0000-0000-000000000001','Ana Admin (Alfa)','admin.alfa@teste.local','admin',crypt('Teste@123',gen_salt('bf',10)),true,'aaaaaaaa-0000-0000-0000-00000000000a',false),
 ('a0000000-0000-0000-0000-000000000002','Dr. Davi Dentista (Alfa)','dentista.alfa@teste.local','dentista',crypt('Teste@123',gen_salt('bf',10)),true,'aaaaaaaa-0000-0000-0000-00000000000a',false),
 ('a0000000-0000-0000-0000-000000000003','Rita Recepção (Alfa)','recepcao.alfa@teste.local','recepcionista',crypt('Teste@123',gen_salt('bf',10)),true,'aaaaaaaa-0000-0000-0000-00000000000a',false),
 ('a0000000-0000-0000-0000-000000000004','Caio Comercial (Alfa)','comercial.alfa@teste.local','comercial',crypt('Teste@123',gen_salt('bf',10)),true,'aaaaaaaa-0000-0000-0000-00000000000a',false),
 ('b0000000-0000-0000-0000-000000000001','Bia Admin (Beta)','admin.beta@teste.local','admin',crypt('Teste@123',gen_salt('bf',10)),true,'bbbbbbbb-0000-0000-0000-00000000000b',false),
 ('b0000000-0000-0000-0000-000000000002','Dra. Bruna Dentista (Beta)','dentista.beta@teste.local','dentista',crypt('Teste@123',gen_salt('bf',10)),true,'bbbbbbbb-0000-0000-0000-00000000000b',false),
 ('b0000000-0000-0000-0000-000000000003','Beto Recepção (Beta)','recepcao.beta@teste.local','recepcionista',crypt('Teste@123',gen_salt('bf',10)),true,'bbbbbbbb-0000-0000-0000-00000000000b',false),
 ('b0000000-0000-0000-0000-000000000004','Bruno Comercial (Beta)','comercial.beta@teste.local','comercial',crypt('Teste@123',gen_salt('bf',10)),true,'bbbbbbbb-0000-0000-0000-00000000000b',false)
ON CONFLICT DO NOTHING;
INSERT INTO user_roles (user_id, role) SELECT id, role::app_role FROM profiles WHERE email LIKE '%@teste.local' ON CONFLICT DO NOTHING;

INSERT INTO dentistas (id, nome, cro, especialidade, ativo, tenant_id, cor_agenda, email) VALUES
 ('da000000-0000-0000-0000-000000000001','Dr. Davi Dentista','CRO-SP 11111','Clínico geral',true,'aaaaaaaa-0000-0000-0000-00000000000a','#0ea5e9','dentista.alfa@teste.local'),
 ('da000000-0000-0000-0000-000000000002','Dra. Elisa Ortodontista','CRO-SP 22222','Ortodontia',true,'aaaaaaaa-0000-0000-0000-00000000000a','#22c55e',NULL),
 ('db000000-0000-0000-0000-000000000001','Dra. Bruna Dentista','CRO-RJ 33333','Clínico geral',true,'bbbbbbbb-0000-0000-0000-00000000000b','#f97316','dentista.beta@teste.local')
ON CONFLICT DO NOTHING;

-- Pacientes (telefones 5511900000xxx são fictícios; NUNCA ligar a Evolution real a este banco)
INSERT INTO pacientes (id, nome, cpf, telefone, email, data_nascimento, sexo, tenant_id) VALUES
 ('aa100000-0000-0000-0000-000000000001','Maria Silva (Alfa)','000.000.001-91','5511900000001','maria@teste.local','1985-03-12','F','aaaaaaaa-0000-0000-0000-00000000000a'),
 ('aa100000-0000-0000-0000-000000000002','João Pereira (Alfa)','000.000.002-72','5511900000002','joao@teste.local','1990-07-30','M','aaaaaaaa-0000-0000-0000-00000000000a'),
 ('aa100000-0000-0000-0000-000000000003','Carla Souza (Alfa)','000.000.003-53','5511900000003',NULL,'2001-11-05','F','aaaaaaaa-0000-0000-0000-00000000000a'),
 ('aa100000-0000-0000-0000-000000000004','Pedro Lima (Alfa)','000.000.004-34','5511900000004','pedro@teste.local','1978-01-20','M','aaaaaaaa-0000-0000-0000-00000000000a'),
 ('aa100000-0000-0000-0000-000000000005','Lúcia Gomes (Alfa)','000.000.005-15','5511900000005',NULL,'1966-09-09','F','aaaaaaaa-0000-0000-0000-00000000000a'),
 ('bb100000-0000-0000-0000-000000000001','Paulo Ramos (Beta)','000.000.101-60','5521900000001','paulo@teste.local','1982-05-02','M','bbbbbbbb-0000-0000-0000-00000000000b'),
 ('bb100000-0000-0000-0000-000000000002','Renata Dias (Beta)','000.000.102-41','5521900000002',NULL,'1995-12-25','F','bbbbbbbb-0000-0000-0000-00000000000b'),
 ('bb100000-0000-0000-0000-000000000003','Sérgio Melo (Beta)','000.000.103-22','5521900000003','sergio@teste.local','1970-04-14','M','bbbbbbbb-0000-0000-0000-00000000000b')
ON CONFLICT DO NOTHING;
INSERT INTO anamneses (paciente_id, alergias, medicamentos, fumante, diabetes, observacoes, tenant_id) VALUES
 ('aa100000-0000-0000-0000-000000000001', ARRAY['penicilina'], ARRAY['losartana'], false, false, 'Paciente fictícia — alérgica a penicilina','aaaaaaaa-0000-0000-0000-00000000000a'),
 ('bb100000-0000-0000-0000-000000000001', ARRAY[]::text[], ARRAY[]::text[], true, false, 'Fictício','bbbbbbbb-0000-0000-0000-00000000000b')
ON CONFLICT DO NOTHING;

-- Agenda: hoje e amanhã (relativo à data em que o seed rodar)
INSERT INTO agendamentos (id, paciente_id, dentista_id, data, hora, duracao, procedimento, status, tenant_id, paciente_nome, dentista_nome) VALUES
 ('ae100000-0000-0000-0000-000000000001','aa100000-0000-0000-0000-000000000001','da000000-0000-0000-0000-000000000001',CURRENT_DATE,'09:00',30,'Limpeza','agendado','aaaaaaaa-0000-0000-0000-00000000000a','Maria Silva (Alfa)','Dr. Davi Dentista'),
 ('ae100000-0000-0000-0000-000000000002','aa100000-0000-0000-0000-000000000002','da000000-0000-0000-0000-000000000001',CURRENT_DATE,'10:00',60,'Restauração','confirmado','aaaaaaaa-0000-0000-0000-00000000000a','João Pereira (Alfa)','Dr. Davi Dentista'),
 ('ae100000-0000-0000-0000-000000000003','aa100000-0000-0000-0000-000000000003','da000000-0000-0000-0000-000000000002',CURRENT_DATE+1,'14:00',30,'Avaliação ortodôntica','agendado','aaaaaaaa-0000-0000-0000-00000000000a','Carla Souza (Alfa)','Dra. Elisa Ortodontista'),
 ('be100000-0000-0000-0000-000000000001','bb100000-0000-0000-0000-000000000001','db000000-0000-0000-0000-000000000001',CURRENT_DATE,'11:00',30,'Consulta','agendado','bbbbbbbb-0000-0000-0000-00000000000b','Paulo Ramos (Beta)','Dra. Bruna Dentista')
ON CONFLICT DO NOTHING;

INSERT INTO orcamentos (id, paciente_id, dentista_id, itens, valor_total, desconto, status, validade, tenant_id, forma_pagamento, parcelas) VALUES
 ('a0c00000-0000-0000-0000-000000000001','aa100000-0000-0000-0000-000000000004','da000000-0000-0000-0000-000000000001','[{"procedimento":"Implante","dente":"36","valor":3500},{"procedimento":"Coroa","dente":"36","valor":1500}]',5000,0,'pendente',CURRENT_DATE+15,'aaaaaaaa-0000-0000-0000-00000000000a','cartao',5),
 ('b0c00000-0000-0000-0000-000000000001','bb100000-0000-0000-0000-000000000002','db000000-0000-0000-0000-000000000001','[{"procedimento":"Clareamento","valor":900}]',900,0,'pendente',CURRENT_DATE+15,'bbbbbbbb-0000-0000-0000-00000000000b','pix',1)
ON CONFLICT DO NOTHING;

INSERT INTO financeiro (id, tipo, descricao, valor, data, categoria, paciente_id, forma_pagamento, tenant_id, status) VALUES
 ('af000000-0000-0000-0000-000000000001','receita','Limpeza — Maria',200,CURRENT_DATE,'procedimento','aa100000-0000-0000-0000-000000000001','pix','aaaaaaaa-0000-0000-0000-00000000000a','pago'),
 ('af000000-0000-0000-0000-000000000002','despesa','Material descartável',350,CURRENT_DATE,'material',NULL,'boleto','aaaaaaaa-0000-0000-0000-00000000000a','pendente'),
 ('bf000000-0000-0000-0000-000000000001','receita','Consulta — Paulo',150,CURRENT_DATE,'procedimento','bb100000-0000-0000-0000-000000000001','dinheiro','bbbbbbbb-0000-0000-0000-00000000000b','pago')
ON CONFLICT DO NOTHING;

INSERT INTO crm_leads (id, nome, telefone, origem, status, kanban_stage, tenant_id) VALUES
 ('ac000000-0000-0000-0000-000000000001','Lead Fictício Alfa','5511900000099','instagram','novo','novo','aaaaaaaa-0000-0000-0000-00000000000a'),
 ('bc000000-0000-0000-0000-000000000001','Lead Fictício Beta','5521900000099','google','novo','novo','bbbbbbbb-0000-0000-0000-00000000000b')
ON CONFLICT DO NOTHING;

INSERT INTO procedimentos_catalogo (id, codigo, nome, categoria, valor_particular, duracao_minutos, tenant_id) VALUES
 ('pc-alfa-1','001','Limpeza','Prevenção',200,30,'aaaaaaaa-0000-0000-0000-00000000000a'),
 ('pc-alfa-2','002','Restauração','Dentística',350,60,'aaaaaaaa-0000-0000-0000-00000000000a'),
 ('pc-beta-1','001','Clareamento','Estética',900,60,'bbbbbbbb-0000-0000-0000-00000000000b')
ON CONFLICT DO NOTHING;
INSERT INTO clinica_config (id, intervalo_agenda) VALUES (1, 30) ON CONFLICT DO NOTHING;
