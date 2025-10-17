'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import type { EventContentArg } from '@fullcalendar/core'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import itLocale from '@fullcalendar/core/locales/it'
import { supabase } from '@/app/lib/supabaseClient'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'

// UiType
type UiType =
  | 'FERIE'
  | 'SMART_WORKING'
  | 'PERMESSO_ENTRATA'
  | 'PERMESSO_USCITA'
  | 'MALATTIA'
  | 'PERMESSO_STUDIO'

// DbType
type DbType =
  | 'FERIE'
  | 'SMART_WORKING'
  | 'PERMESSO_ENTRATA_ANTICIPATA'
  | 'PERMESSO_USCITA_ANTICIPATA'
  | 'MALATTIA'
  | 'PERMESSO_STUDIO'

type Draft = {
  id?: string
  mode: 'create' | 'edit'
  type: UiType
  note: string
  date: string
  time?: string // HH:mm
  startDate?: string
  endDate?: string
  durationHours?: number
}

// helper in cima al file
const PERM_COUNTS_ARE_MINUTES = false
const toHours = (x: number | null | undefined) =>
  Math.round(((Number(x || 0)) / (PERM_COUNTS_ARE_MINUTES ? 60 : 1)) * 100) / 100

const isPermesso = (t: UiType) =>
  t === 'PERMESSO_ENTRATA' || t === 'PERMESSO_USCITA' || t === 'PERMESSO_STUDIO'
const toHHmm = (d: Date) =>
  String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')

// ---- utils date ----
const toDateInput = (iso?: string) => (iso ? iso.slice(0, 10) : '')

// versione only-UTC per evitare slittamenti di un giorno
const addDays = (yyyyMMdd: string, n: number) => {
  const [y, m, d] = yyyyMMdd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

const labelOfType = (dbType: DbType) =>
  ({
    FERIE: 'FERIE',
    SMART_WORKING: 'SMART WORKING',
    PERMESSO_ENTRATA_ANTICIPATA: 'PERMESSO ENTRATA',
    PERMESSO_USCITA_ANTICIPATA: 'PERMESSO USCITA',
    MALATTIA: 'MALATTIA',
    PERMESSO_STUDIO: 'PERMESSO STUDIO',
  } as Record<DbType, string>)[dbType]

const dbTypeOf = (t: UiType): DbType => {
  if (t === 'PERMESSO_ENTRATA') return 'PERMESSO_ENTRATA_ANTICIPATA'
  if (t === 'PERMESSO_USCITA') return 'PERMESSO_USCITA_ANTICIPATA'
  return t
}
const uiTypeOf = (t: DbType): UiType => {
  if (t === 'PERMESSO_ENTRATA_ANTICIPATA') return 'PERMESSO_ENTRATA'
  if (t === 'PERMESSO_USCITA_ANTICIPATA') return 'PERMESSO_USCITA'
  return t
}

// Calcolo Pasqua (Meeus/Butcher)
const easterSunday = (year: number) => {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}
const ymdLocal = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
const italianHolidaysOf = (year: number) => {
  const map = new Map<string, string>()
  const add = (m: number, d: number, name: string) => {
    map.set(ymdLocal(new Date(year, m - 1, d)), name)
  }
  add(1, 1, 'Capodanno')
  add(1, 6, 'Epifania')
  add(4, 25, 'Liberazione')
  add(5, 1, 'Festa del lavoro')
  add(6, 2, 'Festa della Repubblica')
  add(8, 15, 'Ferragosto')
  add(11, 1, 'Tutti i Santi')
  add(12, 8, 'Immacolata Concezione')
  add(12, 25, 'Natale')
  add(12, 26, 'Santo Stefano')
  const pasqua = easterSunday(year)
  const pasquetta = new Date(pasqua)
  pasquetta.setDate(pasqua.getDate() + 1)
  map.set(ymdLocal(pasquetta), 'Lunedì dell’Angelo')
  return map
}

export default function CalendarPage() {
  const [events, setEvents] = useState<any[]>([])
  const [profiles, setProfiles] = useState<any[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [isBoss, setIsBoss] = useState<boolean>(false)
  const [filterUser, setFilterUser] = useState<string>('ALL')
  const [filterType, setFilterType] = useState<'ALL' | DbType>('ALL')
  const [authUser, setAuthUser] = useState<any>(null)
  const [viewDate, setViewDate] = useState<Date>(new Date())
  const [myBalance, setMyBalance] = useState<{ ferie: number; perm: number } | null>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const dlgRef = useRef<HTMLDialogElement>(null)
  const [sendingMail, setSendingMail] = useState(false)

  const handleSendMonthlyEmail = async () => {
    const y = viewDate.getFullYear()
    const m = viewDate.getMonth() + 1
    try {
      setSendingMail(true)
      const res = await fetch('/api/send-monthly-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: y, month: m }),
        credentials: 'include',
      })

      const js = await res.json()
      if (!res.ok) throw new Error(js?.error || 'Invio fallito')
      alert(`Riepilogo ${String(m).padStart(2, '0')}/${y} inviato a: ${js.recipients?.join(', ') || 'nessuno'}`)
    } catch (err: any) {
      alert(`Errore invio: ${String(err?.message || err)}`)
    } finally {
      setSendingMail(false)
    }
  }

  // Festività nazionali per l'anno in vista (±1)
  const holidays = useMemo(() => {
    const y = viewDate.getFullYear()
    return new Map<string, string>([
      ...italianHolidaysOf(y - 1),
      ...italianHolidaysOf(y),
      ...italianHolidaysOf(y + 1),
    ])
  }, [viewDate])

  const calRef = useRef<any>(null) // semplice per getApi()
  const [showFiltersMobile, setShowFiltersMobile] = useState(false)
  const [showTableMobile, setShowTableMobile] = useState(false)

  // NEW: bottone riepilogo (mobile)
  const [showSummarySheet, setShowSummarySheet] = useState(false)

  const initialsOf = (full?: string) => {
    if (!full) return 'U'
    const parts = String(full).trim().split(/\s+/).filter(Boolean)
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
  }

  const openCreateQuick = () => {
    const day = toDateInput(new Date().toISOString())
    setDraft({
      mode: 'create',
      date: day,
      startDate: day,
      endDate: day,
      time: '09:00',
      durationHours: 1,
      type: 'SMART_WORKING',
      note: '',
    })
    setOpen(true)
    setTimeout(() => dlgRef.current?.showModal(), 0)
  }

  // ---------- DATA LOAD ----------
  const load = async () => {
    const { data: evs } = await supabase.from('events').select('*')
    const { data: profs0 } = await supabase.from('profiles').select('id, full_name, is_admin')
    const { data: { user } } = await supabase.auth.getUser()

    setEvents(evs || [])
    setAuthUser(user || null)
    setCurrentUserId(user?.id ?? null)

    let profs = profs0 || []

    // assicura che il profilo dell’utente esista e abbia un nome
    if (user) {
      const mine = profs.find(p => p.id === user.id)
      if (!mine || !mine.full_name) {
        const full_name =
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          (user.email ? user.email.split('@')[0] : 'Utente')

        await supabase.from('profiles').upsert({
          id: user.id,
          full_name,
          is_admin: mine?.is_admin ?? false,
          email: user.email ?? null,
        })

        const { data: profs1 } = await supabase.from('profiles').select('id, full_name, is_admin')
        profs = profs1 || profs
      }
    }

    setProfiles(profs)

    const me = profs.find((p: any) => p.id === user?.id)
    setIsBoss(!!me?.is_admin)
  }
  useEffect(() => { load() }, [])

  // ---------- NAME HELPER ----------
  const nameOf = (uid: string) => {
    const p = profiles.find(p => p.id === uid)
    let full =
      p?.full_name ||
      (uid === authUser?.id
        ? (authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || authUser?.email || 'Tu')
        : 'Utente')

    // Se vista mobile, mostra solo iniziali
    if (typeof window !== 'undefined' && window.innerWidth < 900 && full) {
      const parts = String(full).trim().split(/\s+/).filter(Boolean)
      if (parts.length === 1) {
        const word = parts[0].replace(/@.*/, '')
        const a = word.charAt(0).toUpperCase()
        const b = word.charAt(1) ? word.charAt(1).toUpperCase() : ''
        return a + b
      }
      return parts.map(w => w[0]?.toUpperCase() || '').filter(Boolean).join('')
    }
    return full
  }

  // ---------- FILTERED EVENTS (per il calendario) ----------
  const filtered = useMemo(
    () =>
      events.filter(
        (e: any) =>
          (filterUser === 'ALL' || e.user_id === filterUser) &&
          (filterType === 'ALL' || e.type === filterType)
      ),
    [events, filterUser, filterType]
  )

  const eventsForCalendar = useMemo(
    () =>
      filtered.map((e: any) => {
        const uiT = uiTypeOf(e.type as DbType)
        const allDay = !isPermesso(uiT)
        return {
          id: e.id,
          title: `${nameOf(e.user_id)}`,
          start: e.starts_at,
          end: e.ends_at,
          allDay,
          extendedProps: {
            type: e.type as DbType,
            note: e.note ?? '',
            permesso_hours: e.permesso_hours ?? null,
          },
          classNames: [`evt-${(e.type as string).toLowerCase()}`],
        }
      }),
    [filtered, profiles, authUser]
  )

  // ---------- MONTHLY SUMMARY ----------
  type MonthlyRow = {
    user_id: string
    name: string
    ferie_days: number
    smart_days: number
    malattia_days: number
    perm_entrata_count: number
    perm_uscita_count: number
    perm_studio_count: number
  }
  const [monthSummary, setMonthSummary] = useState<MonthlyRow[]>([])
  const totals = useMemo(() => {
    const acc = { ferie: 0, smart: 0, mal: 0, permH: 0 }
    for (const r of monthSummary) {
      acc.ferie += Number(r.ferie_days || 0)
      acc.smart += Number(r.smart_days || 0)
      acc.mal += Number(r.malattia_days || 0)
      acc.permH += Number(r.perm_entrata_count || 0)
        + Number(r.perm_uscita_count || 0)
        + Number(r.perm_studio_count || 0)
    }
    return acc
  }, [monthSummary])

  const loadSummary = React.useCallback(async () => {
    const y = viewDate.getFullYear()
    const m = viewDate.getMonth() + 1

    let q = supabase
      .from('v_monthly_summaries')
      .select('user_id,name,year,month,ferie_days,smart_days,malattia_days,perm_entrata_count,perm_uscita_count,perm_studio_count')
      .eq('year', y)
      .eq('month', m)
      .order('name', { ascending: true })

    if (!isBoss && currentUserId) q = q.eq('user_id', currentUserId)

    const { data, error } = await q
    if (error) {
      console.error('summary error', error)
      setMonthSummary([])
      return
    }
    setMonthSummary(data || [])
  }, [viewDate, isBoss, currentUserId])

  useEffect(() => { loadSummary() }, [loadSummary])

  // ---------- REALTIME ----------
  useEffect(() => {
    const ch = supabase
      .channel('realtime:events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, async () => {
        await load()
        await loadSummary()
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [loadSummary])

  const WORKDAY_HOURS = 8
  const PERM_BALANCE_IS_DAYS = false

  useEffect(() => {
    const run = async () => {
      if (!currentUserId) return setMyBalance(null)
      const { data } = await supabase
        .from('v_balances')
        .select('ferie_days_balance, permessi_hours_balance')
        .eq('user_id', currentUserId)
        .single()
      setMyBalance(
        data
          ? {
              ferie: Number(data.ferie_days_balance || 0),
              perm: PERM_BALANCE_IS_DAYS
                ? Number(data.permessi_hours_balance || 0) * WORKDAY_HOURS
                : Number(data.permessi_hours_balance || 0),
            }
          : { ferie: 0, perm: 0 }
      )
    }
    run()
  }, [currentUserId, monthSummary])

  // --- Handlers ---
  const onSelect = (info: any) => {
    const day = toDateInput(info.startStr)
    setDraft({
      mode: 'create',
      date: day,
      startDate: day,
      endDate: day,
      time: '09:00',
      durationHours: 1,
      type: 'SMART_WORKING',
      note: '',
    })
    setOpen(true)
    setTimeout(() => dlgRef.current?.showModal(), 0)
  }
  const onDateClick = (info: { dateStr: string }) => {
    const day = toDateInput(info.dateStr)
    setDraft({
      mode: 'create',
      date: day,
      startDate: day,
      endDate: day,
      time: '09:00',
      durationHours: 1,
      type: 'SMART_WORKING',
      note: '',
    })
    setOpen(true)
    setTimeout(() => dlgRef.current?.showModal(), 0)
  }

  const onEventClick = (clickInfo: any) => {
    const e = clickInfo.event
    const id = e.id as string
    const { type, note } = e.extendedProps || {}
    const uiT = uiTypeOf(type as DbType)

    if (isPermesso(uiT)) {
      const start = new Date(e.start!)
      const day = toDateInput(e.startStr)
      const hours = (e.extendedProps as any)?.permesso_hours ?? 1
      setDraft({
        id,
        mode: 'edit',
        date: day,
        time: toHHmm(start),
        type: uiT,
        note: (note as string) ?? '',
        durationHours: Number(hours) || 1,
      })
    } else {
      const startInc = toDateInput(e.startStr)
      const endInc = e.endStr ? addDays(toDateInput(e.endStr), -1) : startInc
      setDraft({
        id,
        mode: 'edit',
        date: startInc,
        startDate: startInc,
        endDate: endInc,
        type: uiTypeOf(type as DbType),
        note: (note as string) ?? '',
      })
    }

    setOpen(true)
    setTimeout(() => dlgRef.current?.showModal(), 0)
  }

  const onCreate = async () => {
    if (!draft) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return alert('Devi essere loggato')

    const typeForDb = dbTypeOf(draft.type)
    let starts_at: string
    let ends_at: string
    let permesso_hours: number | null = null

    if (isPermesso(draft.type)) {
      const day = draft.date
      const t = draft.time || '09:00'
      const local = new Date(`${day}T${t}:00`)
      starts_at = local.toISOString()
      ends_at = starts_at
      const raw = Number(draft.durationHours ?? 1)
      permesso_hours = Math.max(1, Math.round(raw))
    } else {
      const s = draft.startDate || draft.date
      const e = draft.endDate || draft.date
      const startLocal = new Date(`${s}T00:00:00`)
      const endLocal = new Date(`${addDays(e, 1)}T00:00:00`)
      starts_at = startLocal.toISOString()
      ends_at = endLocal.toISOString()
    }

    const { error } = await supabase.from('events').insert({
      user_id: user.id,
      type: typeForDb,
      note: draft.note,
      starts_at,
      ends_at,
      permesso_hours,
    })
    if (error) { alert(error.message); return }

    dlgRef.current?.close()
    setOpen(false)
    setDraft(null)
    await load()
    await loadSummary()
  }

  const onUpdate = async () => {
    if (!draft?.id) return

    let starts_at: string
    let ends_at: string
    let permesso_hours: number | null = null

    if (isPermesso(draft.type)) {
      const day = draft.date
      const t = draft.time || '09:00'
      const local = new Date(`${day}T${t}:00`)
      const isoUtc = local.toISOString()
      starts_at = isoUtc
      ends_at = isoUtc
      const raw = Number(draft.durationHours ?? 1)
      permesso_hours = Math.max(1, Math.round(raw))
    } else {
      const s = draft.startDate || draft.date
      const e = draft.endDate || draft.date
      const startLocal = new Date(`${s}T00:00:00`)
      const endLocal = new Date(`${addDays(e, 1)}T00:00:00`)
      starts_at = startLocal.toISOString()
      ends_at = endLocal.toISOString()
      permesso_hours = null
    }

    const { error } = await supabase
      .from('events')
      .update({
        type: dbTypeOf(draft.type),
        note: draft.note,
        starts_at,
        ends_at,
        permesso_hours,
      })
      .eq('id', draft.id)

    if (error) { alert(error.message); return }

    dlgRef.current?.close()
    setOpen(false)
    setDraft(null)
    await load()
    await loadSummary()
  }

  const handleSendEmail = async () => {
    const y = viewDate.getFullYear()
    const m = viewDate.getMonth() + 1
    try {
      const res = await fetch('/api/send-monthly-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: y, month: m }),
        credentials: 'include',
      })

      const js = await res.json()
      if (!res.ok) throw new Error(js?.error || 'Invio fallito')
      alert(`Riepilogo ${String(m).padStart(2, '0')}/${y} inviato a: ${js.recipients?.join(', ') || 'nessuno'}`)
    } catch (err: any) {
      alert(`Errore invio: ${String(err?.message || err)}`)
    }
  }

  const onDelete = async () => {
    if (!draft?.id) return
    const { error } = await supabase.from('events').delete().eq('id', draft.id)
    if (error) { alert(error.message); return }

    dlgRef.current?.close()
    setOpen(false)
    setDraft(null)
    await load()
    await loadSummary()
  }

  // ---- UI helpers ----
  const gotoPrev = () => calRef.current?.getApi().prev()
  const gotoNext = () => calRef.current?.getApi().next()
  const gotoToday = () => calRef.current?.getApi().today()

  // Event rendering
  const renderEvent = (arg: EventContentArg) => {
    const typeDb = (arg.event.extendedProps as any).type as DbType
    return (
      <div className="m-event">
        <div className="m-event__title">
          <span className="m-event__dot" />
          <span>{arg.event.title}</span>
        </div>
        {/*<div className="m-event__type">{labelOfType(typeDb)}</div>*/}
      </div>
    )
  }

  // --- RIEPILOGO: estratto in funzione per riuso (desktop + sheet mobile) ---
  const renderSummary = () => (
    <div className="card m-elev-1 summary-card" style={{ marginTop: 0, marginBottom: 8 }}>
      <div className="panel__header" style={{ position: 'static' }}>
        <div className="summary-title">
          Riepilogo mese • {format(viewDate, 'MMMM yyyy', { locale: it })}
        </div>
      </div>

      {/* Saldi personali compatti */}
      {myBalance && (
        <div className="my-balances">
          <span>Saldi: <b className="mono">{myBalance.ferie.toFixed(2)}</b> gg ferie</span>
          <span>• <b className="mono">{myBalance.perm.toFixed(2)}</b> h permessi</span>
        </div>
      )}

      {/* KPI mese 2x2 */}
      {monthSummary.length > 0 && (
        <div className="kpi-grid">
          <div className="kpi-card"><i className="dot dot--ferie" /><span className="label">Ferie tot.</span><span className="value mono">{totals.ferie}</span></div>
          <div className="kpi-card"><i className="dot dot--smart" /><span className="label">Smart tot.</span><span className="value mono">{totals.smart}</span></div>
          <div className="kpi-card"><i className="dot dot--malattia" /><span className="label">Malattia</span><span className="value mono">{totals.mal}</span></div>
          <div className="kpi-card"><i className="dot dot--entrata" /><span className="label">Permessi (h)</span><span className="value mono">{totals.permH}</span></div>
        </div>
      )}

      {/* Elenco utenti snello */}
      {monthSummary.length > 0 && (
        <div className="mobile-summary">
          {monthSummary.map(r => {
            const pills: React.ReactNode[] = []
            if (r.ferie_days) pills.push(<span key="f" className="pill pill--ferie"><i className="dot" />{r.ferie_days} gg</span>)
            if (r.smart_days) pills.push(<span key="s" className="pill pill--smart"><i className="dot" />{r.smart_days} gg</span>)
            const permTot = Number(r.perm_entrata_count || 0) + Number(r.perm_uscita_count || 0) + Number(r.perm_studio_count || 0)
            if (permTot) pills.push(<span key="p" className="pill pill--perm"><i className="dot" />{permTot} h</span>)
            if (r.malattia_days) pills.push(<span key="m" className="pill pill--mal"><i className="dot" />{r.malattia_days} gg</span>)
            const initials = r.name?.trim()?.split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || 'U'
            return (
              <div className="muser" key={r.user_id}>
                <div className="muser__ava">{initials}</div>
                <div className="muser__name">{r.name}</div>
                <div className="muser__pills">
                  {pills.length ? pills : <span className="m-field__label">—</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Toggle dettagli */}
      {monthSummary.length > 0 && (
        <button type="button" className="summary-toggle" onClick={() => setShowTableMobile(v => !v)}>
          <span className="material-symbols-rounded">{showTableMobile ? 'expand_less' : 'expand_more'}</span>
          {showTableMobile ? 'Nascondi dettagli' : 'Mostra dettagli'}
        </button>
      )}

      {/* Tabella (desktop sempre visibile, mobile solo se aperta) */}
      {monthSummary.length === 0 ? (
        <div className="m-field__label" style={{ padding: '8px 10px' }}>
          Nessun dato nel mese corrente.
        </div>
      ) : (
        <div className={`table-wrap ${showTableMobile ? 'is-open' : ''}`}>
          {/* lascia la tua tabella identica qui dentro */}
          <table className="m-table"> ... </table>
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* ===== MOBILE APPBAR ===== */}
      <div className="mobile-appbar">
        <button className="mobile-appbar__btn" onClick={() => setShowFiltersMobile(v => !v)} aria-label="Filtri">
          <span className="material-symbols-rounded">menu</span>
        </button>

        <div className="mobile-month">
          <button className="mobile-appbar__btn" onClick={gotoPrev} aria-label="Mese precedente">
            <span className="material-symbols-rounded">chevron_left</span>
          </button>
          <div style={{ maxWidth: '52vw' }}>
            {format(viewDate, 'MMMM yyyy', { locale: it })}
          </div>
          <div className="mobile-month__chev">
            <button className="mobile-appbar__btn" onClick={gotoNext} aria-label="Mese successivo">
              <span className="material-symbols-rounded">chevron_right</span>
            </button>
          </div>
        </div>

        <button className="mobile-appbar__btn" onClick={gotoToday} aria-label="Oggi">
          <span className="material-symbols-rounded">calendar_today</span>
        </button>

        {/* Nuovo: bottone per aprire il RIEPILOGO su mobile */}
        <button
          className="mobile-appbar__btn"
          onClick={() => setShowSummarySheet(true)}
          aria-label="Riepilogo mese"
          title="Riepilogo mese"
        >
          <span className="material-symbols-rounded">insights</span>
        </button>

        <button className="mobile-appbar__btn" onClick={handleSendMonthlyEmail} disabled={sendingMail} aria-label="Invia riepilogo">
          <span className="material-symbols-rounded">{sendingMail ? 'hourglass_top' : 'task_alt'}</span>
        </button>

        <a href="/login" className="mobile-appbar__btn" aria-label="Profilo">
          <div className="mobile-avatar">
            {initialsOf(
              profiles.find(p => p.id === authUser?.id)?.full_name
              || authUser?.user_metadata?.full_name
              || authUser?.user_metadata?.name
              || (authUser?.email?.split('@')[0])
            )}
          </div>
        </a>
      </div>

      {/* Sheet filtri mobile */}
      {showFiltersMobile && (
        <div className="sheet">
          <div className="sheet__row">
            <select className="m-field" value={filterUser} onChange={e => setFilterUser(e.target.value)}>
              <option value="ALL">Tutti gli utenti</option>
              {profiles.map((p: any) => (
                <option value={p.id} key={p.id}>{p.full_name || p.id.slice(0, 6)}</option>
              ))}
            </select>
            <select className="m-field" value={filterType} onChange={e => setFilterType(e.target.value as 'ALL' | DbType)}>
              <option value="ALL">Tutti i tipi</option>
              {(['FERIE', 'SMART_WORKING', 'PERMESSO_ENTRATA_ANTICIPATA', 'PERMESSO_USCITA_ANTICIPATA', 'MALATTIA', 'PERMESSO_STUDIO'] as DbType[]).map(t => (
                <option key={t} value={t}>{labelOfType(t)}</option>
              ))}
            </select>
          </div>
          <div className="sheet__actions">
            <button className="m-btn m-btn--filled" onClick={() => setShowFiltersMobile(false)}>
              <span className="material-symbols-rounded">check</span> Applica
            </button>
          </div>
        </div>
      )}

      <div className="container">
        {/* Top App Bar */}
        <div className="appbar appbar--grid m-elev-2">
          {/* Riga 1 sinistra: Titolo */}
          <div className="appbar__title-wrap">
            <span className="material-symbols-rounded appbar__logo">calendar_month</span>
            <div className="appbar__title">Calendario condiviso</div>
          </div>

          {/* Colonna destra: controlli */}
          <div className="appbar__right">
            <div className="appbar__row appbar__row--bottom">
              <div className="segmented">
                <button className="segmented__btn" onClick={gotoPrev}>
                  <span className="material-symbols-rounded">chevron_left</span>
                </button>

                <div className="cal-month-label">
                  {format(viewDate, 'MMMM yyyy', { locale: it })}
                </div>

                <button className="segmented__btn" onClick={gotoToday}>oggi</button>
                <button className="segmented__btn" onClick={gotoNext}>
                  <span className="material-symbols-rounded">chevron_right</span>
                </button>
              </div>

              <select className="m-field" value={filterUser} onChange={e => setFilterUser(e.target.value)}>
                <option value="ALL">Tutti gli utenti</option>
                {profiles.map((p: any) => (
                  <option value={p.id} key={p.id}>{p.full_name || p.id.slice(0, 6)}</option>
                ))}
              </select>

              <select
                className="m-field"
                value={filterType}
                onChange={e => setFilterType(e.target.value as 'ALL' | DbType)}
              >
                <option value="ALL">Tutti i tipi</option>
                {(['FERIE', 'SMART_WORKING', 'PERMESSO_ENTRATA_ANTICIPATA', 'PERMESSO_USCITA_ANTICIPATA', 'MALATTIA', 'PERMESSO_STUDIO'] as DbType[]).map(t => (
                  <option key={t} value={t}>{labelOfType(t)}</option>
                ))}
              </select>

              <button
                className="m-btn m-btn--filled"
                onClick={handleSendMonthlyEmail}
                disabled={sendingMail}
                title="Invia il riepilogo del mese corrente via email"
                style={{ marginLeft: 8 }}
              >
                <span className="material-symbols-rounded">
                  {sendingMail ? 'hourglass_top' : 'send'}
                </span>
                {sendingMail ? ' Invio…' : ' Invia riepilogo'}
              </button>
              <a href="/login" className="m-btn m-btn--tonal" title="Esci">
                <span className="material-symbols-rounded">logout</span>
              </a>
            </div>
          </div>
        </div>

        <div className="card m-elev-1">
          {/* RIEPILOGO MENSILE (inline su desktop) */}
          {renderSummary()}

          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            height="auto"
            expandRows
            dayMaxEvents={3}
            nowIndicator
            selectable
            selectMirror
            select={onSelect}
            dateClick={onDateClick}
            eventClick={onEventClick}
            selectLongPressDelay={200}
            eventLongPressDelay={200}
            selectMinDistance={1}
            locale={itLocale}
            headerToolbar={false}
            buttonText={{ today: 'oggi', month: 'mese', week: 'settimana', day: 'giorno' }}
            eventDisplay="block"
            displayEventTime={true}
            eventClassNames={(arg) => [`evt-${((arg.event.extendedProps as any).type as DbType).toLowerCase()}`]}
            events={eventsForCalendar}
            eventContent={renderEvent}
            datesSet={(arg) => setViewDate(arg.view.calendar.getDate())}
            dayCellClassNames={(arg) => {
              const classes: string[] = []
              if (arg.isOther) return classes
              const dow = arg.date.getDay() // 0=dom, 6=sab
              if (dow === 0 || dow === 6) classes.push('it-weekend')
              if (dow === 0) classes.push('it-sunday')
              const iso = ymdLocal(arg.date)
              const y = arg.date.getFullYear()
              const map = new Map<string, string>([
                ...italianHolidaysOf(y - 1),
                ...italianHolidaysOf(y),
                ...italianHolidaysOf(y + 1),
              ])
              if (map.get(iso)) classes.push('it-holiday')
              return classes
            }}
            dayCellDidMount={(arg) => {
              if (arg.isOther) return
              const iso = ymdLocal(arg.date)
              const y = arg.date.getFullYear()
              const map = new Map<string, string>([
                ...italianHolidaysOf(y - 1),
                ...italianHolidaysOf(y),
                ...italianHolidaysOf(y + 1),
              ])
              const hol = map.get(iso)
              if (hol) {
                const numEl = arg.el.querySelector('.fc-daygrid-day-number') as HTMLElement | null
                if (numEl) numEl.setAttribute('data-holiday', hol)
              }
            }}
          />

          {/* LEGGENDARIO SOTTO IL RIEPILOGO (dentro la card) */}
          <div className="calendar-legend">
            <div className="legend legend--compact legend--sm">
              <span className="legend__pill"><i className="dot dot--ferie" />Ferie</span>
              <span className="legend__pill"><i className="dot dot--smart" />Smart working</span>
              <span className="legend__pill"><i className="dot dot--entrata" />Permesso entrata</span>
              <span className="legend__pill"><i className="dot dot--uscita" />Permesso uscita</span>
              <span className="legend__pill"><i className="dot dot--malattia" />Malattia</span>
              <span className="legend__pill"><i className="dot dot--studio" />Permesso studio</span>
            </div>
          </div>
        </div>

        {/* MODAL create/edit */}
        {open && (
          <dialog ref={dlgRef} className="modal" onClose={() => { setOpen(false); setDraft(null) }}>
            <div className="panel m-elev-3">
              <div className="panel__header">
                <button className="panel__close" onClick={() => dlgRef.current?.close()} aria-label="Chiudi">
                  <span className="material-symbols-rounded">close</span>
                </button>
              </div>

              {/* Riepilogo */}
              <div className="summary">
                <span className="material-symbols-rounded">event</span>
                <span>
                  {draft?.date}
                  {isPermesso(draft?.type ?? 'FERIE') ? (
                    <em className="summary__days"> • {draft?.time}</em>
                  ) : (
                    <em className="summary__days"> • {draft?.startDate} → {draft?.endDate}</em>
                  )}
                </span>
              </div>

              {/* Campi */}
              {isPermesso(draft?.type ?? 'FERIE') ? (
                <>
                  <div className="row">
                    <div className="col">
                      <label className="m-field__label">Giorno</label>
                      <input type="date" className="m-field" value={draft?.date || ''} readOnly />
                    </div>
                    <div className="col">
                      <label className="m-field__label">
                        {draft?.type === 'PERMESSO_ENTRATA' ? 'Ora di entrata' : 'Ora di uscita'}
                      </label>
                      <input
                        type="time"
                        className="m-field"
                        value={draft?.time || ''}
                        onChange={e => setDraft(v => v ? ({ ...v, time: e.target.value }) : v)}
                      />
                    </div>
                    <div className="col">
                      <label className="m-field__label">Durata (ore)</label>
                      <input
                        type="number"
                        min={1} step={1}
                        className="m-field"
                        value={draft?.durationHours ?? 1}
                        onChange={e => setDraft(v => v ? ({ ...v, durationHours: Number(e.target.value || 1) }) : v)}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="row">
                    <div className="col">
                      <label className="m-field__label">Inizio</label>
                      <input
                        type="date"
                        className="m-field"
                        value={draft?.startDate || ''}
                        onChange={e => setDraft(v => v ? ({
                          ...v,
                          startDate: e.target.value,
                          endDate: (v.endDate && v.endDate < e.target.value) ? e.target.value : v.endDate,
                          date: e.target.value
                        }) : v)}
                      />
                    </div>
                    <div className="col">
                      <label className="m-field__label">Fine</label>
                      <input
                        type="date"
                        className="m-field"
                        value={draft?.endDate || ''}
                        onChange={e => setDraft(v => v ? ({
                          ...v,
                          endDate: (e.target.value < (v.startDate || v.date)) ? (v.startDate || v.date) : e.target.value
                        }) : v)}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Tipo a chip con icone */}
              <div className="block">
                <label className="m-field__label">Tipo</label>
                <div className="chip-group">
                  {([
                    { val: 'FERIE', label: 'Ferie', icon: 'beach_access' },
                    { val: 'SMART_WORKING', label: 'Smart working', icon: 'home_work' },
                    { val: 'PERMESSO_ENTRATA', label: 'Permesso entrata', icon: 'login' },
                    { val: 'PERMESSO_USCITA', label: 'Permesso uscita', icon: 'logout' },
                    { val: 'MALATTIA', label: 'Malattia', icon: 'sick' },
                    { val: 'PERMESSO_STUDIO', label: 'Permesso studio', icon: 'school' },
                  ] as { val: UiType, label: string, icon: string }[]).map(opt => (
                    <button
                      key={opt.val}
                      type="button"
                      className={`chip ${draft?.type === opt.val ? 'chip--selected' : ''}`}
                      onClick={() => setDraft(v => v ? ({ ...v, type: opt.val }) : v)}
                    >
                      <span className="material-symbols-rounded">{opt.icon}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Note */}
              <div className="block">
                <label className="m-field__label">Note</label>
                <textarea
                  className="m-field textarea"
                  rows={3}
                  placeholder="Facoltative"
                  value={draft?.note || ''}
                  onChange={e => setDraft(v => v ? ({ ...v, note: e.target.value }) : v)}
                />
              </div>

              {/* Azioni */}
              <div className="panel__actions">
                <button className="m-btn m-btn--text" onClick={() => dlgRef.current?.close()}>Annulla</button>

                {draft?.mode === 'edit' ? (
                  <>
                    <button className="m-btn m-btn--danger" onClick={onDelete}>Elimina</button>
                    <button className="m-btn m-btn--filled" onClick={onUpdate}>Salva modifiche</button>
                  </>
                ) : (
                  <button className="m-btn m-btn--filled" onClick={onCreate}>Salva</button>
                )}
              </div>
            </div>
          </dialog>
        )}

        {/* SHEET riepilogo mobile */}
        {showSummarySheet && (
          <dialog className="modal" open onClose={() => setShowSummarySheet(false)}>
            <div className="panel m-elev-3" style={{ width: 'min(520px, 92vw)' }}>
              <div className="panel__header">
                <div className="panel__title">Riepilogo mese</div>
                <button className="panel__close" onClick={() => setShowSummarySheet(false)}>
                  <span className="material-symbols-rounded">close</span>
                </button>
              </div>
              <div className="summary-sheet">
                {renderSummary()}
              </div>
            </div>
          </dialog>
        )}
      </div>
    </>
  )
}
