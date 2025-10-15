'use client'
import { useState } from 'react'
import { supabase } from '@/app/lib/supabaseClient'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [isSignup, setIsSignup] = useState(false)
  const [msg, setMsg] = useState('')

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg('')

    if (isSignup) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      })
      if (error) return setMsg(error.message)
      const user = data.user
      if (user) {
        await supabase
          .from('profiles')
          .upsert({ id: user.id, full_name: name, role: 'EMPLOYEE' })
      }
      setMsg('✅ Registrazione riuscita! Ora effettua il login.')
      setIsSignup(false)
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) return setMsg(error.message)
      window.location.href = '/calendar'
    }
  }

  return ( 
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100">
      <form
        onSubmit={onSubmit}
        className="bg-white shadow-lg rounded-2xl px-8 py-10 w-full max-w-sm flex flex-col gap-4 border border-gray-200"
      >
        <h1 className="text-2xl font-bold text-gray-800 text-center mb-2">
          {isSignup ? 'Crea un account' : 'Accedi'}
        </h1>

        {isSignup && (
          <div className="flex flex-col text-left">
            <label className="text-sm font-medium text-gray-600 mb-1">Nome completo</label>
            <input
              type="text"
              placeholder="Mario Rossi"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        )}

        <div className="flex flex-col text-left">
          <label className="text-sm font-medium text-gray-600 mb-1">Email</label>
          <input
            type="email"
            placeholder="esempio@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="flex flex-col text-left">
          <label className="text-sm font-medium text-gray-600 mb-1">Password</label>
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <button
          type="submit"
          className="cursor-pointer w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg py-2 transition-colors"
        >
          {isSignup ? 'Crea account' : 'Accedi'}
        </button>

        <button
          type="button"
          onClick={() => setIsSignup((v) => !v)}
          className="cursor-pointer w-full text-blue-600 hover:text-blue-800 text-sm font-medium transition-colors"
        >
          {isSignup ? 'Hai già un account? Accedi' : 'Non hai un account? Registrati'}
        </button>

        {msg && (
          <p
            className={`mt-2 text-sm text-center ${
              msg.startsWith('✅') ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {msg}
          </p>
        )}
      </form>
    </div>
  )
}

