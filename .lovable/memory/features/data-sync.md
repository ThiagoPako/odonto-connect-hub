---
name: Sincronização de dados entre módulos
description: Todos os módulos devem usar registroCentral.ts como fonte única de verdade para pacientes, dentistas e alertas médicos
type: feature
---
REGRA OBRIGATÓRIA: Dados devem ser sincronizados entre todos os módulos.

- `src/data/registroCentral.ts` é a fonte única de verdade (single source of truth)
- Todos os mock data files usam `pacienteId` para referenciar pacientes do registro central
- Funções utilitárias: `getPacienteById`, `getAlergias`, `getCondicoesCriticas`, `getHistorico`
- Módulos integrados: Agenda, Pacientes, Dentistas, Painel Dentista, Orçamentos, Tratamentos, CRM, Prontuário
- Alertas médicos (alergias, condições) são exibidos em TODOS os módulos que mostram pacientes
- Links cruzados (ExternalLink icon) permitem navegar para a ficha do paciente de qualquer módulo
