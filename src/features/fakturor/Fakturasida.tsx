import { useState } from 'react';

import { formatKronor, type Ore } from '../../domain/belopp/ore';
import { BETALSATTSNAMN } from '../../domain/beslutstrad/beslutstrad';
import { kontonummer, type Kontonummer } from '../../domain/konto/konto';
import type { Redovisningsmetod } from '../../domain/moms/redovisningsmetod';
import type { Datum } from '../../domain/tid/datum';
import type { Faktura } from '../../domain/verifikat/reskontra';
import { beteckning } from '../../domain/verifikat/verifikat';
import { Tillbaka } from '../../ui/Tillbaka';
import { Uppgiftsstatus, useUppgift } from '../data/uppgift';
import { Beloppsfalt, tolkaBelopp } from '../bokfor/Beloppsfalt';

interface Props {
  readonly metod: Redovisningsmetod;
  readonly fakturor: readonly Faktura[];
  readonly idag: Datum;
  readonly onTillbaka: () => void;
  /** Books the payment; resolves with a sentence, rejects with the reason. */
  readonly onBetala: (
    fakturaId: Faktura['verifikat']['id'],
    uppgifter: {
      datum: Datum;
      belopp: Ore;
      betalkonto: Kontonummer;
    },
  ) => Promise<string>;
}

/** Where the money went, or came from: the same choices the booking form gives. */
const KUNDKONTON = [kontonummer('1930'), kontonummer('2013'), kontonummer('1910')];
const LEVERANTORSKONTON = [kontonummer('1930'), kontonummer('2017'), kontonummer('1910')];

/**
 * The invoices that are booked but not yet paid.
 *
 * There is no customer register behind it: an invoice is the verifikat from
 * the Bokför flow that holds a receivable or a payable, and a payment is a
 * second verifikat that points back at it. Only for faktureringsmetoden - with
 * the cash method an invoice is booked when it is paid, and nothing is left
 * open between.
 */
export function Fakturasida({ metod, fakturor, idag, onTillbaka, onBetala }: Props) {
  const { arbetar, besked, fel, kor } = useUppgift();
  const [oppen, setOppen] = useState<string | undefined>();
  const [belopp, setBelopp] = useState('');
  const [dag, setDag] = useState<string>(idag);
  const [konto, setKonto] = useState<Kontonummer | undefined>();

  const kund = fakturor.filter((f) => f.slag === 'kund');
  const leverantor = fakturor.filter((f) => f.slag === 'leverantor');

  function visa(faktura: Faktura) {
    setOppen(faktura.verifikat.id);
    setBelopp(formatKronor(faktura.kvar).replace(/\s/g, ''));
    setDag(idag);
    setKonto(undefined);
  }

  function rad(faktura: Faktura) {
    const id = faktura.verifikat.id;
    const val = faktura.slag === 'kund' ? KUNDKONTON : LEVERANTORSKONTON;
    const valt = konto ?? val[0]!;
    const summa = tolkaBelopp(belopp);

    return (
      <li key={id} data-testid={`faktura-${beteckning(faktura.verifikat)}`}>
        <div className="listrad">
          <span className="listrad__text">
            <span>
              {beteckning(faktura.verifikat)} · {faktura.verifikat.datum} ·{' '}
              {faktura.verifikat.beskrivning}
            </span>
            <span className="listrad__sekundar">
              {formatKronor(faktura.kvar)} kr kvar
              {faktura.betalt > 0 ? ` av ${formatKronor(faktura.belopp)} kr` : ''}
            </span>
          </span>
          {oppen !== id && (
            <button
              type="button"
              className="knapp knapp--text"
              data-testid={`betala-${beteckning(faktura.verifikat)}`}
              onClick={() => visa(faktura)}
            >
              Registrera betalning
            </button>
          )}
        </div>

        {oppen === id && (
          <div className="kort">
            <Beloppsfalt varde={belopp} onChange={setBelopp} etikett="Belopp" />
            <div className="faltgrupp">
              <label htmlFor={`betaldag-${id}`}>Datum</label>
              <input
                id={`betaldag-${id}`}
                className="falt"
                type="date"
                max={idag}
                value={dag}
                onChange={(handelse) => setDag(handelse.target.value)}
              />
            </div>
            <div className="faltgrupp">
              <label htmlFor={`betalkonto-${id}`}>
                {faktura.slag === 'kund' ? 'Insatt på' : 'Betalat med'}
              </label>
              <div className="segment" id={`betalkonto-${id}`}>
                {val.map((kandidat) => (
                  <button
                    key={kandidat}
                    type="button"
                    aria-pressed={valt === kandidat}
                    onClick={() => setKonto(kandidat)}
                  >
                    {BETALSATTSNAMN.get(kandidat) ?? kandidat}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="knapp knapp--primar"
              disabled={arbetar || summa === undefined || dag === ''}
              data-testid="bokfor-betalning"
              onClick={() =>
                void kor(async () => {
                  const meddelande = await onBetala(faktura.verifikat.id, {
                    datum: dag as Datum,
                    belopp: summa!,
                    betalkonto: valt,
                  });
                  setOppen(undefined);
                  return meddelande;
                })
              }
            >
              Bokför betalningen
            </button>
            <button
              type="button"
              className="knapp knapp--text"
              onClick={() => setOppen(undefined)}
            >
              Avbryt
            </button>
          </div>
        )}
      </li>
    );
  }

  return (
    <section aria-label="Fakturor">
      <Tillbaka onTillbaka={onTillbaka} />
      <h2>Fakturor</h2>

      {metod !== 'faktureringsmetoden' ? (
        <p className="tomt" data-testid="fakturor-kontantmetod">
          Boken använder kontantmetoden, där en faktura bokförs först när den betalas, så
          inget ligger öppet här. Under Företaget kan du byta till faktureringsmetoden.
        </p>
      ) : (
        <>
          <p className="hjalptext">
            Fakturor du bokfört som obetalda. Bokför en ny under Bokför genom att välja
            Obetald faktura, och registrera betalningen här när den kommer.
          </p>

          {kund.length === 0 && leverantor.length === 0 && (
            <p className="tomt" data-testid="inga-fakturor">
              Inga obetalda fakturor.
            </p>
          )}

          {kund.length > 0 && (
            <>
              <h3>Att få in</h3>
              <ul className="lista" data-testid="kundfakturor">
                {kund.map(rad)}
              </ul>
            </>
          )}

          {leverantor.length > 0 && (
            <>
              <h3>Att betala</h3>
              <ul className="lista" data-testid="leverantorsfakturor">
                {leverantor.map(rad)}
              </ul>
            </>
          )}
        </>
      )}

      <Uppgiftsstatus arbetar={arbetar} besked={besked} fel={fel} />
    </section>
  );
}
