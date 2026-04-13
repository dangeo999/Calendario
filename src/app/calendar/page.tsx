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

// helper
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

const uiTypeLabels: Record<UiType, string> = {
  FERIE:             'Ferie',
  SMART_WORKING:     'Smart working',
  PERMESSO_ENTRATA:  'Permesso entrata',
  PERMESSO_USCITA:   'Permesso uscita',
  MALATTIA:          'Malattia',
  PERMESSO_STUDIO:   'Permesso studio',
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

// ---------- COMPONENTE PRINCIPALE ----------
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

  const calRef = useRef<any>(null)
  const [showFiltersMobile, setShowFiltersMobile] = useState(false)
  const [showTableMobile, setShowTableMobile] = useState(false)
  const [showSummarySheet, setShowSummarySheet] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1)
  const [miniCalDate, setMiniCalDate] = useState<Date>(new Date())
  const [rangePhase, setRangePhase] = useState<'start' | 'end'>('start')


  useEffect(() => {
    if (typeof window === 'undefined') return

    const check = () => setIsMobile(window.innerWidth <= 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])


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
    setWizardStep(1)
    setRangePhase('start')
    setMiniCalDate(new Date())
    setOpen(true)
    setTimeout(() => dlgRef.current?.showModal(), 0)
  }

  // ---------- DATA LOAD ----------
  const load = async () => {
    const { data: evs } = await supabase.from('events').select('*')
    const { data: profs0 } = await supabase.from('profiles').select('id, full_name, is_admin, email')
    const { data: { user } } = await supabase.auth.getUser()

    setEvents(evs || [])
    setAuthUser(user || null)
    setCurrentUserId(user?.id ?? null)

    let profs = profs0 || []

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

        const { data: profs1 } = await supabase.from('profiles').select('id, full_name, is_admin, email')
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

  // ---------- FILTERED EVENTS ----------
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
    const endDay = info.endStr ? addDays(toDateInput(info.endStr), -1) : day
    setDraft({
      mode: 'create',
      date: day,
      startDate: day,
      endDate: endDay,
      time: '09:00',
      durationHours: 1,
      type: 'SMART_WORKING',
      note: '',
    })
    setWizardStep(1)
    setRangePhase('start')
    setMiniCalDate(new Date(day + 'T12:00:00'))
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
    setWizardStep(1)
    setRangePhase('start')
    setMiniCalDate(new Date(day + 'T12:00:00'))
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

    setWizardStep(3)
    setRangePhase('start')
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

  // Icon mapping per tipo evento
  const iconOfType: Record<DbType, string> = {
    FERIE:                       'beach_access',
    SMART_WORKING:               'home_work',
    PERMESSO_ENTRATA_ANTICIPATA: 'login',
    PERMESSO_USCITA_ANTICIPATA:  'logout',
    MALATTIA:                    'medical_services',
    PERMESSO_STUDIO:             'school',
  }

  // Wizard helpers
  const typeColors: Record<UiType, string> = {
    FERIE:             '#e53935',
    SMART_WORKING:     '#00897b',
    PERMESSO_ENTRATA:  '#1e88e5',
    PERMESSO_USCITA:   '#5e35b1',
    MALATTIA:          '#212121',
    PERMESSO_STUDIO:   '#f9a825',
  }
  const typeIconsUI: Record<UiType, string> = {
    FERIE:             'beach_access',
    SMART_WORKING:     'home_work',
    PERMESSO_ENTRATA:  'login',
    PERMESSO_USCITA:   'logout',
    MALATTIA:          'medical_services',
    PERMESSO_STUDIO:   'school',
  }
  const formatShortDate = (iso?: string) => {
    if (!iso) return '—'
    const [, m, d] = iso.split('-').map(Number)
    const months = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']
    return `${d} ${months[m - 1]}`
  }
  const countWorkdays = (start: string, end: string): number => {
    const [sy, sm, sd] = start.split('-').map(Number)
    const [ey, em, ed] = end.split('-').map(Number)
    let count = 0
    const cur = new Date(Date.UTC(sy, sm - 1, sd))
    const last = new Date(Date.UTC(ey, em - 1, ed))
    while (cur <= last) {
      const dow = cur.getUTCDay()
      const dateStr = cur.toISOString().slice(0, 10)
      const hols = italianHolidaysOf(cur.getUTCFullYear())
      if (dow !== 0 && dow !== 6 && !hols.get(dateStr)) count++
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    return count
  }
  type CalDay = { day: number | null; date: string; isToday: boolean; isWeekend: boolean }
  const getMiniCalDays = (year: number, month: number): CalDay[] => {
    const firstDow = (new Date(year, month, 1).getDay() + 6) % 7
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const todayStr = ymdLocal(new Date())
    const days: CalDay[] = []
    for (let i = 0; i < firstDow; i++) days.push({ day: null, date: '', isToday: false, isWeekend: false })
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d)
      const dow = date.getDay()
      days.push({ day: d, date: ymdLocal(date), isToday: ymdLocal(date) === todayStr, isWeekend: dow === 0 || dow === 6 })
    }
    return days
  }
  const renderNumBadge = (value: number | null | undefined, color: string) => {
    const n = Number(value || 0)
    if (!n) return <span style={{ color: '#94a3b8' }}>—</span>
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 26, height: 26, borderRadius: 999,
        background: color, color: color === '#212121' ? '#fff' : 'white',
        fontWeight: 700, fontSize: '.82rem', padding: '0 6px',
      }}>{n}</span>
    )
  }

  // Event rendering
  const renderEvent = (arg: EventContentArg) => {
    const typeDb = (arg.event.extendedProps as any).type as DbType
    const icon = iconOfType[typeDb] ?? 'event'
    return (
      <div className="m-event">
        <div className="m-event__title">
          <span className="material-symbols-rounded m-event__icon">{icon}</span>
          <span className="m-event__name">{arg.event.title}</span>
        </div>
      </div>
    )
  }

  // --- INVIO RIEPILOGO MENSILE ---
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
    if (!res.ok || !js.ok) throw new Error(js?.error || 'Invio fallito')
    alert(
      `Riepilogo ${String(m).padStart(2, '0')}/${y} inviato (${js.rows} righe) a: ${
        js.sent_to || js.recipients?.join(', ') || 'destinatario configurato'
      }`
    )
  } catch (err: any) {
    alert(`Errore invio: ${String(err?.message || err)}`)
  } finally {
    setSendingMail(false)
  }
}

  // --- RIEPILOGO (riuso desktop + sheet mobile) ---
  const renderSummary = () => (
    <div className="card m-elev-1 summary-card" style={{ marginTop: 0, marginBottom: 8 }}>
      <div className="panel__header" style={{ position: 'static' }}>
        <div className="summary-title">
          Riepilogo mese • {format(viewDate, 'MMMM yyyy', { locale: it })}
        </div>
      </div>

      {myBalance && (
        <div className="my-balances">
          <span>Saldi: <b className="mono">{myBalance.ferie.toFixed(2)}</b> gg ferie</span>
          <span>• <b className="mono">{myBalance.perm.toFixed(2)}</b> h permessi</span>
        </div>
      )}

      {monthSummary.length > 0 && (
        <div className="kpi-grid">
          <div className="kpi-card"><i className="dot dot--ferie" /><span className="label">Ferie tot.</span><span className="value mono">{totals.ferie}</span></div>
          <div className="kpi-card"><i className="dot dot--smart" /><span className="label">Smart tot.</span><span className="value mono">{totals.smart}</span></div>
          <div className="kpi-card"><i className="dot dot--malattia" /><span className="label">Malattia</span><span className="value mono">{totals.mal}</span></div>
          <div className="kpi-card"><i className="dot dot--entrata" /><span className="label">Permessi (h)</span><span className="value mono">{totals.permH}</span></div>
        </div>
      )}

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

      {monthSummary.length === 0 ? (
        <div className="m-field__label" style={{ padding: '8px 10px' }}>
          Nessun dato nel mese corrente.
        </div>
      ) : (
        <div className={`table-wrap ${showTableMobile ? 'is-open' : ''}`}>
          <table className="m-table">
            <thead>
              <tr>
                <th>Utente</th>
                <th><span className="th-dot" style={{ background:'var(--evt-ferie)' }} />Ferie (gg)</th>
                <th><span className="th-dot" style={{ background:'var(--evt-smart)' }} />Smart (gg)</th>
                <th><span className="th-dot" style={{ background:'var(--evt-malattia)' }} />Malattia (gg)</th>
                <th><span className="th-dot" style={{ background:'var(--evt-entrata)' }} />P. Entrata (h)</th>
                <th><span className="th-dot" style={{ background:'var(--evt-uscita)' }} />P. Uscita (h)</th>
                <th><span className="th-dot" style={{ background:'var(--evt-studio)' }} />P. Studio (h)</th>
              </tr>
            </thead>
            <tbody>
              {monthSummary.map(r => {
                const initials = initialsOf(r.name)
                return (
                  <tr key={r.user_id}>
                    <td>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <div style={{ width:28, height:28, borderRadius:8, background:'linear-gradient(135deg, var(--md-sys-color-primary) 0%, var(--md-sys-color-primary-600) 100%)', color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'.65rem', fontWeight:700, flexShrink:0 }}>
                          {initials}
                        </div>
                        <span>{r.name}</span>
                      </div>
                    </td>
                    <td>{renderNumBadge(r.ferie_days, 'var(--evt-ferie)')}</td>
                    <td>{renderNumBadge(r.smart_days, 'var(--evt-smart)')}</td>
                    <td>{renderNumBadge(r.malattia_days, '#555')}</td>
                    <td>{renderNumBadge(r.perm_entrata_count, 'var(--evt-entrata)')}</td>
                    <td>{renderNumBadge(r.perm_uscita_count, 'var(--evt-uscita)')}</td>
                    <td>{renderNumBadge(r.perm_studio_count, 'var(--evt-studio)')}</td>
                  </tr>
                )
              })}
            </tbody>
            {isBoss && monthSummary.length > 1 && (
              <tfoot>
                <tr>
                  <td style={{ fontWeight:700, color:'var(--md-sys-color-on-surface-variant)', fontSize:'.82rem' }}>Totali mese</td>
                  <td>{renderNumBadge(totals.ferie, 'var(--evt-ferie)')}</td>
                  <td>{renderNumBadge(totals.smart, 'var(--evt-smart)')}</td>
                  <td>{renderNumBadge(totals.mal, '#555')}</td>
                  <td colSpan={3}>{renderNumBadge(totals.permH, 'var(--evt-entrata)')}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* ===== MOBILE APPBAR ===== */}
      <div className="mobile-appbar">
        {/* HAMBURGER: apre il menu a scomparsa */}
        <button
          className="mobile-appbar__btn"
          onClick={() => setShowMobileMenu(v => !v)}
          aria-label="Menu"
        >
          <span className="material-symbols-rounded">menu</span>
        </button>

        {/* Mese + frecce + oggi (lasciati fuori) */}
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

          <button className="mobile-appbar__btn" onClick={gotoToday} aria-label="Oggi">
            <span className="material-symbols-rounded">calendar_today</span>
          </button>
          </div>
        </div>
      </div>

      {/* MENU A SCOMPARSA SOTTO L’APPBAR */}
      {showMobileMenu && (
        <div className="mobile-menu mobile-menu--open">
          <button
            className="mobile-menu__item"
            onClick={() => {
              setShowFiltersMobile(prev => !prev)
              setShowMobileMenu(false)             
            }}
          >
            <span className="material-symbols-rounded">filter_list</span>
            <span>Filtri</span>
          </button>

          <button
            className="mobile-menu__item"
            onClick={() => {
              setShowSummarySheet(v => !v)
              setShowMobileMenu(false)
            }}
          >
            <span className="material-symbols-rounded">insights</span>
            <span>Riepilogo mese</span>
          </button>

          <button
            className="mobile-menu__item"
            onClick={async () => {
              await handleSendMonthlyEmail()
              setShowMobileMenu(false)
            }}
            disabled={sendingMail}
          >
            <span className="material-symbols-rounded">
              {sendingMail ? 'hourglass_top' : 'task_alt'}
            </span>
            <span>{sendingMail ? 'Invio in corso…' : 'Invia riepilogo'}</span>
          </button>

          <button
            className="mobile-menu__item mobile-menu__item--logout"
            onClick={async () => {
              setShowMobileMenu(false)
              await supabase.auth.signOut()
              window.location.href = '/login'
            }}
          >
            <span className="material-symbols-rounded">logout</span>
            <span>Esci</span>
          </button>
        </div>
      )}


      {/* Sheet filtri mobile */}
      {showFiltersMobile && (
        <div className="sheet">
          <div className="sheet__row justify-between mr-5 ml-5">
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
          <div className="sheet__actions">
            <button className="m-btn m-btn--filled" onClick={() => setShowFiltersMobile(false)}>
              <span className="material-symbols-rounded">check</span> Applica
            </button>
          </div>
          </div>
        </div>
      )}

      <div className="container">
        {/* Top App Bar (desktop) */}
        <div className="appbar appbar--bar m-elev-2">

          {/* Brand */}
          <div className="appbar__brand">
            <span className="material-symbols-rounded appbar__logo">calendar_month</span>
            <span className="appbar__title">Calendario Geoconsult</span>
          </div>

          {/* Saldi */}
          {myBalance && (
            <div className="appbar__balances">
              <span className="legend__pill legend__pill--stat">
                <i className="dot dot--ferie" />
                <span className="mono">{myBalance.ferie.toFixed(1)}</span>&nbsp;gg
              </span>
              <span className="legend__pill legend__pill--stat">
                <i className="dot dot--entrata" />
                <span className="mono">{myBalance.perm.toFixed(1)}</span>&nbsp;h
              </span>
            </div>
          )}

          <div className="appbar__sep" />

          {/* Navigazione mese */}
          <div className="segmented">
            <button className="segmented__btn" onClick={gotoPrev}>
              <span className="material-symbols-rounded">chevron_left</span>
            </button>
            <div className="cal-month-label">{format(viewDate, 'MMMM yyyy', { locale: it })}</div>
            <button className="segmented__btn" onClick={gotoToday}>oggi</button>
            <button className="segmented__btn" onClick={gotoNext}>
              <span className="material-symbols-rounded">chevron_right</span>
            </button>
          </div>

          <div style={{ flex: 1 }} />

          {/* Filtri */}
          <select className="m-field appbar__select" value={filterUser} onChange={e => setFilterUser(e.target.value)}>
            <option value="ALL">Tutti gli utenti</option>
            {profiles.map((p: any) => (
              <option value={p.id} key={p.id}>{p.full_name || p.id.slice(0, 6)}</option>
            ))}
          </select>

          <select className="m-field appbar__select" value={filterType} onChange={e => setFilterType(e.target.value as 'ALL' | DbType)}>
            <option value="ALL">Tutti i tipi</option>
            {(['FERIE', 'SMART_WORKING', 'PERMESSO_ENTRATA_ANTICIPATA', 'PERMESSO_USCITA_ANTICIPATA', 'MALATTIA', 'PERMESSO_STUDIO'] as DbType[]).map(t => (
              <option key={t} value={t}>{labelOfType(t)}</option>
            ))}
          </select>

          {isBoss && (
            <button className="m-btn m-btn--tonal" onClick={handleSendMonthlyEmail} disabled={sendingMail} title="Invia riepilogo mensile">
              <span className="material-symbols-rounded">{sendingMail ? 'hourglass_top' : 'send'}</span>
            </button>
          )}

          <div className="appbar__sep" />

          {/* Utente */}
          {currentUserId && (
            <div className="user-chip">
              <div className="user-chip__ava">
                {initialsOf(profiles.find((p: any) => p.id === currentUserId)?.full_name
                  || authUser?.user_metadata?.full_name || authUser?.email)}
              </div>
              <span className="user-chip__name">
                {profiles.find((p: any) => p.id === currentUserId)?.full_name
                  || authUser?.user_metadata?.full_name
                  || authUser?.email
                  || 'Utente'}
              </span>
            </div>
          )}

          <button className="m-btn m-btn--tonal appbar__logout" title="Esci"
            onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login' }}
          >
            <span className="material-symbols-rounded">logout</span>
          </button>

        </div>

        <div className="card m-elev-1">
          {/* RIEPILOGO INLINE (desktop + mobile) */}
          {(!isMobile || showSummarySheet) && renderSummary()}

          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            height="auto"
            expandRows
            dayMaxEvents={isMobile ? 2 : 3}
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
            eventClassNames={(arg) => {
              const classes = [
                `evt-${((arg.event.extendedProps as any).type as DbType).toLowerCase()}`
              ]

              const start = arg.event.start
              if (start) {
                const evYM  = start.getFullYear() * 12 + start.getMonth()
                const curYM = viewDate.getFullYear() * 12 + viewDate.getMonth()
                const prevYM = curYM - 1
                const nextYM = curYM + 1

                if (evYM === prevYM) {
                  classes.push('evt--prev-month')
                } else if (evYM === nextYM) {
                  classes.push('evt--next-month')
                }
              }

              return classes
            }}
            events={eventsForCalendar}
            eventContent={renderEvent}
            datesSet={(arg) => setViewDate(arg.view.calendar.getDate())}
            dayCellClassNames={(arg) => {
              const classes: string[] = []
              if (arg.isOther) return classes
              const dow = arg.date.getDay()
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

          {/* LEGENDA */}
          <div className="calendar-legend">
            <div className="calendar-legend__title">Legenda</div>
            <div className="calendar-legend__grid">
              <span className="leg-pill leg-pill--ferie">
                <span className="material-symbols-rounded leg-icon">beach_access</span>
                Ferie
              </span>
              <span className="leg-pill leg-pill--smart">
                <span className="material-symbols-rounded leg-icon">home_work</span>
                Smart working
              </span>
              <span className="leg-pill leg-pill--entrata">
                <span className="material-symbols-rounded leg-icon">login</span>
                Permesso entrata
              </span>
              <span className="leg-pill leg-pill--uscita">
                <span className="material-symbols-rounded leg-icon">logout</span>
                Permesso uscita
              </span>
              <span className="leg-pill leg-pill--malattia">
                <span className="material-symbols-rounded leg-icon">medical_services</span>
                Malattia
              </span>
              <span className="leg-pill leg-pill--studio">
                <span className="material-symbols-rounded leg-icon">school</span>
                Permesso studio
              </span>
            </div>
          </div>
        </div>

        {/* MODAL – 3-Step Wizard */}
        {open && (
          <dialog ref={dlgRef} className="modal" onClose={() => { setOpen(false); setDraft(null) }}>
            <div className="panel wizard-panel m-elev-3">

              {/* Drag handle */}
              <div style={{ display:'flex', justifyContent:'center', padding:'12px 0 6px' }}>
                <div style={{ width:36, height:4, background:'#e2e8f0', borderRadius:2 }} />
              </div>

              {/* Step indicator + close */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 16px 6px' }}>
                <div style={{ display:'flex', alignItems:'center' }}>
                  {([1,2,3] as const).map((s, i) => (
                    <React.Fragment key={s}>
                      {i > 0 && (
                        <div style={{ width:36, height:2, margin:'0 6px', background: wizardStep > i ? '#86efac' : '#e2e8f0', transition:'background .3s' }} />
                      )}
                      <div style={{
                        width: wizardStep === s ? 28 : 10, height:10,
                        borderRadius: wizardStep === s ? 5 : '50%',
                        background: wizardStep > s ? '#86efac' : wizardStep === s ? 'var(--md-sys-color-primary)' : '#e2e8f0',
                        transition:'all .3s',
                      }} />
                    </React.Fragment>
                  ))}
                </div>
                <button className="panel__close" onClick={() => dlgRef.current?.close()} aria-label="Chiudi">
                  <span className="material-symbols-rounded">close</span>
                </button>
              </div>

              {/* Step title */}
              <div style={{ fontFamily:'var(--md-sys-font-heading)', fontSize:16, fontWeight:700, padding:'4px 20px 2px', color:'var(--md-sys-color-on-surface)' }}>
                {wizardStep === 1 ? 'Tipo di assenza' : wizardStep === 2 ? 'Periodo' : 'Conferma evento'}
              </div>

              {/* ─── Step content ─── */}
              <div style={{ padding:'10px 16px 20px' }}>

                {/* ── STEP 1: Tipo ── */}
                {wizardStep === 1 && (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                    {(['FERIE','SMART_WORKING','PERMESSO_ENTRATA','PERMESSO_USCITA','MALATTIA','PERMESSO_STUDIO'] as UiType[]).map(t => {
                      const col = typeColors[t]
                      const sel = draft?.type === t
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            setDraft(v => v ? { ...v, type: t } : v)
                            setRangePhase('start')
                            setWizardStep(2)
                          }}
                          style={{
                            display:'flex', alignItems:'center', gap:10,
                            padding:'12px 14px', borderRadius:14, cursor:'pointer',
                            border:`2px solid ${sel ? col : 'var(--md-sys-color-outline)'}`,
                            background: sel ? col : 'white', transition:'all .2s', textAlign:'left',
                          }}
                        >
                          <div style={{ width:34, height:34, borderRadius:10, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', background: sel ? 'rgba(255,255,255,.25)' : col }}>
                            <span className="material-symbols-rounded" style={{ fontSize:18, color:'white', fontVariationSettings:"'FILL' 1" }}>{typeIconsUI[t]}</span>
                          </div>
                          <span style={{ fontFamily:'var(--md-sys-font-heading)', fontSize:12, fontWeight:600, lineHeight:1.2, color: sel ? 'white' : 'var(--md-sys-color-on-surface)' }}>
                            {uiTypeLabels[t]}
                          </span>
                        </button>
                      )
                    })}
                    <div style={{ gridColumn:'1 / -1', textAlign:'center', paddingTop:6 }}>
                      <span style={{ fontSize:11, color:'var(--md-sys-color-on-surface-variant)' }}>Seleziona un tipo per procedere</span>
                    </div>
                  </div>
                )}

                {/* ── STEP 2: Date ── */}
                {wizardStep === 2 && draft && (
                  <>
                    {/* Back */}
                    <button type="button" onClick={() => setWizardStep(1)}
                      style={{ display:'flex', alignItems:'center', gap:4, background:'transparent', border:'none', cursor:'pointer', color:'var(--md-sys-color-on-surface-variant)', fontSize:12, fontWeight:500, padding:'0 0 10px', fontFamily:'inherit' }}
                    >
                      <span className="material-symbols-rounded" style={{ fontSize:15 }}>arrow_back</span>
                      Cambia tipo
                    </button>

                    {/* Badge tipo */}
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'5px 12px 5px 8px', borderRadius:20, background:typeColors[draft.type], fontFamily:'var(--md-sys-font-heading)', fontSize:12, fontWeight:600, color:'white' }}>
                        <span className="material-symbols-rounded" style={{ fontSize:15, fontVariationSettings:"'FILL' 1" }}>{typeIconsUI[draft.type]}</span>
                        {uiTypeLabels[draft.type]}
                      </span>
                      <span style={{ fontSize:11, color:'var(--md-sys-color-on-surface-variant)' }}>selezionato</span>
                    </div>

                    {isPermesso(draft.type) ? (
                      /* Permesso: inputs */
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
                        <div className="col">
                          <label className="m-field__label">Giorno</label>
                          <input type="date" className="m-field" value={draft.date || ''}
                            onChange={e => setDraft(v => v ? { ...v, date: e.target.value } : v)} />
                        </div>
                        <div className="col">
                          <label className="m-field__label">{draft.type === 'PERMESSO_ENTRATA' ? 'Ora entrata' : 'Ora uscita'}</label>
                          <input type="time" className="m-field" value={draft.time || ''}
                            onChange={e => setDraft(v => v ? { ...v, time: e.target.value } : v)} />
                        </div>
                        <div className="col" style={{ gridColumn:'1 / -1' }}>
                          <label className="m-field__label">Durata (ore)</label>
                          <input type="number" min={1} step={1} className="m-field" value={draft.durationHours ?? 1}
                            onChange={e => setDraft(v => v ? { ...v, durationHours: Number(e.target.value || 1) } : v)} />
                        </div>
                      </div>
                    ) : (
                      /* Mini calendar */
                      <>
                        <div style={{ background:'#F8FAFC', borderRadius:14, padding:12, marginBottom:14 }}>
                          {/* Header */}
                          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                            <span style={{ fontFamily:'var(--md-sys-font-heading)', fontSize:13, fontWeight:700, color:'var(--md-sys-color-on-surface)', textTransform:'capitalize' }}>
                              {format(miniCalDate, 'MMMM yyyy', { locale: it })}
                            </span>
                            <div style={{ display:'flex', gap:2 }}>
                              {([-1, 1] as const).map(dir => (
                                <button key={dir} type="button"
                                  style={{ width:28, height:28, borderRadius:8, border:'none', background:'white', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--md-sys-color-on-surface-variant)', boxShadow:'0 1px 4px rgba(0,0,0,.08)' }}
                                  onClick={() => setMiniCalDate(d => { const nd = new Date(d); nd.setMonth(nd.getMonth() + dir); return nd })}
                                >
                                  <span className="material-symbols-rounded" style={{ fontSize:16 }}>{dir === -1 ? 'chevron_left' : 'chevron_right'}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                          {/* Grid */}
                          <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:2 }}>
                            {['L','M','M','G','V','S','D'].map((l, i) => (
                              <div key={i} style={{ fontSize:9, fontWeight:700, color:'var(--md-sys-color-on-surface-variant)', textAlign:'center', padding:'3px 0', fontFamily:'var(--md-sys-font-heading)' }}>{l}</div>
                            ))}
                            {getMiniCalDays(miniCalDate.getFullYear(), miniCalDate.getMonth()).map((day, i) => {
                              if (!day.day) return <div key={i} />
                              const isStart = day.date === draft.startDate
                              const isEnd = day.date === draft.endDate
                              const isInRange = !!(draft.startDate && draft.endDate && draft.startDate !== draft.endDate && day.date > draft.startDate && day.date < draft.endDate)
                              const selected = isStart || isEnd
                              return (
                                <div key={i}
                                  onClick={() => {
                                    if (rangePhase === 'start') {
                                      setDraft(v => v ? { ...v, startDate: day.date, endDate: day.date, date: day.date } : v)
                                      setRangePhase('end')
                                    } else {
                                      if (day.date >= (draft.startDate || draft.date)) {
                                        setDraft(v => v ? { ...v, endDate: day.date } : v)
                                        setRangePhase('start')
                                      } else {
                                        setDraft(v => v ? { ...v, startDate: day.date, endDate: day.date, date: day.date } : v)
                                      }
                                    }
                                  }}
                                  style={{
                                    fontSize:11, textAlign:'center', width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center',
                                    margin:'0 auto', cursor:'pointer',
                                    borderRadius: isInRange ? 0 : '50%',
                                    background: selected ? 'var(--md-sys-color-primary)' : isInRange ? '#DBEAFE' : 'transparent',
                                    color: selected ? 'white' : isInRange ? 'var(--md-sys-color-primary)' : day.isWeekend ? '#94a3b8' : day.isToday ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-on-surface)',
                                    fontWeight: selected || day.isToday ? 700 : 500,
                                  }}
                                >{day.day}</div>
                              )
                            })}
                          </div>
                        </div>

                        {/* Date chips */}
                        <div style={{ display:'grid', gridTemplateColumns:'1fr auto 1fr', alignItems:'center', gap:8, marginBottom:12 }}>
                          <div style={{ background:'white', border:`2px solid ${rangePhase === 'start' ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline)'}`, borderRadius:10, padding:'8px 12px', textAlign:'center', fontFamily:'var(--md-sys-font-heading)', fontSize:12, fontWeight:600, color:'var(--md-sys-color-on-surface)' }}>
                            <small style={{ display:'block', fontSize:9, color:'var(--md-sys-color-on-surface-variant)', fontWeight:500, marginBottom:2 }}>DAL</small>
                            {formatShortDate(draft.startDate)}
                          </div>
                          <span className="material-symbols-rounded" style={{ fontSize:18, color:'var(--md-sys-color-on-surface-variant)' }}>arrow_forward</span>
                          <div style={{ background:'white', border:`2px solid ${rangePhase === 'end' ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline)'}`, borderRadius:10, padding:'8px 12px', textAlign:'center', fontFamily:'var(--md-sys-font-heading)', fontSize:12, fontWeight:600, color:'var(--md-sys-color-on-surface)' }}>
                            <small style={{ display:'block', fontSize:9, color:'var(--md-sys-color-on-surface-variant)', fontWeight:500, marginBottom:2 }}>AL</small>
                            {formatShortDate(draft.endDate)}
                          </div>
                        </div>

                        {/* Workdays badge */}
                        {draft.startDate && draft.endDate && (
                          <div style={{ display:'flex', justifyContent:'center', marginBottom:14 }}>
                            <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 14px', borderRadius:20, background:'#fed7aa', color:'#9a3412', fontFamily:'var(--md-sys-font-heading)', fontSize:12, fontWeight:700 }}>
                              <span className="material-symbols-rounded" style={{ fontSize:14, fontVariationSettings:"'FILL' 1" }}>work_history</span>
                              {countWorkdays(draft.startDate, draft.endDate)} gg lavorativi
                            </span>
                          </div>
                        )}
                      </>
                    )}

                    <button type="button"
                      style={{ width:'100%', padding:13, borderRadius:14, border:'none', background:'var(--md-sys-color-primary)', color:'white', fontFamily:'var(--md-sys-font-heading)', fontSize:14, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}
                      onClick={() => setWizardStep(3)}
                    >
                      Avanti
                      <span className="material-symbols-rounded" style={{ fontSize:18 }}>arrow_forward</span>
                    </button>
                  </>
                )}

                {/* ── STEP 3: Riepilogo ── */}
                {wizardStep === 3 && draft && (
                  <>
                    {/* Summary card */}
                    <div style={{ borderRadius:16, overflow:'hidden', border:`2px solid ${typeColors[draft.type]}44`, marginBottom:16 }}>
                      {/* Header */}
                      <div style={{ padding:'14px 16px', display:'flex', alignItems:'center', gap:12, background:`linear-gradient(135deg, ${typeColors[draft.type]}ee, ${typeColors[draft.type]}bb)` }}>
                        <div style={{ width:44, height:44, borderRadius:12, background:'rgba(255,255,255,.2)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                          <span className="material-symbols-rounded" style={{ fontSize:22, color:'white', fontVariationSettings:"'FILL' 1" }}>{typeIconsUI[draft.type]}</span>
                        </div>
                        <div>
                          <div style={{ fontFamily:'var(--md-sys-font-heading)', fontSize:14, fontWeight:700, color:'white' }}>{uiTypeLabels[draft.type]}</div>
                          <div style={{ fontSize:11, color:'rgba(255,255,255,.8)' }}>
                            {profiles.find((p: any) => p.id === currentUserId)?.full_name || authUser?.user_metadata?.full_name || 'Tu'}
                          </div>
                        </div>
                        <div style={{ marginLeft:'auto', background:'rgba(255,255,255,.2)', borderRadius:10, padding:'4px 10px', fontFamily:'var(--md-sys-font-heading)', fontSize:11, fontWeight:700, color:'white' }}>
                          {draft.mode === 'create' ? 'In attesa' : 'Modifica'}
                        </div>
                      </div>

                      {/* Rows */}
                      <div style={{ background:'#F8FAFC' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 16px', borderTop:'1px solid #f1f5f9' }}>
                          <span className="material-symbols-rounded" style={{ fontSize:18, color:typeColors[draft.type], fontVariationSettings:"'FILL' 1", flexShrink:0 }}>calendar_today</span>
                          <div style={{ fontSize:12, color:'var(--md-sys-color-on-surface)', fontWeight:500 }}>
                            {isPermesso(draft.type)
                              ? `${formatShortDate(draft.date)} • ${draft.time}`
                              : `${formatShortDate(draft.startDate)} → ${formatShortDate(draft.endDate)}`}
                          </div>
                        </div>
                        {!isPermesso(draft.type) && draft.startDate && draft.endDate && (
                          <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 16px', borderTop:'1px solid #f1f5f9' }}>
                            <span className="material-symbols-rounded" style={{ fontSize:18, color:'#f97316', fontVariationSettings:"'FILL' 1", flexShrink:0 }}>work_history</span>
                            <div style={{ fontSize:12, color:'var(--md-sys-color-on-surface)', fontWeight:500 }}>
                              {countWorkdays(draft.startDate, draft.endDate)} giorni lavorativi
                            </div>
                          </div>
                        )}
                        {isPermesso(draft.type) && (
                          <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 16px', borderTop:'1px solid #f1f5f9' }}>
                            <span className="material-symbols-rounded" style={{ fontSize:18, color:'var(--md-sys-color-on-surface-variant)', flexShrink:0 }}>schedule</span>
                            <div style={{ fontSize:12, color:'var(--md-sys-color-on-surface)', fontWeight:500 }}>{draft.durationHours} ore</div>
                          </div>
                        )}
                        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 16px', borderTop:'1px solid #f1f5f9' }}>
                          <span className="material-symbols-rounded" style={{ fontSize:18, color:'var(--md-sys-color-on-surface-variant)', flexShrink:0 }}>edit_note</span>
                          <input
                            style={{ flex:1, border:'none', background:'transparent', fontFamily:'inherit', fontSize:12, color:'var(--md-sys-color-on-surface-variant)', outline:'none' }}
                            placeholder="Aggiungi una nota... (opzionale)"
                            value={draft.note || ''}
                            onChange={e => setDraft(v => v ? { ...v, note: e.target.value } : v)}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                      <button type="button"
                        style={{ flex:2, padding:13, borderRadius:14, border:'none', background:'#00897b', color:'white', fontFamily:'var(--md-sys-font-heading)', fontSize:13, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}
                        onClick={draft.mode === 'edit' ? onUpdate : onCreate}
                      >
                        <span className="material-symbols-rounded" style={{ fontSize:18, fontVariationSettings:"'FILL' 1" }}>check_circle</span>
                        {draft.mode === 'edit' ? 'Aggiorna' : 'Conferma'}
                      </button>
                      <button type="button"
                        style={{ flex:1, padding:13, borderRadius:14, border:'2px solid #e2e8f0', background:'transparent', color:'var(--md-sys-color-on-surface-variant)', fontFamily:'var(--md-sys-font-heading)', fontSize:13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}
                        onClick={() => setWizardStep(1)}
                      >
                        <span className="material-symbols-rounded" style={{ fontSize:16 }}>edit</span>
                        Modifica
                      </button>
                    </div>
                    {draft.mode === 'edit' && (
                      <button type="button"
                        style={{ width:'100%', padding:10, borderRadius:14, border:'1.5px solid #fecaca', background:'#fff5f5', color:'#ef4444', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}
                        onClick={onDelete}
                      >
                        <span className="material-symbols-rounded" style={{ fontSize:16 }}>delete</span>
                        Elimina evento
                      </button>
                    )}
                  </>
                )}

              </div>
            </div>
          </dialog>
        )}
      </div>

      {/* FAB – solo mobile – crea evento veloce */}
      <button className="fab" onClick={openCreateQuick} aria-label="Nuovo evento">
        <span className="material-symbols-rounded">add</span>
        <span>Nuovo</span>
      </button>
    </>
  )
}
