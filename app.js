// Interfejs aplikacji: widoki, okna, zdarzenia. Dane i synchronizacja - dane.js, rozliczenia - logika.js.
import * as L from './logika.js';
import {Magazyn} from './dane.js';
import {transportAppsScript, transportDemo} from './api.js';

const {esc, zl, dt, dtk, RZ, procent} = L;
const $ = s => document.querySelector(s);
const PARAM = new URLSearchParams(location.search);
const DEMO = PARAM.has('demo');
const DZIEN_DEMO = DEMO && /^\d{4}-\d{2}-\d{2}$/.test(PARAM.get('dzien') || '') ? PARAM.get('dzien') : null;
const PREF = DEMO ? 'stud-demo' + (DZIEN_DEMO ? ':' + DZIEN_DEMO : '') : 'stud';
const pamiec = (() => {
  try { localStorage.setItem('stud:test', '1'); localStorage.removeItem('stud:test'); return localStorage; } catch (e) {
    const m = new Map();
    return {getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k)};
  }
})();

let M = null, transport = null;
let S = null, R = null, K = [], D = L.dzisISO();
let filtrKlasy = 'wszyscy', importPodglad = null, oknoOtwarte = null, toastT = null, instalacja = null, ostatniaTrasa = '';

// ---------- połączenie z Arkuszem ----------
function wczytajPolaczenie() {
  if (DEMO) return {demo: true};
  const z = L.parsujLinkPolaczenia(location.hash);
  if (z) {
    try { pamiec.setItem('stud:polaczenie', JSON.stringify(z)); } catch (e) { /* tryb prywatny */ }
    history.replaceState(null, '', location.pathname + location.search + '#pulpit');
    return z;
  }
  try { return JSON.parse(pamiec.getItem('stud:polaczenie')); } catch (e) { return null; }
}

function ekranPolaczenia(blad) {
  document.body.innerHTML = `<div class="start"><form class="card form" data-form="polacz">
    <img src="ikony/ikona-192.png" alt="">
    <h1>Studniówka</h1>
    <p>Rozliczenie wpłat i wydatków studniówki. Żeby zacząć, otwórz link od Pawła albo wklej go poniżej.</p>
    <label for="link-polaczenia">Link do połączenia z Arkuszem<input id="link-polaczenia" autocomplete="off" placeholder="https://...#polacz=..."></label>
    ${blad ? `<p class="c-bad small">${esc(blad)}</p>` : ''}
    <button class="btn primary full">Połącz</button>
    <p class="small muted">Chcesz tylko obejrzeć? <a href="?demo#pulpit">Otwórz wersję demo</a> na zmyślonych danych.</p>
  </form></div><div class="toast" id="toast" role="status" hidden></div>`;
}

// ---------- pomocnicze ----------
const raty = () => S.ustawienia.raty;
const klasa = nazwa => K.find(k => k.nazwa === nazwa) || {nazwa, pelna: nazwa || 'bez klasy', id: L.slug(nazwa)};

function ostatnie() { try { return JSON.parse(pamiec.getItem(PREF + ':ostatnie')) || []; } catch (e) { return []; } }
function dodajOstatnia(id) { try { pamiec.setItem(PREF + ':ostatnie', JSON.stringify([id, ...ostatnie().filter(x => x !== id)].slice(0, 8))); } catch (e) { /* bez historii */ } }

function opisSt(x) { return {ok: 'opłacona', zal: `brak ${zl(x.kwota - x.pokryte)}`, czesc: `wpłacono ${zl(x.pokryte)}`, czeka: 'czeka'}[x.st]; }
function znaczniki(u) {
  const t = R.get(u.id).stanRat.map(x => `<span class="rc ${x.st === 'czeka' ? '' : x.st}" title="${RZ[x.nr - 1]} rata ${zl(x.kwota)} do ${dt(x.termin)}: ${opisSt(x)}">${RZ[x.nr - 1]}</span>`);
  while (t.length < 3) t.push('<span class="rc brak" aria-hidden="true"></span>');
  return `<span class="rc-row">${t.join('')}</span>`;
}
function pillStatus(u) {
  const r = R.get(u.id);
  if (r.status === 'oplacone') return '<span class="pill ok">Opłacone</span>';
  if (r.status === 'nadplata') return `<span class="pill info">Nadpłata ${zl(r.nadplata)}</span>`;
  if (r.status === 'zalegla') return `<span class="pill bad">Brak ${zl(r.zaleglosc)}</span>`;
  return r.nastepna ? `<span class="pill">${RZ[r.nastepna.nr - 1]} rata do ${dtk(r.nastepna.termin)}</span>` : '<span class="pill">-</span>';
}
function terminOpis(termin) {
  const d = L.dniMiedzy(D, termin);
  if (d > 1) return `za ${d} dni`; if (d === 1) return 'jutro'; if (d === 0) return 'dziś'; return 'po terminie';
}

/** Przerysowanie bez utraty tego, co Kasia właśnie wpisuje (dane mogą odświeżyć się w tle). */
function zachowajFormularze(el, fn) {
  const pola = [...el.querySelectorAll('input[id], textarea[id], select[id]')].map(p => [p.id, p.type === 'radio' || p.type === 'checkbox' ? p.checked : p.value, p.type]);
  const akt = document.activeElement && el.contains(document.activeElement) ? document.activeElement : null;
  let zazn = null;
  try { if (akt && typeof akt.selectionStart === 'number') zazn = [akt.selectionStart, akt.selectionEnd]; } catch (e) { /* pole bez zaznaczenia */ }
  const otwarte = [...el.querySelectorAll('details[id]')].filter(d => d.open).map(d => d.id);
  fn();
  pola.forEach(([id, v, typ]) => {
    const p = document.getElementById(id);
    if (!p || !el.contains(p)) return;
    if (typ === 'radio' || typ === 'checkbox') p.checked = v; else p.value = v;
  });
  otwarte.forEach(id => { const d = document.getElementById(id); if (d) d.open = true; });
  if (akt && akt.id) {
    const p = document.getElementById(akt.id);
    if (p) { p.focus(); if (zazn) try { p.setSelectionRange(zazn[0], zazn[1]); } catch (e) { /* typ pola */ } }
  }
}

// ---------- stan synchronizacji ----------
function statusHtml() {
  if (!M) return '';
  const n = M.oczekujace();
  const czas = M.synch ? new Date(M.synch).toLocaleTimeString('pl-PL', {hour: '2-digit', minute: '2-digit'}) : '';
  const [kl, txt] = {
    wysylam: ['wysylam', `Zapisuję${n > 1 ? ` (${n})` : ''}...`],
    offline: ['offline', n ? `Brak internetu · ${n} czeka` : 'Brak internetu'],
    klucz: ['klucz', 'Brak dostępu do Arkusza'],
    ok: ['ok', czas ? `Zapisane · ${czas}` : 'Zapisane'],
    nieznane: ['wysylam', 'Łączę z Arkuszem...']
  }[M.polaczenie];
  return `<button class="sync ${kl}" data-akcja="idz" data-id="ustawienia" title="Stan połączenia z Arkuszem"><i></i>${esc(txt)}</button>${DEMO ? ' <span class="tag-demo">Demo</span>' : ''}`;
}
function pokazStatus() {
  const h = statusHtml();
  $('#status-d').innerHTML = h;
  $('#status-m').innerHTML = h;
}

// ---------- nawigacja ----------
const IKONY = {
  pulpit: '<path d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
  klasy: '<path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
  zal: '<path d="M12 3 2 20h20zM12 10v4m0 3v.5" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" fill="none"/>',
  wiecej: '<circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/>'
};
function nawigacja(widok, zal) {
  const odz = zal ? `<span class="badge">${zal}</span>` : '';
  const akt = w => (widok === w || (w === 'klasy' && widok === 'klasa')) ? ' class="on"' : '';
  $('#nav').innerHTML = [
    ['pulpit', 'Pulpit', ''], ['wplata', 'Szybka wpłata', ''], ['klasy', 'Klasy', ''], ['zaleglosci', 'Zaległości', odz],
    ['wydatki', 'Wydatki', ''], ['goscie', 'Lista gości', ''], ['ustawienia', 'Ustawienia', '']
  ].map(([h, t, b]) => `<a href="#${h}"${akt(h)}><span>${t}</span>${b}</a>`).join('');
  const ik = n => `<svg viewBox="0 0 24 24" aria-hidden="true">${IKONY[n]}</svg>`;
  const wiecejOn = ['wiecej', 'wydatki', 'goscie', 'ustawienia'].includes(widok) ? ' class="on"' : '';
  $('#tabbar').innerHTML = `
    <a href="#pulpit"${akt('pulpit')}>${ik('pulpit')}Pulpit</a>
    <a href="#klasy"${akt('klasy')}>${ik('klasy')}Klasy</a>
    <a href="#wplata"${akt('wplata')}><span class="plus">${ik('plus')}</span>Wpłata</a>
    <a href="#zaleglosci"${akt('zaleglosci')}>${ik('zal')}Zaległości${odz}</a>
    <a href="#wiecej"${wiecejOn}>${ik('wiecej')}Więcej</a>`;
}

// ---------- widoki ----------
function widokLadowanie() {
  if (M.polaczenie === 'klucz') return `<div class="card pusto"><b>Ten link nie ma już dostępu do Arkusza.</b><span>Poproś Pawła o nowy link i otwórz go na tym urządzeniu.</span></div>`;
  if (M.polaczenie === 'offline') return `<div class="card pusto"><b>Brak internetu.</b><span>Dane pojawią się, gdy telefon lub komputer połączy się z siecią.</span></div>`;
  return `<div class="card pusto"><b>Wczytuję dane z Arkusza...</b><span>Pierwsze wczytanie trwa kilka sekund.</span></div>`;
}

function banery() {
  const b = [];
  if (M.polaczenie === 'klucz') b.push(`<div class="baner bad"><span><b>Aplikacja straciła dostęp do Arkusza.</b> Zmiany zostaną na tym urządzeniu, dopóki nie otworzysz nowego linku od Pawła.</span></div>`);
  if (S.ostrzezenia && S.ostrzezenia.length) b.push(`<div class="baner bad"><span>W Arkuszu ${S.ostrzezenia.length === 1 ? 'jest 1 wiersz' : `są wiersze (${S.ostrzezenia.length})`} z błędem, pominięte w rozliczeniu.</span><a class="btn small" href="#ustawienia">Pokaż</a></div>`);
  if (instalacja && pamiec.getItem(PREF + ':bez-instalacji') !== '1') b.push(`<div class="baner"><span><b>Zainstaluj aplikację</b> - będzie ikona na pulpicie i działanie bez internetu.</span><span class="przyciski"><button class="btn small primary" data-akcja="instaluj" data-id="">Zainstaluj</button><button class="btn small" data-akcja="instaluj-nie" data-id="">Nie teraz</button></span></div>`);
  return b.join('');
}

function widokPulpit() {
  const s = L.sumy(S.uczestnicy, R), w = L.wydatkiSumy(S.wydatki);
  const saldo = s.wplacono - w.zaplacono;
  const typy = ['osoba', 'para'];
  const terminy = [...new Set(typy.flatMap(t => (raty()[t] || []).map(r => r.termin)))].sort();
  const najblizszy = terminy.find(t => t >= D);
  const rataNajbl = najblizszy ? typy.map(t => (raty()[t] || []).find(r => r.termin === najblizszy)).find(Boolean) : null;
  const ileRat = Math.max(0, ...typy.map(t => (raty()[t] || []).length));
  const kartyRat = Array.from({length: ileRat}, (_, i) => {
    const t = typy.filter(x => (raty()[x] || [])[i]);
    const kw = t.map(x => [x, raty()[x][i].kwota]);
    const termin = raty()[t[0]][i].termin;
    const opisKw = kw.length === 1 ? `tylko ${kw[0][0] === 'para' ? 'pary' : 'osoby'}: ${zl(kw[0][1])}` : kw[0][1] === kw[1][1] ? zl(kw[0][1]) : `osoba ${zl(kw[0][1])}, para ${zl(kw[1][1])}`;
    const dotyczy = S.uczestnicy.filter(u => (raty()[u.typ] || [])[i]);
    let opl = 0, brak = 0, zalOs = 0;
    for (const u of dotyczy) {
      const x = R.get(u.id).stanRat[i];
      if (x.st === 'ok') opl++; brak += x.kwota - x.pokryte; if (x.st === 'zal') zalOs++;
    }
    const po = D > termin;
    return `<div class="card rata-card">
      <div class="top"><b>${RZ[i]} rata</b><span class="pill ${po ? (zalOs ? 'bad' : 'ok') : ''}">${terminOpis(termin)}</span></div>
      <div class="muted small">do ${dt(termin)} · ${opisKw}</div>
      <div class="bar ${dotyczy.length && opl === dotyczy.length ? 'ok' : ''}"><span style="width:${procent(opl, dotyczy.length)}%"></span></div>
      <div class="small">Opłaciło <b>${opl}</b> z ${dotyczy.length}</div>
      <div class="small ${po && brak ? 'c-bad' : 'muted'}">${po ? (zalOs ? `Zaległość: ${zl(brak)} u ${zalOs} os.` : 'Wszyscy opłacili') : `Do zebrania: ${zl(brak)}`}</div>
    </div>`;
  }).join('');
  const kafle = K.map(k => {
    const ks = L.sumy(S.uczestnicy.filter(u => u.klasa === k.nazwa), R);
    return `<a class="card klasa-tile" href="#klasa-${k.id}">
      <span class="nm">${esc(k.nazwa)}</span>
      <span class="row"><span>${ks.osob} os.${ks.par ? ` · ${ks.par} par` : ''}</span><b>${procent(ks.wplacono, ks.wymagane)}%</b></span>
      <span class="bar ${ks.osob && ks.oplaconych === ks.osob ? 'ok' : ''}"><span style="width:${procent(ks.wplacono, ks.wymagane)}%"></span></span>
      <span class="row">${ks.zaleglych ? `<span class="c-bad">${ks.zaleglych} z zaległością</span>` : '<span>bez zaległości</span>'}</span>
    </a>`;
  }).join('');
  const zapas = s.wymagane - w.umowy;
  const osTow = S.uczestnicy.filter(u => u.typ === 'para').length;
  const goscie = S.ustawienia.goscie || 0;
  return `${banery()}
  <div class="view-head"><div><span class="eyebrow">Stan na ${dt(D)}</span><h1>Pulpit</h1></div>
    <span class="przyciski"><button class="btn" data-akcja="drukuj" data-id="">Drukuj</button><a class="btn primary" href="#wplata">+ Dodaj wpłatę</a></span></div>
  ${!S.uczestnicy.length ? `<div class="baner"><span><b>Nie ma jeszcze uczestników.</b> Wklej listę z Excela w Ustawieniach albo dodaj osoby w widoku klasy.</span><a class="btn small" href="#ustawienia">Import listy</a></div>` : ''}
  <section class="card hero">
    <div class="hero-main">
      <span class="eyebrow">Zebrano od uczestników</span>
      <span class="big">${zl(s.wplacono)}</span>
      <span class="muted">z ${zl(s.wymagane)} wymaganych · ${procent(s.wplacono, s.wymagane)}%</span>
      <div class="bar"><span style="width:${procent(s.wplacono, s.wymagane)}%"></span></div>
      <span class="small muted">${s.oplaconych} z ${s.osob} uczestników opłaciło całość</span>
    </div>
    <dl class="hero-stats">
      <div><dt>Saldo konta</dt><dd>${zl(saldo)}</dd><small>wpłaty minus zapłacone wydatki (${zl(w.zaplacono)})</small></div>
      <div><dt>Zaległości</dt><dd class="${s.zaleglosc ? 'c-bad' : ''}">${zl(s.zaleglosc)}</dd><small>${s.zaleglych ? `${s.zaleglych} osób po terminie · <a href="#zaleglosci">lista</a>` : 'nikt nie zalega z ratą po terminie'}</small></div>
      <div><dt>Najbliższy termin</dt><dd>${najblizszy ? dtk(najblizszy) : '-'}</dd><small>${rataNajbl ? `${RZ[rataNajbl.nr - 1]} rata · ${terminOpis(najblizszy)}` : 'wszystkie terminy minęły'}</small></div>
    </dl>
  </section>
  <section class="sec"><div class="sec-head"><h2>Raty</h2></div><div class="raty-grid">${kartyRat}</div></section>
  <section class="sec"><div class="sec-head"><h2>Klasy</h2><a class="small" href="#klasy">tabela klas</a></div><div class="klasy-grid">${kafle}</div></section>
  <section class="two">
    <div class="card pad sec"><h2>Czy wystarczy pieniędzy?</h2>
      <div class="rows">
        <div><span>Wymagane wpłaty (wszyscy, całość)</span><span>${zl(s.wymagane)}</span></div>
        <div><span>Koszty z umów</span><span>${zl(w.umowy)}</span></div>
        <div><span>${zapas >= 0 ? 'Zapas' : 'Brakuje'}</span><span class="${zapas >= 0 ? 'c-ok' : 'c-bad'}">${zl(Math.abs(zapas))}</span></div>
      </div>
      ${s.osob ? `<p class="small muted">To ok. ${zl(Math.round(Math.abs(zapas) / s.osob))} na uczestnika ${zapas >= 0 ? 'do zwrotu lub na nieprzewidziane wydatki' : 'do dopłaty'}. Koszt nauczycieli i gości jest już w kwotach uczniów.</p>` : ''}
    </div>
    <div class="card pad sec"><h2>Liczba miejsc</h2>
      <div class="rows">
        <div><span>Uczniowie</span><span>${s.osob}</span></div>
        <div><span>Osoby towarzyszące</span><span>${osTow}</span></div>
        <div><span>Nauczyciele i goście</span><span>${goscie}</span></div>
        <div><span>Razem na sali</span><span>${s.osob + osTow + goscie}</span></div>
      </div>
      <p class="small muted">Liczbę nauczycieli i gości zmienisz w <a href="#ustawienia">Ustawieniach</a>.</p>
    </div>
  </section>`;
}

function widokKlasy() {
  const wiersze = K.map(k => {
    const s = L.sumy(S.uczestnicy.filter(u => u.klasa === k.nazwa), R);
    return `<tr data-akcja="idz" data-id="klasa-${k.id}" tabindex="0">
      <td><b>${esc(k.pelna)}</b></td><td class="num">${s.osob}</td><td class="num hide-m">${s.par}</td>
      <td class="num">${zl(s.wplacono)}</td><td class="num hide-m">${zl(s.wymagane)}</td>
      <td class="num">${procent(s.wplacono, s.wymagane)}%</td>
      <td class="num">${s.zaleglych ? `<span class="pill bad">${s.zaleglych}</span>` : '<span class="muted">0</span>'}</td></tr>`;
  }).join('');
  const s = L.sumy(S.uczestnicy, R);
  return `
  <div class="view-head"><div><span class="eyebrow">Stan na ${dt(D)}</span><h1>Klasy</h1></div>
    <button class="btn" data-akcja="drukuj" data-id="">Drukuj</button></div>
  <div class="tab-wrap"><table>
    <thead><tr><th>Klasa</th><th class="num">Osób</th><th class="num hide-m">Par</th><th class="num">Wpłacono</th><th class="num hide-m">Wymagane</th><th class="num">%</th><th class="num">Zaległ.</th></tr></thead>
    <tbody>${wiersze}</tbody>
    <tfoot><tr><td>Razem</td><td class="num">${s.osob}</td><td class="num hide-m">${s.par}</td><td class="num">${zl(s.wplacono)}</td><td class="num hide-m">${zl(s.wymagane)}</td><td class="num">${procent(s.wplacono, s.wymagane)}%</td><td class="num">${s.zaleglych}</td></tr></tfoot>
  </table></div>`;
}

function widokKlasa(id) {
  const k = K.find(x => x.id === id);
  if (!k) return `<div class="card pusto"><b>Nie ma takiej klasy.</b><a href="#klasy">Wróć do listy klas</a></div>`;
  const wszyscy = S.uczestnicy.filter(u => u.klasa === k.nazwa).sort(L.porownaj);
  const s = L.sumy(wszyscy, R);
  const grupy = {
    wszyscy: () => true,
    zalegla: u => R.get(u.id).status === 'zalegla',
    terminowo: u => R.get(u.id).status === 'terminowo',
    oplacone: u => ['oplacone', 'nadplata'].includes(R.get(u.id).status)
  };
  const lista = wszyscy.filter(grupy[filtrKlasy] || grupy.wszyscy);
  const ile = f => wszyscy.filter(grupy[f]).length;
  const filtry = [['wszyscy', 'Wszyscy'], ['zalegla', 'Zaległości'], ['terminowo', 'W terminie'], ['oplacone', 'Opłacone']]
    .map(([f, t]) => `<button data-akcja="filtr" data-id="${f}" class="${filtrKlasy === f ? 'on' : ''}" aria-pressed="${filtrKlasy === f}">${t} (${ile(f)})</button>`).join('');
  const wiersze = lista.map((u, i) => {
    const r = R.get(u.id);
    return `<tr data-akcja="osoba" data-id="${esc(u.id)}" tabindex="0">
      <td class="lp">${i + 1}</td>
      <td><b>${esc(u.nazwa)}</b>${u.typ === 'para' ? `<span class="sub">para z: ${esc(u.partner || 'brak nazwiska')}</span>` : ''}${u.uwagi ? `<span class="sub">${esc(u.uwagi)}</span>` : ''}</td>
      <td>${znaczniki(u)}</td>
      <td class="num hide-m">${zl(r.wplacono)}</td>
      <td class="num hide-m">${zl(r.pozostalo)}</td>
      <td>${pillStatus(u)}</td></tr>`;
  }).join('') || `<tr><td colspan="6"><div class="pusto">Brak osób w tym widoku.</div></td></tr>`;
  return `
  <div class="view-head"><div><a class="small nie-drukuj" href="#klasy">‹ Klasy</a><span class="eyebrow tylko-druk">Stan na ${dt(D)}${filtrKlasy !== 'wszyscy' ? ' · tylko: ' + {zalegla: 'zaległości', terminowo: 'w terminie', oplacone: 'opłacone'}[filtrKlasy] : ''}</span><h1>${esc(k.pelna)}</h1>
    <span class="muted">${s.osob} os. (${s.par} par) · wpłacono ${zl(s.wplacono)} z ${zl(s.wymagane)}${s.zaleglych ? ` · <span class="c-bad">zaległości ${zl(s.zaleglosc)}</span>` : ''}</span></div>
    <span class="przyciski"><button class="btn" data-akcja="drukuj" data-id="">Drukuj</button><button class="btn" data-akcja="nowa-osoba" data-id="${esc(k.nazwa)}">+ Dodaj osobę</button></span></div>
  <div class="filtry">${filtry}</div>
  <div class="tab-wrap"><table>
    <thead><tr><th>Lp.</th><th>Nazwisko i imię</th><th>Raty</th><th class="num hide-m">Wpłacono</th><th class="num hide-m">Pozostało</th><th>Status</th></tr></thead>
    <tbody>${wiersze}</tbody>
    ${lista.length ? `<tfoot><tr><td></td><td>Razem (${lista.length} os.)</td><td></td><td class="num hide-m">${zl(lista.reduce((a, u) => a + R.get(u.id).wplacono, 0))}</td><td class="num hide-m">${zl(lista.reduce((a, u) => a + R.get(u.id).pozostalo, 0))}</td><td></td></tr></tfoot>` : ''}
  </table></div>
  <p class="small muted"><span class="nie-drukuj">Kliknij osobę, żeby dodać wpłatę albo poprawić dane. </span>Znaczniki: <span class="rc-row"><span class="rc ok">I</span></span> opłacona, <span class="rc-row"><span class="rc czesc">I</span></span> częściowo, <span class="rc-row"><span class="rc zal">I</span></span> zaległa, <span class="rc-row"><span class="rc">I</span></span> czeka na termin.</p>`;
}

function widokWplata() {
  return `
  <div class="view-head"><div><span class="eyebrow">Przelew przyszedł na konto?</span><h1>Szybka wpłata</h1></div></div>
  <input class="szukaj" id="szukaj" type="search" placeholder="Wpisz nazwisko ucznia lub osoby towarzyszącej" autocomplete="off" aria-label="Szukaj uczestnika">
  <div class="card lista" id="wyniki">${wynikiHtml('')}</div>`;
}
function wynikiHtml(q) {
  const slowa = L.norm(q).split(/\s+/).filter(Boolean);
  if (!slowa.length) {
    const wg = new Map(S.wplaty.map(w => [w.id, w]));
    const lista = ostatnie().map(id => wg.get(id)).filter(Boolean).slice(0, 6);
    if (!lista.length) return `<div class="pusto"><b>Zacznij pisać nazwisko</b><span>Wystarczą 2-3 litery, bez polskich znaków też znajdzie.</span></div>`;
    return `<div class="pad" style="padding-bottom:6px"><span class="eyebrow">Ostatnio dodane na tym urządzeniu</span></div>` + lista.map(w => {
      const u = S.uczestnicy.find(x => x.id === w.uid); if (!u) return '';
      return `<button data-akcja="osoba" data-id="${esc(u.id)}"><span class="nm">${esc(u.nazwa)}</span><span class="sub">${esc(klasa(u.klasa).pelna)} · ${zl(w.kwota)} z ${dt(w.data)}</span>${pillStatus(u)}</button>`;
    }).join('');
  }
  const trafienia = S.uczestnicy.filter(u => { const t = L.norm(`${u.nazwa} ${u.partner} ${u.klasa}`); return slowa.every(s => t.includes(s)); }).sort(L.porownaj);
  if (!trafienia.length) return `<div class="pusto"><b>Nikogo nie znaleziono</b><span>Sprawdź pisownię albo dodaj osobę w widoku klasy.</span></div>`;
  return trafienia.slice(0, 30).map(u => `<button data-akcja="osoba" data-id="${esc(u.id)}">
      <span class="nm">${esc(u.nazwa)}</span>
      <span class="sub">${esc(klasa(u.klasa).pelna)} · ${u.typ === 'para' ? `para z: ${esc(u.partner)}` : 'osoba'} · wpłacono ${zl(R.get(u.id).wplacono)} z ${zl(R.get(u.id).suma)}</span>
      ${pillStatus(u)}</button>`).join('') + (trafienia.length > 30 ? `<div class="pusto small">i ${trafienia.length - 30} więcej, doprecyzuj wyszukiwanie</div>` : '');
}

function zaleglosciGrupy() {
  return K.map(k => ({k, lista: S.uczestnicy.filter(u => u.klasa === k.nazwa && R.get(u.id).zaleglosc > 0).sort(L.porownaj)})).filter(g => g.lista.length);
}
function widokZaleglosci() {
  const grupy = zaleglosciGrupy(), s = L.sumy(S.uczestnicy, R);
  const terminy = [...new Set(['osoba', 'para'].flatMap(t => (raty()[t] || []).map(r => r.termin)))].sort();
  if (!grupy.length) return `
  <div class="view-head"><div><span class="eyebrow">Stan na ${dt(D)}</span><h1>Zaległości</h1></div></div>
  <div class="card pusto"><b>Nikt nie zalega z ratą po terminie.</b>
    <span>${terminy.length && D <= terminy[0] ? `Pierwszy termin: ${dt(terminy[0])}. Lista pojawi się dzień po terminie.` : 'Wszystkie raty po terminie są opłacone.'}</span></div>`;
  return `
  <div class="view-head"><div><span class="eyebrow">Stan na ${dt(D)}</span><h1>Zaległości</h1>
    <span class="muted">${s.zaleglych} osób, razem <b class="c-bad">${zl(s.zaleglosc)}</b>. Listy do wysłania wychowawcom lub skarbnikom klas.</span></div>
    <span class="przyciski"><button class="btn" data-akcja="drukuj" data-id="">Drukuj (klasa na stronę)</button><button class="btn primary" data-akcja="kopiuj-zal" data-id="">Kopiuj wszystkie klasy</button></span></div>
  <div class="sec druk-strony">${grupy.map(({k, lista}) => `<section class="grupa">
    <span class="eyebrow tylko-druk">Zaległości we wpłatach na studniówkę · stan na ${dt(D)}</span>
    <div class="grupa-head"><h2>${esc(k.pelna)} <span class="muted small">· ${lista.length} os. · ${zl(lista.reduce((a, u) => a + R.get(u.id).zaleglosc, 0))}</span></h2>
      <span class="przyciski"><button class="btn small" data-akcja="drukuj" data-id="${esc(k.nazwa)}">Drukuj</button><button class="btn small" data-akcja="kopiuj-zal" data-id="${esc(k.nazwa)}">Kopiuj listę</button></span></div>
    <div class="tab-wrap"><table><tbody>${lista.map((u, i) => {
      const r = R.get(u.id), x = r.stanRat.find(z => z.st === 'zal');
      return `<tr data-akcja="osoba" data-id="${esc(u.id)}" tabindex="0"><td class="lp">${i + 1}</td><td><b>${esc(u.nazwa)}</b><span class="sub">${u.typ === 'para' ? 'para' : 'osoba'} · wpłacono ${zl(r.wplacono)}</span></td>
        <td>${znaczniki(u)}</td><td class="num"><b class="c-bad">${zl(r.zaleglosc)}</b><span class="sub">${RZ[x.nr - 1]} rata, ${dtk(x.termin)}</span></td></tr>`;
    }).join('')}</tbody></table></div></section>`).join('')}</div>`;
}

function widokWydatki() {
  const w = L.wydatkiSumy(S.wydatki);
  const wiersze = S.wydatki.map(e => {
    const zap = L.zaplaconoWydatek(e), poz = e.umowa - zap;
    const plat = e.platnosci.slice().sort((a, b) => a.data.localeCompare(b.data)).map(p => `${esc(p.opis || 'płatność')} ${dt(p.data)}: ${zl(p.kwota)}`).join(' · ');
    return `<tr data-akcja="wydatek" data-id="${esc(e.id)}" tabindex="0"><td><b>${esc(e.kat)}</b><span class="sub">${esc(e.kontrahent)}</span>${plat ? `<span class="sub tylko-druk">${plat}</span>` : ''}</td>
      <td class="num">${zl(e.umowa)}</td><td class="num">${zl(zap)}</td>
      <td class="num">${poz === 0 ? '<span class="pill ok">zapłacone</span>' : poz < 0 ? `<span class="pill info">nadpłata ${zl(-poz)}</span>` : zl(poz)}</td></tr>`;
  }).join('') || `<tr><td colspan="4"><div class="pusto">Nie ma jeszcze wydatków.</div></td></tr>`;
  return `
  <div class="view-head"><div><span class="eyebrow">Stan na ${dt(D)}</span><h1>Wydatki</h1>
    <span class="muted">Umowy ${zl(w.umowy)} · zapłacono ${zl(w.zaplacono)} · zostało ${zl(w.pozostalo)}</span></div>
    <span class="przyciski"><button class="btn" data-akcja="drukuj" data-id="">Drukuj</button><button class="btn" data-akcja="nowy-wydatek" data-id="">+ Dodaj wydatek</button></span></div>
  <div class="tab-wrap"><table>
    <thead><tr><th>Koszt</th><th class="num">Umowa</th><th class="num">Zapłacono</th><th class="num">Pozostało</th></tr></thead>
    <tbody>${wiersze}</tbody>
    <tfoot><tr><td>Razem</td><td class="num">${zl(w.umowy)}</td><td class="num">${zl(w.zaplacono)}</td><td class="num">${zl(w.pozostalo)}</td></tr></tfoot>
  </table></div>
  <p class="small muted nie-drukuj">Kliknij wydatek, żeby dodać zaliczkę, dopłatę lub zwrot albo poprawić kwotę z umowy.</p>`;
}

function goscieTekst() {
  return K.map(k => {
    const l = S.uczestnicy.filter(u => u.klasa === k.nazwa).sort(L.porownaj);
    if (!l.length) return '';
    return `${k.pelna}\n` + l.map(u => L.imieNazwisko(u.nazwa) + (u.typ === 'para' && u.partner ? `\n${L.imieNazwisko(u.partner)} (os. tow.)` : '')).join('\n');
  }).filter(Boolean).join('\n\n');
}
function widokGoscie() {
  const pary = S.uczestnicy.filter(u => u.typ === 'para').length, n = S.uczestnicy.length, g = S.ustawienia.goscie || 0;
  return `
  <div class="view-head"><div><span class="eyebrow tylko-druk">Stan na ${dt(D)}</span><h1>Lista gości</h1>
    <span class="muted">${n} uczniów + ${pary} os. towarzyszących + ${g} nauczycieli i gości = <b>${n + pary + g}</b> miejsc</span></div>
    <span class="przyciski"><button class="btn" data-akcja="drukuj" data-id="">Drukuj</button><button class="btn primary" data-akcja="kopiuj-goscie" data-id="">Kopiuj listę do winietek</button></span></div>
  <div class="klasy-grid lista-gosci">
  ${K.map(k => {
    const l = S.uczestnicy.filter(u => u.klasa === k.nazwa).sort(L.porownaj);
    return `<div class="card pad grupa"><h2>${esc(k.pelna)} <span class="muted small">· ${l.length + l.filter(u => u.typ === 'para').length} miejsc</span></h2>
      <div class="small">${l.map(u => `<div>${esc(L.imieNazwisko(u.nazwa))}${u.typ === 'para' ? ` <span class="muted">+ ${esc(u.partner ? L.imieNazwisko(u.partner) : 'osoba towarzysząca')}</span>` : ''}</div>`).join('') || '<span class="muted">brak osób</span>'}</div></div>`;
  }).join('')}</div>`;
}

function widokUstawienia() {
  const harm = ['osoba', 'para'].map(t => `<tr><td><b>${t === 'osoba' ? 'Osoba' : 'Para'}</b></td>${[0, 1, 2].map(i => {
    const r = (raty()[t] || [])[i]; return `<td class="num">${r ? `${zl(r.kwota)}<span class="sub">do ${dt(r.termin)}</span>` : '<span class="muted">-</span>'}</td>`;
  }).join('')}<td class="num"><b>${zl(L.sumaTypu(raty(), t))}</b></td></tr>`).join('');
  const n = M.oczekujace();
  const czas = M.synch ? new Date(M.synch).toLocaleString('pl-PL', {day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit'}) : 'jeszcze nie';
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  return `${M.polaczenie === 'klucz' ? banery() : ''}
  <div class="view-head"><div><h1>Ustawienia</h1></div></div>
  <section class="card pad sec"><h2>Połączenie z Arkuszem</h2>
    <div class="rows">
      <div><span>Stan</span><span>${statusHtml()}</span></div>
      <div><span>Ostatnia synchronizacja</span><span>${czas}</span></div>
      <div><span>Zmiany czekające na wysłanie</span><span>${n}</span></div>
    </div>
    <div class="przyciski">
      <button class="btn" data-akcja="odswiez" data-id="">Odśwież teraz</button>
      ${instalacja ? '<button class="btn" data-akcja="instaluj" data-id="">Zainstaluj aplikację</button>' : ''}
    </div>
    ${ios ? '<p class="small muted">iPhone: żeby dodać ikonę, w Safari stuknij Udostępnij, potem „Do ekranu początkowego”.</p>' : ''}
    <p class="small muted">Wszystko, co wpisujesz w aplikacji, zapisuje się w Arkuszu Google na Twoim Dysku. Zmiany rób tylko tutaj, w aplikacji - Arkusz jest kopią i ostrzeże przed ręczną edycją.</p>
  </section>
  ${S.ostrzezenia && S.ostrzezenia.length ? `<section class="card pad sec"><h2 class="c-bad">Błędne wiersze w Arkuszu</h2>
    <p class="small muted">Te wiersze są pominięte w rozliczeniu. Daj znać Pawłowi - poprawi je w Arkuszu, a aplikacja odświeży się sama.</p>
    <ul class="small">${S.ostrzezenia.map(o => `<li>${esc(o)}</li>`).join('')}</ul></section>` : ''}
  <section class="sec"><h2>Raty</h2>
    <div class="tab-wrap"><table><thead><tr><th>Typ</th><th class="num">I rata</th><th class="num">II rata</th><th class="num">III rata</th><th class="num">Razem</th></tr></thead><tbody>${harm}</tbody></table></div>
    <p class="small muted">Zmianę kwot lub terminów rat zgłoś Pawłowi.</p></section>
  <section class="sec"><h2>Klasy</h2><p>${K.map(k => esc(k.pelna)).join(', ')}</p><p class="small muted">Zmianę listy klas zgłoś Pawłowi.</p></section>
  <section class="card pad sec"><h2>Nauczyciele i goście</h2>
    <form class="form" data-form="goscie"><label for="ust-goscie">Liczba osób (tylko do liczby miejsc na sali, nie płacą)
      <input id="ust-goscie" type="number" min="0" step="1" value="${S.ustawienia.goscie || 0}" inputmode="numeric"></label>
      <div><button class="btn primary">Zapisz</button></div></form></section>
  <section class="card pad sec"><h2>Import uczestników</h2>
    <p class="small muted">Skopiuj kolumny z Excela i wklej poniżej. Kolejność: nazwisko i imię, klasa, osoba/para, opcjonalnie nazwisko osoby towarzyszącej (tylko para).</p>
    <form class="form" data-form="import">
      <label for="imp-tekst">Wklejone wiersze<textarea id="imp-tekst" placeholder="Nowak Anna&#9;B&#9;osoba"></textarea></label>
      <div class="przyciski"><button class="btn">Sprawdź</button></div>
    </form>
    <div id="imp-podglad">${importPodglad ? importPodgladHtml() : ''}</div>
  </section>
  <section class="card pad sec"><h2>To urządzenie</h2>
    ${DEMO
      ? `<p class="small muted">Tryb demo: dane są zmyślone i zapisują się tylko w tej przeglądarce.</p>
         <div><button class="btn danger" data-akcja="reset-demo" data-id="" data-potwierdz="Na pewno przywrócić?">Przywróć dane demo</button></div>`
      : `<p class="small muted">Odłączenie usuwa z tego urządzenia kopię danych i link do Arkusza. Dane w Arkuszu zostają.${n ? ` <b class="c-bad">Uwaga: ${n} zmian jeszcze nie wysłano - przepadną.</b>` : ''}</p>
         <div><button class="btn danger" data-akcja="odlacz" data-id="" data-potwierdz="Na pewno odłączyć?">Odłącz to urządzenie</button></div>`}
  </section>`;
}

function importPodgladHtml() {
  const ok = importPodglad.filter(x => !x.blad).length;
  return `<div class="tab-wrap"><table><thead><tr><th>Nazwisko i imię</th><th>Klasa</th><th>Typ</th><th>Uwagi</th></tr></thead><tbody>${importPodglad.map(x => `
    <tr><td>${esc(x.nazwa)}${x.partner ? `<span class="sub">+ ${esc(x.partner)}</span>` : ''}</td><td>${esc(x.klasa || '-')}</td><td>${x.typ}</td>
    <td>${x.blad ? `<span class="pill bad">${esc(x.blad)}</span>` : '<span class="pill ok">OK</span>'}</td></tr>`).join('')}</tbody></table></div>
    <div class="przyciski"><button class="btn primary" data-akcja="import-dodaj" data-id="" ${ok ? '' : 'disabled'}>Dodaj ${ok} os.</button>
    ${importPodglad.length - ok ? '<span class="small muted">Wiersze z błędem zostaną pominięte.</span>' : ''}</div>`;
}

function widokWiecej() {
  return `<div class="view-head"><div><h1>Więcej</h1></div></div>
  <div class="card wiecej"><a href="#wydatki">Wydatki <span class="muted">›</span></a><a href="#goscie">Lista gości i winietki <span class="muted">›</span></a><a href="#ustawienia">Ustawienia i połączenie <span class="muted">›</span></a></div>`;
}

// ---------- okna ----------
function pokaz(html) { $('#sheet').innerHTML = html; $('#modal').hidden = false; }
function zamknij() { $('#modal').hidden = true; oknoOtwarte = null; }
function odswiezOkno() {
  if (!oknoOtwarte || $('#modal').hidden) return;
  const [typ, id] = oknoOtwarte;
  zachowajFormularze($('#sheet'), () => { if (typ === 'osoba') oknoOsoba(id); else if (typ === 'wydatek') oknoWydatek(id); });
}

function oknoOsoba(id) {
  const u = S.uczestnicy.find(x => x.id === id);
  if (!u) return zamknij();
  const r = R.get(u.id), k = klasa(u.klasa);
  const opcje = [];
  if (r.nastepna) opcje.push([Math.round((r.nastepna.cum - r.wplacono) * 100) / 100, `${RZ[r.nastepna.nr - 1]} rata`]);
  if (r.pozostalo > 0 && !opcje.some(o => o[0] === r.pozostalo)) opcje.push([r.pozostalo, 'całość']);
  else if (opcje.length && opcje[0][0] === r.pozostalo) opcje[0][1] += ' = całość';
  pokaz(`
  <header class="sheet-head"><div><span class="eyebrow">${esc(k.pelna)} · ${u.typ === 'para' ? 'para' : 'osoba'}</span><h2 id="sheet-tytul">${esc(u.nazwa)}</h2>
    ${u.typ === 'para' ? `<span class="small muted">${u.partner ? 'osoba towarzysząca: ' + esc(u.partner) : 'z osobą towarzyszącą'}</span>` : ''}</div>
    <button class="x" data-akcja="zamknij" data-id="" aria-label="Zamknij">✕</button></header>
  <div class="sheet-body">
    <section>
      <div class="przyciski" style="justify-content:space-between"><span>Wpłacono <b>${zl(r.wplacono)}</b> z ${zl(r.suma)}</span>${pillStatus(u)}</div>
      <div class="raty-lista">${r.stanRat.map(x => `<div><span class="rc ${x.st === 'czeka' ? '' : x.st}">${RZ[x.nr - 1]}</span>
        <span>${zl(x.kwota)} <span class="muted small">do ${dt(x.termin)}</span></span>
        <span class="small ${x.st === 'zal' ? 'c-bad' : x.st === 'ok' ? 'c-ok' : 'muted'}">${opisSt(x)}</span></div>`).join('')}</div>
      ${u.uwagi ? `<p class="small muted">Uwagi: ${esc(u.uwagi)}</p>` : ''}
    </section>
    <section><h3>Nowa wpłata</h3>
      <form class="form" data-form="wplata" data-id="${esc(u.id)}">
        <div class="kwoty" role="radiogroup" aria-label="Kwota">
          ${opcje.map(([kw, opis], i) => `<label><input type="radio" name="kw" id="kw-${i}" value="${kw}" ${i === 0 ? 'checked' : ''}><span class="opt"><b>${zl(kw)}</b><small>${opis}</small></span></label>`).join('')}
          <label><input type="radio" name="kw" id="kw-inna-r" value="inna" ${opcje.length ? '' : 'checked'}><span class="opt"><input class="inna" id="kw-inna" inputmode="decimal" placeholder="inna kwota" aria-label="Inna kwota"><small>wpisz kwotę</small></span></label>
        </div>
        <div class="rzad">
          <label for="wp-data">Data przelewu<input type="date" id="wp-data" value="${D}" min="2025-01-01" max="2028-12-31" required></label>
          <label for="wp-uwagi">Uwagi<input id="wp-uwagi" placeholder="np. tytuł przelewu" maxlength="300"></label>
        </div>
        <button class="btn primary full">Zapisz wpłatę</button>
      </form>
    </section>
    <section><h3>Historia wpłat</h3>
      ${r.wplaty.length ? `<div class="hist">${r.wplaty.map(w => `<div><span class="small muted">${dt(w.data)}</span><span class="small muted">${esc(w.uwagi)}</span><b class="num">${zl(w.kwota)}</b>
        <button class="btn small danger" data-akcja="usun-wplate" data-id="${esc(w.id)}" data-potwierdz="Usunąć?" aria-label="Usuń wpłatę ${zl(w.kwota)} z ${dt(w.data)}">Usuń</button></div>`).join('')}</div>` : '<p class="small muted">Brak wpłat.</p>'}
    </section>
    <details id="dane-osoby"><summary>Dane uczestnika</summary>${formOsoby(u, u.klasa, r.wplaty.length)}</details>
  </div>`);
}
function formOsoby(u, kl, ileWplat = 0) {
  return `<form class="form" data-form="osoba" data-id="${u ? esc(u.id) : ''}">
    <label for="os-nazwa">Nazwisko i imię<input id="os-nazwa" value="${esc(u ? u.nazwa : '')}" maxlength="100" required></label>
    <div class="rzad">
      <label for="os-klasa">Klasa<select id="os-klasa">${K.map(k => `<option value="${esc(k.nazwa)}" ${k.nazwa === kl ? 'selected' : ''}>${esc(k.pelna)}</option>`).join('')}</select></label>
      <label for="os-typ">Typ<select id="os-typ"><option value="osoba">osoba (${zl(L.sumaTypu(raty(), 'osoba'))})</option><option value="para" ${u && u.typ === 'para' ? 'selected' : ''}>para (${zl(L.sumaTypu(raty(), 'para'))})</option></select></label>
    </div>
    <label for="os-partner">Osoba towarzysząca (tylko para, opcjonalnie)<input id="os-partner" value="${esc(u ? u.partner : '')}" maxlength="100"></label>
    <label for="os-uwagi">Uwagi<input id="os-uwagi" value="${esc(u ? u.uwagi : '')}" maxlength="300"></label>
    <div class="przyciski" style="justify-content:space-between"><button class="btn primary">${u ? 'Zapisz zmiany' : 'Dodaj osobę'}</button>
    ${u && !ileWplat ? `<button type="button" class="btn danger" data-akcja="usun-osobe" data-id="${esc(u.id)}" data-potwierdz="Na pewno usunąć?">Usuń osobę</button>` : ''}</div>
    ${u && ileWplat ? '<p class="small muted">Osobę z wpłatami można usunąć dopiero po usunięciu jej wpłat.</p>' : ''}
  </form>`;
}
function oknoNowaOsoba(kl) {
  pokaz(`<header class="sheet-head"><div><span class="eyebrow">${esc(klasa(kl).pelna)}</span><h2 id="sheet-tytul">Nowa osoba</h2></div>
    <button class="x" data-akcja="zamknij" data-id="" aria-label="Zamknij">✕</button></header>
    <div class="sheet-body">${formOsoby(null, kl)}</div>`);
}

function oknoWydatek(id) {
  const e = id ? S.wydatki.find(x => x.id === id) : null;
  if (id && !e) return zamknij();
  const plat = e ? e.platnosci.slice().sort((a, b) => a.data.localeCompare(b.data)) : [];
  const zap = e ? L.zaplaconoWydatek(e) : 0;
  const kategorie = S.ustawienia.kategorie || ['Inne'];
  pokaz(`<header class="sheet-head"><div><span class="eyebrow">Wydatek</span><h2 id="sheet-tytul">${e ? esc(e.kat) : 'Nowy wydatek'}</h2>
    ${e ? `<span class="small muted">umowa ${zl(e.umowa)} · zapłacono ${zl(zap)} · zostało ${zl(e.umowa - zap)}</span>` : ''}</div>
    <button class="x" data-akcja="zamknij" data-id="" aria-label="Zamknij">✕</button></header>
  <div class="sheet-body">
    ${e ? `<section><h3>Płatności</h3>
      ${plat.length ? `<div class="hist">${plat.map(p => `<div><span class="small muted">${dt(p.data)}</span><span class="small">${esc(p.opis)}</span><b class="num ${p.kwota < 0 ? 'c-ok' : ''}">${zl(p.kwota)}</b>
        <button class="btn small danger" data-akcja="usun-platnosc" data-id="${esc(p.id)}" data-potwierdz="Usunąć?">Usuń</button></div>`).join('')}</div>` : '<p class="small muted">Brak płatności.</p>'}
      <form class="form" data-form="platnosc" data-id="${esc(e.id)}">
        <div class="rzad">
          <label for="pl-rodzaj">Rodzaj<select id="pl-rodzaj"><option>Zaliczka</option><option>Dopłata</option><option>Całość</option><option value="Zwrot">Zwrot (pieniądze wracają)</option></select></label>
          <label for="pl-kwota">Kwota<input id="pl-kwota" inputmode="decimal" required placeholder="0"></label>
          <label for="pl-data">Data<input type="date" id="pl-data" value="${D}" min="2025-01-01" max="2028-12-31" required></label>
        </div>
        <button class="btn primary">Dodaj płatność</button>
      </form></section>` : ''}
    <${e ? 'details id="dane-wydatku"' : 'div'}>${e ? '<summary>Dane wydatku</summary>' : ''}
      <form class="form" data-form="wydatek" data-id="${e ? esc(e.id) : ''}">
        <div class="rzad">
          <label for="wy-kat">Kategoria<select id="wy-kat">${[...new Set([...kategorie, ...(e ? [e.kat] : [])])].map(k => `<option ${e && e.kat === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
          <label for="wy-umowa">Kwota z umowy<input id="wy-umowa" inputmode="decimal" value="${e ? e.umowa : ''}" required></label>
        </div>
        <label for="wy-kontr">Kontrahent / opis<input id="wy-kontr" value="${esc(e ? e.kontrahent : '')}" maxlength="150"></label>
        <div class="przyciski" style="justify-content:space-between"><button class="btn primary">${e ? 'Zapisz zmiany' : 'Dodaj wydatek'}</button>
        ${e && !plat.length ? `<button type="button" class="btn danger" data-akcja="usun-wydatek" data-id="${esc(e.id)}" data-potwierdz="Usunąć wydatek?">Usuń wydatek</button>` : ''}</div>
      </form>
    </${e ? 'details' : 'div'}>
  </div>`);
}

function oknoTekst(tytul, txt) {
  oknoOtwarte = null;
  pokaz(`<header class="sheet-head"><div><h2 id="sheet-tytul">${esc(tytul)}</h2><span class="small muted">Tekst jest zaznaczony, skopiuj go (Ctrl+C lub przytrzymaj palec).</span></div>
    <button class="x" data-akcja="zamknij" data-id="" aria-label="Zamknij">✕</button></header>
    <div class="sheet-body form"><textarea id="kopia" readonly style="min-height:300px">${esc(txt)}</textarea></div>`);
  const t = $('#kopia'); t.focus(); t.select();
}

function toast(msg, akcja) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>` + (akcja ? `<button data-akcja="${akcja.a}" data-id="${esc(akcja.id)}">${akcja.label}</button>` : '');
  t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 6000);
}
/** Drukuje bieżący widok; z grupą (zaległości jednej klasy) - tylko tę grupę. */
function drukuj(grupa) {
  if (grupa) { grupa.classList.add('druk-ten'); document.body.classList.add('druk-jeden'); }
  window.print();
}
window.addEventListener('beforeprint', () => {
  const t = new Date();
  $('#druk-info').textContent = `Studniówka 2026/2027 · wydruk z aplikacji ${dt(L.dzisISO(t))}, godz. ${t.toLocaleTimeString('pl-PL', {hour: '2-digit', minute: '2-digit'})}`;
});
window.addEventListener('afterprint', () => {
  document.body.classList.remove('druk-jeden');
  document.querySelectorAll('.druk-ten').forEach(g => g.classList.remove('druk-ten'));
});

function kopiuj(tytul, txt) {
  if (!navigator.clipboard) return oknoTekst(tytul, txt);
  navigator.clipboard.writeText(txt).then(() => toast('Skopiowano. Wklej w wiadomości lub w e-mailu.'), () => oknoTekst(tytul, txt));
}

// ---------- render ----------
function trasa() {
  const h = location.hash.slice(1) || 'pulpit';
  return h.startsWith('klasa-') ? ['klasa', h.slice(6)] : [h, null];
}
function render() {
  D = DZIEN_DEMO || L.dzisISO();
  S = M.widok();
  const [widok, arg] = trasa();
  pokazStatus();
  if (!S) { nawigacja(widok, 0); $('#widok').innerHTML = widokLadowanie(); ostatniaTrasa = ''; return; }
  K = S.ustawienia.klasy.map(k => ({...k, pelna: k.pelna || k.nazwa, id: L.slug(k.nazwa)}));
  R = L.przelicz(S, D);
  nawigacja(widok, L.sumy(S.uczestnicy, R).zaleglych);
  const V = {pulpit: widokPulpit, klasy: widokKlasy, wplata: widokWplata, zaleglosci: widokZaleglosci, wydatki: widokWydatki, goscie: widokGoscie, ustawienia: widokUstawienia, wiecej: widokWiecej};
  const el = $('#widok');
  const rysuj = () => { el.innerHTML = widok === 'klasa' ? widokKlasa(arg) : (V[widok] || widokPulpit)(); };
  const klucz = location.hash;
  if (klucz === ostatniaTrasa) zachowajFormularze(el, rysuj); else rysuj();
  ostatniaTrasa = klucz;
  if (widok === 'wplata') { const q = $('#szukaj').value; if (q) $('#wyniki').innerHTML = wynikiHtml(q); }
}

// ---------- zdarzenia ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-akcja]');
  if (!el) return;
  if (el.dataset.potwierdz && !el.dataset.uzbrojony) {
    el.dataset.uzbrojony = '1'; el.dataset.tekst = el.textContent; el.textContent = el.dataset.potwierdz;
    setTimeout(() => { if (el.isConnected) { delete el.dataset.uzbrojony; el.textContent = el.dataset.tekst; } }, 3500);
    return;
  }
  const id = el.dataset.id;
  switch (el.dataset.akcja) {
    case 'idz': location.hash = id; break;
    case 'osoba': oknoOtwarte = ['osoba', id]; oknoOsoba(id); break;
    case 'nowa-osoba': oknoOtwarte = null; oknoNowaOsoba(id); break;
    case 'wydatek': oknoOtwarte = ['wydatek', id]; oknoWydatek(id); break;
    case 'nowy-wydatek': oknoOtwarte = null; oknoWydatek(null); break;
    case 'zamknij': zamknij(); break;
    case 'filtr': filtrKlasy = id; render(); break;
    case 'usun-wplate': M.wykonaj('usunWplate', {id}); toast('Wpłata usunięta.'); break;
    case 'cofnij-wplate': M.wykonaj('usunWplate', {id}); $('#toast').hidden = true; break;
    case 'usun-osobe': zamknij(); M.wykonaj('usunUczestnika', {id}); toast('Osoba usunięta.'); break;
    case 'usun-platnosc': M.wykonaj('usunPlatnosc', {id}); break;
    case 'usun-wydatek': zamknij(); M.wykonaj('usunWydatek', {id}); break;
    case 'kopiuj-zal': {
      const g = zaleglosciGrupy().filter(x => !id || x.k.nazwa === id);
      kopiuj('Lista zaległości', g.map(x => L.zaleglosciTekst(x.k, x.lista, R, D)).join('\n\n'));
      break;
    }
    case 'kopiuj-goscie': kopiuj('Lista do winietek', goscieTekst()); break;
    case 'import-dodaj': {
      const lista = importPodglad.filter(x => !x.blad).map(x => ({id: L.nid('u'), nazwa: x.nazwa, klasa: x.klasa, typ: x.typ, partner: x.partner}));
      importPodglad = null; $('#imp-tekst').value = '';
      M.wykonaj('importujUczestnikow', {lista});
      toast(`Dodano ${lista.length} os.`);
      break;
    }
    case 'odswiez': M.odswiez().then(ok => { if (ok) toast('Dane odświeżone.'); }); break;
    case 'instaluj': if (instalacja) { instalacja.prompt(); instalacja.userChoice.finally(() => { instalacja = null; render(); }); } break;
    case 'instaluj-nie': try { pamiec.setItem(PREF + ':bez-instalacji', '1'); } catch (err) { /* bez zapamiętania */ } render(); break;
    case 'odlacz': ['stud:polaczenie', 'stud:dane', 'stud:ostatnie', 'stud:bez-instalacji'].forEach(k => pamiec.removeItem(k)); location.replace(location.pathname); break;
    case 'reset-demo': transport('resetDemo', {}).then(() => { pamiec.removeItem(PREF + ':dane'); pamiec.removeItem(PREF + ':ostatnie'); location.reload(); }); break;
    case 'drukuj': drukuj(id ? el.closest('.grupa') : null); break;
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#modal').hidden) zamknij();
  if (e.key === 'Enter' && e.target.matches('tr[data-akcja]')) e.target.click();
});
document.addEventListener('input', e => {
  if (e.target.id === 'szukaj') $('#wyniki').innerHTML = wynikiHtml(e.target.value);
  if (e.target.id === 'kw-inna') $('#kw-inna-r').checked = true;
});
document.addEventListener('focusin', e => { if (e.target.id === 'kw-inna') $('#kw-inna-r').checked = true; });
document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, id = f.dataset.id;
  const dataOk = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= '2025-01-01' && d <= '2028-12-31';
  switch (f.dataset.form) {
    case 'polacz': {
      const z = L.parsujLinkPolaczenia($('#link-polaczenia').value);
      if (!z) return ekranPolaczenia('To nie wygląda na link od Pawła. Powinien zawierać „#polacz=”.');
      try { pamiec.setItem('stud:polaczenie', JSON.stringify(z)); } catch (err) { /* tryb prywatny */ }
      location.replace(location.pathname + '#pulpit');
      location.reload();
      break;
    }
    case 'wplata': {
      const wyb = f.querySelector('input[name=kw]:checked');
      const kwota = wyb && wyb.value !== 'inna' ? Number(wyb.value) : L.kwotaZ($('#kw-inna').value);
      if (!(kwota > 0)) { toast('Wpisz kwotę większą od zera.'); $('#kw-inna').focus(); return; }
      const data = $('#wp-data').value;
      if (!dataOk(data)) { toast('Wybierz datę przelewu.'); return; }
      const u = S.uczestnicy.find(x => x.id === id);
      const w = {id: L.nid('w'), uid: id, data, kwota, uwagi: $('#wp-uwagi').value.trim()};
      zamknij();
      M.wykonaj('dodajWplate', w);
      dodajOstatnia(w.id);
      toast(`Zapisano ${zl(kwota)} · ${u.nazwa}`, {a: 'cofnij-wplate', id: w.id, label: 'Cofnij'});
      const s = $('#szukaj'); if (s) { s.value = ''; $('#wyniki').innerHTML = wynikiHtml(''); s.focus(); }
      break;
    }
    case 'osoba': {
      const dane = {nazwa: $('#os-nazwa').value.trim(), klasa: $('#os-klasa').value, typ: $('#os-typ').value, partner: $('#os-partner').value.trim(), uwagi: $('#os-uwagi').value.trim()};
      if (!dane.nazwa) return;
      if (dane.typ === 'osoba') dane.partner = '';
      if (id) { M.wykonaj('zapiszUczestnika', {id, ...dane}); toast('Zapisano zmiany.'); }
      else { const nowy = {id: L.nid('u'), ...dane}; oknoOtwarte = ['osoba', nowy.id]; M.wykonaj('zapiszUczestnika', nowy); oknoOsoba(nowy.id); toast('Dodano osobę.'); }
      break;
    }
    case 'platnosc': {
      let kwota = L.kwotaZ($('#pl-kwota').value);
      if (!(kwota > 0)) { toast('Wpisz kwotę większą od zera.'); return; }
      const data = $('#pl-data').value;
      if (!dataOk(data)) { toast('Wybierz datę płatności.'); return; }
      const rodzaj = $('#pl-rodzaj').value; if (rodzaj === 'Zwrot') kwota = -kwota;
      $('#pl-kwota').value = '';
      M.wykonaj('dodajPlatnosc', {id: L.nid('p'), eid: id, data, kwota, opis: rodzaj});
      toast('Dodano płatność.');
      break;
    }
    case 'wydatek': {
      const umowa = L.kwotaZ($('#wy-umowa').value);
      if (!(umowa >= 0)) { toast('Wpisz kwotę z umowy.'); return; }
      const dane = {kat: $('#wy-kat').value, kontrahent: $('#wy-kontr').value.trim(), umowa};
      if (id) { M.wykonaj('zapiszWydatek', {id, ...dane}); toast('Zapisano zmiany.'); }
      else { const nowy = {id: L.nid('e'), ...dane}; oknoOtwarte = ['wydatek', nowy.id]; M.wykonaj('zapiszWydatek', nowy); oknoWydatek(nowy.id); }
      break;
    }
    case 'goscie': {
      const g = parseInt($('#ust-goscie').value, 10);
      if (!(g >= 0 && g <= 2000)) { toast('Podaj liczbę od 0 do 2000.'); return; }
      M.wykonaj('zapiszUstawienia', {goscie: g}); toast('Zapisano.');
      break;
    }
    case 'import':
      importPodglad = L.parsujImport($('#imp-tekst').value, K, S.uczestnicy);
      $('#imp-podglad').innerHTML = importPodglad.length ? importPodgladHtml() : '<p class="small muted">Nic nie wklejono.</p>';
      break;
  }
});
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) zamknij(); });
window.addEventListener('hashchange', () => {
  if (L.parsujLinkPolaczenia(location.hash)) { location.reload(); return; }
  filtrKlasy = 'wszyscy'; zamknij(); render(); window.scrollTo(0, 0);
  if (location.hash === '#wplata' && matchMedia('(min-width:900px)').matches) $('#szukaj')?.focus();
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); instalacja = e; if (M) render(); });

// ---------- start ----------
function start() {
  const p = wczytajPolaczenie();
  if (!p) return ekranPolaczenia();
  transport = DEMO ? transportDemo(pamiec, {prefiks: PREF, dzien: DZIEN_DEMO}) : transportAppsScript(p.url, p.klucz);
  M = new Magazyn({transport, pamiec, prefiks: PREF});
  M.wczytaj();
  M.nasluchuj(({typ, blad}) => {
    if (typ === 'blad') toast('Nie zapisano: ' + blad);
    else if (typ === 'zmiana') { render(); odswiezOkno(); }
    else { pokazStatus(); if (!S) render(); }
  });
  render();
  M.odswiez();
  M.wysylaj();
  setInterval(() => { if (document.visibilityState === 'visible') M.sprawdz(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') M.sprawdz(); });
  window.addEventListener('online', () => { M.wysylaj(); M.sprawdz(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* bez trybu offline */ });
}
start();
