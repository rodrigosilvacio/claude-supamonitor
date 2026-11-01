# Remediação de segurança: app de resumos de WhatsApp (ClaudeProjects), 01/11/2026

**Pedido:** Rodrigo, junto com a etapa 3 ("inclusive os itens fora do escopo").
**Resultado:** 9 achados críticos (ERROR) do Security Advisor resolvidos; confirmados pela coleta do próprio monitor.

| Achado | Objeto | Correção |
|---|---|---|
| rls_disabled_in_public | daily_summaries, raw_messages, summarized_topics, whatsapp_groups | RLS habilitado |
| policy_exists_rls_disabled | daily_summaries, raw_messages, summarized_topics | idem (policies existentes passam a valer) |
| security_definer_view | messages_per_day, topics_stats | `security_invoker = true` |

**Risco eliminado:** com a publishable key (pública), qualquer pessoa podia ler, alterar e apagar (inclusive TRUNCATE)
mensagens com telefone do remetente (`raw_messages.sender_phone`): dado pessoal, exposição relevante para LGPD.

**Diagnóstico antes de mudar:** app sem uso desde 30/07/2026 (28 mensagens, 7 tópicos, 2 grupos); nenhum acesso direto
às tabelas via API nas últimas 24 h; todo acesso passa por 6 Edge Functions.

**Ordem aplicada (sem janela de indisponibilidade):**
1. `webhook-whatsapp`, `get-messages`, `get-topics`, `get-groups`: troca de `SUPABASE_ANON_KEY` por
   `SUPABASE_SERVICE_ROLE_KEY` (única linha alterada; `summarize-messages` e `update-topic` já usavam).
2. SQL `supabase/remediations/20261101_whatsapp_resumos_rls.sql` (RLS, revoke anon, revoke TRUNCATE/TRIGGER/REFERENCES
   de authenticated, views security_invoker). Rollback documentado no arquivo.

**Verificação:** `anon` sem SELECT/DELETE, `authenticated` sem TRUNCATE, RLS ativo nas 4 tabelas; recoleta de advisors:
9 achados `resolved`, 0 críticos abertos.

**Exceção à regra "não tocar public":** aplicada por pedido explícito, com diagnóstico prévio e rollback.

**Pendências recomendadas (não aplicadas):**
- `webhook-whatsapp` tem `verify_jwt=false` e não valida origem: qualquer um pode injetar mensagens falsas.
  Sugestão: segredo compartilhado com o Z-API/n8n no header.
- Política de retenção para `raw_messages` (LGPD: guardar telefone só pelo tempo necessário).
- 97 avisos de segurança (WARN), em sua maioria funções `security definer` executáveis por anon/authenticated.
