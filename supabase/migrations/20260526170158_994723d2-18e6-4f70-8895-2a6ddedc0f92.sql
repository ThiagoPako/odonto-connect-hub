
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-media', 'chat-media', true)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='chat-media public read') THEN
    CREATE POLICY "chat-media public read" ON storage.objects FOR SELECT USING (bucket_id = 'chat-media');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='chat-media authenticated upload') THEN
    CREATE POLICY "chat-media authenticated upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'chat-media');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='chat-media owner update') THEN
    CREATE POLICY "chat-media owner update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'chat-media' AND owner = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='chat-media owner delete') THEN
    CREATE POLICY "chat-media owner delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'chat-media' AND owner = auth.uid());
  END IF;
END $$;
