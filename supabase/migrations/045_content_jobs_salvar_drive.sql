-- 045 · salvar_drive — quando o cliente APROVA uma peça, o worker grava os
-- arquivos dela na pasta de conteúdos do Drive dele (OAuth · Picker), na
-- estrutura Ano/Mês/<linha editorial|dia>/<peça>/.
alter table public.content_jobs drop constraint content_jobs_kind_check;
alter table public.content_jobs add constraint content_jobs_kind_check
  check (kind in (
    'chat', 'gerar_peca', 'gerar_semana', 'ajustar_peca', 'agendar_publicacao',
    'produzir_pauta', 'gerar_arte', 'salvar_drive'
  ));
