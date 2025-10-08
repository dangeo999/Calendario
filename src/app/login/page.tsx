'use client'
import { useState } from 'react'
import { supabase } from '@/app/lib/supabaseClient'

export default function LoginPage(){
  const [email,setEmail] = useState('')
  const [password,setPassword] = useState('')
  const [name,setName] = useState('')
  const [isSignup,setIsSignup] = useState(false)
  const [msg,setMsg] = useState('')

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg('')
    if (isSignup) {
      const { data, error } = await supabase.auth.signUp({
        email, password, options: { data: { full_name: name } }
      })
      if (error) return setMsg(error.message)
      const user = data.user
      if (user) {
        await supabase.from('profiles').upsert({ id: user.id, full_name: name, role: 'EMPLOYEE' })
      }
      setMsg('Registrazione riuscita. Ora effettua il login.')
      setIsSignup(false)
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return setMsg(error.message)
      window.location.href = '/calendar'
    }
  }

  return (
    <form onSubmit={onSubmit} style={{display:'grid', gap:8, maxWidth:360}}>
      <h1>{isSignup ? 'Registrati' : 'Accedi'}</h1>
      {isSignup && (
        <input placeholder="Nome" value={name} onChange={e=>setName(e.target.value)} required />
      )}
      <input placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
      <input placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required />
      <button type="submit">{isSignup ? 'Crea account' : 'Entra'}</button>
      <button type="button" onClick={()=>setIsSignup(v=>!v)}>
        {isSignup ? 'Hai già un account? Accedi' : 'Non hai un account? Registrati'}
      </button>
      {msg && <p>{msg}</p>}
    </form>
  )
}
