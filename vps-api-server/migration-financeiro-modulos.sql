-- ═══════════════════════════════════════════════════════════════
-- FINANCEIRO — Sub-módulos: Bancos, Funcionários, Folha, Contas
-- ═══════════════════════════════════════════════════════════════

-- Contas bancárias
CREATE TABLE IF NOT EXISTS fin_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  bank VARCHAR(100) NOT NULL,
  agency VARCHAR(20) DEFAULT '',
  account VARCHAR(30) DEFAULT '',
  type VARCHAR(20) DEFAULT 'corrente' CHECK (type IN ('corrente','poupanca','investimento')),
  balance NUMERIC(14,2) DEFAULT 0,
  color VARCHAR(30) DEFAULT 'hsl(217, 91%, 60%)',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Funcionários
CREATE TABLE IF NOT EXISTS fin_employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL,
  role VARCHAR(100) NOT NULL,
  cpf VARCHAR(20) DEFAULT '',
  admission_date VARCHAR(15) DEFAULT '',
  salary NUMERIC(12,2) DEFAULT 0,
  benefits NUMERIC(12,2) DEFAULT 0,
  bank_account_id UUID REFERENCES fin_bank_accounts(id) ON DELETE SET NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Folha de pagamento
CREATE TABLE IF NOT EXISTS fin_payrolls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES fin_employees(id) ON DELETE CASCADE NOT NULL,
  employee_name VARCHAR(150) NOT NULL,
  month VARCHAR(10) NOT NULL, -- '04/2026'
  gross_salary NUMERIC(12,2) DEFAULT 0,
  benefits NUMERIC(12,2) DEFAULT 0,
  deductions NUMERIC(12,2) DEFAULT 0,
  net_salary NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pendente' CHECK (status IN ('pendente','pago')),
  payment_date VARCHAR(15),
  bank_account_id UUID REFERENCES fin_bank_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contas a pagar
CREATE TABLE IF NOT EXISTS fin_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  value NUMERIC(12,2) NOT NULL,
  due_date VARCHAR(15) NOT NULL,
  status VARCHAR(20) DEFAULT 'pendente' CHECK (status IN ('pendente','pago','vencido')),
  supplier VARCHAR(150),
  bank_account_id UUID REFERENCES fin_bank_accounts(id) ON DELETE SET NULL,
  payment_date VARCHAR(15),
  recurrent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Movimentações financeiras (complementa tabela financeiro existente)
CREATE TABLE IF NOT EXISTS fin_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(10) NOT NULL CHECK (type IN ('entrada','saida')),
  description VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  value NUMERIC(12,2) NOT NULL,
  date VARCHAR(15) NOT NULL,
  bank_account_id UUID REFERENCES fin_bank_accounts(id) ON DELETE SET NULL,
  bank_name VARCHAR(100) DEFAULT '',
  patient VARCHAR(150),
  bill_id UUID REFERENCES fin_bills(id) ON DELETE SET NULL,
  payroll_id UUID REFERENCES fin_payrolls(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inadimplentes
CREATE TABLE IF NOT EXISTS fin_overdue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient VARCHAR(150) NOT NULL,
  value NUMERIC(12,2) NOT NULL,
  days_late INT DEFAULT 0,
  procedure VARCHAR(150) DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fin_movements_type ON fin_movements(type);
CREATE INDEX IF NOT EXISTS idx_fin_movements_date ON fin_movements(date);
CREATE INDEX IF NOT EXISTS idx_fin_movements_bank ON fin_movements(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_fin_bills_status ON fin_bills(status);
CREATE INDEX IF NOT EXISTS idx_fin_payrolls_month ON fin_payrolls(month);
CREATE INDEX IF NOT EXISTS idx_fin_payrolls_status ON fin_payrolls(status);

SELECT 'Migration financeiro sub-módulos concluída com sucesso!' AS resultado;
