-- A agenda passou a escutar mudanças via Supabase Realtime.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'agendamentos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agendamentos;
  END IF;
END $$;
