# Approvazione ferie e permessi di uscita

Quando un dipendente crea una richiesta di **Ferie** o **Permesso uscita**, l'evento
nasce in stato `PENDING` e parte una notifica al responsabile. L'evento resta
visibile sul calendario ma marcato "in attesa" finche' non viene approvato.

Tutti gli altri tipi (smart working, malattia, permesso entrata, permesso studio)
sono immediati come prima.

---

## 1. Migrazione database — GIA' APPLICATA

Eseguita il 5 agosto 2026 sul progetto `rvhguqudmtzavrrubdlk`
(`2adanieleneroni@gmail.com's Org`). File: `supabase/migrations/20260805_approvals.sql`.

Stato del database prima dell'intervento:

- `events.status` esisteva gia', enum `event_status` (`PENDING`/`APPROVED`/`REJECTED`),
  con default `PENDING` — mai usato dall'app
- 326 eventi, **tutti** in `PENDING`
- `events.type` e' enum `event_type` (serve `::text` per passarlo a funzioni text)
- trigger `trg_events_balance_au` -> `events_balance_au()` popolava `balance_ledger`
  senza guardare lo status

Cosa ha fatto la migrazione:

1. aggiunto `requested_at`, `decided_at`, `decided_by`, `decision_channel`,
   `notified_at`, `notify_error` + indice su `status`
2. default di `status` portato a `APPROVED`
3. patch di `events_balance_au()`: solo gli eventi `APPROVED` muovono i saldi
4. backfill dei 326 eventi storici a `APPROVED` (l'update ha fatto ripartire il
   trigger dei saldi, che ha ricostruito `balance_ledger` con le stesse 117 righe)
5. creato `is_privileged_role()`, `event_needs_approval()`,
   `enforce_event_approval()` + trigger `trg_enforce_event_approval`
6. ricreate `v_monthly_summaries`, `v_balances`, `monthly_summary_view` con
   `where e.status = 'APPROVED'`

`v_balances_by_month` non e' stata toccata: legge solo `balance_ledger`, gia'
corretto dal punto 3.

Il trigger `enforce_event_approval` decide lo stato lato database: **il client non
puo' auto-approvarsi**, nemmeno chiamando l'API Supabase a mano. Se modifichi tipo o
date di una richiesta gia' approvata, torna in `PENDING`.

### Verifica post-migrazione

Test eseguito (con rollback automatico via `raise exception`):

```
FERIE  -> PENDING, requested_at valorizzato
USCITA -> PENDING
SMART  -> APPROVED
```

Conteggi finali: 326 eventi, 117 righe ledger, 1 trigger, 3 viste filtrate.

### Backup

Nel database restano due tabelle di backup con RLS attiva (nessuna policy = solo
service_role/postgres):

- `public.bak_events_20260805` (326 righe)
- `public.bak_balance_ledger_20260805` (117 righe)

Rollback completo: `supabase/migrations/20260805_approvals_ROLLBACK.sql`.
Eliminare i backup solo dopo qualche settimana di esercizio senza problemi.

---

## 2. Canale email — funziona subito, costo zero

Riusa l'SMTP gia' configurato per il riepilogo mensile.

```env
APPROVAL_CHANNELS=email
APPROVER_EMAIL=capo@geoconsult.it     # se assente ricade su MAIL_TO
APP_BASE_URL=https://tuo-dominio.vercel.app
APPROVAL_SECRET=<openssl rand -base64 32>
```

Il responsabile riceve una mail con due bottoni **Approva** / **Rifiuta**.
Il click apre una pagina di conferma; solo il submit applica la decisione.
Il doppio passaggio evita che uno scanner antispam approvi da solo.

I link sono firmati HMAC e scadono dopo 60 giorni.

---

## 3. Canale WhatsApp — quando avrai l'account Meta

### 3.1 Cosa serve

| Ruolo | Cosa serve |
|---|---|
| Azienda (mittente) | Meta Business Account + numero su WhatsApp Cloud API |
| Responsabile (destinatario) | WhatsApp normale. Nulla da installare. |

Il numero registrato su Cloud API **non e' piu' utilizzabile** con l'app WhatsApp
normale o WhatsApp Business. Serve un numero dedicato.

Per iniziare senza SIM dedicata: Meta fornisce un **numero di test gratuito** con
fino a 5 destinatari registrati. Con un solo destinatario copre il caso d'uso
completo a costo zero.

### 3.2 Setup

1. [business.facebook.com](https://business.facebook.com) → crea Business Portfolio
2. [developers.facebook.com](https://developers.facebook.com) → nuova App → prodotto **WhatsApp**
3. **API Setup**: annota `Phone number ID`, genera un token (per la produzione usa
   un System User token permanente)
4. Registra il numero del responsabile fra i destinatari di test
5. Crea il template (sotto)
6. Configura il webhook (sotto)
7. Imposta le env var e metti `APPROVAL_CHANNELS=email,whatsapp`

### 3.3 Template da sottomettere a Meta

- **Nome**: `richiesta_assenza`
- **Categoria**: `Utility`
- **Lingua**: Italiano (`it`)

**Corpo** (5 variabili, nell'ordine esatto):

```
Nuova richiesta di assenza da approvare.

Dipendente: {{1}}
Tipo: {{2}}
Periodo: {{3}}
Durata: {{4}}
Nota: {{5}}
```

**Bottoni**: due *Quick reply*, in quest'ordine:

| Indice | Testo |
|---|---|
| 0 | `Approva` |
| 1 | `Rifiuta` |

L'ordine conta: il codice manda il payload `APPROVED:<id>` all'indice 0 e
`REJECTED:<id>` all'indice 1.

Esempi richiesti da Meta per l'approvazione: Mario Rossi / Ferie /
dal 12 agosto 2026 al 20 agosto 2026 / 9 giorni / nessuna.

Approvazione Meta: da un'ora a un giorno.

### 3.4 Webhook

Nel pannello Meta → WhatsApp → Configuration → Webhook:

- **Callback URL**: `https://<dominio>/api/approvals/whatsapp-webhook`
- **Verify token**: lo stesso valore messo in `WHATSAPP_VERIFY_TOKEN`
- **Campi da sottoscrivere**: `messages`

Il webhook verifica la firma `X-Hub-Signature-256` con `WHATSAPP_APP_SECRET`.
**Senza app secret configurato rifiuta ogni richiesta.**

Accetta decisioni **solo** dal numero in `WHATSAPP_APPROVER_PHONE`: un tap da un
altro numero viene loggato e ignorato.

### 3.5 Costi

Template categoria *utility*: pochi centesimi a messaggio in Italia. Quando il
responsabile tocca un bottone si apre una finestra di 24h in cui i messaggi di
testo sono gratuiti (usata per il messaggio di conferma).
Verificare la tariffa corrente sulla pagina pricing di Meta: cambia spesso.

---

## 4. Fallback in app

Se la notifica non parte (SMTP giu', token WhatsApp scaduto), la richiesta resta
comunque `PENDING` e l'errore viene salvato in `events.notify_error`.

Un utente con `profiles.is_admin = true` che apre l'evento sul calendario trova
i bottoni **Approva** / **Rifiuta** direttamente nel riepilogo del wizard.
Nessuna richiesta puo' rimanere bloccata.

---

## 5. Flusso completo

```
dipendente crea Ferie
        │
        ▼
trigger DB  ──►  status = PENDING
        │
        ▼
POST /api/approvals/request
        │
        ├──► email al responsabile   (link firmati)
        └──► WhatsApp al responsabile (template + bottoni)
                     │
                     ▼
        tap bottone / click link
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
/api/approvals/decide     /api/approvals/whatsapp-webhook
        │                         │
        └────────────┬────────────┘
                     ▼
            applyDecision()  ──►  status = APPROVED | REJECTED
                     │
                     ▼
        realtime Supabase aggiorna il calendario
```

---

## 6. Cambiare quali tipi richiedono approvazione

Due punti da tenere allineati:

- `APPROVAL_REQUIRED_TYPES` in `src/app/lib/approvals.ts`
- `public.event_needs_approval()` nella migrazione SQL

Il database e' la fonte di verita': se i due divergono, vince il trigger.
