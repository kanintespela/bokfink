import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bevakaUppdateringar, KONTROLLINTERVALL_MS, type Sidan } from './uppdatering';

function provsida() {
  const tillstand = { synlig: true, online: true };
  const lyssnare = new Set<() => void>();
  const sidan: Sidan = {
    synlig: () => tillstand.synlig,
    online: () => tillstand.online,
    narSynlighetAndras: (lyssna) => {
      lyssnare.add(lyssna);
      return () => lyssnare.delete(lyssna);
    },
  };
  const visas = (synlig: boolean) => {
    tillstand.synlig = synlig;
    lyssnare.forEach((lyssna) => lyssna());
  };
  return { sidan, tillstand, visas, lyssnare };
}

describe('bevakaUppdateringar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks when the app comes back to the foreground', () => {
    const update = vi.fn(() => Promise.resolve());
    const { sidan, visas } = provsida();
    bevakaUppdateringar({ update }, sidan);

    visas(false);
    expect(update).not.toHaveBeenCalled();
    visas(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('checks once an hour while the app is open', () => {
    const update = vi.fn(() => Promise.resolve());
    const { sidan } = provsida();
    bevakaUppdateringar({ update }, sidan);

    vi.advanceTimersByTime(KONTROLLINTERVALL_MS - 1);
    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('does not ask while hidden or offline', () => {
    const update = vi.fn(() => Promise.resolve());
    const { sidan, tillstand, visas } = provsida();
    bevakaUppdateringar({ update }, sidan);

    tillstand.synlig = false;
    vi.advanceTimersByTime(KONTROLLINTERVALL_MS);
    tillstand.online = false;
    visas(true);
    expect(update).not.toHaveBeenCalled();
  });

  it('leaves a failed check for the next one', async () => {
    const update = vi.fn(() => Promise.reject(new Error('offline')));
    const { sidan, visas } = provsida();
    bevakaUppdateringar({ update }, sidan);

    visas(true);
    await vi.runAllTicks();
    visas(true);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('stops checking when stopped', () => {
    const update = vi.fn(() => Promise.resolve());
    const { sidan, visas, lyssnare } = provsida();
    const sluta = bevakaUppdateringar({ update }, sidan);

    sluta();
    visas(true);
    vi.advanceTimersByTime(KONTROLLINTERVALL_MS);
    expect(update).not.toHaveBeenCalled();
    expect(lyssnare.size).toBe(0);
  });
});
