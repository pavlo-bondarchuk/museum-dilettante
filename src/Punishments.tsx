import { X, Plus, Pencil, Ban, Shuffle, Repeat2, Link2, Save } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { db } from './supabase'

type Mode = 'random' | 'no_repeat' | 'linked'
type Punishment = { id:number; body:string; category:string; active:boolean; question_id:number|null }
type Question = { id:number; question:string; deck_id:number }
type Deck = { id:number; name:string }
type Draft = Omit<Punishment,'id'> & { id?:number }

const blank:Draft = {body:'',category:'Музейний абсурд',active:true,question_id:null}
const categories=['Музейний абсурд','Акторські','Екскурсійні','Для колективу']
const modes:{value:Mode;title:string;description:string}[]=[
 {value:'random',title:'Випадково',description:'Випадковий вибір серед ще не використаних вироків. Кожен вирок — максимум один раз за сеанс.'},
 {value:'no_repeat',title:'Без повторень',description:'Без повторів у межах сеансу. Коли всі вироки вичерпано, новий не призначається.'},
 {value:'linked',title:'Прив’язка до запитання',description:'Спершу невикористані вироки для цього запитання, потім загальні. Жодних повторів у сеансі.'}
]

export default function Punishments(){
 const [items,setItems]=useState<Punishment[]>([])
 const [questions,setQuestions]=useState<Question[]>([])
 const [decks,setDecks]=useState<Deck[]>([])
 const [mode,setMode]=useState<Mode>('random')
 const [savedMode,setSavedMode]=useState<Mode>('random')
 const [editing,setEditing]=useState<Draft|null>(null)
 const [search,setSearch]=useState('')
 const [working,setWorking]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const reload=useCallback(async()=>{
  if(!db)return
  const [ps,qs,ds,settings]=await Promise.all([
   db.from('quiz_punishments').select('id,body,category,active,question_id').order('id'),
   db.from('quiz_questions').select('id,question,deck_id').order('id'),
   db.from('quiz_decks').select('id,name').order('id'),
   db.from('quiz_settings').select('punishment_mode').eq('id',1).single()
  ])
  for(const result of [ps,qs,ds,settings])if(result.error)throw result.error
  setItems(ps.data||[])
  setQuestions(qs.data||[])
  setDecks(ds.data||[])
  const choice=(settings.data?.punishment_mode||'random') as Mode
  setMode(choice);setSavedMode(choice)
 },[])
 useEffect(()=>{void reload().catch(e=>setError((e as Error).message))},[reload])
 const filtered=useMemo(()=>items.filter(p=>p.body.toLowerCase().includes(search.toLowerCase())||p.category.toLowerCase().includes(search.toLowerCase())),[items,search])
 const questionText=(id:number|null)=>questions.find(q=>q.id===id)?.question||''
 async function saveMode(){
  if(!db)return
  setWorking(true);setError('');setNotice('')
  try {
   const {error:e}=await db.from('quiz_settings').update({punishment_mode:mode}).eq('id',1)
   if(e)throw e
   setSavedMode(mode);setNotice('Режим збережено. Він діятиме для нових кімнат.')
  }catch(e){setError((e as Error).message)}finally{setWorking(false)}
 }
 async function saveItem(){
  if(!db||!editing)return
  if(editing.body.trim().length<3){setError('Введіть текст покарання (щонайменше 3 символи).');return}
  setWorking(true);setError('');setNotice('')
  try {
   const payload={body:editing.body.trim(),category:editing.category.trim()||categories[0],active:editing.active,question_id:editing.question_id}
   const result=editing.id?await db.from('quiz_punishments').update(payload).eq('id',editing.id).select('id').single():await db.from('quiz_punishments').insert(payload).select('id').single()
   if(result.error)throw result.error
   await reload();setEditing(null);setNotice('Покарання збережено.')
  }catch(e){setError((e as Error).message)}finally{setWorking(false)}
 }
 async function toggle(item:Punishment){
  if(!db)return
  setWorking(true);setError('');setNotice('')
  try {
   const {error:e}=await db.from('quiz_punishments').update({active:!item.active}).eq('id',item.id)
   if(e)throw e
   await reload();setNotice(item.active?'Покарання вимкнено.':'Покарання увімкнено.')
  }catch(e){setError((e as Error).message)}finally{setWorking(false)}
 }
 return <>
  {error&&<div className="admin-alert" role="alert">{error}<button onClick={()=>setError('')}><X size={18}/></button></div>}
  {notice&&<div className="admin-notice">{notice}<button onClick={()=>setNotice('')}><X size={18}/></button></div>}
  <section className="admin-card penalty-settings">
   <div className="penalty-header"><div><h2>Режим покарань</h2><p>Кожен вирок може з’явитися лише один раз за ігровий сеанс у будь-якому режимі. Налаштування режиму фіксується при створенні кімнати.</p></div></div>
   <div className="penalty-modes">{modes.map(item=><label className={'penalty-mode'+(mode===item.value?' selected':'')} key={item.value}><input type="radio" name="punishment-mode" checked={mode===item.value} onChange={()=>setMode(item.value)}/><span><strong>{item.value==='random'?<Shuffle size={17} className="ui-icon"/>:item.value==='no_repeat'?<Repeat2 size={17} className="ui-icon"/>:<Link2 size={17} className="ui-icon"/>} {item.title}</strong><small>{item.description}</small></span></label>)}</div>
   <button className="admin-button accent" onClick={()=>void saveMode()} disabled={working||mode===savedMode}><Save size={15} className="ui-icon"/> Зберегти режим</button>
  </section>
  <section className="admin-card">
   <div className="admin-list-bar"><input placeholder="Пошук за текстом чи категорією…" value={search} onChange={e=>setSearch(e.target.value)}/><button className="admin-button accent" onClick={()=>setEditing({...blank})}><Plus size={16} className="ui-icon"/> Додати покарання</button></div>
   <div className="admin-summary"><div><strong>{items.length}</strong><span>Усього</span></div><div><strong>{items.filter(x=>x.active).length}</strong><span>Активних</span></div><div><strong>{items.filter(x=>x.question_id!==null).length}</strong><span>Прив'язаних</span></div></div>
   <div className="admin-list">{filtered.map(p=><article key={p.id} className={'admin-question'+(!p.active?' inactive':'')}><div className="admin-question-text"><span className="admin-question-id">#{p.id} · {p.category} · {p.active?'Активне':'Вимкнене'}</span><h3>{p.body}</h3><p>{p.question_id===null?'Для будь-якого запитання':'Питання: '+questionText(p.question_id)}</p></div><div className="admin-question-actions"><button className="admin-button" onClick={()=>setEditing({...p})}><Pencil size={15} className="ui-icon"/> Редагувати</button><button className="admin-button danger" disabled={working} onClick={()=>void toggle(p)}><Ban size={15} className="ui-icon"/>{p.active?'Вимкнути':'Увімкнути'}</button></div></article>)}{!filtered.length&&<p className="admin-empty">Покарань за цим пошуком немає.</p>}</div>
  </section>
  {editing&&<div className="admin-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setEditing(null)}}><section className="admin-dialog" role="dialog" aria-modal="true" aria-label="Редактор покарання"><div className="admin-dialog-top"><h2>{editing.id?'Редагувати покарання':'Додати покарання'}</h2><button onClick={()=>setEditing(null)}><X size={18}/></button></div>
   <label>Текст завдання<textarea rows={4} value={editing.body} maxLength={500} onChange={e=>setEditing({...editing,body:e.target.value})}/></label>
   <div className="admin-form-grid"><label>Категорія<select value={editing.category} onChange={e=>setEditing({...editing,category:e.target.value})}>{[...new Set([...categories,...items.map(x=>x.category)])].map(c=><option key={c} value={c}>{c}</option>)}</select></label><label>Прив’язане запитання<select value={editing.question_id??''} onChange={e=>setEditing({...editing,question_id:e.target.value?Number(e.target.value):null})}><option value="">Загальне (без прив’язки)</option>{decks.map(d=><optgroup label={d.name} key={d.id}>{questions.filter(q=>q.deck_id===d.id).map(q=><option value={q.id} key={q.id}>#{q.id} — {q.question}</option>)}</optgroup>)}</select></label></div>
   <p className="penalty-help">За режиму «Прив’язка до запитання» спочатку вибираються пов’язані з ним покарання. Для решти запитань можна використовувати загальні.</p>
   <label className="admin-check"><input type="checkbox" checked={editing.active} onChange={e=>setEditing({...editing,active:e.target.checked})}/> Активне покарання</label>
   <div className="admin-dialog-buttons"><button className="admin-button" onClick={()=>setEditing(null)}>Скасувати</button><button className="admin-button accent" disabled={working} onClick={()=>void saveItem()}><Save size={15} className="ui-icon"/> Зберегти</button></div></section></div>}
 </>
}
