import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { UserRoundPlus, Trash2, ShieldCheck, Mail, RefreshCw } from 'lucide-react'
import { db } from './supabase'

export default function AdminUsers() {
  const [emails,setEmails] = useState<string[]>([])
  const [email,setEmail] = useState('')
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const [loaded,setLoaded] = useState(false)

  const change = useCallback(async (action: 'list'|'add'|'remove', address?: string) => {
    if (!db) throw new Error('Supabase не підключено')
    const {data,error:err} = await db.rpc('manage_quiz_admins',{p_action:action,p_email:address||null})
    if (err) throw err
    setEmails(Array.isArray(data?.emails) ? data.emails : [])
  },[])

  useEffect(() => {
    void change('list').catch(e=>setError((e as Error).message)).finally(()=>setLoaded(true))
  },[change])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true);setError('');setNotice('')
    try {
      await change('add',email.trim())
      setEmail('')
      setNotice('Адресу додано. Тепер колега може увійти через свій email.')
    } catch(e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  async function remove(address:string) {
    if (!window.confirm('Відкликати адміністративний доступ для '+address+'?')) return
    setBusy(true);setError('');setNotice('')
    try {
      await change('remove',address)
      setNotice('Адміністративний доступ відкликано.')
    } catch(e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  return <section className="admin-card admin-users">
    <div className="admin-users-heading"><div><h2><ShieldCheck size={25} className="ui-icon"/> Адміністратори</h2><p>Тільки адреси з цього списку можуть редагувати запитання, покарання та налаштування гри.</p></div><button className="admin-button icon-button" disabled={busy} onClick={()=>void change('list').catch(e=>setError((e as Error).message))}><RefreshCw size={16}/> Оновити</button></div>
    {error&&<div className="admin-alert" role="alert">{error}</div>}
    {notice&&<div className="admin-notice" role="status">{notice}</div>}
    <form className="admin-users-form" onSubmit={e=>void submit(e)}>
      <label htmlFor="admin-new-email">Email нового адміністратора</label>
      <div className="admin-users-field"><div className="admin-users-input"><Mail size={18}/><input id="admin-new-email" type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="colleague@example.com"/></div><button type="submit" className="admin-button accent icon-button" disabled={busy||!email.trim()}><UserRoundPlus size={17}/> Додати доступ</button></div>
    </form>
    <div className="admin-users-list">
      <h3>Дозволені адреси ({emails.length})</h3>
      {!loaded&&<p>Завантаження…</p>}
      {emails.map(address=><div key={address} className="admin-users-row"><div className="admin-users-identity"><ShieldCheck size={18}/><span>{address}</span></div><button className="admin-button danger icon-button" disabled={busy} onClick={()=>void remove(address)}><Trash2 size={15}/> Відкликати</button></div>)}
    </div>
    <p className="admin-users-hint">Додавання email не надсилає лист автоматично. Колега відкриває /admin, вводить адресу й отримує посилання для входу. Доступ почне діяти після підтвердження пошти.</p>
  </section>
}
