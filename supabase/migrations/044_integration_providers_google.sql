-- 044 · Novos providers de integração do workspace (fatia ⑨):
--   google_oauth           — conta Google do cliente (OAuth + Picker · fotos/conteúdos)
--   google_drive_conteudos — legado: pasta de conteúdos por link (fallback)
alter table public.integration_connections drop constraint integration_connections_provider_check;
alter table public.integration_connections add constraint integration_connections_provider_check
  check (provider in ('metricool', 'google_drive', 'google_drive_conteudos', 'google_oauth'));
