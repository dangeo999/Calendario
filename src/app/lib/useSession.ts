'use client'
import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'


export function useSession(){
const [session,setSession] = useState<any>(null)
useEffect(()=>{
supabase.auth.getSession().then(({ data }) => setSession(data.session))
const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
return () => sub.subscription.unsubscribe()
},[])
return session
}