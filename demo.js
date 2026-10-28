// Fikcyjne dane do trybu demo (?demo). Deterministyczne - ten sam seed daje te same osoby.
import {dodajDni, dniMiedzy} from './logika.js';

const RATY = {
  osoba: [{nr: 1, kwota: 500, termin: '2026-10-31'}, {nr: 2, kwota: 375, termin: '2026-11-30'}],
  para: [{nr: 1, kwota: 500, termin: '2026-10-31'}, {nr: 2, kwota: 400, termin: '2026-11-30'}, {nr: 3, kwota: 400, termin: '2027-01-12'}]
};
const KLASY = [...'ABCDEFGHI'].map(l => ({nazwa: l, pelna: 'Klasa ' + l})).concat([{nazwa: 'KSP', pelna: 'KSP'}, {nazwa: 'I Społeczna', pelna: 'I Społeczna'}]);
const ROZMIARY = [30, 28, 31, 27, 29, 26, 30, 24, 22, 25, 19];
const KATEGORIE = ['Hotel', 'Foto', 'DJ/Muzyka', 'Tancerze', 'Alkohol', 'Kwiaty', 'Ksero', 'Winietki', 'Zaproszenia', 'Prowizje bankowe', 'Inne'];
const IMIONA_K = ['Anna', 'Maria', 'Zuzanna', 'Julia', 'Zofia', 'Maja', 'Hanna', 'Lena', 'Aleksandra', 'Natalia', 'Wiktoria', 'Oliwia', 'Amelia', 'Alicja', 'Martyna', 'Karolina', 'Weronika', 'Gabriela', 'Emilia', 'Kinga', 'Paulina', 'Nikola', 'Magdalena', 'Joanna', 'Iga', 'Pola'];
const IMIONA_M = ['Jakub', 'Antoni', 'Jan', 'Szymon', 'Filip', 'Kacper', 'Mikołaj', 'Wojciech', 'Adam', 'Michał', 'Bartosz', 'Igor', 'Mateusz', 'Piotr', 'Tymon', 'Franciszek', 'Aleksander', 'Wiktor', 'Oskar', 'Dawid', 'Marcel', 'Kamil', 'Hubert', 'Patryk', 'Stanisław', 'Maksymilian'];
const NAZWISKA = ['Nowak', 'Kowalski', 'Wiśniewski', 'Wójcik', 'Kowalczyk', 'Kamiński', 'Lewandowski', 'Zieliński', 'Szymański', 'Woźniak', 'Dąbrowski', 'Kozłowski', 'Jankowski', 'Mazur', 'Wojciechowski', 'Kwiatkowski', 'Krawczyk', 'Kaczmarek', 'Piotrowski', 'Grabowski', 'Zając', 'Pawłowski', 'Michalski', 'Król', 'Wieczorek', 'Jabłoński', 'Wróbel', 'Nowakowski', 'Majewski', 'Olszewski', 'Stępień', 'Malinowski', 'Jaworski', 'Adamczyk', 'Dudek', 'Nowicki', 'Pawlak', 'Górski', 'Witkowski', 'Walczak', 'Sikora', 'Baran', 'Rutkowski', 'Michalak', 'Szewczyk', 'Ostrowski', 'Tomaszewski', 'Pietrzak', 'Zalewski', 'Wróblewski', 'Marciniak', 'Jasiński', 'Zawadzki', 'Bąk', 'Jakubowski', 'Sadowski', 'Duda', 'Włodarczyk', 'Wilk', 'Chmielewski'];

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/** Stan w kształcie odpowiedzi backendu (akcja stan). Wpłaty i płatności tylko do dnia `dzis`. */
export function daneDemo(dzis) {
  const r = mulberry32(20262027), pick = a => a[Math.floor(r() * a.length)];
  const forma = (n, k) => k ? n.replace(/ski$/, 'ska').replace(/cki$/, 'cka').replace(/dzki$/, 'dzka') : n;
  let licznik = 0;
  const id = p => p + 'demo' + (++licznik);
  const dzien = (od, doD) => dodajDni(od, Math.floor(r() * (dniMiedzy(od, doD) + 1)));
  const przed = (termin, maks, wyk) => dodajDni(termin, -Math.floor(maks * Math.pow(r(), wyk)));
  const uczestnicy = [], wplaty = [];
  KLASY.forEach((k, ki) => {
    const uzyte = new Set();
    for (let i = 0; i < ROZMIARY[ki]; i++) {
      let kob, nazwa;
      do { kob = r() < .55; nazwa = forma(pick(NAZWISKA), kob) + ' ' + pick(kob ? IMIONA_K : IMIONA_M); } while (uzyte.has(nazwa));
      uzyte.add(nazwa);
      const typ = r() < .16 ? 'para' : 'osoba';
      const partner = typ === 'para' ? forma(pick(NAZWISKA), !kob) + ' ' + pick(kob ? IMIONA_M : IMIONA_K) : '';
      const u = {id: id('u'), nazwa, klasa: k.nazwa, typ, partner, uwagi: ''};
      uczestnicy.push(u);
      const wp = (kwota, data) => wplaty.push({id: id('w'), uid: u.id, data, kwota, uwagi: ''});
      const raty = RATY[typ], suma = raty.reduce((a, x) => a + x.kwota, 0), x = r();
      if (x < .10) wp(suma, dzien('2026-09-21', '2026-10-31'));
      else if (x < .68) {
        wp(raty[0].kwota, przed('2026-10-31', 26, 4));
        if (typ === 'para' && r() < .2) wp(800, dzien('2026-11-05', '2026-11-30'));
        else { wp(raty[1].kwota, przed('2026-11-30', 28, 2)); if (typ === 'para') wp(raty[2].kwota, przed('2027-01-12', 40, 1)); }
      } else if (x < .86) {
        wp(raty[0].kwota, dzien('2026-11-02', '2026-11-24'));
        if (r() < .8) wp(raty[1].kwota, dzien('2026-12-01', '2026-12-22'));
        if (typ === 'para' && r() < .8) wp(raty[2].kwota, dzien('2027-01-13', '2027-01-28'));
      } else if (x < .94) {
        wp(300, dzien('2026-10-12', '2026-10-31'));
        wp(200, dzien('2026-11-04', '2026-11-20'));
        if (r() < .5) wp(raty[1].kwota, dzien('2026-12-01', '2026-12-14'));
      }
    }
  });
  uczestnicy[3].uwagi = 'Przelew od mamy, inne nazwisko w tytule';
  const wyd = (kat, kontrahent, umowa, plat) => ({id: id('e'), kat, kontrahent, umowa,
    platnosci: plat.filter(([data]) => data <= dzis).map(([data, kwota, opis]) => ({id: id('p'), data, kwota, opis}))});
  const wydatki = [
    wyd('Hotel', 'Hotel Pod Dębami (sala, kolacja, nocleg obsługi)', 245000, [['2026-10-23', 20000, 'Zaliczka'], ['2026-12-15', 120000, 'Dopłata'], ['2027-01-20', 105000, 'Dopłata']]),
    wyd('Foto', 'Studio Kadr - zdjęcia i film', 6500, [['2026-10-12', 1500, 'Zaliczka']]),
    wyd('DJ/Muzyka', 'DJ Rytm', 5500, [['2026-10-10', 1000, 'Zaliczka']]),
    wyd('Tancerze', 'Szkoła tańca Krok - nauka poloneza', 3200, [['2026-12-05', 3200, 'Całość']]),
    wyd('Alkohol', 'Hurtownia napojów - stół nauczycieli', 3800, []),
    wyd('Kwiaty', 'Kwiaciarnia - dekoracje stołów', 1800, []),
    wyd('Ksero', 'Punkt ksero przy szkole', 300, [['2026-11-18', 140, 'Plakaty i listy']]),
    wyd('Winietki', 'Drukarnia', 650, []),
    wyd('Zaproszenia', 'Drukarnia', 900, [['2026-11-20', 900, 'Całość']]),
    wyd('Prowizje bankowe', 'Bank - opłaty za konto', 120, ['2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31'].map(d => [d, 10, 'Opłata miesięczna']))
  ];
  return {
    uczestnicy, wplaty: wplaty.filter(w => w.data <= dzis), wydatki,
    ustawienia: {raty: RATY, klasy: KLASY, goscie: 80, kategorie: KATEGORIE},
    arkuszUrl: ''
  };
}
