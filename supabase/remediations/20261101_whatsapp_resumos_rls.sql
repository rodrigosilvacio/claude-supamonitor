-- =============================================================================
-- Remediação de segurança (fora do escopo do monitor, autorizada pelo Rodrigo em 01/11/2026)
-- App: resumidor de grupos de WhatsApp (schema public do ClaudeProjects)
-- Achados corrigidos (Security Advisor, nível ERROR):
--   rls_disabled_in_public: daily_summaries, raw_messages, summarized_topics, whatsapp_groups
--   policy_exists_rls_disabled: daily_summaries, raw_messages, summarized_topics
--   security_definer_view: messages_per_day, topics_stats
-- Risco antes: qualquer portador da publishable key lia/alterava/apagava (inclusive TRUNCATE)
--   mensagens com telefone do remetente (dado pessoal, LGPD).
-- Pré-requisito aplicado antes: as 6 Edge Functions do app usam SUPABASE_SERVICE_ROLE_KEY
--   (webhook-whatsapp, get-messages, get-topics, get-groups atualizadas; summarize-messages e
--   update-topic já usavam). service_role ignora RLS, então o app segue funcionando.
-- Rollback: ver bloco no fim do arquivo.
-- =============================================================================

alter table public.daily_summaries   enable row level security;
alter table public.raw_messages      enable row level security;
alter table public.summarized_topics enable row level security;
alter table public.whatsapp_groups   enable row level security;

-- anon: nenhum acesso direto (o app acessa só via Edge Functions com service_role).
revoke all on public.daily_summaries, public.raw_messages, public.summarized_topics,
              public.whatsapp_groups, public.messages_per_day, public.topics_stats from anon;

-- authenticated: TRUNCATE/TRIGGER/REFERENCES ignoram RLS; remover. Demais operações ficam
-- limitadas pelas policies existentes (SELECT; UPDATE em summarized_topics).
revoke truncate, trigger, references on public.daily_summaries, public.raw_messages,
              public.summarized_topics, public.whatsapp_groups from authenticated;

-- Views passam a respeitar o RLS de quem consulta.
alter view public.messages_per_day set (security_invoker = true);
alter view public.topics_stats     set (security_invoker = true);

-- -----------------------------------------------------------------------------
-- ROLLBACK (só se algum consumidor desconhecido quebrar; reabre a exposição):
-- alter table public.daily_summaries disable row level security;  (idem para as outras 3)
-- grant all on public.daily_summaries, public.raw_messages, public.summarized_topics,
--   public.whatsapp_groups, public.messages_per_day, public.topics_stats to anon;
-- grant truncate, trigger, references on public.daily_summaries, public.raw_messages,
--   public.summarized_topics, public.whatsapp_groups to authenticated;
-- alter view public.messages_per_day reset (security_invoker);
-- alter view public.topics_stats reset (security_invoker);
-- -----------------------------------------------------------------------------
