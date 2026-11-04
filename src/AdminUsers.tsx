import { ShieldCheck, Building2, LockKeyhole } from 'lucide-react'

export default function AdminUsers() {
  return <section className="admin-card admin-users">
    <div className="admin-users-heading"><div>
      <h2><ShieldCheck size={25} className="ui-icon"/> Правила доступу</h2>
      <p>Доступ визначається автоматично за підтвердженою електронною адресою в Supabase Auth.</p>
    </div></div>
    <div className="admin-users-list">
      <div className="admin-users-row"><div className="admin-users-identity"><LockKeyhole size={20}/><div><strong>Головний адміністратор</strong><p>bonddesign85@gmail.com</p></div></div></div>
      <div className="admin-users-row"><div className="admin-users-identity"><Building2 size={20}/><div><strong>Музейні адміністратори</strong><p>Усі підтверджені адреси @ofam.ua</p></div></div></div>
      <div className="admin-users-row"><div className="admin-users-identity"><ShieldCheck size={20}/><div><strong>Правило авторизації</strong><p>Лише головний адміністратор і підтверджені акаунти з домену @ofam.ua</p></div></div></div>
    </div>
    <p className="admin-users-hint">Окремо додавати співробітників із @ofam.ua більше не потрібно. Інші домени не отримують адміністративного доступу. Зміна цих правил потребує оновлення серверної політики.</p>
  </section>
}
