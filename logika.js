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

// ---------- import wyciągu z banku (Millennium, CSV) ----------

/** CSV z cudzysłowami ("" w środku pola, nowe linie w polu). Separator wykrywany z pierwszej linii: ; , albo tabulator. */
export function parsujCSV(tekst) {
  const t = String(tekst).replace(/^﻿/, '');
  const pierwsza = t.slice(0, t.search(/\r?\n/) >>> 0 || t.length);
  const ile = z => pierwsza.split(z).length;
  const sep = [';', '\t', ','].sort((a, b) => ile(b) - ile(a))[0];
  const wiersze = [];
  let wiersz = [], pole = '', cudz = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (cudz) {
      if (c === '"' && t[i + 1] === '"') { pole += '"'; i++; } else if (c === '"') cudz = false; else pole += c;
    } else if (c === '"') cudz = true;
    else if (c === sep) { wiersz.push(pole); pole = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      wiersz.push(pole); pole = '';
      if (wiersz.some(x => x.trim())) wiersze.push(wiersz);
      wiersz = [];
    } else pole += c;
  }
  wiersz.push(pole);
  if (wiersz.some(x => x.trim())) wiersze.push(wiersz);
  return wiersze.map(w => w.map(x => x.trim()));
}

/** Data z wyciągu: 2026-10-30, 30-10-2026, 30.10.2026, 30/10/2026 (także z godziną). */
export function dataZ(s) {
  const v = String(s ?? '').trim();
  let m = v.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

/** Kwota z wyciągu: "1 234,56", "1234.56", "-500,00", "+500,00 PLN". Puste = 0. */
export function kwotaWyciag(s) {
  let v = String(s ?? '').replace(/[\s ]|zł|PLN/gi, '');
  if (!v) return 0;
  if (v.includes(',') && v.includes('.')) v = v.lastIndexOf(',') > v.lastIndexOf('.') ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '');
  else v = v.replace(',', '.');
  const n = parseFloat(v);
  return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

/** Krótki, stały skrót tekstu (dwa FNV-1a 32-bit) - z niego ID wpłaty, więc ten sam przelew ma zawsze to samo ID. */
export function skrot(s) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ c, 2246822519) >>> 0;
  }
  return a.toString(36).padStart(7, '0') + b.toString(36).padStart(7, '0');
}

const KOLUMNY_WYCIAGU = {
  data: ['data transakcji', 'data operacji', 'data ksiegowania', 'data waluty', 'data rozliczenia', 'data'],
  kwota: ['kwota operacji', 'kwota transakcji', 'kwota'],
  uznania: ['uznania', 'uznanie', 'wplywy', 'wplyw', 'ma'],
  obciazenia: ['obciazenia', 'obciazenie', 'wydatki', 'wyplywy', 'winien'],
  nadawca: ['odbiorca/zleceniodawca', 'zleceniodawca/odbiorca', 'nadawca/odbiorca', 'odbiorca/nadawca', 'nadawca', 'zleceniodawca', 'kontrahent', 'nazwa kontrahenta', 'dane kontrahenta'],
  tytul: ['opis', 'tytul', 'tytul operacji', 'tytul przelewu', 'opis operacji', 'opis transakcji', 'szczegoly'],
  rachunek: ['na konto/z konta', 'z konta/na konto', 'rachunek kontrahenta', 'numer rachunku kontrahenta', 'konto kontrahenta']
};

/**
 * Wyciąg z banku -> lista wpływów {id, data, kwota, nadawca, tytul}. Kolumny szukane po nagłówkach,
 * więc zadziała także, jeśli bank zmieni kolejność. Obciążenia (wydatki) są pomijane i tylko liczone.
 */
export function parsujWyciag(tekst) {
  const wiersze = parsujCSV(tekst);
  const iNag = wiersze.findIndex(w => w.some(x => norm(x).startsWith('data')) && w.some(x => /kwota|uznani|obciazen|wplyw/.test(norm(x))));
  if (iNag < 0) return {blad: 'Nie rozpoznano pliku. Potrzebny jest plik CSV z historią transakcji z Millenetu (Moje finanse > Wyciąg z historii transakcji).', wplywy: []};
  const nag = wiersze[iNag].map(x => norm(x).replace(/\s+/g, ' ').trim());
  const kol = {};
  for (const [k, nazwy] of Object.entries(KOLUMNY_WYCIAGU)) {
    for (const n of nazwy) { const i = nag.indexOf(n); if (i >= 0) { kol[k] = i; break; } }
  }
  if (kol.data == null || (kol.kwota == null && kol.uznania == null)) return {blad: 'W pliku brakuje kolumny z datą albo kwotą. Prześlij plik Pawłowi - dopasuje import do tego formatu.', wplywy: []};
  const wplywy = [], wystapienia = new Map();
  let obciazen = 0, bledow = 0;
  for (const w of wiersze.slice(iNag + 1)) {
    const pole = k => kol[k] == null ? '' : (w[kol[k]] || '');
    const data = dataZ(pole('data'));
    const kwota = kol.uznania != null ? kwotaWyciag(pole('uznania')) || (kol.kwota != null ? kwotaWyciag(pole('kwota')) : 0) : kwotaWyciag(pole('kwota'));
    if (!data || isNaN(kwota)) { if (w.length > 2) bledow++; continue; }
    if (kwota <= 0) { if (kwota < 0 || kwotaWyciag(pole('obciazenia'))) obciazen++; continue; }
    const nadawca = pole('nadawca').replace(/\s+/g, ' '), tytul = pole('tytul').replace(/\s+/g, ' '), rachunek = pole('rachunek').replace(/\s/g, '');
    const podpis = [data, kwota.toFixed(2), norm(nadawca), norm(tytul), rachunek].join('|');
    const n = (wystapienia.get(podpis) || 0) + 1;
    wystapienia.set(podpis, n);
    wplywy.push({id: 'wb' + skrot(podpis + (n > 1 ? '|' + n : '')), data, kwota, nadawca, tytul});
  }
  return {wplywy, obciazen, bledow, blad: ''};
}

const slowa = s => norm(s).split(/[^a-z0-9]+/).filter(x => x.length >= 2);
/** Rdzeń słowa do porównań z odmianą: Kowalski -> kowalsk (Kowalskiego), Anna -> ann (Anny), Nowak -> nowa (Nowaka). */
const rdzen = w => w.slice(0, Math.max(3, w.length - 1));

/**
 * Dopasowanie wpływu do uczestnika po nazwisku i imieniu w tytule przelewu (albo w nadawcy - rodzic ma zwykle to samo nazwisko).
 * Punkty: 3 - imię i nazwisko w tytule, 2 - imię i nazwisko w tytule z nadawcą, 1 - tylko nazwisko; +0,5 za klasę w tytule (4B, kl. B).
 * Wynik: {uid, pewne, kandydaci} - pewne tylko, gdy jedna osoba ma najwyższy wynik co najmniej 2.
 */
export function dopasujWplyw(wplyw, uczestnicy) {
  const wTytule = slowa(wplyw.tytul), wSzystkie = [...wTytule, ...slowa(wplyw.nadawca)];
  const tytulN = ' ' + norm(wplyw.tytul).replace(/[^a-z0-9]+/g, ' ') + ' ';
  const klasaWTytule = kl => { const k = norm(kl); return k.length === 1 ? tytulN.includes(` 4${k} `) || tytulN.includes(` kl ${k} `) || tytulN.includes(` klasa ${k} `) || tytulN.includes(` ${k} `) && k !== 'i' : tytulN.includes(` ${k} `); };
  const jest = (lista, w) => lista.some(t => t === w || (w.length >= 3 && t.startsWith(rdzen(w)) && Math.abs(t.length - w.length) <= 3));
  const ocena = nazwa => {
    const s = slowa(nazwa);
    if (!s.length) return 0;
    const nazwisko = s[0];
    if (s.every(w => jest(wTytule, w))) return 3;
    if (s.every(w => jest(wSzystkie, w))) return 2;
    return nazwisko.length >= 3 && jest(wSzystkie, nazwisko) ? 1 : 0;
  };
  const wyniki = uczestnicy.map(u => ({u, p: Math.max(ocena(u.nazwa), u.partner ? ocena(u.partner) : 0)})).filter(x => x.p > 0)
    .map(x => ({u: x.u, p: x.p + (x.u.klasa && klasaWTytule(x.u.klasa) ? 0.5 : 0)})).sort((a, b) => b.p - a.p);
  if (!wyniki.length) return {uid: '', pewne: false, kandydaci: []};
  const naj = wyniki.filter(x => x.p === wyniki[0].p);
  const pewne = wyniki[0].p >= 2 && naj.length === 1;
  return {uid: naj.length === 1 ? naj[0].u.id : '', pewne, kandydaci: wyniki.slice(0, 6).map(x => x.u.id)};
}

/** Czy wpłata tego uczestnika wpisana ręcznie wygląda na ten sam przelew (ta sama kwota, data +-5 dni). */
export function mozliwyDuplikat(wplyw, uid, wplaty) {
  return wplaty.some(w => w.uid === uid && !w.id.startsWith('wb') && Math.abs(w.kwota - wplyw.kwota) < 0.005 && Math.abs(dniMiedzy(w.data, wplyw.data)) <= 5);
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
    case 'importujWplaty':
      d.lista.forEach(x => { if (!stan.wplaty.some(w => w.id === x.id)) stan.wplaty.push({id: x.id, uid: x.uid, data: x.data, kwota: x.kwota, uwagi: x.uwagi || ''}); });
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
