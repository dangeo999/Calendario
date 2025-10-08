'use client'
import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'


export function useProfile(){
const [profile,setProfile] = useState<any>(null)
useEffect(()=>{
supabase.auth.getUser().then(async ({ data })=>{
const user = data.user
if(!user) return
const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
setProfile(p)
})
},[])
return profile
}


export function useIsManager(){
const p = useProfile()
return p?.role === 'MANAGER'
}