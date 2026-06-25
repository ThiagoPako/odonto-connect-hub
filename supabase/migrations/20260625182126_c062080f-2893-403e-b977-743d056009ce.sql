
CREATE POLICY "exam_images_user_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'exam-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "exam_images_user_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'exam-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "exam_images_user_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'exam-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "exam_images_user_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'exam-images' AND (storage.foldername(name))[1] = auth.uid()::text);
