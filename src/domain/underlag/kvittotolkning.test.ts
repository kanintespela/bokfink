import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import { datum } from '../tid/datum';
import { hittaForfallodag, tolkaKvitto } from './kvittotolkning';

const IDAG = datum('2026-09-05');
const kr = (text: string) => oreFromKronor(text);

/*
 * A thermal receipt as OCR hands it over: the shop at the top, the lines in
 * the middle, and the money at the bottom.
 */
const LANTMANNEN = `Lantmännen Lantbruk
Storgatan 14, 123 45 Ekeby
Org.nr 556012-1223

Kraftfoder 25 kg      416,25
Frakt                  84,00

SUMMA                 500,25
Att betala            520,31
Moms 25%      416,25  104,06
Kontant               600,00
Växel                  79,69

2026-02-13 14:22
Kvitto 4417`;

describe('tolkaKvitto', () => {
  it('reads a whole receipt', () => {
    const forslag = tolkaKvitto(LANTMANNEN, IDAG);

    expect(forslag.datum).toBe('2026-02-13');
    expect(forslag.brutto).toBe(kr('520.31'));
    expect(forslag.moms).toBe(kr('104.06'));
    expect(forslag.momssats).toBe(25);
    expect(forslag.leverantor).toBe('Lantmännen Lantbruk');
    expect(forslag.orgnr).toBe('556012-1223');
  });

  /*
   * The trap a naive "largest amount wins" falls into. Six hundred kronor
   * changed hands, but 520,31 was the purchase.
   */
  it('does not mistake the cash handed over for the total', () => {
    expect(tolkaKvitto(LANTMANNEN, IDAG).brutto).toBe(kr('520.31'));
  });

  /*
   * Both a receipt and an invoice call the figure that was paid "Totalt",
   * while "Summa" is used for a line total, a subtotal and the amount due on
   * the same page. Order on the page must not decide between them.
   */
  it('prefers Totalt over Summa wherever they stand', () => {
    const summaSist = 'Totalt 1 004,00\nSumma varor 803,19';
    const totaltSist = 'Summa varor 803,19\nTotalt 1 004,00';

    expect(tolkaKvitto(summaSist, IDAG).brutto).toBe(kr('1004.00'));
    expect(tolkaKvitto(totaltSist, IDAG).brutto).toBe(kr('1004.00'));
  });

  it('prefers the labelled total over a running subtotal', () => {
    const text = 'Summa 300,00\nRabatt -50,00\nAtt betala 250,00';
    expect(tolkaKvitto(text, IDAG).brutto).toBe(kr('250.00'));
  });

  it('falls back to the largest amount when nothing is labelled', () => {
    const text = 'Kaffe 39,00\nBulle 25,00\n64,00';
    expect(tolkaKvitto(text, IDAG).brutto).toBe(kr('64.00'));
  });

  it('reads amounts printed with a thousands space', () => {
    expect(tolkaKvitto('Att betala 12 345,67', IDAG).brutto).toBe(kr('12345.67'));
  });

  it('reads whole kronor without decimals', () => {
    expect(tolkaKvitto('Att betala 320', IDAG).brutto).toBe(kr('320.00'));
  });

  describe('datum', () => {
    it('reads the Swedish order too', () => {
      expect(tolkaKvitto('Datum 13/02/2026', IDAG).datum).toBe('2026-02-13');
    });

    it('reads the six digits a cash register prints', () => {
      expect(tolkaKvitto('KÖP 260213 14:22', IDAG).datum).toBe('2026-02-13');
    });

    /*
     * OCR turns 2026 into 2028 often enough to matter, and a receipt from
     * next year is a misread rather than a purchase. Left out, so the person
     * types the date instead of correcting a wrong one they trusted.
     */
    it('ignores a date in the future', () => {
      expect(tolkaKvitto('2028-02-13', IDAG).datum).toBeUndefined();
    });

    it('ignores a date the calendar does not have', () => {
      expect(tolkaKvitto('2026-02-30', IDAG).datum).toBeUndefined();
    });

    it('takes the first date, which is where the purchase date is printed', () => {
      const text = '2026-02-13\nBäst före 2026-03-01';
      expect(tolkaKvitto(text, IDAG).datum).toBe('2026-02-13');
    });
  });

  describe('moms', () => {
    it('reads the rate when it stands after the amount', () => {
      const forslag = tolkaKvitto('25% moms 104,06', IDAG);
      expect(forslag.momssats).toBe(25);
      expect(forslag.moms).toBe(kr('104.06'));
    });

    it('reads a rate written with a decimal', () => {
      expect(tolkaKvitto('Moms 25,00% 104,06', IDAG).momssats).toBe(25);
    });

    it('takes the last figure on the line, which is the VAT itself', () => {
      // Rate, net, VAT - the order a Swedish VAT summary is printed in.
      expect(tolkaKvitto('Moms 12% 100,00 12,00', IDAG).moms).toBe(kr('12.00'));
    });
  });

  describe('leverantör', () => {
    it('skips a line of digits to find the name', () => {
      const text = '4417 0022\nICA Kvantum Ekeby\nStorgatan 1';
      expect(tolkaKvitto(text, IDAG).leverantor).toBe('ICA Kvantum Ekeby');
    });

    /*
     * From a real reading: OCR put its own noise above the shop's name, and
     * "HR Rn" is letters enough to pass for a name without being one. It
     * would have ended up as the verifikat's description.
     */
    it('skips fragments that are letters without being words', () => {
      const text = 'HR Rn\nMaE — Hrks | stsport AB\nBilbyggarvägen 12B';
      expect(tolkaKvitto(text, IDAG).leverantor).toBe('MaE — Hrks | stsport AB');
    });

    it('suggests nothing rather than noise', () => {
      expect(tolkaKvitto('HR Rn\n= x\n88', IDAG).leverantor).toBeUndefined();
    });
  });

  it('suggests nothing rather than guessing when the text says nothing', () => {
    expect(tolkaKvitto('', IDAG)).toEqual({});
    expect(tolkaKvitto('   \n\n  ', IDAG)).toEqual({});
  });

  /*
   * The organisation number is only read where it is labelled. Six digits, a
   * hyphen and four more is also what a personnummer and a phone number look
   * like, and a receipt carries several of them.
   */
  it('only reads an organisation number that says it is one', () => {
    expect(tolkaKvitto('Tel 0123-456789', IDAG).orgnr).toBeUndefined();
    expect(tolkaKvitto('Org.nr 556012-1223', IDAG).orgnr).toBe('556012-1223');
  });

  /*
   * A real invoice, and the failure it caused: OCR read the payment slip's
   * reference number as an amount, twelve digits joined across the spaces it
   * is printed in, and nothing else was labelled clearly enough to beat it.
   * The suggestion was 731 204 559 812,00 kronor.
   */
  const FAKTURA = `Lantbrukstjänst Exempel AB
Fakturanummer 4417
Kundnummer 100 001
Fakturadatum 2026-02-13
Förfallodatum 2026-03-15

Beskrivning              Antal    Pris      Summa
Analys av jordprov           2   450,00    900,00
Frakt                        1    84,00     84,00

Summa exkl. moms                          984,00
Moms 25%                                  246,00
Öresavrundning                              0,00

Att betala
1 230,00 kr

Bankgiro 5555-6666
OCR 731 204 559 812`;

  it('does not read a reference number as an amount', () => {
    const forslag = tolkaKvitto(FAKTURA, IDAG);
    expect(forslag.brutto).toBe(kr('1230.00'));
  });

  it('finds an amount on the line under its label', () => {
    // Invoices put "Att betala" above the figure as often as beside it.
    expect(tolkaKvitto('Att betala\n1 230,00 kr', IDAG).brutto).toBe(kr('1230.00'));
  });

  it('does not mistake the net for the total', () => {
    const text = 'Summa exkl. moms 984,00\nMoms 25% 246,00\nAtt betala 1 230,00';
    expect(tolkaKvitto(text, IDAG).brutto).toBe(kr('1230.00'));
  });

  it('ignores a number too long to be money', () => {
    // A bankgiro, an OCR reference, an organisation number: all digits, none
    // of them amounts.
    const text = 'Kvitto\n731 204 559 812\nAtt betala 249,00';
    expect(tolkaKvitto(text, IDAG).brutto).toBe(kr('249.00'));
  });

  it('does not guess at a bare number when nothing is labelled', () => {
    // Without a label and without öre it is as likely to be a receipt number
    // as an amount, and a wrong figure costs more than an empty field.
    expect(tolkaKvitto('Kvitto 4417\nKassa 3', IDAG).brutto).toBeUndefined();
  });

  /*
   * A real receipt, transcribed line by line from a photograph of it and then
   * made anonymous: a shoe shop, three pairs on a three-for-two, paid by card. It is
   * here because every trap on it is one a shop receipt actually sets.
   *
   * The correct answers are 1 004,00 to book, 200,81 of VAT, and the ninth of
   * May.
   */
  const SKOBUTIK = `skobutiken  exempel
Exempelskor AB
1001 Exempelcity
Storgatan 1
123 45 Exempelstad
556123-4567
https://exempelskor.se

Kvitto:   10234
Säljare:  1001
Datum:    2026-05-09 14:30

Artikel                              Belopp
Sandal med remmar-SP               399,00 kr
 Storlek: 40
 3483394000
3 för 2 - Billigaste paret på köpet -113,96 kr
Snörsko-SP                         499,00 kr
 Storlek: 44
 3487744400
3 för 2 - Billigaste paret på köpet -142,52 kr
Snörsko-SP                         499,00 kr
 Storlek: 44
 3487754400
3 för 2 - Billigaste paret på köpet -142,52 kr
Papperspåse M                        6,00 kr
 88

Totalt                           1 004,00 kr
Kort                             1 004,00 kr

Moms 25% (803,19 kr)               200,81 kr
3 för 2 - Billigaste paret på köpet -399,00 kr

Medlemsnr: 1234567

TELLER DK / CA
BUTIKSNR: 10000001
TERM: 10000002-100003
2026-05-09 14:30

Debit Mastercard
Contactless
************0000-0
AID: A0000000041010
TVR: 0000048002
REF: 100004 100005 KA1
RESP: 00
PERIOD: 446

KÖP
SEK        1004,00
Personlig kod
GODKÄNT`;

  it('reads a real shop receipt', () => {
    const forslag = tolkaKvitto(SKOBUTIK, IDAG);

    expect(forslag.brutto).toBe(kr('1004.00'));
    expect(forslag.moms).toBe(kr('200.81'));
    expect(forslag.momssats).toBe(25);
    expect(forslag.datum).toBe('2026-05-09');
  });

  /*
   * The card terminal's own half of the receipt is a page of numbers that are
   * not money: terminal ids, an AID, a TVR, a reference. None of them may
   * reach the amount.
   */
  it('is not distracted by the card terminal block', () => {
    const text = `Totalt 1 004,00 kr
BUTIKSNR: 10000001
TERM: 10000002-100003
AID: A0000000041010
TVR: 0000048002
REF: 100004 100005 KA1
PERIOD: 446`;
    expect(tolkaKvitto(text, IDAG).brutto).toBe(kr('1004.00'));
  });

  /*
   * The VAT is printed with the net beside it, in brackets. The figure that
   * matters is the last one on the line.
   */
  it('takes the VAT and not the net it is printed next to', () => {
    expect(tolkaKvitto('Moms 25% (803,19 kr) 200,81 kr', IDAG).moms).toBe(kr('200.81'));
  });

  /*
   * A pharmacy receipt, as OCR handed it over, misreadings and all: prescribed
   * medicine is exempt, so there is no VAT to find, and the engine turned one
   * of the three printings of the total into 869,00.
   */
  const APOTEKET = `TE Apotek Exempel
Storgatan 6
123 45 Exempelstad
= Org-nr: 556000-0001
ns www .apotekexempel.se
j Kassakvitto
| Ant. Beskrivning kr/st Belopp
; SEK SEK
 Receptköp C10000001
. 1 Receptvaror OM 889,00 889,00
7 100000
3/Totalt Receptköp c10000001 889,00
Totalt : ; 869,00
1 Artikel
Kort/Swish ; 889,00
Term: 1000000001 SWE :1000002
Debit Mastercard okokta ]0 11
But ik:1001
2026-06-27 09:40 ATD:A0000000041010
TVR :000004800A TS: 0000
Ref :000100000006 100 Rsp:00 100007 KA1 5
Person lig kod Contact less
Köp 889,00. I
Totalt SEK 889,00
Spara kvittot j
(Moms OM X 889,00 = 0,00 )
Butik Säljare Nr Datum Tid
01.1001/02 bar8B34 1001 2026-06-27 09:40`;

  it('reads a receipt with no VAT on it', () => {
    const forslag = tolkaKvitto(APOTEKET, IDAG);

    expect(forslag.brutto).toBe(kr('889.00'));
    // Prescribed medicine is exempt, and the receipt says so.
    expect(forslag.moms).toBe(0);
    expect(forslag.datum).toBe('2026-06-27');
    expect(forslag.orgnr).toBe('556000-0001');
  });

  /*
   * The misread that would not be noticed. 869 against 889 looks like an
   * amount either way, so the figure the receipt repeats wins over the one it
   * prints once - wherever on the page the misreading happens to fall.
   */
  it('believes the total the receipt repeats, not the one it misprints', () => {
    const sistaRaden = APOTEKET.replace('Totalt SEK 889,00', 'Totalt SEK 869,00').replace(
      'Totalt : ; 869,00',
      'Totalt : ; 889,00',
    );

    expect(tolkaKvitto(APOTEKET, IDAG).brutto).toBe(kr('889.00'));
    expect(tolkaKvitto(sistaRaden, IDAG).brutto).toBe(kr('889.00'));
  });

  it('still lets the last label win when nothing is repeated', () => {
    // Two totals, one printing each: the later one is the final figure.
    const text = 'Totalt 300,00\nRabatt\nTotalt 250,00';
    expect(tolkaKvitto(text, IDAG).brutto).toBe(kr('250.00'));
  });

  /*
   * A fuel receipt as the engine read it from a photograph, trimmed to the
   * lines that matter. Three traps in one page, all of which it fell into:
   *
   *   - "PRODUKT MOMS BELOPP" is a column heading, and the price stands
   *     under it. Read as a VAT line it offered the total as its own VAT.
   *   - "Belopp" as a heading is not a total either.
   *   - "TOTALT" came back as "TOFALFENEA", so nothing was labelled at all.
   *
   * The answers are 344,74 paid and 68,95 of VAT, from a booked receipt.
   */
  const PREEM = `preem
Preem Exempelstad Storvägen
Org.Nr: 556072-6977
KVITTO
PRODUKT a — BELOPP d
-— ist
PREEM 0 D eSen | 3 O&SEK 344, 745
(Pump Ed 1,16 LK +20,09 SEK/L+)
TOFALFENEA SEK 344,74
BANKKORT SEK 344,74
Butiksnr: 1000008
26-06-08 07:59:27
Momskod &$ Netto Belopp F
3 25;00-— SEK 275,79 SEK 68,95
08-06-2026 07:59:28 181 1000009`;

  it('reads a fuel receipt whose total label was mangled', () => {
    const forslag = tolkaKvitto(PREEM, IDAG);

    expect(forslag.brutto).toBe(kr('344.74'));
    expect(forslag.moms).toBe(kr('68.95'));
    expect(forslag.datum).toBe('2026-06-08');
  });

  it('does not read a column heading as the VAT', () => {
    // The price stands under "PRODUKT MOMS BELOPP", and a fifth of the total
    // is the most the VAT can be.
    const text = 'PRODUKT MOMS BELOPP\nDiesel SEK 344,74\nTotalt SEK 344,74';
    expect(tolkaKvitto(text, IDAG).moms).toBeUndefined();
  });

  it('does not read a column heading as the total', () => {
    const text = 'PRODUKT MOMS BELOPP\nDiesel 3 SEK 344,74\nTOTALT SEK 344,74';
    expect(tolkaKvitto(text, IDAG).brutto).toBe(kr('344.74'));
  });

  /*
   * Zero turns up as a misread letter far more often than as an amount, and a
   * receipt for nothing is not a receipt.
   */
  it('never suggests nothing as the amount', () => {
    expect(tolkaKvitto('Totalt 0,00\nKort 0,00', IDAG).brutto).toBeUndefined();
  });

  it('takes the figure with öre from under a heading, not the code beside it', () => {
    // The row is a code, a rate and two amounts; only money is written with öre.
    const text = 'Momskod % Netto Belopp\n3 25,00 SEK 275,79 SEK 68,95\nTotalt 344,74';
    expect(tolkaKvitto(text, IDAG).moms).toBe(kr('68.95'));
  });

  /*
   * Three real receipts put the VAT in three different columns, and a rate of
   * 25 is a figure on the line in all of them:
   *
   *   Underlag 740,80   Moms 185,20 (25%)   Summa 926,00   → the middle
   *   MOMS 25%          NETTO 766,00        BELOPP 191,50  → the last
   *   Momskod 3  25,00  Netto 275,79        Belopp 68,95   → the last
   *
   * With a labelled total to judge against, the largest figure that could be
   * the VAT is the VAT - a fifth of the gross is the most 25 % can come to.
   */
  it('finds the VAT whichever column it stands in', () => {
    const granngarden = 'Totalt 926,00\nUnderlag 740,80 Moms 185,20 (25%) Summa 926,00';
    const hooks = 'Att betala 957,50\nMOMS NETTO BELOPP\n25% 766,00 191,50';
    const preem =
      'TOTALT SEK 344,74\nMomskod % Netto Belopp\n3 25,00 SEK 275,79 SEK 68,95';

    expect(tolkaKvitto(granngarden, IDAG).moms).toBe(kr('185.20'));
    expect(tolkaKvitto(hooks, IDAG).moms).toBe(kr('191.50'));
    expect(tolkaKvitto(preem, IDAG).moms).toBe(kr('68.95'));
  });

  /*
   * A real reading, kept exactly as OCR handed it over - "MomsX M N Brutto"
   * for the heading and "2500:00" for the net - because the noise is half the
   * problem and a tidied-up copy would not have caught this.
   *
   * The sales part states the VAT in its summary; the card terminal's own
   * slip is printed underneath and carries "Varav moms: 0.00", which is a
   * field the terminal does not fill in rather than a statement that the
   * purchase was exempt. Taking the last moms line handed over the zero, and
   * a VAT read off the underlag overrides the one the template computes - so
   * the whole 3 225,00 was booked as a cost and not an öre of it deducted as
   * ingående moms.
   */
  const SWECOL = `swecol
Swedol Järnhandel Exempelstad
hd: 2026-09-16 15:38:05
Artikel . Apris — Total
B21127-44 1 2580,00 — 2580,00
OrU SO KENGA VIPERX HIGH 53-44
3225,00
MomsX M N Brutto
25,00 645,00 — 2500:00 — 3225,00
Att betala: 3225,00 SEK
Att betala exkl. 2580,00 SEK
BETALT MED
Kort 225,00 SEK
Retain 24 Presentkort 3000,00 SEK
TRANSAKTIONSINFO. START
| ta 16 Sep 2026 15:38
SEK 225,00
Varav moms: 0.00
Varav inlösenavgift: 0,00
KONTANT: 0.00 ;
DRICKS: 0.00 |
TOTALT: 225.00 |`;

  it('does not let a card terminal slip zero out the VAT above it', () => {
    const forslag = tolkaKvitto(SWECOL, IDAG);

    expect(forslag.moms).toBe(kr('645.00'));
    expect(forslag.brutto).toBe(kr('3225.00'));
  });

  /*
   * The terminal's own total is the card's share of a split payment - 225,00
   * of the 3 225,00, the rest on a gift card. Reading it as what was paid
   * would book a tenth of the purchase.
   */
  it('takes the purchase total over the card terminal total', () => {
    expect(tolkaKvitto(SWECOL, IDAG).brutto).toBe(kr('3225.00'));
  });

  /*
   * How strong the reading of the total is, which is the only measure of a
   * suggestion that does not rely on the engine's opinion of itself. A
   * receipt prints what was paid several times over.
   */
  it('counts how often the receipt repeats the total it suggests', () => {
    expect(tolkaKvitto('Totalt 926,00\nKort 926,00\nSEK 926,00', IDAG).stod).toBe(3);
    expect(tolkaKvitto('Totalt 926,00\nKvitto 4417', IDAG).stod).toBe(1);
  });
});

describe('hittaForfallodag', () => {
  it('reads a labelled due date on the same line', () => {
    expect(hittaForfallodag('Fakturadatum 2026-02-13\nFörfallodatum 2026-03-15')).toBe(
      '2026-03-15',
    );
  });

  it('reads a Swedish-ordered date and other labels', () => {
    expect(hittaForfallodag('Att betala senast: 15/3/2026')).toBe('2026-03-15');
    expect(hittaForfallodag('SISTA BETALNINGSDAG 2026.04.30')).toBe('2026-04-30');
  });

  it('takes the value under the label when labels and values are in two rows', () => {
    const text = [
      'Fakturadatum    Förfallodatum    Kundnummer',
      '2026-02-13      2026-03-15       100293',
    ].join('\n');
    expect(hittaForfallodag(text)).toBe('2026-03-15');
  });

  it('suggests nothing when no date is labelled as due', () => {
    expect(
      hittaForfallodag('ICA Kvantum\n2026-02-13\nAtt betala 249,00'),
    ).toBeUndefined();
    expect(hittaForfallodag('Förfallodatum\n\nOCR 731 204 559 812')).toBeUndefined();
  });

  it('accepts a date already passed', () => {
    expect(hittaForfallodag('Förfaller 2020-01-31')).toBe('2020-01-31');
  });
});

/*
 * The four figures an invoice adds up with: netto + moms + avrundning = att
 * betala. Read so that the öresutjämning can be booked on 3740 without being
 * typed. The layouts are those of real invoices measured on 2026-10-28, with
 * the names and numbers made up.
 */
describe('tolkaKvitto, netto and öresutjämning', () => {
  const kr = (text: string) => oreFromKronor(text);

  it('reads a labelled netto beside the moms and the rounded total', () => {
    const forslag = tolkaKvitto(
      [
        'Momsunderlag 25 %   169,00   Summa exkl moms     169,00',
        '                             Moms                 42,25',
        '                             Öresutjämning        -0,25',
        'Bankgiro 1234-5678           Summa att betala    211,00',
      ].join('\n'),
      IDAG,
    );

    expect(forslag.brutto).toBe(kr('211'));
    expect(forslag.moms).toBe(kr('42.25'));
    expect(forslag.netto).toBe(kr('169'));
  });

  /* A row of headings over a row of figures, each figure in its column. */
  it('reads the figures under a row of headings', () => {
    const forslag = tolkaKvitto(
      [
        'Nettobelopp   Momsbelopp   Momssats %   Avrundning   Totalt att betala',
        '199,00        49,75        25,00        0,25         249,00',
      ].join('\n'),
      IDAG,
    );

    expect(forslag.brutto).toBe(kr('249'));
    expect(forslag.netto).toBe(kr('199'));
  });

  /*
   * "Summa" here is the netto and the moms is not printed; netto, rate and
   * avrundning together leave only one way for the figures to add up.
   */
  it('works out the moms when only the netto and the avrundning are printed', () => {
    const forslag = tolkaKvitto(
      [
        'Betalningsvillkor:  15 dgr netto',
        '                         Summa:              211,60',
        '                         Öresutjämning:        0,50',
        '                         Total SUMMA:        265,00',
      ].join('\n'),
      IDAG,
    );

    expect(forslag.brutto).toBe(kr('265'));
    expect(forslag.netto).toBe(kr('211.60'));
    expect(forslag.moms).toBe(kr('52.90'));
  });

  /*
   * 2026-10-28: the total was printed rounded for cash, the card was charged
   * the exact sum, and the exact sum is what left the account. Rounding to
   * whole kronor applies to cash (lag 1970:1029); a card pays the öre.
   */
  it('takes what the card was charged over a total rounded for cash', () => {
    const forslag = tolkaKvitto(
      [
        'Totalt exkl. moms 124,70',
        'Öresavrundning: -0,12',
        'Totalt inkl. moms 156,00',
        'Kortbetalning DEBIT',
        'MASTERCARD 155,88',
      ].join('\n'),
      IDAG,
    );

    expect(forslag.brutto).toBe(kr('155.88'));
    expect(forslag.netto).toBe(kr('124.70'));
    expect(forslag.moms).toBe(kr('31.18'));
  });

  it('does not take a delsumma for the total', () => {
    const forslag = tolkaKvitto(
      ['DELSUMMA   1 050,00 kr', 'MOMS         262,50 kr', 'SUMMA      1 312,50 kr'].join(
        '\n',
      ),
      IDAG,
    );

    expect(forslag.brutto).toBe(kr('1312.50'));
    expect(forslag.netto).toBe(kr('1050'));
  });

  /* An invoice through a credit company offers to take part of it now. */
  it('ignores the smallest payment and the cost of credit', () => {
    const forslag = tolkaKvitto(
      [
        'Lägsta belopp att betala:   160,00 kr',
        'den totala kostnaden 6 378,00 kr och den effektiva räntan 72,04 %.',
        'Öresavrundning                 0,25 kr',
        'Totalt belopp              2 889,00 kr',
        'Varav moms                   577,75 kr',
        'Lägst att betala             160,00 kr',
      ].join('\n'),
      IDAG,
    );

    expect(forslag.brutto).toBe(kr('2889'));
    expect(forslag.moms).toBe(kr('577.75'));
    expect(forslag.netto).toBe(kr('2311'));
  });

  it('reads an amount written the English way', () => {
    expect(tolkaKvitto('Order totalt   SEK   2,599.00', IDAG).brutto).toBe(kr('2599'));
  });

  /*
   * Nothing on this receipt vouches for a netto: no moms line and no
   * avrundning. That 100 + 25 % happens to be 125 is not evidence.
   */
  it('does not guess a netto from amounts that merely add up', () => {
    const forslag = tolkaKvitto(
      ['Vara A 100,00', 'Vara B 25,00', 'Totalt 125,00'].join('\n'),
      IDAG,
    );

    expect(forslag.brutto).toBe(kr('125'));
    expect(forslag.netto).toBeUndefined();
  });

  it('leaves out a netto that does not add up to within a krona', () => {
    const forslag = tolkaKvitto(
      ['Summa exkl moms 150,00', 'Moms 50,00', 'Att betala 250,00'].join('\n'),
      IDAG,
    );

    expect(forslag.netto).toBeUndefined();
  });
});
