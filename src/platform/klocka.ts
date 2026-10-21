import { datum, type Datum } from '../domain/tid/datum';
import type { Klocka } from '../domain/tid/klocka';

/**
 * Today, in Europe/Stockholm.
 *
 * The domain refuses to read a clock, so this is where the real one lives.
 * The zone is named rather than left to the device: someone bookkeeping from
 * abroad still books into Swedish days, and a receipt from the evening of the
 * 31st belongs to that month whatever the phone is set to.
 */
export function systemklocka(nu: () => Date = () => new Date()): Klocka {
  return {
    idag(): Datum {
      const delar = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Stockholm',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(nu());
      return datum(delar);
    },
  };
}

/**
 * The time of day in Europe/Stockholm as HHMMSS, for the files Skatteverket
 * wants stamped with when they were made.
 */
export function klockslag(nu: () => Date = () => new Date()): string {
  const text = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(nu());
  return text.replace(/\D/g, '');
}
