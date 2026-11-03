/**
 * The check digit every Swedish personnummer, samordningsnummer and
 * organisationsnummer ends in: the Luhn algorithm over the ten digits
 * ÅÅMMDDNNNK (or the organisation's own ten).
 *
 * Source: Skatteverket, "Personnummer" (SKV 704) - the last digit is a
 * modulus-10 check over the first nine.
 */
export function harGiltigKontrollsiffra(tio: string): boolean {
  if (!/^\d{10}$/.test(tio)) {
    return false;
  }
  let summa = 0;
  for (let i = 0; i < tio.length; i += 1) {
    let siffra = Number(tio[i]) * (i % 2 === 0 ? 2 : 1);
    if (siffra > 9) {
      siffra -= 9;
    }
    summa += siffra;
  }
  return summa % 10 === 0;
}
