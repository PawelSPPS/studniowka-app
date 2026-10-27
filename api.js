// Transporty dla Magazynu: prawdziwy backend Apps Script i tryb demo (dane fikcyjne w przeglądarce).
import {zastosuj, dzisISO} from './logika.js';
import {daneDemo} from './demo.js';

/** POST z text/plain - Apps Script nie obsługuje preflight CORS. Brak sieci lub nie-JSON = wyjątek (Magazyn ponowi). */
export function transportAppsScript(url, klucz, {limitMs = 30000} = {}) {
  return async (akcja, dane) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), limitMs);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({klucz, akcja, dane}),
        signal: ctrl.signal
      });
      const tekst = await r.text();
      try { return JSON.parse(tekst); } catch (e) { throw new Error(`Nieoczekiwana odpowiedź serwera (HTTP ${r.status})`); }
    } finally {
      clearTimeout(t);
    }
  };
}

/** Udaje backend: te same akcje i reguły usuwania, dane w pamięci przeglądarki. */
export function transportDemo(pamiec, {opoznienie = 700, prefiks = 'stud-demo', dzien = null} = {}) {
  const KLUCZ = prefiks + ':backend';
  const nowe = () => daneDemo(dzien || dzisISO());
  let stan = null;
  try { stan = JSON.parse(pamiec.getItem(KLUCZ)); } catch (e) { /* nowe dane */ }
  if (!stan) stan = nowe();
  let zmiana = Date.now();
  const zapisz = () => { try { pamiec.setItem(KLUCZ, JSON.stringify(stan)); } catch (e) { /* bez zapisu */ } };
  return async (akcja, dane) => {
    await new Promise(r => setTimeout(r, opoznienie));
    if (akcja === 'ping') return {ok: true, wynik: {zmiana: String(zmiana)}};
    if (akcja === 'stan') return {ok: true, wynik: {...JSON.parse(JSON.stringify(stan)), ostrzezenia: [], zmiana: String(zmiana)}};
    if (akcja === 'resetDemo') { stan = nowe(); zmiana = Date.now(); zapisz(); return {ok: true, wynik: {}}; }
    if (akcja === 'usunUczestnika' && stan.wplaty.some(w => w.uid === dane.id)) return {ok: false, blad: 'Ta osoba ma wpłaty. Najpierw usuń wpłaty, jeśli na pewno były błędne.'};
    if (akcja === 'usunWydatek' && (stan.wydatki.find(e => e.id === dane.id) || {platnosci: []}).platnosci.length) return {ok: false, blad: 'Ten wydatek ma płatności. Najpierw je usuń.'};
    zastosuj(stan, {akcja, dane});
    zmiana = Date.now();
    zapisz();
    return {ok: true, wynik: {}};
  };
}
