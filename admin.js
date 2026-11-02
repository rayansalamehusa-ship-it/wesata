'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = n => Number(n).toLocaleString('ar-EG');
const agoTxt = d => d < 1 ? 'اليوم' : d === 1 ? 'أمس' : 'قبل ' + d + ' أيام';
const STG = { new: 'جديد', contact: 'تم التواصل', view: 'معاينة', neg: 'تفاوض', closed: 'أُغلق' };
let ME = null, AL = [], AQ = [], ST = {}, tab = 'l', tt, addTo = null;
const toast = m => { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 3000); };
async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch (e) { }
  if (r.status === 401) { location.replace('/login.html'); throw new Error('انتهت الجلسة'); }
  if (!r.ok) throw new Error(j.error || 'حدث خطأ، حاول مرة أخرى');
  return j;
}
const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message); } };

// تصغير الصورة في المتصفح وتحويلها إلى JPEG قبل الرفع
async function toJpeg(file, max = 1400, q = 0.82) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
async function upload(lid, files) {
  let ok = 0;
  for (const f of [...files].slice(0, 8)) {
    try { toast(`جارٍ رفع الصورة ${ok + 1} من ${Math.min(files.length, 8)}…`); await api(`/api/admin/listings/${lid}/images`, 'POST', { data: await toJpeg(f) }); ok++; }
    catch (e) { toast(e.message); }
  }
  return ok;
}
async function load() {
  [ME, AL, AQ, ST] = await Promise.all([api('/api/admin/me'), api('/api/admin/listings'), api('/api/admin/leads'), api('/api/settings')]);
  render();
}
function render() {
  const stale = AL.filter(l => l.status === 'avail' && !l.fresh).length, nl = AQ.filter(q => q.stage === 'new').length, mt = AQ.reduce((n, q) => n + q.matches.length, 0);
  let body = '';
  if (tab === 'l') {
    body = `<div class="grid2" style="margin-bottom:10px"><div><label class="f" for="nt">عنوان العقار</label><input id="nt" maxlength="120"></div><div><label class="f" for="np">السعر (ر.س)</label><input id="np" inputmode="numeric"></div><div><label class="f" for="ny">النوع</label><select id="ny"><option>شقة</option><option>فيلا</option><option>أرض</option><option>تجاري</option></select></div><div><label class="f" for="nc">المدينة</label><input id="nc" list="cl" maxlength="40"><datalist id="cl">${[...new Set(AL.map(l => l.city))].map(c => `<option value="${esc(c)}">`).join('')}</datalist></div><div><label class="f" for="na">المساحة م²</label><input id="na" inputmode="numeric"></div><div><label class="f" for="nb">عدد الغرف</label><input id="nb" inputmode="numeric"></div><div class="full"><label class="f" for="nf">صور العقار (حتى 8)</label><input id="nf" type="file" accept="image/*" multiple></div><div class="full"><button class="btn" id="addL">إضافة العقار ونشره</button></div></div>
    <div class="list" style="margin-top:20px">${AL.map(l => `<div class="row"><div class="head">${l.images[0] ? `<img class="thumb" src="/uploads/${l.images[0].file}" alt="">` : '<div class="thumb"></div>'}<div><b>${esc(l.title)}</b> ${l.status === 'avail' ? (l.fresh ? '<span class="tag">ظاهر للجمهور</span>' : '<span class="tag warn">مخفي: يحتاج إعادة تأكيد</span>') : `<span class="tag bad">${l.status === 'sold' ? 'مباع' : 'محجوز'}</span>`}<br><small>${n0(l.price)} ر.س · ${esc(l.type)} · ${esc(l.city)} · آخر تأكيد ${agoTxt(l.ageDays)}</small></div></div><div class="acts"><button class="btn sm" data-cf="${l.id}">تأكيد التوفر الآن</button><button class="btn sm ghost" data-st="${l.id}:${l.status === 'avail' ? 'res' : 'avail'}">${l.status === 'avail' ? 'محجوز' : 'إتاحة'}</button><button class="btn sm ghost" data-st="${l.id}:sold">مباع</button><button class="btn sm ghost" data-ai="${l.id}">＋ صور</button><button class="btn sm ghost" data-del="${l.id}">حذف</button></div>${l.images.length ? `<div class="imgs">${l.images.map(i => `<div class="im"><img src="/uploads/${i.file}" alt=""><button data-di="${i.id}" aria-label="حذف الصورة">×</button></div>`).join('')}</div>` : ''}</div>`).join('') || '<div class="empty">لا توجد عقارات بعد. أضف أول عقار من النموذج أعلاه وسيظهر فوراً في الموقع.</div>'}</div>`;
  } else if (tab === 'q') {
    body = AQ.length ? `<div class="list">${AQ.map(q => `<div class="row" style="align-items:flex-start"><div><b>${esc(q.name)}</b> <span class="tag warn">${q.src === 'req' ? 'طلب عقار' : 'استفسار'}</span><br><small dir="ltr" style="unicode-bidi:plaintext">${esc(q.phone)}</small><br><small>${q.src === 'req' ? `يبحث عن ${esc(q.type)} في ${esc(q.city)}${q.maxPrice ? ' حتى ' + n0(q.maxPrice) + ' ر.س' : ''}` : q.listingTitle ? 'عن: ' + esc(q.listingTitle) : 'عقار محذوف'}</small><br><a class="cbtn sm" href="tel:${esc(q.phone)}" style="padding:4px 14px;margin-top:6px">اتصال بالعميل</a></div><div class="acts" style="min-width:230px;flex-direction:column"><select data-sg="${q.id}" aria-label="المرحلة">${Object.entries(STG).map(([k, v]) => `<option value="${k}" ${q.stage === k ? 'selected' : ''}>${v}</option>`).join('')}</select><input type="date" data-fu="${q.id}" value="${esc(q.followUp)}" aria-label="موعد المتابعة"><input data-nt="${q.id}" value="${esc(q.note)}" placeholder="ملاحظة" maxlength="500" aria-label="ملاحظة"></div></div>`).join('')}</div>` : '<div class="empty">لا يوجد عملاء بعد. ستظهر هنا الاستفسارات والطلبات تلقائياً.</div>';
  } else if (tab === 'm') {
    const rq = AQ.filter(q => q.src === 'req');
    body = rq.length ? `<div class="list">${rq.map(q => `<div class="row"><div><b>${esc(q.name)}</b><br><small>${esc(q.type)} · ${esc(q.city)}${q.maxPrice ? ' · حتى ' + n0(q.maxPrice) : ''}</small></div><div>${q.matches.length ? q.matches.map(l => `<span class="tag">${esc(l.title)} · ${n0(l.price)}</span>`).join('') : '<span class="tag warn">لا يوجد تطابق حالياً</span>'}</div></div>`).join('')}</div>` : '<div class="empty">لا توجد طلبات عملاء للمطابقة بعد.</div>';
  } else {
    body = `<div class="grid2"><div><label class="f" for="so">اسم المكتب</label><input id="so" value="${esc(ST.office_name)}" maxlength="80"></div><div><label class="f" for="sp">رقم الاتصال</label><input id="sp" value="${esc(ST.phone)}" dir="ltr" style="text-align:right" placeholder="0501234567"></div><div><label class="f" for="sw">رقم واتساب (بصيغة دولية بدون +)</label><input id="sw" value="${esc(ST.whatsapp)}" dir="ltr" style="text-align:right" placeholder="966501234567"></div><div><label class="f" for="sa">العنوان</label><input id="sa" value="${esc(ST.address)}" maxlength="160"></div><div class="full"><button class="btn" id="saveS">حفظ الإعدادات</button></div></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:26px 0"><h3 style="font-size:22px;margin-bottom:10px">تغيير كلمة المرور</h3><div class="grid2"><div><label class="f" for="pc">الحالية</label><input id="pc" type="password" autocomplete="current-password"></div><div><label class="f" for="pn">الجديدة (8 أحرف على الأقل)</label><input id="pn" type="password" autocomplete="new-password"></div><div class="full"><button class="btn" id="savePw">تغيير كلمة المرور</button></div></div>`;
  }
  $('adm').innerHTML = `${!ST.whatsapp && !ST.phone ? '<div class="warnbox">لم تُضف وسائل التواصل بعد. أضف رقم واتساب والاتصال من «الإعدادات» لتظهر أزرار التواصل المباشر للزوار.</div>' : ''}<div class="stats"><div class="stat"><b>${n0(AL.filter(l => l.fresh).length)}</b><span>ظاهرة للجمهور</span></div><div class="stat"><b>${n0(stale)}</b><span>تحتاج إعادة تأكيد</span></div><div class="stat"><b>${n0(nl)}</b><span>عملاء جدد</span></div><div class="stat"><b>${n0(mt)}</b><span>تطابقات جاهزة</span></div></div><div class="tabs">${[['l', 'العقارات'], ['q', 'العملاء'], ['m', 'التطابق'], ['s', 'الإعدادات']].map(([k, v]) => `<button class="chip ${tab === k ? 'sel' : ''}" data-tb="${k}">${v}</button>`).join('')}<button class="chip" data-tb="out" style="margin-inline-start:auto">خروج (${esc(ME.username)})</button></div>${body}`;
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-cf],[data-st],[data-del],[data-ai],[data-di],[data-tb],button[id]'); if (!t) return;
  const D = t.dataset, id = t.id;
  if (D.cf) run(async () => { await api(`/api/admin/listings/${D.cf}/confirm`, 'POST', {}); await load(); }, 'تم تأكيد التوفر، وظهر العقار للجمهور');
  else if (D.st) { const [i, s] = D.st.split(':'); run(async () => { await api(`/api/admin/listings/${i}/status`, 'POST', { status: s }); await load(); }); }
  else if (D.del) { if (confirm('حذف هذا العقار وصوره نهائياً؟')) run(async () => { await api('/api/admin/listings/' + D.del, 'DELETE', {}); await load(); }, 'تم الحذف'); }
  else if (D.ai) { addTo = +D.ai; $('fi').click(); }
  else if (D.di) run(async () => { await api('/api/admin/images/' + D.di, 'DELETE', {}); await load(); });
  else if (D.tb === 'out') run(async () => { await api('/api/logout', 'POST', {}); location.replace('/login.html'); });
  else if (D.tb) { tab = D.tb; render(); }
  else if (id === 'addL') run(async () => {
    const files = $('nf').files;
    const r = await api('/api/admin/listings', 'POST', { title: $('nt').value, price: $('np').value, type: $('ny').value, city: $('nc').value, area: $('na').value, beds: $('nb').value });
    if (files.length) await upload(r.id, files);
    await load(); toast('أُضيف العقار وظهر في الموقع');
  });
  else if (id === 'saveS') run(async () => { ST = await api('/api/admin/settings', 'PUT', { office_name: $('so').value, phone: $('sp').value, whatsapp: $('sw').value, address: $('sa').value }); render(); }, 'حُفظت الإعدادات');
  else if (id === 'savePw') run(async () => { await api('/api/admin/password', 'POST', { current: $('pc').value, next: $('pn').value }); $('pc').value = $('pn').value = ''; }, 'تم تغيير كلمة المرور');
});
document.addEventListener('change', e => {
  const D = e.target.dataset, v = e.target.value;
  if (e.target.id === 'fi') { const f = e.target.files; if (addTo && f.length) run(async () => { await upload(addTo, f); e.target.value = ''; await load(); }, 'تمت إضافة الصور'); return; }
  if (D.sg) run(async () => { await api('/api/admin/leads/' + D.sg, 'PATCH', { stage: v }); await load(); });
  else if (D.fu) run(() => api('/api/admin/leads/' + D.fu, 'PATCH', { followUp: v }));
  else if (D.nt) run(() => api('/api/admin/leads/' + D.nt, 'PATCH', { note: v }), 'حُفظت الملاحظة');
});
load().catch(e => { $('adm').innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
