-- =====================================================================
--  Rimozione del flusso di approvazione: solo notifica email al capo
--
--  Da qui in poi ogni evento nasce APPROVED. Il responsabile riceve una
--  email informativa per FERIE e PERMESSO_USCITA_ANTICIPATA, ma non deve
--  approvare nulla: l'assenza e' valida da subito e conta sui saldi.
--
--  Eseguire per intero nel SQL Editor di Supabase.
--  Annulla il comportamento di 20260805_approvals.sql (trigger e viste
--  restano al loro posto: cambia solo l'esito).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Nessun tipo richiede piu' approvazione
--    (la funzione resta, cosi' il trigger continua a proteggere status
--     dalle scritture del client, ma ora forza sempre APPROVED)
-- ---------------------------------------------------------------------
create or replace function public.event_needs_approval(p_type text)
returns boolean
language sql
immutable
as $$
  select false;
$$;

-- ---------------------------------------------------------------------
-- 2. Sblocco degli eventi rimasti appesi
--    PENDING e REJECTED non hanno piu' senso: senza approvazione tutto
--    quello che e' a calendario e' valido. L'UPDATE fa ripartire
--    trg_events_balance_au, che riallinea balance_ledger.
-- ---------------------------------------------------------------------
update public.events
set    status           = 'APPROVED'::event_status,
       decided_at       = coalesce(decided_at, now()),
       decision_channel = coalesce(decision_channel, 'auto')
where  status is distinct from 'APPROVED'::event_status;

commit;

-- Controllo: deve tornare una sola riga, APPROVED.
-- select status, count(*) from public.events group by status;
