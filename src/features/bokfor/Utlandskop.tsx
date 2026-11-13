import { useState } from 'react';
import { formatKronor, kronorString } from '../../domain/belopp/ore';
import {
  kurs,
  kursText,
  tillRedovisningsvaluta,
  valutakod,
} from '../../domain/belopp/valuta';
import { kontonummer, type Konto, type Kontonummer } from '../../domain/konto/konto';
import {
  UTLANDSKOP,
  utlandskopKonteringar,
  type Utlandskopstyp,
} from '../../domain/moms/utlandskop';
import { datum, type Datum } from '../../domain/tid/datum';
import { pc8Varning } from '../../domain/sie/pc8';
import { Tillbaka } from '../../ui/Tillbaka';
import { Beloppsfalt, tolkaBelopp } from './Beloppsfalt';
import type { Friforslag } from './FriKontering';

interface Props {
  readonly idag: Datum;
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly onTillbaka: () => void;
  readonly onGranska: (forslag: Friforslag) => void;
}

/** A deliberately scoped purchase proposal; final booking stays in FriKontering. */
export function Utlandskop({ idag, konton, onTillbaka, onGranska }: Props) {
  const [typ, setTyp] = useState<Utlandskopstyp | ''>('');
  const [beskrivning, setBeskrivning] = useState('');
  const [datumtext, setDatum] = useState<string>(idag);
  const [belopp, setBelopp] = useState('');
  const [valuta, setValuta] = useState('');
  const [kurstext, setKurs] = useState('');
  const [iValuta, setIValuta] = useState(false);
  const [betal, setBetal] = useState('1930');
  const [bekraftat, setBekraftat] = useState(false);
  // A construction service bought in Sweden is in kronor.
  const valutaAktiv = iValuta && typ !== 'bygg-sverige';
  let hinder: string | undefined;
  let forslag: Friforslag | undefined;
  try {
    const valtDatum = datum(datumtext);
    if (valtDatum > idag) throw new Error('Datumet har inte hänt än.');
    const last = tolkaBelopp(belopp);
    if (last === undefined || last === 0)
      throw new Error('Ange ett belopp skilt från noll.');
    let underlag = last;
    let valutaText = '';
    if (valutaAktiv) {
      const kod = valutakod(valuta);
      const kursen = kurs(kurstext);
      underlag = tillRedovisningsvaluta(last, kursen);
      valutaText = `, ${kronorString(last).replace('.', ',')} ${kod}, kurs ${kursText(kursen)}`;
    }
    if (typ === '') throw new Error('Välj vad du köpt.');
    if (beskrivning.trim() === '') throw new Error('Skriv vad inköpet avser.');
    const text = `${beskrivning.trim()} (${UTLANDSKOP[typ].namn}${valutaText})`;
    const varning = pc8Varning(text);
    if (varning !== undefined) throw new Error(varning);
    const konteringar = utlandskopKonteringar(typ, underlag, kontonummer(betal));
    const saknas = konteringar.find((rad) => !konton.get(rad.konto)?.aktiv);
    if (saknas !== undefined)
      throw new Error(
        `Konto ${saknas.konto} saknas eller är inaktivt. Kontrollera Kontoplan.`,
      );
    forslag = { datum: valtDatum, beskrivning: text, konteringar };
  } catch (orsak) {
    hinder = orsak instanceof Error ? orsak.message : String(orsak);
  }
  return (
    <section aria-label="Köp med omvänd moms">
      <Tillbaka onTillbaka={onTillbaka} />
      <h2>Köp med omvänd moms</h2>
      <p>
        För betalda inköp där fakturan är utan moms och momsen i stället redovisas av dig
        som köpare: köp från utlandet, och byggtjänster från en underentreprenör i
        Sverige. Momsen är 25 % med full avdragsrätt. Den beräknas ovanpå inköpsbeloppet
        och bokförs både som utgående och ingående moms. Beloppet du betalat ändras inte.
      </p>
      <p className="hjalptext">
        Det här gäller inte till exempel hotell, persontransporter eller import av varor
        från länder utanför EU. Andra momssatser och begränsad avdragsrätt får konteras
        fritt.
      </p>
      <div className="faltgrupp">
        <label htmlFor="utlandstyp">Vad har du köpt?</label>
        <select
          id="utlandstyp"
          className="falt"
          value={typ}
          onChange={(e) => setTyp(e.target.value as Utlandskopstyp | '')}
        >
          <option value="">Välj inköpstyp</option>
          {(Object.keys(UTLANDSKOP) as Utlandskopstyp[]).map((key) => (
            <option key={key} value={key}>
              {UTLANDSKOP[key].namn}
            </option>
          ))}
        </select>
        {typ === 'bygg-sverige' && (
          <p className="hjalptext" data-testid="bygghjalp">
            Fakturan ska ha texten ”omvänd betalningsskyldighet” och inte visa någon moms.
            Det är säljaren som avgör om reglerna gäller. Har fakturan moms bokför du den
            som en vanlig Köpt tjänst i stället. Material som ingår i tjänsten räknas med.
            Det gäller bara arbete på fastighet.
          </p>
        )}
      </div>
      <div className="faltgrupp">
        <label htmlFor="utlandsbeskrivning">Vad avser det?</label>
        <input
          id="utlandsbeskrivning"
          className="falt"
          value={beskrivning}
          onChange={(e) => setBeskrivning(e.target.value)}
        />
      </div>
      <div className="faltgrupp">
        <label htmlFor="utlandsdatum">Datum</label>
        <input
          id="utlandsdatum"
          className="falt"
          type="date"
          value={datumtext}
          max={idag}
          onChange={(e) => setDatum(e.target.value)}
        />
      </div>
      <Beloppsfalt
        etikett={
          valutaAktiv ? 'Belopp i valutan, utan moms' : 'Belopp i kronor, utan moms'
        }
        varde={belopp}
        onChange={setBelopp}
      />
      {typ !== 'bygg-sverige' && (
        <p>
          <button
            type="button"
            className="knapp knapp--text"
            onClick={() => setIValuta(!iValuta)}
          >
            {iValuta ? 'Beloppet är i kronor' : 'Beloppet är i annan valuta'}
          </button>
        </p>
      )}
      {valutaAktiv && (
        <>
          <div className="faltgrupp">
            <label htmlFor="utlandsvaluta">Valuta</label>
            <input
              id="utlandsvaluta"
              className="falt"
              placeholder="EUR"
              value={valuta}
              onChange={(e) => setValuta(e.target.value)}
            />
          </div>
          <div className="faltgrupp">
            <label htmlFor="utlandskurs">Kurs, kronor per enhet</label>
            <input
              id="utlandskurs"
              className="falt"
              inputMode="decimal"
              value={kurstext}
              onChange={(e) => setKurs(e.target.value)}
            />
          </div>
        </>
      )}
      <div className="faltgrupp">
        <label htmlFor="utlandsbetal">Betalat med</label>
        <select
          id="utlandsbetal"
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
          {typ === 'bygg-sverige'
            ? 'Fakturan är utan moms och har texten omvänd betalningsskyldighet, och momsen dras av helt.'
            : 'Fakturan är utan moms och köpet omfattas av 25 % omvänd moms med full avdragsrätt.'}
        </label>
      </p>
      {forslag !== undefined && (
        <div className="kort" data-testid="utlandsforslag">
          <p>
            Betalat: {formatKronor(forslag.konteringar[0]!.belopp)} kr. Deklarationsruta{' '}
            {typ === '' ? '' : UTLANDSKOP[typ].ruta} samt ruta 30 och 48.
          </p>
          <ul>
            {forslag.konteringar.map((rad) => (
              <li key={rad.konto}>
                {rad.konto} {konton.get(rad.konto)?.namn}: {formatKronor(rad.belopp)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {hinder !== undefined && (
        <p className="hjalptext" data-testid="utlandshinder">
          {hinder}
        </p>
      )}
      <button
        type="button"
        className="knapp knapp--primar"
        disabled={forslag === undefined || !bekraftat}
        data-testid="granska-utland"
        onClick={() => forslag !== undefined && onGranska(forslag)}
      >
        Granska konteringen
      </button>
    </section>
  );
}
