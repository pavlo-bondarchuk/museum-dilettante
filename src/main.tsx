import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { db } from './supabase'
import Admin from './Admin'
import './style.css'

type Player = { name: string; value?: number; error?: number; points: number; penalties: number; answered: boolean; mine?: boolean; id: string }
type Snapshot = { code: string; status: 'lobby'|'answer'|'reveal'|'finished'; round: number; total: number; question: string|null; correct: number|null; unit: string|null; explanation?: string|null; answered: number; players: Player[]; punishment: string|null; loser: string|null }
type Result = { ok: boolean; message?: string; code?: string; snapshot?: Snapshot }

async function call(action: string, data: Record<string, unknown> = {}): Promise<Result> {
  if (!db) throw new Error('Спершу підключіть Supabase через змінні середовища Vercel.')
  const { data: result, error } = await db.rpc('game_api', { p_action: action, p_data: data })
  if (error) throw new Error(error.message)
  if (!result?.ok) throw new Error(result?.message || 'Не вдалося виконати дію.')
  return result as Result
}

const token = (key: string) => {
  let stored = localStorage.getItem(key)
  if (!stored) { stored = crypto.randomUUID(); localStorage.setItem(key, stored) }
  return stored
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="shell"><header><Link to="/" className="brand"><span className="brand-mark">М</span><span>МУЗЕЙНИЙ<br/><b>ДИЛЕТАНТ</b></span></Link><span className="eyebrow">ОНХМ · Інтерактивна гра</span></header><main>{children}</main><footer>Музейні історії. Непередбачувані цифри.</footer></div>
}

function Home() {
  return <Shell><section className="hero"><span className="kicker">Гра, де приблизно — вже непогано</span><h1>А наскільки<br/><em>ви помиляєтесь?</em></h1><p>Вгадуйте числа з історії музею. Перемагає той, хто найближче. Хто найдалі — отримує музейний вирок.</p><div className="actions"><Link className="btn primary" to="/host">Я ведучий →</Link><Link className="btn outline" to="/join">Приєднатися до гри</Link><Link className="btn outline" to="/admin">Банк запитань</Link></div></section></Shell>
}

function useLive(code: string | undefined, identity: Record<string, unknown>) {
  const [snap, setSnap] = useState<Snapshot|null>(null)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const fetch = useCallback(async () => {
    if (!code || busy.current) return
    busy.current = true
    try { const result = await call('snapshot', { code, ...identity }); setSnap(result.snapshot || null); setError('') }
    catch (e) { setError((e as Error).message) }
    finally { busy.current = false }
  }, [code, JSON.stringify(identity)])
  useEffect(() => {
    if (!code) return
    void fetch()
    const interval = window.setInterval(() => void fetch(), 3000)
    const channel = db?.channel('game-' + code).on('postgres_changes', { event: '*', schema: 'public', table: 'game_public', filter: 'code=eq.' + code }, () => void fetch()).subscribe()
    return () => { clearInterval(interval); if (channel && db) void db.removeChannel(channel) }
  }, [code, fetch])
  return { snap, error, refresh: fetch }
}

function Host() {
  const [code, setCode] = useState(localStorage.getItem('md-host-code') || '')
  const [decks, setDecks] = useState<{id:number,name:string,question_count:number}[]>([])
  const [deckId, setDeckId] = useState<number|null>(null)
  useEffect(() => { void db?.rpc('list_public_decks').then(({data}) => { if (data) { setDecks(data); setDeckId(old => old || data[0]?.id || null) } }) }, [])
  const secret = token('md-host-secret')
  const { snap, error, refresh } = useLive(code, { host_secret: secret })
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState('')
  async function act(action: string) {
    setWorking(true); setNotice('')
    try { const res = await call(action, { code, host_secret: secret, deck_id: action === 'create' ? deckId : undefined }); if (res.code) { localStorage.setItem('md-host-code', res.code); setCode(res.code) }; await refresh() }
    catch (e) { setNotice((e as Error).message) }
    finally { setWorking(false) }
  }
  const link = code ? window.location.origin + '/join/' + code : ''
  return <Shell><div className="top"><span className="kicker">Пульт ведучого</span><Link to="/admin">Банк запитань</Link></div>{!code ? <section className="panel center"><h1>Створити гру</h1><p>Одна кімната, одна QR-адреса, до 40 учасників.</p><label>Колода<select value={deckId ?? ""} onChange={e=>setDeckId(Number(e.target.value))}>{decks.map(d=><option key={d.id} value={d.id}>{d.name} · {d.question_count} запитань</option>)}</select></label><button className="btn primary" disabled={working || !deckId} onClick={() => void act('create')}>Створити кімнату</button></section> : <>
    <div className="host-grid"><section className="panel"><span className="kicker">Кімната</span><h1 className="room-code">{code}</h1><div className="qr">{link && <QRCodeSVG value={link} size={176} bgColor="#ffffff" fgColor="#171b25" marginSize={2}/>}</div><a href={link} target="_blank" rel="noreferrer">{link}</a><div className="actions"><Link className="btn outline" to={'/screen/' + code} target="_blank">Відкрити екран проектора ↗</Link><button className="btn subtle" onClick={() => void navigator.clipboard.writeText(link)}>Скопіювати посилання</button></div></section>
    <section className="panel"><span className="kicker">{snap ? 'Раунд ' + (snap.round + 1) + ' / ' + snap.total : 'Очікування'}</span><h2>{snap?.question || 'Збираємо учасників'}</h2><p>Підключено: <b>{snap?.players.length || 0}</b> · Відповіло: <b>{snap?.answered || 0}</b></p><p>Стан: <b>{snap?.status || 'завантаження'}</b></p>{snap?.status === 'reveal' && <div className="result"><div>Правильна відповідь: <strong>{snap.correct} {snap.unit}</strong></div><div>Музейний вирок: <strong>{snap.loser || 'Немає'}</strong></div><p>{snap.punishment}</p>{snap.explanation && <p>{snap.explanation}</p>}</div>}
    <div className="actions">{snap?.status === 'lobby' && <button className="btn primary" disabled={working || !snap.players.length} onClick={() => void act('start')}>Почати гру</button>}{snap?.status === 'answer' && <button className="btn primary" disabled={working} onClick={() => void act('reveal')}>Закрити відповіді й показати результат</button>}{snap?.status === 'reveal' && <button className="btn primary" disabled={working} onClick={() => void act('next')}>Наступне питання →</button>}{snap?.status === 'finished' && <p>Гру завершено. Дякуємо за участь!</p>}</div></section></div>
    <div className="actions"><button className="btn subtle" onClick={() => { localStorage.removeItem("md-host-code"); setCode(""); }}>Створити іншу кімнату</button></div>
    <section className="panel"><h2>Учасники</h2><div className="people">{snap?.players.map(p => <span className="person" key={p.id}>{p.name} <small>{p.points} б. {p.answered ? '✓' : ''}</small></span>)}</div></section>
    </>}{(notice || error) && <p className="error">{notice || error}</p>}</Shell>
}

function Join() {
  const { code: pathCode } = useParams()
  const navigate = useNavigate()
  const [code, setCode] = useState(pathCode || '')
  const [name, setName] = useState(localStorage.getItem('md-name') || '')
  const [joined, setJoined] = useState(() => !!pathCode && localStorage.getItem('md-joined-code') === pathCode.toUpperCase())
  const [value, setValue] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(false)
  const playerToken = token('md-player-token')
  const { snap, error, refresh } = useLive(joined ? code.toUpperCase() : undefined, { player_token: playerToken })
  const me = snap?.players.find(p => p.mine)
  useEffect(() => { setValue('') }, [snap?.round])
  useEffect(() => { if (pathCode) setCode(pathCode.toUpperCase()) }, [pathCode])
  async function join() {
    setPending(true); setNotice('')
    try { await call('join', { code: code.trim().toUpperCase(), name: name.trim(), player_token: playerToken }); localStorage.setItem('md-name', name.trim()); localStorage.setItem('md-joined-code', code.trim().toUpperCase()); setJoined(true); navigate('/join/' + code.trim().toUpperCase(), { replace: true }) }
    catch (e) { setNotice((e as Error).message) }
    finally { setPending(false) }
  }
  async function submit() {
    setPending(true); setNotice('')
    try { await call('submit', { code, player_token: playerToken, value: Number(value) }); await refresh() }
    catch (e) { setNotice((e as Error).message) }
    finally { setPending(false) }
  }
  return <Shell><div className="top"><span className="kicker">Телефон учасника</span><Link to="/">← Головна</Link></div>{!joined ? <section className="panel center"><h1>Заходьте у гру</h1><p>Вкажіть код з проектора та своє ім’я.</p><label>Код гри<input value={code} maxLength={6} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="ABC123" autoCapitalize="characters"/></label><label>Ваше ім’я<input value={name} maxLength={28} onChange={e => setName(e.target.value)} placeholder="Наприклад, Олена"/></label><button className="btn primary" disabled={pending || code.trim().length !== 6 || !name.trim()} onClick={() => void join()}>Приєднатися →</button></section> : <section className="panel center"><span className="kicker">Кімната {code} · {name}</span>{snap?.status === 'lobby' && <><h1>Ви у грі!</h1><p>Чекаємо, поки ведучий почне перший раунд.</p></>}{snap?.status === 'answer' && <><span className="round-label">Питання {(snap.round || 0) + 1} / {snap.total}</span><h2>{snap.question}</h2>{me?.answered ? <p className="success">✓ Відповідь прийнято. Очікуємо інших.</p> : <><label>Ваше число<input type="number" inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} placeholder="Введіть число"/></label><button className="btn primary" disabled={pending || value.trim() === '' || !Number.isFinite(Number(value))} onClick={() => void submit()}>Надіслати відповідь</button></>}</>}{snap?.status === 'reveal' && <><span className="kicker">Правильна відповідь</span><h1>{snap.correct} <small>{snap.unit}</small></h1><p>{snap.loser ? 'Музейний вирок отримує ' + snap.loser : 'Цього разу без покарання.'}</p><p>{snap.punishment}</p></>}{snap?.status === 'finished' && <><h1>Гру завершено</h1><p>Дякуємо за участь!</p></>}{!snap && <p>Підключення…</p>}</section>}{(notice || error) && <p className="error">{notice || error}</p>}</Shell>
}

function Screen() {
  const { code } = useParams()
  const { snap, error } = useLive(code?.toUpperCase(), {})
  return <div className="screen"><div className="screen-top"><span>МУЗЕЙНИЙ ДИЛЕТАНТ</span><span>КІМНАТА {code?.toUpperCase()}</span></div>{!snap ? <h1>{error || 'Завантажуємо гру…'}</h1> : snap.status === 'lobby' ? <div className="screen-center"><span className="kicker">Скануйте QR, щоб приєднатися</span><div className="screen-qr"><QRCodeSVG value={window.location.origin + '/join/' + snap.code} size={230} marginSize={2}/></div><h1>{snap.code}</h1><p>У грі вже {snap.players.length} учасників</p></div> : snap.status === 'answer' ? <div className="screen-center"><span className="kicker">Раунд {snap.round + 1} із {snap.total}</span><h1>{snap.question}</h1><p>Відповіли {snap.answered} / {snap.players.length}</p></div> : snap.status === 'reveal' ? <div className="screen-center"><span className="kicker">Правильна відповідь</span><div className="big-answer">{snap.correct} <small>{snap.unit}</small></div>{snap.explanation && <p className="screen-explanation">{snap.explanation}</p>}<div className="scoreboard">{snap.players.map(p => <div className="score-row" key={p.id}><b>{p.name}</b><span>{p.value ?? '—'}</span><span>{p.error == null ? '—' : '±' + p.error}</span></div>)}</div>{snap.loser && <div className="verdict"><span>МУЗЕЙНИЙ ВИРОК · {snap.loser}</span><h2>{snap.punishment}</h2></div>}</div> : <div className="screen-center"><h1>Дякуємо за гру!</h1><div className="scoreboard">{snap.players.map(p => <div className="score-row" key={p.id}><b>{p.name}</b><span>{p.points} балів</span><span>{p.penalties} покарань</span></div>)}</div></div>}<div className="screen-foot">Історія музею ближча, ніж здається</div></div>
}

function App() {
  return <Routes>
    <Route path="/" element={<Home/>}/>
    <Route path="/host" element={<Host/>}/>
    <Route path="/admin" element={<Admin/>}/>
    <Route path="/join" element={<Join/>}/>
    <Route path="/join/:code" element={<Join/>}/>
    <Route path="/screen/:code" element={<Screen/>}/>
    <Route path="*" element={<Home/>}/>
  </Routes>
}

createRoot(document.getElementById('root')!).render(<BrowserRouter><App/></BrowserRouter>)
