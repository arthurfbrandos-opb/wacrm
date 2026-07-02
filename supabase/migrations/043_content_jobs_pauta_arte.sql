-- 043 · Produção em dois portões (pedido Arthur 02/07):
--   produzir_pauta — escreve o CONTEÚDO (copy/roteiro) de uma peça que nasceu
--                    na pauta da linha editorial (o cliente aprova o conteúdo)
--   gerar_arte     — renderiza a ARTE só depois do conteúdo aprovado
alter table public.content_jobs drop constraint content_jobs_kind_check;
alter table public.content_jobs add constraint content_jobs_kind_check
  check (kind in (
    'chat', 'gerar_peca', 'gerar_semana', 'ajustar_peca', 'agendar_publicacao',
    'produzir_pauta', 'gerar_arte'
  ));
