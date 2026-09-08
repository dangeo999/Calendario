# Notifica assenze al responsabile

Quando un dipendente inserisce **Ferie** o **Permesso uscita**, l'evento e' subito
valido (`APPROVED`) e conta sui saldi. Al responsabile parte solo una **email
informativa**: non deve approvare niente, non ci sono bottoni.

Tutti gli altri tipi (smart working, malattia, permesso entrata, permesso studio)
non generano nessuna notifica.

Storia: il flusso di approvazione e' esistito dal 5 agosto al 8 settembre 2026
(`supabase/migrations/20260805_approvals.sql`, commit `d5c4136`). E' stato tolto
con `supabase/migrations/20260908_notify_only.sql`.

---

## 1. Database

Migrazione da eseguire nel SQL Editor di Supabase:
`supabase/migrations/20260908_notify_only.sql`.

Cosa fa:

1. `public.event_needs_approval()` ora ritorna sempre `false` → il trigger
   `trg_enforce_event_approval` forza `status = 'APPROVED'` su ogni insert/update
2. gli eventi rimasti `PENDING` o `REJECTED` passano ad `APPROVED`
   (l'update fa ripartire `trg_events_balance_au`, che riallinea `balance_ledger`)

Restano in piedi, e vanno bene cosi':

- colonna `events.status` + le viste che filtrano `status = 'APPROVED'`
  (`v_monthly_summaries`, `v_balances`, `monthly_summary_view`)
- il trigger, che continua a impedire al client di scrivere `status` a mano
- le colonne di tracciamento; l'app usa ancora `notified_at` e `notify_error`

Backup del 5 agosto: `bak_events_20260805`, `bak_balance_ledger_20260805`.

Verifica dopo la migrazione:

```sql
select status, count(*) from public.events group by status;  -- una sola riga: APPROVED
```

---

## 2. Canale email

Riusa l'SMTP gia' configurato per il riepilogo mensile.

```env
APPROVAL_CHANNELS=email
APPROVER_EMAIL=capo@geoconsult.it     # se assente ricade su MAIL_TO
APP_BASE_URL=https://tuo-dominio.vercel.app
```

Il responsabile riceve una mail con dipendente, tipo, periodo, durata, nota e un
bottone **Apri il calendario**. Nessun link di approvazione, nessun token firmato:
`APPROVAL_SECRET` non serve piu' e puo' essere rimossa dalle env di Vercel.

Se l'invio fallisce l'evento resta valido lo stesso e l'errore finisce in
`events.notify_error`; l'utente vede un alert.

---

## 3. Canale WhatsApp — opzionale, quando avrai l'account Meta

Stesse env var di prima (vedi `.env.example`), piu'
`APPROVAL_CHANNELS=email,whatsapp`.

Template `richiesta_assenza`, categoria `Utility`, lingua `it`, **senza bottoni**:

```
Nuova assenza registrata.

Dipendente: {{1}}
Tipo: {{2}}
Periodo: {{3}}
Durata: {{4}}
Nota: {{5}}
```

Non serve piu' nessun webhook: `WHATSAPP_VERIFY_TOKEN` e `WHATSAPP_APP_SECRET`
non sono piu' usati.

---

## 4. Flusso completo

```
dipendente crea Ferie
        │
        ▼
insert su events  ──►  status = APPROVED (subito nei saldi)
        │
        ▼
POST /api/notify/absence
        │
        ├──► email al responsabile
        └──► WhatsApp (se configurato)
```

---

## 5. Cambiare quali tipi mandano la notifica

Solo un punto: `NOTIFY_TYPES` in `src/app/lib/approvals.ts`. Il database non
c'entra piu' niente: qualunque tipo e' comunque approvato.
