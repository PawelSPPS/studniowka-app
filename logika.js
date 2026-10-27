// Logika rozliczeń - czyste funkcje bez DOM, testowane w Node (test/logika.test.mjs).

export const RZ = ['I', 'II', 'III', 'IV', 'V'];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const zl = n => {
  const r = Math.round(n * 100) / 100;
  return r.toLocaleString('pl-PL', {minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2}).replace(/\s/g, ' ') + ' zł';
};
export const dt = iso => iso ? iso.split('-').reverse().join('.') : '';
export const dtk = iso => { const [, m, d] = iso.split('-'); return `${+d}.${m}`; };
export const dniMiedzy = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
export const dodajDni = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
export const slug = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const porownaj = (a, b) => a.nazwa.localeCompare(b.nazwa, 'pl');
export const kwotaZ = s => { const n = parseFloat(String(s ?? '').replace(/\s|zł/g, '').replace(',', '.')); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
export const procent = (a, b) => b ? Math.max(0, Math.min(100, Math.round(a / b * 100))) : 0;
export const nid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const imieNazwisko = n => { const p = String(n).trim().split(/\s+/); if (p.length < 2) return n; const imie = p.pop(); return imie + ' ' + p.join(' '); };

export function dzisISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function sumaTypu(raty, typ) {
  return (raty[typ] || []).reduce((a, r) => a + r.kwota, 0);
}

/** Stan rat uczestnika na dzień D. Wpłaty liczone wszystkie (pieniądze są na koncie), termin decyduje tylko o zaległości. */
export function rozlicz(u, wplaty, raty, D) {
  const lista = raty[u.typ] || [];
  const suma = sumaTypu(raty, u.typ);
  const wplacono = Math.round(wplaty.reduce((a, w) => a + w.kwota, 0) * 100) / 100;
  let cum = 0;
  const stanRat = lista.map(rt => {
    const od = cum; cum += rt.kwota;
    const pokryte = Math.min(Math.max(wplacono - od, 0), rt.kwota);
    const st = pokryte >= rt.kwota ? 'ok' : D > rt.termin ? 'zal' : pokryte > 0 ? 'czesc' : 'czeka';
    return {...rt, cum, pokryte, st};
  });
  const wymaganeNaDzis = stanRat.filter(x => D > x.termin).reduce((a, x) => a + x.kwota, 0);
  const zaleglosc = Math.max(0, wymaganeNaDzis - wplacono);
  const pozostalo = Math.max(0, suma - wplacono);
  const nadplata = Math.max(0, wplacono - suma);
  const nastepna = stanRat.find(x => x.pokryte < x.kwota) || null;
  const status = nadplata > 0 ? 'nadplata' : pozostalo === 0 ? 'oplacone' : zaleglosc > 0 ? 'zalegla' : 'terminowo';
  return {suma, wplacono, stanRat, zaleglosc, pozostalo, nadplata, nastepna, status, wplaty};
}

/** Mapa id uczestnika -> rozliczenie. */
export function przelicz(stan, D) {
  const mapa = new Map();
  for (const w of stan.wplaty) { if (!mapa.has(w.uid)) mapa.set(w.uid, []); mapa.get(w.uid).push(w); }
  const R = new Map();
  for (const u of stan.uczestnicy) {
    const lw = (mapa.get(u.id) || []).sort((a, b) => a.data.localeCompare(b.data));
    R.set(u.id, rozlicz(u, lw, stan.ustawienia.raty, D));
  }
  return R;
}

export function sumy(lista, R) {
  const s = {osob: lista.length, par: 0, wymagane: 0, wplacono: 0, zaleglosc: 0, zaleglych: 0, oplaconych: 0};
  for (const u of lista) {
    const r = R.get(u.id);
    if (u.typ === 'para') s.par++;
    s.wymagane += r.suma; s.wplacono += r.wplacono;
    s.zaleglosc += r.zaleglosc; if (r.zaleglosc > 0) s.zaleglych++;
    if (r.pozostalo === 0) s.oplaconych++;
  }
  return s;
}

export function zaplaconoWydatek(e) {
  return e.platnosci.reduce((a, p) => a + p.kwota, 0);
}

export function wydatkiSumy(wydatki) {
  let umowy = 0, zaplacono = 0;
  for (const e of wydatki) { umowy += e.umowa; zaplacono += zaplaconoWydatek(e); }
  return {umowy, zaplacono, pozostalo: umowy - zaplacono};
}

export function znajdzKlase(klasy, v) {
  const s = norm(v).replace(/\s+/g, ' ').trim().replace(/^4\s*/, '');
  if (!s) return null;
  return klasy.find(k => norm(k.nazwa) === s || norm(k.pelna) === s || slug(k.nazwa) === slug(s)) || null;
}

/** Wklejone z Excela wiersze: nazwisko i imię, klasa, osoba/para, osoba towarzysząca. Tabulatory albo średniki. */
export function parsujImport(txt, klasy, uczestnicy) {
  const istniejace = new Set(uczestnicy.map(u => norm(u.nazwa).trim() + '|' + u.klasa));
  return String(txt).split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const c = (l.includes('\t') ? l.split('\t') : l.split(';')).map(x => x.trim());
    const [nazwa = '', kl = '', typTxt = '', partner = ''] = c;
    const k = znajdzKlase(klasy, kl);
    const typ = /para/i.test(typTxt) || partner ? 'para' : 'osoba';
    let blad = '';
    if (!nazwa) blad = 'brak nazwiska';
    else if (!k) blad = `nieznana klasa „${kl}”`;
    else if (istniejace.has(norm(nazwa).trim() + '|' + k.nazwa)) blad = 'już jest na liście';
    if (!blad) istniejace.add(norm(nazwa).trim() + '|' + k.nazwa);
    return {nazwa, klasa: k ? k.nazwa : '', typ, partner: typ === 'para' ? partner : '', blad};
  });
}

/**
 * Nakłada operację (taką samą, jaka idzie do API) na stan. Idempotentna - działa po ID,
 * więc ponowne nałożenie operacji, którą serwer już zna, niczego nie dubluje.
 */
export function zastosuj(stan, op) {
  const d = op.dane;
  const usun = (lista, id) => { const i = lista.findIndex(x => x.id === id); if (i >= 0) lista.splice(i, 1); };
  const upsert = (lista, obj) => { const i = lista.findIndex(x => x.id === obj.id); if (i >= 0) lista[i] = {...lista[i], ...obj}; else lista.push(obj); };
  switch (op.akcja) {
    case 'dodajWplate':
      if (!stan.wplaty.some(w => w.id === d.id)) stan.wplaty.push({id: d.id, uid: d.uid, data: d.data, kwota: d.kwota, uwagi: d.uwagi || ''});
      break;
    case 'usunWplate': usun(stan.wplaty, d.id); break;
    case 'zapiszUczestnika':
      upsert(stan.uczestnicy, {id: d.id, nazwa: d.nazwa, klasa: d.klasa, typ: d.typ, partner: d.typ === 'para' ? d.partner || '' : '', uwagi: d.uwagi || ''});
      break;
    case 'usunUczestnika': usun(stan.uczestnicy, d.id); break;
    case 'importujUczestnikow':
      d.lista.forEach(x => { if (!stan.uczestnicy.some(u => u.id === x.id)) stan.uczestnicy.push({id: x.id, nazwa: x.nazwa, klasa: x.klasa, typ: x.typ, partner: x.partner || '', uwagi: ''}); });
      break;
    case 'zapiszWydatek': {
      const e = stan.wydatki.find(x => x.id === d.id);
      if (e) Object.assign(e, {kat: d.kat, kontrahent: d.kontrahent || '', umowa: d.umowa});
      else stan.wydatki.push({id: d.id, kat: d.kat, kontrahent: d.kontrahent || '', umowa: d.umowa, platnosci: []});
      break;
    }
    case 'usunWydatek': usun(stan.wydatki, d.id); break;
    case 'dodajPlatnosc': {
      const e = stan.wydatki.find(x => x.id === d.eid);
      if (e && !e.platnosci.some(p => p.id === d.id)) e.platnosci.push({id: d.id, data: d.data, kwota: d.kwota, opis: d.opis || ''});
      break;
    }
    case 'usunPlatnosc': stan.wydatki.forEach(e => usun(e.platnosci, d.id)); break;
    case 'zapiszUstawienia': if ('goscie' in d) stan.ustawienia.goscie = d.goscie; break;
  }
  return stan;
}

/** Tekst listy zaległości do wysłania wychowawcy. */
export function zaleglosciTekst(k, lista, R, D) {
  return `Zaległości - ${k.pelna} (stan na ${dt(D)})\n` + lista.map((u, i) => {
    const r = R.get(u.id), x = r.stanRat.find(z => z.st === 'zal');
    return `${i + 1}. ${u.nazwa} - brak ${zl(r.zaleglosc)} (${RZ[x.nr - 1]} rata, termin ${dt(x.termin)})`;
  }).join('\n');
}

/** Link instalacyjny: ...#polacz=<ID wdrożenia>.<klucz>. Przyjmuje tylko adresy script.google.com. */
export function parsujLinkPolaczenia(tekst) {
  const m = String(tekst).match(/polacz=([A-Za-z0-9_-]{20,120})\.([a-f0-9]{64})/);
  return m ? {url: `https://script.google.com/macros/s/${m[1]}/exec`, klucz: m[2]} : null;
}
