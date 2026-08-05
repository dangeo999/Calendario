-- =====================================================================
--  ROLLBACK di 20260805_approvals.sql
--
--  Riporta il database allo stato precedente alla migrazione.
--  Le definizioni qui sotto sono quelle lette da pg_views / pg_get_functiondef
--  sul progetto rvhguqudmtzavrrubdlk PRIMA di qualunque modifica.
--
--  Presuppone che esistano le tabelle di backup create al punto 0
--  della migrazione:
--    public.bak_events_20260805
--    public.bak_balance_ledger_20260805
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Via il trigger di approvazione (altrimenti blocca il ripristino
--    dello status e rimette in PENDING al primo update)
-- ---------------------------------------------------------------------
drop trigger if exists trg_enforce_event_approval on public.events;
drop function if exists public.enforce_event_approval();
drop function if exists public.event_needs_approval(text);
drop function if exists public.is_privileged_role();

-- ---------------------------------------------------------------------
-- 2. Funzione saldi: versione originale, senza guardia sullo status
-- ---------------------------------------------------------------------
create or replace function public.events_balance_au()
returns trigger
language plpgsql
as $function$
begin
  if (tg_op = 'DELETE') then
    delete from public.balance_ledger where source_event_id = old.id;
    return old;
  end if;

  delete from public.balance_ledger where source_event_id = new.id;

  insert into public.balance_ledger(user_id, kind, amount, year, month, source_event_id, note, rule)
  select new.user_id, e.kind, e.amount, e.year, e.month, new.id, null, e.rule
  from public.event_effect(new.type, new.starts_at, new.ends_at, new.permesso_minutes) e
  where e.amount <> 0;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------
-- 3. Status: ripristino dal backup, riga per riga
-- ---------------------------------------------------------------------
update public.events e
   set status = b.status
  from public.bak_events_20260805 b
 where b.id = e.id
   and e.status is distinct from b.status;

alter table public.events
  alter column status set default 'PENDING'::event_status;

-- ---------------------------------------------------------------------
-- 4. Viste: definizioni originali (nessun filtro sullo status)
-- ---------------------------------------------------------------------
create or replace view public.v_monthly_summaries as
 SELECT e.user_id,
    COALESCE(p.full_name, (e.user_id)::text) AS name,
    (EXTRACT(year FROM (e.starts_at AT TIME ZONE 'Europe/Rome'::text)))::integer AS year,
    (EXTRACT(month FROM (e.starts_at AT TIME ZONE 'Europe/Rome'::text)))::integer AS month,
    sum(
        CASE
            WHEN (e.type = 'FERIE'::event_type) THEN COALESCE(( SELECT (count(*))::numeric AS count
               FROM generate_series((((e.starts_at AT TIME ZONE 'Europe/Rome'::text))::date)::timestamp with time zone, ((((e.ends_at AT TIME ZONE 'Europe/Rome'::text) - '1 day'::interval))::date)::timestamp with time zone, '1 day'::interval) d(d)
              WHERE ((EXTRACT(dow FROM d.d) <> ALL (ARRAY[(0)::numeric, (6)::numeric])) AND (NOT ((d.d)::date IN ( SELECT h.day
                       FROM holidays h))))), (0)::numeric)
            ELSE (0)::numeric
        END) AS ferie_days,
    (sum(
        CASE
            WHEN (e.type = 'SMART_WORKING'::event_type) THEN GREATEST(date_part('day'::text, (e.ends_at - e.starts_at)), (0)::double precision)
            ELSE (0)::double precision
        END))::numeric AS smart_days,
    (sum(
        CASE
            WHEN (e.type = 'MALATTIA'::event_type) THEN GREATEST(date_part('day'::text, (e.ends_at - e.starts_at)), (0)::double precision)
            ELSE (0)::double precision
        END))::numeric AS malattia_days,
    (sum(
        CASE
            WHEN (e.type = 'PERMESSO_ENTRATA_ANTICIPATA'::event_type) THEN COALESCE(e.permesso_hours, 0)
            ELSE 0
        END))::numeric AS perm_entrata_count,
    (sum(
        CASE
            WHEN (e.type = 'PERMESSO_USCITA_ANTICIPATA'::event_type) THEN COALESCE(e.permesso_hours, 0)
            ELSE 0
        END))::numeric AS perm_uscita_count,
    (sum(
        CASE
            WHEN (e.type = 'PERMESSO_STUDIO'::event_type) THEN COALESCE(e.permesso_hours, 0)
            ELSE 0
        END))::numeric AS perm_studio_count
   FROM (events e
     LEFT JOIN profiles p ON ((p.id = e.user_id)))
  GROUP BY e.user_id, COALESCE(p.full_name, (e.user_id)::text), ((EXTRACT(year FROM (e.starts_at AT TIME ZONE 'Europe/Rome'::text)))::integer), ((EXTRACT(month FROM (e.starts_at AT TIME ZONE 'Europe/Rome'::text)))::integer)
  ORDER BY COALESCE(p.full_name, (e.user_id)::text);

create or replace view public.v_balances as
 WITH perm_usage AS (
         SELECT e.user_id,
            sum(COALESCE((e.permesso_hours)::numeric, ((e.permesso_minutes)::numeric / 60.0))) AS used_h
           FROM events e
          WHERE (e.type = ANY (ARRAY['PERMESSO_ENTRATA_ANTICIPATA'::event_type, 'PERMESSO_USCITA_ANTICIPATA'::event_type]))
          GROUP BY e.user_id
        ), ferie_usage AS (
         SELECT e.user_id,
            (sum(GREATEST((date((e.ends_at AT TIME ZONE 'Europe/Rome'::text)) - date((e.starts_at AT TIME ZONE 'Europe/Rome'::text))), 1)))::numeric AS used_days
           FROM events e
          WHERE (e.type = 'FERIE'::event_type)
          GROUP BY e.user_id
        )
 SELECT u.id AS user_id,
    (COALESCE(s.ferie_days, (0)::numeric) - COALESCE(fu.used_days, (0)::numeric)) AS ferie_days_balance,
    (COALESCE(s.perm_hours, (0)::numeric) - COALESCE(pu.used_h, (0)::numeric)) AS permessi_hours_balance
   FROM (((profiles u
     LEFT JOIN bl_starting_balances s ON ((s.user_id = u.id)))
     LEFT JOIN ferie_usage fu ON ((fu.user_id = u.id)))
     LEFT JOIN perm_usage pu ON ((pu.user_id = u.id)));

create or replace view public.monthly_summary_view as
 WITH ev_notes AS (
         SELECT e.user_id,
            (EXTRACT(year FROM e.starts_at))::integer AS year,
            (EXTRACT(month FROM e.starts_at))::integer AS month,
            string_agg(btrim(e.note), (chr(10) || '• ')::text ORDER BY e.starts_at) AS notes
           FROM events e
          WHERE ((e.note IS NOT NULL) AND (btrim(e.note) <> ''::text))
          GROUP BY e.user_id, ((EXTRACT(year FROM e.starts_at))::integer), ((EXTRACT(month FROM e.starts_at))::integer)
        )
 SELECT vms.user_id,
    vms.name,
    vms.year,
    vms.month,
    (vms.ferie_days)::integer AS ferie_days,
    (vms.malattia_days)::integer AS malattia_days,
    (COALESCE(vms.smart_days, (0)::numeric))::integer AS smart_days,
    (COALESCE(vms.perm_entrata_count, (0)::numeric))::integer AS perm_entrata_count,
    (COALESCE(vms.perm_uscita_count, (0)::numeric))::integer AS perm_uscita_count,
    ev.notes
   FROM (v_monthly_summaries vms
     LEFT JOIN ev_notes ev ON (((ev.user_id = vms.user_id) AND (ev.year = vms.year) AND (ev.month = vms.month))));

-- ---------------------------------------------------------------------
-- 5. balance_ledger: ricostruito dal backup
-- ---------------------------------------------------------------------
delete from public.balance_ledger;
insert into public.balance_ledger select * from public.bak_balance_ledger_20260805;

commit;

-- ---------------------------------------------------------------------
-- 6. Opzionale: le colonne aggiunte restano (innocue). Per toglierle:
--
-- alter table public.events
--   drop column if exists requested_at,
--   drop column if exists decided_at,
--   drop column if exists decided_by,
--   drop column if exists decision_channel,
--   drop column if exists notified_at,
--   drop column if exists notify_error;
-- drop index if exists public.events_status_idx;
--
-- E per eliminare i backup una volta certi che va tutto bene:
--
-- drop table if exists public.bak_events_20260805;
-- drop table if exists public.bak_balance_ledger_20260805;
-- ---------------------------------------------------------------------
