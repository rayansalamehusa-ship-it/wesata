'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = n => Number(n).toLocaleString('ar-EG');
const agoTxt = d => d < 1 ? 'اليوم' : d === 1 ? 'أمس' : 'قبل ' + d + ' أيام';
const ICON = { 'شقة': '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4"/>', 'فيلا': '<path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5"/>', 'أرض': '<path d="M3 19l5-9 4 6 3-4 6 7z"/>', 'تجاري': '<path d="M4 20V8l8-4 8 4v12M9 20v-6h6v6M8 10h2M14 10h2"/>' };
let PUB = { listings: [], hidden: 0, freshDays: 7 }, SET = { office_name: 'دار الوساطة', phone: '', whatsapp: '', address: '' }, inqId = null, tt;
const toast = m => { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2800); };
async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch (e) { }
  if (!r.ok) throw new Error(j.error || 'حدث خطأ، حاول مرة أخرى');
  return j;
}
const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message); } };
const waLink = msg => `https://wa.me/${SET.whatsapp}?text=${encodeURIComponent(msg)}`;
const msgFor = l => `مرحباً، أستفسر عن العقار: ${l.title} (${n0(l.price)} ر.س)\n${location.origin}`;
const contactBtns = l => (SET.whatsapp ? `<a class="cbtn wa" href="${waLink(l ? msgFor(l) : 'مرحباً، أرغب في الاستفسار عن العقارات')}" target="_blank" rel="noopener">واتساب</a>` : '') + (SET.phone ? `<a class="cbtn" href="tel:${esc(SET.phone)}">اتصال</a>` : '');

function applySettings() {
  $('brand').textContent = $('fBrand').textContent = SET.office_name; document.title = SET.office_name + ' · عقارات مؤكدة التوفر';
  $('cAddr').textContent = SET.address || '';
  $('cBtns').innerHTML = contactBtns(null) || '<span style="color:var(--muted)">سيضيف المكتب وسائل التواصل قريباً.</span>';
  const f = $('fab'); f.hidden = !SET.whatsapp; if (SET.whatsapp) f.href = waLink('مرحباً، أرغب في الاستفسار عن العقارات');
}
function fillCities() {
  const cs = [...new Set(PUB.listings.map(l => l.city))], cur = $('fc').value;
  $('fc').innerHTML = '<option value="">الكل</option>' + cs.map(c => `<option ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('');
  $('cities').innerHTML = cs.map(c => `<option value="${esc(c)}">`).join('');
}
function renderCards() {
  const t = $('ft').value, c = $('fc').value, p = +$('fp').value, s = $('fs').value;
  const a = PUB.listings.filter(l => (!t || l.type === t) && (!c || l.city === c) && (!p || l.price <= p));
  a.sort((x, y) => s === 'l' ? x.price - y.price : s === 'h' ? y.price - x.price : x.ageDays - y.ageDays);
  $('hidden').innerHTML = PUB.hidden ? `أخفينا <b>${n0(PUB.hidden)}</b> عقاراً مؤقتاً لأن الوسيط لم يؤكد توفره خلال ${PUB.freshDays} أيام، لتوفير وقتك. تظهر فور إعادة التأكيد.` : `جميع العقارات المعروضة مؤكدة التوفر خلال آخر ${PUB.freshDays} أيام.`;
  $('cards').innerHTML = a.length ? a.map(l => `<article class="card"><div class="ph">${l.images[0] ? `<img src="/uploads/${l.images[0]}" alt="${esc(l.title)}" loading="lazy">` : `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">${ICON[l.type] || ''}</svg>`}<span class="fresh">✓ توفر مؤكد ${agoTxt(l.ageDays)}</span></div><div class="b"><div class="price">${n0(l.price)} ر.س</div><h3 style="font-size:20px">${esc(l.title)}</h3><div class="meta"><span>${esc(l.type)}</span><span>${esc(l.city)}</span>${l.area ? `<span>${n0(l.area)} م²</span>` : ''}${l.beds ? `<span>${n0(l.beds)} غرف</span>` : ''}</div></div><div style="padding:0 18px 18px"><button class="btn" data-d="${l.id}">التفاصيل</button>${contactBtns(l)}</div></article>`).join('')
    : '<div class="empty" style="grid-column:1/-1">لا توجد عقارات مؤكدة بهذه المواصفات. سجّل طلبك أدناه وسنطابقه لك.</div>';
}
function openDetail(id) {
  const l = PUB.listings.find(x => x.id === id); if (!l) return;
  $('ddBody').innerHTML = `${l.images.length ? `<div class="gal">${l.images.map(f => `<img src="/uploads/${f}" alt="${esc(l.title)}">`).join('')}</div>` : ''}<div class="price">${n0(l.price)} ر.س</div><h3 style="font-size:26px">${esc(l.title)}</h3><div class="meta" style="margin:6px 0 4px"><span>${esc(l.type)}</span><span>${esc(l.city)}</span>${l.area ? `<span>${n0(l.area)} م²</span>` : ''}${l.beds ? `<span>${n0(l.beds)} غرف</span>` : ''}<span style="color:var(--ok)">✓ توفر مؤكد ${agoTxt(l.ageDays)}</span></div><div class="acts" style="margin-top:16px">${contactBtns(l)}<button class="btn" data-q="${l.id}">اطلب أن نتصل بك</button><button class="btn ghost" data-close="dd">إغلاق</button></div>`;
  $('dd').showModal();
}
async function load() {
  [PUB, SET] = await Promise.all([api('/api/listings'), api('/api/settings')]);
  applySettings(); fillCities(); renderCards();
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-d],[data-q],[data-close],button[id]'); if (!t) return;
  const D = t.dataset, id = t.id;
  if (D.d) openDetail(+D.d);
  else if (D.q) { inqId = +D.q; $('dd').close(); $('dT').textContent = PUB.listings.find(l => l.id === inqId)?.title || ''; $('dlg').showModal(); }
  else if (D.close) $(D.close).close();
  else if (id === 'fgo') renderCards();
  else if (id === 'icl') $('dlg').close();
  else if (id === 'igo') run(async () => { await api('/api/inquiries', 'POST', { listingId: inqId, name: $('in').value, phone: $('ip').value }); $('dlg').close(); $('in').value = $('ip').value = ''; }, 'تم إرسال استفسارك، سيتصل بك الوسيط');
  else if (id === 'rgo') run(async () => { await api('/api/requests', 'POST', { name: $('rn').value, phone: $('rp').value, type: $('rt').value, city: $('rc').value, maxPrice: $('rm').value }); ['rn', 'rp', 'rm', 'rc'].forEach(i => $(i).value = ''); }, 'تم تسجيل طلبك وسنطابقه مع العقارات المؤكدة');
});
['ft', 'fc', 'fp', 'fs'].forEach(i => $(i).addEventListener('change', renderCards));
load().catch(() => toast('تعذر تحميل العقارات'));
