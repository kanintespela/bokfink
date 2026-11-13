import { useState } from 'react';

import { formatKronor } from '../../domain/belopp/ore';
import { kontonummer, type Konto, type Kontonummer } from '../../domain/konto/konto';
import {
  fordelaRepresentation,
  REPRESENTATIONSTYP,
  type Representationstyp,
} from '../../domain/representation/representation';
import { pc8Varning } from '../../domain/sie/pc8';
import { datum, type Datum } from '../../domain/tid/datum';
import { Tillbaka } from '../../ui/Tillbaka';
import { Beloppsfalt, tolkaBelopp } from './Beloppsfalt';
import type { Friforslag } from './FriKontering';

interface Props {
  readonly idag: Datum;
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly onTillbaka: () => void;
  readonly onGranska: (forslag: Friforslag) => void;
}

/**
 * Representation: a meal, a coffee or a gift for a customer.
 *
 * Moms and income tax treat it differently - a lunch gives a moms deduction
 * but no income deduction at all - so the amount has to be divided, and the
 * division depends on how many were there. Skatteverket also wants to know who
 * took part and why, so those are asked for and kept in the verifikat's text.
 * Like the foreign purchases, this only makes a proposal: the rows are shown
 * and can be changed on the way to the booking (hard rule 10).
 */
export function Representation({ idag, konton, onTillbaka, onGranska }: Props) {
  const [typ, setTyp] = useState<Representationstyp>('maltid');
  const [belopp, setBelopp] = useState('');
  const [momsText, setMomsText] = useState('');
  const [antalText, setAntalText] = useState('');
  const [deltagare, setDeltagare] = useState('');
  const [syfte, setSyfte] = useState('');
  const [datumtext, setDatum] = useState<string>(idag);
  const [betal, setBetal] = useState('1930');
  const [bekraftat, setBekraftat] = useState(false);

  const enhet = REPRESENTATIONSTYP[typ].enhet;
  const arGava = typ === 'gava';

  let hinder: string | undefined;
  let forslag: Friforslag | undefined;
  let fordelning: ReturnType<typeof fordelaRepresentation> | undefined;
  try {
    const valtDatum = datum(datumtext);
    if (valtDatum > idag) throw new Error('Datumet har inte hänt än.');
    const brutto = tolkaBelopp(belopp);
    if (brutto === undefined || brutto === 0) throw new Error('Ange vad du betalade.');
    const moms = tolkaBelopp(momsText === '' ? '0' : momsText);
    if (moms === undefined) throw new Error('Ange momsen som står på kvittot.');
    const antal = Number(antalText);
    if (antalText.trim() === '' || !Number.isInteger(antal) || antal < 1) {
      throw new Error(
        arGava ? 'Ange hur många gåvor det är.' : 'Ange hur många som var med.',
      );
    }
    if (deltagare.trim() === '') {
      throw new Error(arGava ? 'Skriv vem som fick gåvan.' : 'Skriv vilka som var med.');
    }
    if (syfte.trim() === '') throw new Error('Skriv i vilket syfte du gjorde det.');

    fordelning = fordelaRepresentation({
      typ,
      brutto,
      moms,
      antal,
      betalkonto: kontonummer(betal),
    });
    const text =
      `${REPRESENTATIONSTYP[typ].namn.split(',')[0]}: ${deltagare.trim()}. ` +
      `Syfte: ${syfte.trim()} (${antal} ${enhet === 'gåvor' ? (antal === 1 ? 'gåva' : 'gåvor') : antal === 1 ? 'person' : 'personer'})`;
    const varning = pc8Varning(text);
    if (varning !== undefined) throw new Error(varning);
    const saknas = fordelning.konteringar.find((rad) => !konton.get(rad.konto)?.aktiv);
    if (saknas !== undefined) {
      throw new Error(
        `Konto ${saknas.konto} saknas eller är inaktivt. Kontrollera Kontoplan.`,
      );
    }
    forslag = {
      datum: valtDatum,
      beskrivning: text,
      konteringar: fordelning.konteringar,
    };
  } catch (orsak) {
    hinder = orsak instanceof Error ? orsak.message : String(orsak);
    fordelning = undefined;
  }

  return (
    <section aria-label="Representation">
      <Tillbaka onTillbaka={onTillbaka} />
      <h2>Representation</h2>
      <p>
        Mat, fika och gåvor till kunder och andra affärskontakter. Momsen och
        inkomstskatten räknas olika: en lunch ger avdrag för en del av momsen men inget
        avdrag alls vid beskattningen, medan en enkel fika och en liten gåva kan dras av
        helt. Appen delar upp beloppet åt dig.
      </p>
      <p className="hjalptext">
        Det här gäller en momsregistrerad firma. Skatteverket kräver att du skriver vilka
        som var med och varför. Det sparas i verifikatets text.
      </p>

      <div className="faltgrupp" role="group" aria-labelledby="repr-typ">
        <span id="repr-typ">Vad gäller det?</span>
        <div className="segment">
          {(Object.keys(REPRESENTATIONSTYP) as Representationstyp[]).map((kandidat) => (
            <button
              key={kandidat}
              type="button"
              aria-pressed={typ === kandidat}
              onClick={() => setTyp(kandidat)}
            >
              {REPRESENTATIONSTYP[kandidat].namn}
            </button>
          ))}
        </div>
        <p className="hjalptext">
          {typ === 'maltid' &&
            'Frukost, lunch och middag ger inget avdrag vid beskattningen, men en del av momsen får dras av.'}
          {typ === 'enklare' &&
            'Kaffe, te, bulle, frukt eller en enkel smörgås. Avdrag vid beskattningen får du bara om det kostar högst 60 kr per person utan moms. Kostar det mer får du inget avdrag alls.'}
          {typ === 'gava' &&
            'En gåva som har direkt med verksamheten att göra, till exempel blommor till en kunds jubileum. Avdrag för högst 300 kr utan moms per gåva.'}
        </p>
      </div>

      <Beloppsfalt etikett="Betalat, med moms" varde={belopp} onChange={setBelopp} />
      <Beloppsfalt
        etikett="Varav moms enligt kvittot"
        varde={momsText}
        onChange={setMomsText}
      />

      <div className="faltgrupp">
        <label htmlFor="repr-antal">{arGava ? 'Antal gåvor' : 'Antal personer'}</label>
        <input
          id="repr-antal"
          className="falt"
          inputMode="numeric"
          autoComplete="off"
          value={antalText}
          onChange={(e) => setAntalText(e.target.value)}
        />
        {!arGava && (
          <p className="hjalptext">Räkna med dig själv och alla som var med.</p>
        )}
      </div>

      <div className="faltgrupp">
        <label htmlFor="repr-deltagare">
          {arGava ? 'Vem fick gåvan?' : 'Vilka var med?'}
        </label>
        <input
          id="repr-deltagare"
          className="falt"
          autoComplete="off"
          value={deltagare}
          onChange={(e) => setDeltagare(e.target.value)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="repr-syfte">Varför? Vad var syftet?</label>
        <input
          id="repr-syfte"
          className="falt"
          autoComplete="off"
          placeholder="Till exempel genomgång av offert"
          value={syfte}
          onChange={(e) => setSyfte(e.target.value)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="repr-datum">Datum</label>
        <input
          id="repr-datum"
          className="falt"
          type="date"
          value={datumtext}
          max={idag}
          onChange={(e) => setDatum(e.target.value)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="repr-betal">Betalat med</label>
        <select
          id="repr-betal"
          className="falt"
          value={betal}
          onChange={(e) => setBetal(e.target.value)}
        >
          <option value="1930">Företagskontot</option>
          <option value="2013">Egna pengar</option>
          <option value="1910">Kassan</option>
        </select>
      </div>

      <p>
        <label>
          <input
            type="checkbox"
            checked={bekraftat}
            onChange={(e) => setBekraftat(e.target.checked)}
          />{' '}
          Det här hade ett omedelbart samband med verksamheten: att skapa eller hålla
          kontakten med kunder eller andra affärskontakter.
        </label>
      </p>

      {fordelning !== undefined && forslag !== undefined && (
        <div className="kort" data-testid="representationsforslag">
          <p>
            Moms som får dras av:{' '}
            <strong>{formatKronor(fordelning.avdragsgillMoms)} kr</strong>. Kostnad som
            får dras av vid beskattningen:{' '}
            <strong>{formatKronor(fordelning.avdragsgillKostnad)} kr</strong>. Kostnad som
            inte får det:{' '}
            <strong>{formatKronor(fordelning.ejAvdragsgillKostnad)} kr</strong>.
          </p>
          <ul>
            {forslag.konteringar.map((rad) => (
              <li key={rad.konto}>
                {rad.konto} {konton.get(rad.konto)?.namn}: {formatKronor(rad.belopp)}
              </li>
            ))}
          </ul>
          {fordelning.ejAvdragsgillKostnad > 0 && (
            <p className="hjalptext">
              Kostnaden på 6072 ska läggas tillbaka i deklarationen, på NE-bilagans sida 2
              under Bokförda kostnader som inte ska dras av.
            </p>
          )}
        </div>
      )}
      {hinder !== undefined && (
        <p className="hjalptext" data-testid="representationshinder">
          {hinder}
        </p>
      )}
      <button
        type="button"
        className="knapp knapp--primar"
        disabled={forslag === undefined || !bekraftat}
        data-testid="granska-representation"
        onClick={() => forslag !== undefined && onGranska(forslag)}
      >
        Granska konteringen
      </button>
    </section>
  );
}
