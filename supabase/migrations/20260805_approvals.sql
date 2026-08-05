-- =====================================================================
--  Flusso di approvazione assenze (ferie / permesso uscita)
--
--  Scritta contro lo schema REALE del progetto rvhguqudmtzavrrubdlk.
--  Eseguire per intero nel SQL Editor di Supabase, in un colpo solo.
--  L'ordine dei blocchi conta.
--
--  Stato di partenza rilevato:
--    - events.status esiste gia', enum event_status (PENDING/APPROVED/REJECTED)
--    - default della colonna: 'PENDING'  -> mai usato dall'app
--    - 326 eventi esistenti, TUTTI in PENDING
--    - trigger trg_events_balance_au -> events_balance_au() popola balance_ledger
--    - viste che leggono events: v_monthly_summaries, v_balances, monthly_summary_view
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Colonne di tracciamento (status esiste gia', non si tocca il tipo)
-- ---------------------------------------------------------------------
alter table public.events
  add column if not exists requested_at     timestamptz,
  add column if not exists decided_at       timestamptz,
  add column if not exists decided_by       uuid,
  add column if not exists decision_channel text,
  add column if not exists notified_at      timestamptz,
  add column if not exists notify_error     text;

-- Il default diventa APPROVED: cosi' qualunque insert che sfugga al
-- trigger non blocca per sbaglio un evento non soggetto ad approvazione.
alter table public.events
  alter column status set default 'APPROVED'::event_status;

create index if not exists events_status_idx on public.events (status);

-- ---------------------------------------------------------------------
-- 2. I saldi li muovono solo gli eventi approvati
--    (patch della funzione esistente: aggiunta la sola guardia sullo status)
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

  -- NUOVO: una richiesta in attesa o rifiutata non scala nulla.
  if new.status is distinct from 'APPROVED'::event_status then
    return new;
  end if;

  insert into public.balance_ledger(user_id, kind, amount, year, month, source_event_id, note, rule)
  select new.user_id, e.kind, e.amount, e.year, e.month, new.id, null, e.rule
  from public.event_effect(new.type, new.starts_at, new.ends_at, new.permesso_minutes) e
  where e.amount <> 0;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------
-- 3. BACKFILL — i 326 eventi gia' inseriti sono storico approvato
--
--    Senza questo passo, dopo il filtro delle viste sparirebbero tutti
--    da riepiloghi e saldi. L'UPDATE fa ripartire trg_events_balance_au,
--    che ricostruisce balance_ledger con gli stessi identici valori.
-- ---------------------------------------------------------------------
update public.events
   set status = 'APPROVED'::event_status
 where status = 'PENDING'::event_status;

-- ---------------------------------------------------------------------
-- 4. Helper: il chiamante ha privilegi di servizio?
--    - PostgREST con service_role key -> claims.role = 'service_role'
--    - SQL Editor / psql              -> current_user = 'postgres'
-- ---------------------------------------------------------------------
create or replace function public.is_privileged_role()
returns boolean
language sql
stable
as $$
  select coalesce(
           nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
           current_user
         ) in ('service_role', 'postgres', 'supabase_admin');
$$;

-- ---------------------------------------------------------------------
-- 5. Tipi soggetti ad approvazione
--    ATTENZIONE: allineato a APPROVAL_REQUIRED_TYPES in
--    src/app/lib/approvals.ts
--    L'argomento e' text: event_type non ha cast implicito verso text,
--    quindi ai richiami serve sempre  ::text
-- ---------------------------------------------------------------------
create or replace function public.event_needs_approval(p_type text)
returns boolean
language sql
immutable
as $$
  select p_type in ('FERIE', 'PERMESSO_USCITA_ANTICIPATA');
$$;

-- ---------------------------------------------------------------------
-- 6. Lo stato lo decide il database, non il client
--    - insert di un tipo soggetto ad approvazione -> PENDING forzato
--    - il client non puo' cambiare status da solo
--    - modifica di tipo/date/ore -> torna in PENDING
-- ---------------------------------------------------------------------
create or replace function public.enforce_event_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if public.event_needs_approval(new.type::text) then
      new.status           := 'PENDING'::event_status;
      new.requested_at     := now();
      new.decided_at       := null;
      new.decided_by       := null;
      new.decision_channel := null;
    else
      new.status       := 'APPROVED'::event_status;
      new.requested_at := null;
    end if;
    new.notified_at  := null;
    new.notify_error := null;
    return new;
  end if;

  -- UPDATE
  if not public.is_privileged_role() then
    if new.status is distinct from old.status then
      raise exception
        'Lo stato di approvazione non puo essere modificato direttamente';
    end if;

    if public.event_needs_approval(new.type::text)
       and (new.type           is distinct from old.type
         or new.starts_at      is distinct from old.starts_at
         or new.ends_at        is distinct from old.ends_at
         or new.permesso_hours is distinct from old.permesso_hours)
    then
      new.status           := 'PENDING'::event_status;
      new.requested_at     := now();
      new.decided_at       := null;
      new.decided_by       := null;
      new.decision_channel := null;
      new.notified_at      := null;
      new.notify_error     := null;
    end if;

    if not public.event_needs_approval(new.type::text) then
      new.status := 'APPROVED'::event_status;
    end if;
  end if;

  return new;
end;
$$;

-- BEFORE: gira prima di trg_events_balance_au (AFTER), che vede lo status finale.
drop trigger if exists trg_enforce_event_approval on public.events;
create trigger trg_enforce_event_approval
  before insert or update on public.events
  for each row execute function public.enforce_event_approval();

-- =====================================================================
--  7. VISTE — escludono PENDING e REJECTED
--     Definizioni identiche alle attuali, aggiunto solo il filtro.
-- =====================================================================

-- 7a. v_monthly_summaries
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
  WHERE (e.status = 'APPROVED'::event_status)          -- <<< filtro approvazione
  GROUP BY e.user_id, COALESCE(p.full_name, (e.user_id)::text), ((EXTRACT(year FROM (e.starts_at AT TIME ZONE 'Europe/Rome'::text)))::integer), ((EXTRACT(month FROM (e.starts_at AT TIME ZONE 'Europe/Rome'::text)))::integer)
  ORDER BY COALESCE(p.full_name, (e.user_id)::text);

-- 7b. v_balances
create or replace view public.v_balances as
 WITH perm_usage AS (
         SELECT e.user_id,
            sum(COALESCE((e.permesso_hours)::numeric, ((e.permesso_minutes)::numeric / 60.0))) AS used_h
           FROM events e
          WHERE (e.type = ANY (ARRAY['PERMESSO_ENTRATA_ANTICIPATA'::event_type, 'PERMESSO_USCITA_ANTICIPATA'::event_type]))
            AND (e.status = 'APPROVED'::event_status)  -- <<< filtro approvazione
          GROUP BY e.user_id
        ), ferie_usage AS (
         SELECT e.user_id,
            (sum(GREATEST((date((e.ends_at AT TIME ZONE 'Europe/Rome'::text)) - date((e.starts_at AT TIME ZONE 'Europe/Rome'::text))), 1)))::numeric AS used_days
           FROM events e
          WHERE (e.type = 'FERIE'::event_type)
            AND (e.status = 'APPROVED'::event_status)  -- <<< filtro approvazione
          GROUP BY e.user_id
        )
 SELECT u.id AS user_id,
    (COALESCE(s.ferie_days, (0)::numeric) - COALESCE(fu.used_days, (0)::numeric)) AS ferie_days_balance,
    (COALESCE(s.perm_hours, (0)::numeric) - COALESCE(pu.used_h, (0)::numeric)) AS permessi_hours_balance
   FROM (((profiles u
     LEFT JOIN bl_starting_balances s ON ((s.user_id = u.id)))
     LEFT JOIN ferie_usage fu ON ((fu.user_id = u.id)))
     LEFT JOIN perm_usage pu ON ((pu.user_id = u.id)));

-- 7c. monthly_summary_view
--     Legge v_monthly_summaries (gia' filtrata) + CTE ev_notes su events.
create or replace view public.monthly_summary_view as
 WITH ev_notes AS (
         SELECT e.user_id,
            (EXTRACT(year FROM e.starts_at))::integer AS year,
            (EXTRACT(month FROM e.starts_at))::integer AS month,
            string_agg(btrim(e.note), (chr(10) || '• ')::text ORDER BY e.starts_at) AS notes
           FROM events e
          WHERE ((e.note IS NOT NULL) AND (btrim(e.note) <> ''::text))
            AND (e.status = 'APPROVED'::event_status)  -- <<< filtro approvazione
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

-- v_balances_by_month non tocca events: legge balance_ledger, gia' corretto
-- dalla patch di events_balance_au() al punto 2.

commit;
