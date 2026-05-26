-- Create Procedure Catalog Table
CREATE TABLE public.procedimentos_catalogo (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    codigo TEXT,
    nome TEXT NOT NULL,
    categoria TEXT,
    valor_particular NUMERIC(12,2) DEFAULT 0,
    valor_convenio NUMERIC(12,2) DEFAULT 0,
    duracao_minutos INTEGER DEFAULT 30,
    cor TEXT DEFAULT '#3B82F6',
    requer_dente BOOLEAN DEFAULT false,
    requer_face BOOLEAN DEFAULT false,
    ativo BOOLEAN DEFAULT true,
    descricao TEXT,
    versao_atual INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create Procedure Versions Table
CREATE TABLE public.procedimentos_versoes (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    procedimento_id UUID NOT NULL REFERENCES public.procedimentos_catalogo(id) ON DELETE CASCADE,
    versao INTEGER NOT NULL,
    codigo TEXT,
    nome TEXT NOT NULL,
    categoria TEXT,
    valor_particular NUMERIC(12,2),
    valor_convenio NUMERIC(12,2),
    duracao_minutos INTEGER,
    cor TEXT,
    requer_dente BOOLEAN,
    requer_face BOOLEAN,
    descricao TEXT,
    motivo TEXT,
    alterado_por UUID,
    valido_desde TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    valido_ate TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for performance
CREATE INDEX idx_procedimentos_catalogo_tenant ON public.procedimentos_catalogo(tenant_id);
CREATE INDEX idx_procedimentos_versoes_procedimento ON public.procedimentos_versoes(procedimento_id);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.procedimentos_catalogo TO authenticated;
GRANT ALL ON public.procedimentos_catalogo TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.procedimentos_versoes TO authenticated;
GRANT ALL ON public.procedimentos_versoes TO service_role;

-- Enable RLS
ALTER TABLE public.procedimentos_catalogo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procedimentos_versoes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view procedures of their tenant" 
ON public.procedimentos_catalogo FOR SELECT 
USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert procedures for their tenant" 
ON public.procedimentos_catalogo FOR INSERT 
WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update procedures of their tenant" 
ON public.procedimentos_catalogo FOR UPDATE 
USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can delete procedures of their tenant" 
ON public.procedimentos_catalogo FOR DELETE 
USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can view versions of their tenant" 
ON public.procedimentos_versoes FOR SELECT 
USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert versions for their tenant" 
ON public.procedimentos_versoes FOR INSERT 
WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Function to handle versioning
CREATE OR REPLACE FUNCTION public.handle_procedimento_versioning()
RETURNS TRIGGER AS $$
DECLARE
    v_alterado_por UUID;
    v_motivo TEXT;
BEGIN
    -- Try to get the user ID from the session
    v_alterado_por := auth.uid();
    
    -- In a real scenario, the 'motivo' might come from a transaction variable or be passed in a specific update
    -- Since we can't easily pass extra params to triggers, we'll check if it's stored in a temporary setting if needed
    -- For now, we use a default if not found.
    
    IF (TG_OP = 'INSERT') THEN
        INSERT INTO public.procedimentos_versoes (
            tenant_id, procedimento_id, versao, codigo, nome, categoria, 
            valor_particular, valor_convenio, duracao_minutos, cor, 
            requer_dente, requer_face, descricao, motivo, alterado_por, valido_desde
        ) VALUES (
            NEW.tenant_id, NEW.id, NEW.versao_atual, NEW.codigo, NEW.nome, NEW.categoria,
            NEW.valor_particular, NEW.valor_convenio, NEW.duracao_minutos, NEW.cor,
            NEW.requer_dente, NEW.requer_face, NEW.descricao, 'Criação inicial', v_alterado_por, NEW.created_at
        );
    ELSIF (TG_OP = 'UPDATE') THEN
        -- Only create a new version if key fields changed
        IF (OLD.nome <> NEW.nome OR OLD.codigo <> NEW.codigo OR OLD.valor_particular <> NEW.valor_particular OR OLD.valor_convenio <> NEW.valor_convenio OR OLD.duracao_minutos <> NEW.duracao_minutos OR OLD.categoria <> NEW.categoria) THEN
            
            -- Increment version
            NEW.versao_atual := OLD.versao_atual + 1;
            
            -- Close old version
            UPDATE public.procedimentos_versoes 
            SET valido_ate = now() 
            WHERE procedimento_id = NEW.id AND valido_ate IS NULL;
            
            -- Insert new version
            INSERT INTO public.procedimentos_versoes (
                tenant_id, procedimento_id, versao, codigo, nome, categoria, 
                valor_particular, valor_convenio, duracao_minutos, cor, 
                requer_dente, requer_face, descricao, motivo, alterado_por, valido_desde
            ) VALUES (
                NEW.tenant_id, NEW.id, NEW.versao_atual, NEW.codigo, NEW.nome, NEW.categoria,
                NEW.valor_particular, NEW.valor_convenio, NEW.duracao_minutos, NEW.cor,
                NEW.requer_dente, NEW.requer_face, NEW.descricao, 'Atualização de dados', v_alterado_por, now()
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger for versioning
CREATE TRIGGER trigger_procedimento_versioning
BEFORE INSERT OR UPDATE ON public.procedimentos_catalogo
FOR EACH ROW
EXECUTE FUNCTION public.handle_procedimento_versioning();

-- Trigger for updated_at
CREATE TRIGGER update_procedimentos_catalogo_updated_at
BEFORE UPDATE ON public.procedimentos_catalogo
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
