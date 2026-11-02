'use strict';
const $ = id => document.getElementById(id);
let tt;
const toast = m => { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 3000); };
fetch('/api/admin/me').then(r => { if (r.ok) location.replace('/admin/'); });
async function login() {
  $('go').disabled = true;
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('lu').value, password: $('lp').value }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'تعذر تسجيل الدخول');
    location.replace('/admin/');
  } catch (e) { toast(e.message); $('go').disabled = false; }
}
$('go').addEventListener('click', login);
['lu', 'lp'].forEach(i => $(i).addEventListener('keydown', e => { if (e.key === 'Enter') login(); }));
