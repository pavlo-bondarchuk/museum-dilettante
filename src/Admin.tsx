import { X, Plus, Pencil, Ban, LogOut, BookOpen, ListChecks, Upload, Download, Save, UsersRound, KeyRound, Mail, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Link } from 'react-router-dom'
import { db } from './supabase'
import Punishments from './Punishments'
import AdminUsers from './AdminUsers'
import './admin.css'

type Deck = { id: number; name: string; slug: string; description: string }
type Question = { id: number; question: string; answer: number; unit: string; deck_id: number; explanation: string; difficulty: string; active: boolean }
type Editor = Omit<Question, 'id'> & { id?: number }

function csvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] || ''
  const delimiter = [';', ',', '\t'].sort((a,b) => firstLine.split(b).length - firstLine.split(a).length)[0]
  const input = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (char === '"') {
      if (quoted && input[i+1] === '"') { value += '"'; i++ }
      else quoted = !quoted
    } else if (char === delimiter && !quoted) {
      row.push(value.trim()); value = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i+1] === '\n') i++
      row.push(value.trim())
      if (row.some(x => x)) rows.push(row)
      row = []; value = ''
    } else value += char
  }
  if (quoted) throw new Error('Незакриті лапки у CSV.')
  row.push(value.trim())
  if (row.some(x => x)) rows.push(row)
  return rows
}

const blank = (deck: number): Editor => ({
  question:'', answer:0, unit:'', deck_id:deck, explanation:'', difficulty:'medium', active:true
})

export default function Admin() {
  const [session, setSession] = useState<Session|null>(null)
  const [tab,setTab] = useState<'questions'|'punishments'|'admins'>('questions')
  const [ready, setReady] = useState(false)
  const [allowed, setAllowed] = useState(false)
  const [email, setEmail] = useState('')
  const [loginMethod,setLoginMethod] = useState<'password'|'email'>('password')
  const [password,setPassword] = useState('')
  const [newPassword,setNewPassword] = useState('')
  const [confirmPassword,setConfirmPassword] = useState('')
  const [passwordOpen,setPasswordOpen] = useState(false)
  const [emailLimited,setEmailLimited] = useState(false)
  const [sent, setSent] = useState(false)
  const [token, setToken] = useState('')
  const [decks, setDecks] = useState<Deck[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [selected, setSelected] = useState(0)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Editor|null>(null)
  const [newDeck, setNewDeck] = useState(false)
  const [deckName, setDeckName] = useState('')
  const [deckDescription, setDeckDescription] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!db) { setError('Немає підключення до Supabase.'); setReady(true); return }
    db.auth.getSession().then(({data}) => { setSession(data.session); setReady(true) })
    const { data: subscription } = db.auth.onAuthStateChange((_event, next) => { setSession(next) })
    return () => subscription.subscription.unsubscribe()
  }, [])

  const load = useCallback(async () => {
    if (!db) return
    const [ds, qs] = await Promise.all([
      db.from('quiz_decks').select('id,name,slug,description').order('id'),
      db.from('quiz_questions').select('id,question,answer,unit,deck_id,explanation,difficulty,active').order('id', { ascending:false })
    ])
    if (ds.error) throw ds.error
    if (qs.error) throw qs.error
    setDecks(ds.data || [])
    setQuestions(qs.data || [])
    setSelected(current => current || ds.data?.[0]?.id || 0)
  }, [])

  useEffect(() => {
    const client = db
    if (!session || !client) { setAllowed(false); return }
    let cancelled = false
    const connect = async () => {
      try {
        const { data, error: err } = await client.rpc('is_quiz_admin')
        if (err) throw err
        if (cancelled) return
        setAllowed(!!data)
        if (data) await load()
      } catch(e) { if (!cancelled) setError((e as Error).message) }
    }
    void connect()
    return () => { cancelled = true }
  }, [session?.user.id, load])

  const displayed = useMemo(() => questions.filter(q => q.deck_id === selected && (q.question.toLowerCase().includes(search.toLowerCase()) || String(q.answer).includes(search))), [questions,selected,search])
  const deck = decks.find(d => d.id === selected)
  const active = questions.filter(q => q.deck_id === selected && q.active).length

  async function sendLink() {
    if (!db || !email.trim()) return
    setWorking(true); setError(''); setNotice('')
    try {
      const { error: err } = await db.auth.signInWithOtp({ email:email.trim(), options: { emailRedirectTo: window.location.origin + '/admin', shouldCreateUser:false } })
      if (err) throw err
      setSent(true)
      setNotice('Лист надіслано. Відкрийте посилання з пошти на цьому пристрої або введіть код, якщо він є в листі.')
    } catch(e) {
      const err=e as {message?:string;status?:number;code?:string}
      if (err.status===429 || err.code==='over_email_send_rate_limit' || err.message?.toLowerCase().includes('email rate limit')) {
        setEmailLimited(true)
        setError('Ліміт листів Supabase на цю годину вичерпано. Якщо пароль уже встановлено — увійдіть із ним. Інакше потрібно дочекатися відновлення ліміту, а після входу встановити пароль.')
      } else setError(err.message||'Не вдалося надіслати лист.')
    }
    finally { setWorking(false) }
  }

  async function signInPassword() {
    if (!db || !email.trim() || !password) return
    setWorking(true);setError('');setNotice('')
    try {
      const {error:err}=await db.auth.signInWithPassword({email:email.trim(),password})
      if(err) throw err
      setPassword('')
    } catch(e) {
      const err=e as {message?:string}
      setError(err.message==='Invalid login credentials'?'Неправильний email або пароль. Якщо пароль ще не створювали, оберіть «Вхід через пошту».':err.message||'Не вдалося увійти.')
    } finally {setWorking(false)}
  }

  async function setAdminPassword() {
    if(!db) return
    if(newPassword.length<12){setError('Пароль має містити щонайменше 12 символів.');return}
    if(newPassword!==confirmPassword){setError('Паролі не збігаються.');return}
    setWorking(true);setError('');setNotice('')
    try {
      const {error:err}=await db.auth.updateUser({password:newPassword})
      if(err)throw err
      setNewPassword('');setConfirmPassword('');setPasswordOpen(false)
      setNotice('Пароль встановлено. Наступного разу можна входити без листа.')
    }catch(e){setError((e as Error).message)}
    finally {setWorking(false)}
  }

  async function verifyCode() {
    if (!db) return
    setWorking(true); setError('')
    try {
      const { error: err } = await db.auth.verifyOtp({ email: email.trim(), token: token.trim(), type:'email' })
      if (err) throw err
      setNotice('Вхід підтверджено.')
    } catch(e) { setError((e as Error).message) }
    finally { setWorking(false) }
  }

  async function saveQuestion() {
    if (!db || !editing) return
    const question = editing.question.trim()
    if (!question || !Number.isFinite(Number(editing.answer))) { setError('Заповніть запитання та правильну числову відповідь.'); return }
    setWorking(true); setError(''); setNotice('')
    try {
      const payload = { question, answer:Number(editing.answer), unit:editing.unit.trim(), explanation:editing.explanation.trim(), difficulty:editing.difficulty, active:editing.active, deck_id:editing.deck_id }
      const result = editing.id ? await db.from('quiz_questions').update(payload).eq('id',editing.id).select('id').single() : await db.from('quiz_questions').insert(payload).select('id').single()
      if (result.error) throw result.error
      await load()
      setEditing(null)
      setNotice('Запитання збережено.')
    } catch(e) { setError((e as Error).message) }
    finally { setWorking(false) }
  }

  async function removeQuestion(q: Question) {
    if (!db) return
    setWorking(true); setError('')
    try {
      const {error:err} = await db.from('quiz_questions').update({active:!q.active}).eq('id',q.id)
      if (err) throw err
      await load()
      setNotice(q.active ? 'Запитання вимкнено для нових ігор.' : 'Запитання знову активне.')
    } catch(e) { setError((e as Error).message) }
    finally { setWorking(false) }
  }

  async function saveDeck() {
    if (!db || !deckName.trim()) return
    setWorking(true); setError('')
    try {
      const slug = 'deck-' + crypto.randomUUID().slice(0,8)
      const {data, error:err} = await db.from('quiz_decks').insert({name:deckName.trim(),description:deckDescription.trim(),slug}).select('id').single()
      if (err) throw err
      await load(); setSelected(data.id); setNewDeck(false); setDeckName(''); setDeckDescription('')
      setNotice('Колоду створено.')
    } catch(e) { setError((e as Error).message) }
    finally { setWorking(false) }
  }

  async function importCsv(file: File) {
    if (!db || !selected) return
    setWorking(true); setError(''); setNotice('')
    try {
      const data = csvRows(await file.text())
      if (data.length < 2) throw new Error('CSV має містити заголовки та принаймні одне запитання.')
      const headers = data.shift()!.map(v=>v.toLowerCase().trim())
      const find = (name: string) => headers.indexOf(name)
      if (find('question') < 0 || find('answer') < 0) throw new Error('Потрібні колонки question та answer.')
      const payload = data.map((row,i) => {
        const pick = (column: string) => { const index=find(column); return index<0 ? '' : row[index] || '' }
        const q=pick('question').trim()
        const answer = Number(pick('answer').replace(',','.'))
        if (!q || !pick('answer') || !Number.isFinite(answer)) throw new Error('Помилка в рядку '+(i+2)+': потрібні question і числовий answer.')
        return { question:q, answer, unit:pick('unit'), deck_id:selected, explanation:pick('explanation'), difficulty: ['easy','medium','hard'].includes(pick('difficulty')) ? pick('difficulty'):'medium', active: !['false','0','no'].includes(pick('active').toLowerCase()) }
      })
      if (payload.length > 500) throw new Error('Імпортуйте не більше 500 запитань за раз.')
      for (let i=0;i<payload.length;i+=100) {
        const {error:err} = await db.from('quiz_questions').insert(payload.slice(i,i+100))
        if (err) throw err
      }
      await load()
      setNotice('Імпортовано '+payload.length+' запитань. Перед грою перевірте правильність відповідей.')
    } catch(e) { setError((e as Error).message) }
    finally { setWorking(false) }
  }

  function exportCsv() {
    const selectedQuestions = questions.filter(q => q.deck_id === selected)
    const fields = ['question','answer','unit','explanation','difficulty','active'] as const
    const escape = (value:unknown) => '"' + String(value ?? '').replace(/"/g,'""') + '"'
    const csv = [fields.join(','),...selectedQuestions.map(q=>fields.map(key=>escape(q[key])).join(','))].join('\r\n')
    const blob = new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'})
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href=objectUrl; link.download='museum-dilettante-'+(deck?.slug||'questions')+'.csv';link.click()
    setTimeout(()=>URL.revokeObjectURL(objectUrl),1000)
  }

  if (!ready) return <div className="admin-shell"><p>Завантаження адміністратора…</p></div>
  return <div className="admin-shell">
    <header className="admin-bar"><Link to="/" className="admin-brand">М <span>МУЗЕЙНИЙ ДИЛЕТАНТ</span></Link><div className="admin-actions"><Link to="/host">Пульт ведучого</Link>{session && <button className="admin-button quiet" onClick={() => void db?.auth.signOut()}><LogOut size={15} className="ui-icon"/> Вийти</button>}</div></header>
    <main className="admin-main">
      <div className="admin-heading"><div><span className="kicker">Адміністрування</span><h1>Музейна гра · налаштування</h1><p>Керуйте запитаннями, покараннями та правилами їхнього вибору без змін у коді.</p></div></div>
      {error && <div role="alert" className="admin-alert">{error}<button onClick={()=>setError('')}><X size={18}/></button></div>}
      {notice && <div className="admin-notice">{notice}<button onClick={()=>setNotice('')}><X size={18}/></button></div>}
      {!session ? <section className="admin-card admin-login">
        <h2>Вхід адміністратора</h2>
        <p>Вхід доступний лише для email, доданих до списку адміністраторів.</p>
        <div className="admin-login-methods">
          <button className={'admin-button icon-button'+(loginMethod==='password'?' accent':'')} onClick={()=>{setLoginMethod('password');setError('')}}><KeyRound size={16}/> За паролем</button>
          <button className={'admin-button icon-button'+(loginMethod==='email'?' accent':'')} onClick={()=>{setLoginMethod('email');setError('')}}><Mail size={16}/> Через пошту</button>
        </div>
        <label>Електронна пошта<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} placeholder="email@example.com"/></label>
        {loginMethod==='password' ? <>
          <label>Пароль<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Ваш пароль"/></label>
          <button className="admin-button accent icon-button" disabled={working||!email.trim()||!password} onClick={()=>void signInPassword()}><KeyRound size={16}/> Увійти</button>
          <p className="admin-login-help">Якщо ви ще не встановили пароль, скористайтеся входом через пошту. Після підтвердження можна буде створити пароль.</p>
        </> : <>
          <button disabled={working || !email.trim() || emailLimited} className="admin-button accent icon-button" onClick={()=>void sendLink()}><Mail size={16}/>{sent?'Надіслати ще раз':'Отримати посилання для входу'}</button>
          {emailLimited && <p className="admin-login-help">Надсилання листів тимчасово обмежене на рівні Supabase. Ліміт спільний для всіх адміністраторів проєкту. Після його відновлення можна повторити спробу.</p>}
          {sent && <div className="admin-code"><label>Код із листа (якщо є)<input value={token} onChange={e=>setToken(e.target.value)} inputMode="numeric" placeholder="6-значний код"/></label><button disabled={working || !token} className="admin-button" onClick={()=>void verifyCode()}>Підтвердити код</button></div>}
        </>}
      </section> : !allowed ? <section className="admin-card"><h2>Доступ обмежено</h2><p>Ви увійшли, але ця адреса ще не додана до списку адміністраторів. Попросіть чинного адміністратора додати ваш email у вкладці «Адміністратори», після чого оновіть сторінку.</p></section> : <>
      <section className="admin-password-settings">
        <button className="admin-button icon-button" onClick={()=>{setPasswordOpen(!passwordOpen);setError('')}}><ShieldCheck size={16}/> {passwordOpen?'Закрити налаштування пароля':'Налаштувати пароль для входу'}</button>
        {passwordOpen&&<div className="admin-card admin-password-form">
          <h2>Пароль адміністратора</h2>
          <p>Після встановлення пароля можна входити без листа Supabase. Це безкоштовно й не змінює права доступу.</p>
          <label>Новий пароль (від 12 символів)<input type="password" autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></label>
          <label>Підтвердіть пароль<input type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/></label>
          <button className="admin-button accent icon-button" disabled={working||newPassword.length<12||!confirmPassword} onClick={()=>void setAdminPassword()}><Save size={16}/> Зберегти пароль</button>
        </div>}
      </section>
      <div className="admin-tabs"><button className={tab==='questions'?'active':''} onClick={()=>setTab('questions')}><BookOpen size={16} className="ui-icon"/> Запитання</button><button className={tab==='punishments'?'active':''} onClick={()=>{setTab('punishments');setEditing(null);setNewDeck(false)}}><ListChecks size={16} className="ui-icon"/> Покарання</button><button className={tab==='admins'?'active':''} onClick={()=>{setTab('admins');setEditing(null);setNewDeck(false)}}><UsersRound size={16} className="ui-icon"/> Адміністратори</button></div>
      {tab==='punishments' ? <Punishments/> : tab==='admins' ? <AdminUsers/> : <>
      <section className="admin-toolbar"><div className="admin-field"><label>Колода<select value={selected} onChange={e=>{setSelected(Number(e.target.value));setEditing(null)}}>{decks.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label></div><button className="admin-button" onClick={()=>setNewDeck(true)}><Plus size={16} className="ui-icon"/> Нова колода</button><button className="admin-button accent" onClick={()=>setEditing(blank(selected))} disabled={!selected}><Plus size={16} className="ui-icon"/> Запитання</button></section>
      {deck && <div className="admin-summary"><div><strong>{questions.filter(q=>q.deck_id===selected).length}</strong><span>Усього запитань</span></div><div><strong>{active}</strong><span>Активних</span></div><p>{deck.description}</p></div>}
      <section className="admin-card"><div className="admin-list-bar"><input placeholder="Пошук запитання або числа…" value={search} onChange={e=>setSearch(e.target.value)}/><label className="admin-import"><Upload size={16} className="ui-icon"/> Імпорт CSV <input type="file" accept=".csv,text/csv,text/plain" disabled={working} onChange={async e=>{const f=e.target.files?.[0];if(f) await importCsv(f);e.target.value=''}}/></label><button className="admin-button" onClick={exportCsv} disabled={!questions.length}><Download size={16} className="ui-icon"/> Експорт CSV</button></div><div className="admin-list">{displayed.map(q=><article key={q.id} className={'admin-question'+(!q.active?' inactive':'')}><div className="admin-question-text"><span className="admin-question-id">#{q.id} · {q.difficulty} · {q.active?'Активне':'Вимкнене'}</span><h3>{q.question}</h3><p><strong>{q.answer}</strong> {q.unit}</p>{q.explanation && <small>{q.explanation}</small>}</div><div className="admin-question-actions"><button className="admin-button" onClick={()=>setEditing({...q})}><Pencil size={15} className="ui-icon"/> Редагувати</button><button className="admin-button danger" disabled={working} onClick={()=>void removeQuestion(q)}><Ban size={15} className="ui-icon"/>{q.active?'Вимкнути':'Увімкнути'}</button></div></article>)}{!displayed.length && <p className="admin-empty">У цій колоді немає запитань за вибраним фільтром.</p>}</div></section>
      </>}
      </>}
    </main>
    {editing && <div className="admin-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setEditing(null)}}><section className="admin-dialog" role="dialog" aria-modal="true" aria-label="Редактор запитання"><div className="admin-dialog-top"><h2>{editing.id?'Редагувати запитання':'Нове запитання'}</h2><button onClick={()=>setEditing(null)}><X size={18}/></button></div><label>Запитання<textarea rows={3} value={editing.question} onChange={e=>setEditing({...editing,question:e.target.value})}/></label><div className="admin-form-grid"><label>Правильне число<input type="number" value={editing.answer} onChange={e=>setEditing({...editing,answer:Number(e.target.value)})}/></label><label>Одиниця вимірювання<input value={editing.unit} onChange={e=>setEditing({...editing,unit:e.target.value})} placeholder="рік, колон, рублів…"/></label></div><label>Пояснення для ведучого<textarea rows={3} value={editing.explanation} onChange={e=>setEditing({...editing,explanation:e.target.value})}/></label><div className="admin-form-grid"><label>Колода<select value={editing.deck_id} onChange={e=>setEditing({...editing,deck_id:Number(e.target.value)})}>{decks.map(d=><option value={d.id} key={d.id}>{d.name}</option>)}</select></label><label>Складність<select value={editing.difficulty} onChange={e=>setEditing({...editing,difficulty:e.target.value})}><option value="easy">Легке</option><option value="medium">Середнє</option><option value="hard">Складне</option></select></label></div><label className="admin-check"><input type="checkbox" checked={editing.active} onChange={e=>setEditing({...editing,active:e.target.checked})}/> Активне запитання</label><div className="admin-dialog-buttons"><button className="admin-button" onClick={()=>setEditing(null)}>Скасувати</button><button className="admin-button accent" disabled={working} onClick={()=>void saveQuestion()}><Save size={15} className="ui-icon"/> Зберегти</button></div></section></div>}
    {newDeck && <div className="admin-overlay" role="presentation"><section className="admin-dialog compact" role="dialog" aria-modal="true" aria-label="Нова колода"><div className="admin-dialog-top"><h2>Нова колода</h2><button onClick={()=>setNewDeck(false)}><X size={18}/></button></div><label>Назва<input value={deckName} onChange={e=>setDeckName(e.target.value)} placeholder="Наприклад, Колекція ОНХМ"/></label><label>Опис<textarea rows={2} value={deckDescription} onChange={e=>setDeckDescription(e.target.value)}/></label><div className="admin-dialog-buttons"><button className="admin-button" onClick={()=>setNewDeck(false)}>Скасувати</button><button className="admin-button accent" disabled={working||!deckName.trim()} onClick={()=>void saveDeck()}><Plus size={15} className="ui-icon"/> Створити</button></div></section></div>}
  </div>
}
