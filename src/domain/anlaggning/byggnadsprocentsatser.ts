/**
 * Årliga avskrivningsprocentsatser för byggnader och markanläggningar.
 *
 * BFN K1 punkt 6.14: "Byggnader ska skrivas av med samma belopp som dras av
 * vid beskattningen." Skatteverket ger ut allmänna råd om procentsatserna per
 * byggnadstyp (senast SKV A 2005:5 m. uppdateringar, som BFN:s vägledning
 * hänvisar till i en fotnot till punkt 6.14). Den exakta nu gällande
 * versionen gick inte att hämta direkt från skatteverket.se när det här
 * skrevs - tabellen nedan kommer från RSV 2003:6, kontrollerad mot en
 * befintlig bokföring där en ekonomibyggnad skrivits av med exakt 4 % om
 * året, som denna tabell också ger. Om en byggnadstyp saknas här hellre än
 * att gissa - lägg till den med källa när den behövs.
 *
 * Markanläggningar (punkt 6.15, IL 20 kap.): 5 % för de flesta, 10 % för
 * täckdiken och skogsvägar, kontrollerat mot samma bokföring.
 */
export type Byggnadstyp =
  | 'ekonomibyggnad_ovrig'
  | 'ekonomibyggnad_vaxthus_silo_kylhus'
  | 'smahus'
  | 'hyreshus_parkeringshus_varuhus_hotell_restaurang'
  | 'hyreshus_kiosk'
  | 'hyreshus_ovrigt'
  | 'kraftverksbyggnad_varmekraft'
  | 'kraftverksbyggnad_vattenkraft'
  | 'kraftverksbyggnad_vindkraft'
  | 'industribyggnad'
  | 'industribyggnad_special'
  | 'specialbyggnad';

export const BYGGNADSPROCENT: Readonly<Record<Byggnadstyp, number>> = {
  ekonomibyggnad_ovrig: 4,
  ekonomibyggnad_vaxthus_silo_kylhus: 5,
  smahus: 2,
  hyreshus_parkeringshus_varuhus_hotell_restaurang: 3,
  hyreshus_kiosk: 5,
  hyreshus_ovrigt: 2,
  kraftverksbyggnad_varmekraft: 4,
  kraftverksbyggnad_vattenkraft: 2,
  kraftverksbyggnad_vindkraft: 5,
  industribyggnad: 4,
  industribyggnad_special: 5,
  specialbyggnad: 3,
};

export const BYGGNADSTYP_NAMN: Readonly<Record<Byggnadstyp, string>> = {
  ekonomibyggnad_ovrig: 'Ekonomibyggnad, övrig',
  ekonomibyggnad_vaxthus_silo_kylhus: 'Ekonomibyggnad: växthus, silo eller kylhus',
  smahus: 'Småhus',
  hyreshus_parkeringshus_varuhus_hotell_restaurang:
    'Hyreshus: parkeringshus, varuhus, hotell- eller restaurangbyggnad',
  hyreshus_kiosk: 'Hyreshus: kiosk',
  hyreshus_ovrigt: 'Hyreshus, övrigt',
  kraftverksbyggnad_varmekraft: 'Kraftverksbyggnad: värmekraft',
  kraftverksbyggnad_vattenkraft: 'Kraftverksbyggnad: vattenkraft',
  kraftverksbyggnad_vindkraft: 'Kraftverksbyggnad: vindkraft',
  industribyggnad: 'Industribyggnad',
  industribyggnad_special:
    'Industribyggnad, speciell (t.ex. bensinstation, mejeri, sågverk)',
  specialbyggnad: 'Specialbyggnad',
};

export type Markanlaggningstyp = 'tackdike_skogsvag' | 'ovrig';

export const MARKANLAGGNINGSPROCENT: Readonly<Record<Markanlaggningstyp, number>> = {
  tackdike_skogsvag: 10,
  ovrig: 5,
};

export const MARKANLAGGNINGSTYP_NAMN: Readonly<Record<Markanlaggningstyp, string>> = {
  tackdike_skogsvag: 'Täckdike eller skogsväg',
  ovrig: 'Övrig markanläggning',
};
