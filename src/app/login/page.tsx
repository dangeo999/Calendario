'use client'
import { useState } from 'react'
import { supabase } from '@/app/lib/supabaseClient'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg('')
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) { setMsg(error.message); return }
      window.location.href = '/calendar'
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">

        {/* Logo */}
        <div className="login-icon-wrap">
          <span className="material-symbols-rounded">calendar_month</span>
        </div>

        <h1 className="login-title">Calendario Geoconsult</h1>
        <p className="login-subtitle">Inserisci le tue credenziali per accedere</p>

        <form onSubmit={onSubmit} className="login-form">
          <div className="login-field-wrap">
            <label className="m-field__label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="m-field"
              placeholder="nome@geoconsult.it"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="login-field-wrap">
            <label className="m-field__label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="m-field"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="m-btn m-btn--filled login-submit"
            disabled={loading}
          >
            {loading
              ? <><span className="material-symbols-rounded" style={{ fontSize: 20 }}>hourglass_top</span> Accesso in corso…</>
              : <><span className="material-symbols-rounded" style={{ fontSize: 20 }}>login</span> Accedi</>
            }
          </button>

          {msg && (
            <p className={`login-msg ${msg.startsWith('✅') ? 'login-msg--success' : 'login-msg--error'}`}>
              {msg}
            </p>
          )}
        </form>

      </div>
    </div>
  )
}
