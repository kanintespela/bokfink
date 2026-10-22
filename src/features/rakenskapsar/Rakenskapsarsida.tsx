import { useState } from 'react';

import { formatKronor } from '../../domain/belopp/ore';
import type { Konto, Kontonummer } from '../../domain/konto/konto';
import type { Rakenskapsar } from '../../domain/rakenskapsar/rakenskapsar';
import type { Datum } from '../../domain/tid/datum';
import type { Arsavslutschecklista, Balansoverforing } from '../../data/arsavslut';

interface Props {
  readonly rakenskapsar: readonly Rakenskapsar[];
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly idag: Datum;
  readonly onMomslas: (ar: Rakenskapsar, tom: Datum) => Promise<void>;
  readonly onAvsluta: (ar: Rakenskapsar) => Promise<void>;
  /**
   * The years that hold nothing at all and may therefore be removed.
   *
   * Worked out by the caller, which is the only place that knows what has
   * been booked. A year that holds bookkeeping is not offered - see
   * taBortRakenskapsar for why.
   */
  readonly borttagbara: ReadonlySet<Rakenskapsar['id']>;
  readonly onTaBort: (ar: Rakenskapsar) => Promise<void>;
  readonly onHamtaChecklista: (ar: Rakenskapsar) => Promise<Arsavslutschecklista>;
  readonly onSkapaNastaAr: (ar: Rakenskapsar) => Promise<Rakenskapsar>;
  readonly onForUtgaendeBalanser: (
    ar: Rakenskapsar,
    nastaArId: Rakenskapsar['id'],
  ) => Promise<Balansoverforing>;
}

/**
 * Fiscal years, their opening balances and how far each is locked.
 *
 * Both locks are here because both are one-way. A period closed after a
 * momsdeklaration cannot be reopened by pressing the button again, and
 * neither can a closed year - so each asks first and says plainly what it
 * will stop.
 */
export function Rakenskapsarsida({
  rakenskapsar,
  borttagbara,
  onTaBort,
  konton,
  idag,
  onMomslas,
  onAvsluta,
  onHamtaChecklista,
  onSkapaNastaAr,
  onForUtgaendeBalanser,
}: Props) {
  const [oppet, setOppet] = useState<string | undefined>();
  const [lasTom, setLasTom] = useState<string>(idag);
  const [arbetar, setArbetar] = useState(false);
  const [checklistor, setChecklistor] = useState<Map<string, Arsavslutschecklista>>(
    new Map(),
  );
  const [overforda, setOverforda] = useState<Map<string, Balansoverforing>>(new Map());

  const iOrdning = [...rakenskapsar].sort((a, b) => (a.start < b.start ? 1 : -1));

  function visaRad(ar: Rakenskapsar): void {
    const nastaOppen = oppet === ar.id ? undefined : ar.id;
    setOppet(nastaOppen);
    if (nastaOppen !== undefined && !ar.avslutat && !checklistor.has(ar.id)) {
      void onHamtaChecklista(ar).then((checklista) => {
        setChecklistor((forra) => new Map(forra).set(ar.id, checklista));
      });
    }
  }

  async function uppdateraChecklista(ar: Rakenskapsar): Promise<void> {
    const checklista = await onHamtaChecklista(ar);
    setChecklistor((forra) => new Map(forra).set(ar.id, checklista));
  }

  if (iOrdning.length === 0) {
    return (
      <p className="tomt" data-testid="inga-rakenskapsar">
        Inget räkenskapsår är upplagt.
      </p>
    );
  }

  return (
    <section aria-label="Räkenskapsår">
      <h2>Räkenskapsår</h2>

      <ul className="lista" data-testid="rakenskapsarlista">
        {iOrdning.map((ar) => {
          const visas = oppet === ar.id;
          return (
            <li key={ar.id}>
              <button
                type="button"
                className="listrad"
                aria-expanded={visas}
                onClick={() => visaRad(ar)}
              >
                <span className="listrad__text">
                  <span>{ar.start.slice(0, 4)}</span>
                  <span className="listrad__sekundar">
                    {ar.avslutat
                      ? 'Avslutat'
                      : ar.momslastTom === undefined
                        ? 'Öppet'
                        : `Momslåst t.o.m. ${ar.momslastTom}`}
                  </span>
                </span>
                <span className="listrad__sekundar">
                  {ar.ingaendeBalanser.length} IB-poster
                </span>
              </button>

              {visas && (
                <div data-testid={`rakenskapsar-${ar.start.slice(0, 4)}`}>
                  {/*
                   * Only for a year that holds nothing. Two devices used to
                   * create one calendar year each before the identifier was
                   * derived from its start date, and the empty one of the
                   * pair has to be able to go.
                   */}
                  {borttagbara.has(ar.id) && (
                    <p>
                      <button
                        type="button"
                        className="knapp knapp--text"
                        data-testid={`ta-bort-ar-${ar.id.slice(0, 8)}`}
                        onClick={() => void onTaBort(ar)}
                      >
                        Ta bort det här tomma räkenskapsåret
                      </button>
                    </p>
                  )}

                  {ar.ingaendeBalanser.length > 0 && (
                    <ul className="lista">
                      {[...ar.ingaendeBalanser]
                        .sort((a, b) => a.konto.localeCompare(b.konto))
                        .map((post) => (
                          <li key={post.konto}>
                            <div className="listrad">
                              <span className="listrad__text">
                                <span>{post.konto}</span>
                                <span className="listrad__sekundar">
                                  {konton.get(post.konto)?.namn ?? ''}
                                </span>
                              </span>
                              <span
                                className={`belopp${post.belopp < 0 ? ' belopp--negativ' : ''}`}
                              >
                                {formatKronor(post.belopp)}
                              </span>
                            </div>
                          </li>
                        ))}
                    </ul>
                  )}

                  {!ar.avslutat && (
                    <Checklistkort
                      ar={ar}
                      checklista={checklistor.get(ar.id)}
                      overforda={overforda.get(ar.id)}
                      arbetar={arbetar}
                      onSkapaNastaAr={async () => {
                        setArbetar(true);
                        try {
                          await onSkapaNastaAr(ar);
                          await uppdateraChecklista(ar);
                        } finally {
                          setArbetar(false);
                        }
                      }}
                      onForUtgaendeBalanser={async (nastaArId) => {
                        setArbetar(true);
                        try {
                          const overforing = await onForUtgaendeBalanser(ar, nastaArId);
                          setOverforda((forra) => new Map(forra).set(ar.id, overforing));
                        } finally {
                          setArbetar(false);
                        }
                      }}
                    />
                  )}

                  {!ar.avslutat && (
                    <div className="kort">
                      <div className="faltgrupp">
                        <label htmlFor={`las-${ar.id}`}>Momslås till och med</label>
                        <input
                          id={`las-${ar.id}`}
                          className="falt"
                          type="date"
                          min={ar.start}
                          max={ar.slut}
                          value={lasTom}
                          onChange={(handelse) => setLasTom(handelse.target.value)}
                        />
                      </div>

                      <p>
                        Låser allt till och med det datumet, så att en siffra som redan
                        lämnats till Skatteverket inte kan ändras i efterhand. Det går
                        inte att ångra.
                      </p>

                      <button
                        type="button"
                        className="knapp"
                        disabled={arbetar}
                        data-testid={`momslas-${ar.start.slice(0, 4)}`}
                        onClick={() => {
                          setArbetar(true);
                          void onMomslas(ar, lasTom as Datum).finally(() =>
                            setArbetar(false),
                          );
                        }}
                      >
                        Momslås
                      </button>

                      <p>
                        Att avsluta året stänger det helt. Inget kan bokföras i det
                        efteråt, och en rättelse får göras i ett öppet år i stället.
                      </p>

                      <button
                        type="button"
                        className="knapp"
                        // Nästa år måste finnas innan detta stängs, annars har det
                        // ingenstans att ta emot utgående balanser - se Checklistkort.
                        disabled={
                          arbetar || checklistor.get(ar.id)?.nastaAr === undefined
                        }
                        data-testid={`avsluta-${ar.start.slice(0, 4)}`}
                        onClick={() => {
                          setArbetar(true);
                          void onAvsluta(ar).finally(() => setArbetar(false));
                        }}
                      >
                        Avsluta {ar.start.slice(0, 4)}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface ChecklistkortProps {
  readonly ar: Rakenskapsar;
  readonly checklista: Arsavslutschecklista | undefined;
  readonly overforda: Balansoverforing | undefined;
  readonly arbetar: boolean;
  readonly onSkapaNastaAr: () => Promise<void>;
  readonly onForUtgaendeBalanser: (nastaArId: Rakenskapsar['id']) => Promise<void>;
}

/**
 * Vad som är värt att kontrollera innan ett år stängs, och stegen att skapa
 * nästa år och föra över dess utgående balanser dit. Avskrivningar och
 * periodiseringar listas som påminnelser, inte som ✅/❌ - om de är klara är
 * ett beslut ingen knapp här kan avgöra åt dig (hård regel 10).
 */
function Checklistkort({
  ar,
  checklista,
  overforda,
  arbetar,
  onSkapaNastaAr,
  onForUtgaendeBalanser,
}: ChecklistkortProps) {
  if (checklista === undefined) {
    return null;
  }

  return (
    <div className="kort" data-testid={`checklista-${ar.start.slice(0, 4)}`}>
      <h3>Checklista</h3>
      <ul className="lista">
        <li>
          {checklista.obokfordaUtkast === 0 ? '✅' : '❌'} Utkast klara att bokföra eller
          ta bort: {checklista.obokfordaUtkast} kvar
        </li>
        <li>{checklista.momsTackerHelaAret ? '✅' : '❌'} Moms inlämnad för hela året</li>
        <li>
          {checklista.djurlagerInventeratIAr ? '✅' : '❌'} Djurlager inventerat i år
        </li>
        <li>
          Dagar sedan senaste säkerhetskopia:{' '}
          {checklista.dagarSedanBackup ?? 'ingen tagen ännu'}
        </li>
      </ul>

      <p className="hjalptext">
        Kontrollera själv att avskrivningar och periodiseringar för året är bokförda - det
        kan ingen checklista se åt dig.
      </p>

      {checklista.nastaAr === undefined ? (
        <button
          type="button"
          className="knapp"
          disabled={arbetar}
          data-testid={`skapa-nasta-ar-${ar.start.slice(0, 4)}`}
          onClick={() => void onSkapaNastaAr()}
        >
          Skapa nästa räkenskapsår
        </button>
      ) : (
        <>
          <p className="hjalptext">
            Nästa år ({checklista.nastaAr.start.slice(0, 4)}) är skapat.
          </p>
          <button
            type="button"
            className="knapp"
            disabled={arbetar}
            data-testid={`for-over-balanser-${ar.start.slice(0, 4)}`}
            onClick={() => void onForUtgaendeBalanser(checklista.nastaAr!.id)}
          >
            Beräkna och för över utgående balanser
          </button>
        </>
      )}

      {overforda !== undefined && (
        <p role="status" data-testid={`overforda-balanser-${ar.start.slice(0, 4)}`}>
          {overforda.balanser.length} kontons utgående balans förd över till nästa år.
          {overforda.omforing === undefined
            ? ' Omföringen av eget kapital bokförs när det nya året har börjat.'
            : ` Eget kapital omfört som ${overforda.omforing.serie}${overforda.omforing.nummer} den ${overforda.omforing.datum}.`}
        </p>
      )}
    </div>
  );
}
