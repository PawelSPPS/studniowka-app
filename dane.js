// Magazyn danych: ostatni stan z serwera + kolejka niewysłanych zmian, oba zapisane na urządzeniu.
// Interfejs widzi stan serwera z nałożoną kolejką, więc zapis jest widoczny od razu, a wysyłka idzie w tle.
import {zastosuj} from './logika.js';

const klon = o => JSON.parse(JSON.stringify(o));
const USUWANIE = new Set(['usunWplate', 'usunUczestnika', 'usunWydatek', 'usunPlatnosc']);

export class Magazyn {
  /**
   * transport(akcja, dane) -> Promise<{ok, wynik} | {ok:false, blad, kod?}>, rzuca wyjątek przy braku sieci.
   * pamiec - obiekt w stylu localStorage. planuj - setTimeout (podmieniany w testach).
   */
  constructor({transport, pamiec, prefiks = 'stud', planuj = (fn, ms) => setTimeout(fn, ms), teraz = () => Date.now()}) {
    Object.assign(this, {transport, pamiec, prefiks, planuj, teraz});
    this.serwer = null;
    this.kolejka = [];
    this.synch = 0;
    this.polaczenie = 'nieznane'; // ok | wysylam | offline | klucz
    this.sluchacze = new Set();
    this._widok = null;
    this.wysylanie = false;
    this.odswiezanie = null;
    this.wTrakcieOdswiezania = null;
    this.proba = 0;
    this.ponowienie = false;
  }

  wczytaj() {
    try {
      const s = JSON.parse(this.pamiec.getItem(this.prefiks + ':dane'));
      if (s) { this.serwer = s.serwer; this.kolejka = s.kolejka || []; this.synch = s.synch || 0; }
    } catch (e) { /* uszkodzona kopia - pobierzemy z serwera */ }
    this._widok = null;
  }

  zapisz() {
    try { this.pamiec.setItem(this.prefiks + ':dane', JSON.stringify({serwer: this.serwer, kolejka: this.kolejka, synch: this.synch})); } catch (e) { /* brak miejsca */ }
  }

  nasluchuj(fn) { this.sluchacze.add(fn); return () => this.sluchacze.delete(fn); }

  powiadom(typ, blad) {
    if (typ === 'zmiana') this._widok = null;
    this.sluchacze.forEach(f => f({typ, blad}));
  }

  ustawPolaczenie(p) {
    if (this.polaczenie === p) return;
    this.polaczenie = p;
    this.powiadom('polaczenie');
  }

  /** Stan do wyświetlenia: serwer + niewysłane zmiany. */
  widok() {
    if (!this.serwer) return null;
    if (!this._widok) this._widok = this.kolejka.reduce((s, op) => zastosuj(s, op), klon(this.serwer));
    return this._widok;
  }

  oczekujace() { return this.kolejka.length; }

  wykonaj(akcja, dane) {
    const op = {akcja, dane};
    this.kolejka.push(op);
    this.zapisz();
    this.powiadom('zmiana');
    this.wysylaj();
    return op;
  }

  async wyslij(akcja, dane) {
    try { return await this.transport(akcja, dane); } catch (e) { return {siec: true, blad: e.message}; }
  }

  /** Wysyła kolejkę po jednej operacji, w kolejności. Błąd sieci: ponowienie z rosnącym odstępem. */
  async wysylaj() {
    if (this.wysylanie || this.polaczenie === 'klucz' || !this.kolejka.length) return;
    this.wysylanie = true;
    let odswiezPo = false;
    try {
      while (this.kolejka.length) {
        const op = this.kolejka[0];
        this.ustawPolaczenie('wysylam');
        const r = await this.wyslij(op.akcja, op.dane);
        if (r.siec) { this.ustawPolaczenie('offline'); this.zaplanujPonowienie(); return; }
        if (r.kod === 401) { this.ustawPolaczenie('klucz'); return; }
        this.kolejka.shift();
        if (r.ok || (USUWANIE.has(op.akcja) && /Nie znaleziono/.test(r.blad || ''))) {
          if (this.serwer) zastosuj(this.serwer, op);
          if (this.wTrakcieOdswiezania) this.wTrakcieOdswiezania.push(op);
          if (op.akcja === 'importujUczestnikow' || op.akcja === 'importujWplaty') odswiezPo = true;
        } else {
          odswiezPo = true;
          this.powiadom('blad', r.blad);
        }
        this.proba = 0;
        this.synch = this.teraz();
        this.zapisz();
        this.powiadom('zmiana');
      }
      this.ustawPolaczenie('ok');
    } finally {
      this.wysylanie = false;
    }
    if (odswiezPo) this.odswiez();
  }

  zaplanujPonowienie() {
    if (this.ponowienie) return;
    this.ponowienie = true;
    const ms = Math.min(60000, 3000 * 2 ** this.proba++);
    this.planuj(() => {
      this.ponowienie = false;
      if (!this.serwer) this.odswiez();
      this.wysylaj();
    }, ms);
  }

  /** Pobiera pełny stan. Operacje potwierdzone w trakcie pobierania nakłada ponownie (odczyt mógł być sprzed nich). */
  odswiez() {
    if (this.odswiezanie) return this.odswiezanie;
    this.wTrakcieOdswiezania = [];
    this.odswiezanie = (async () => {
      const r = await this.wyslij('stan', {});
      try {
        if (r.siec) { this.ustawPolaczenie('offline'); this.zaplanujPonowienie(); return false; }
        if (r.kod === 401) { this.ustawPolaczenie('klucz'); return false; }
        if (!r.ok) { this.powiadom('blad', r.blad); return false; }
        this.serwer = r.wynik;
        this.wTrakcieOdswiezania.forEach(op => zastosuj(this.serwer, op));
        this.synch = this.teraz();
        if (!this.wysylanie) this.ustawPolaczenie('ok');
        this.zapisz();
        this.powiadom('zmiana');
        return true;
      } finally {
        this.wTrakcieOdswiezania = null;
        this.odswiezanie = null;
      }
    })();
    return this.odswiezanie;
  }

  /** Tanie sprawdzenie (ok. 1 s): pobiera pełny stan tylko, gdy w Arkuszu coś się zmieniło. */
  async sprawdz() {
    if (this.odswiezanie || this.wysylanie) return;
    const r = await this.wyslij('ping', {});
    if (r.siec) { this.ustawPolaczenie('offline'); return; }
    if (r.kod === 401) { this.ustawPolaczenie('klucz'); return; }
    if (r.ok && (!this.serwer || r.wynik.zmiana !== this.serwer.zmiana)) await this.odswiez();
    else if (r.ok) { this.synch = this.teraz(); if (!this.wysylanie) this.ustawPolaczenie('ok'); this.zapisz(); this.powiadom('polaczenie'); }
    if (this.kolejka.length) this.wysylaj();
  }
}
