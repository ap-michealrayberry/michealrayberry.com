import { describe, expect, it } from 'vitest';
import {
  agreementGate, appliesOn, correctiveDueAt, correctiveFor, dayNumber, etDate, etWallTime,
  packetComponents, packetDeadline, parseSupervisionDays, supervisionRequiredOn,
} from '../../src/rules';

const executed = {
  agreement_edition: '2',
  participant_signature_verified_on: '2026-10-03',
  ap_signature_verified_on: '2026-10-03',
  consent_recording_date: '2026-10-03',
  consent_reviewed_on: '2026-10-03',
};

describe('day numbering (§1)', () => {
  it('Day 1 is 2026-10-03', () => {
    expect(dayNumber('2026-10-03')).toBe(1);
    expect(dayNumber('2026-10-04')).toBe(2);
    expect(dayNumber('2026-10-02')).toBe(0);
  });
  it('counts calendar days across the DST change', () => {
    expect(dayNumber('2026-11-01')).toBe(30);
    expect(dayNumber('2026-11-02')).toBe(31);
    expect(dayNumber('2027-03-15')).toBe(164);
  });
  it('uses the Eastern date, not UTC', () => {
    expect(etDate(new Date('2026-10-04T03:30:00Z'))).toBe('2026-10-03'); // 11:30 PM EDT
    expect(etDate(new Date('2026-10-04T04:30:00Z'))).toBe('2026-10-04');
    expect(etDate(new Date('2026-12-01T04:30:00Z'))).toBe('2026-11-30'); // 11:30 PM EST
  });
});

describe('packet deadline (§4: 10:00 PM Eastern)', () => {
  it('is 22:00 EDT before the change and 22:00 EST after', () => {
    expect(packetDeadline('2026-10-03').toISOString()).toBe('2026-10-04T02:00:00.000Z');
    expect(packetDeadline('2026-10-31').toISOString()).toBe('2026-11-01T02:00:00.000Z');
    expect(packetDeadline('2026-11-01').toISOString()).toBe('2026-11-02T03:00:00.000Z');
    expect(packetDeadline('2027-03-13').toISOString()).toBe('2027-03-14T03:00:00.000Z');
    expect(packetDeadline('2027-03-14').toISOString()).toBe('2027-03-15T02:00:00.000Z');
  });
  it('maps Eastern wall time on the DST days', () => {
    expect(etWallTime('2026-11-01', 18).toISOString()).toBe('2026-11-01T23:00:00.000Z');
    expect(etWallTime('2027-03-14', 18).toISOString()).toBe('2027-03-14T22:00:00.000Z');
  });
});

describe('corrective sessions (§8)', () => {
  it('levels follow the confirmed count; third and later are Level Three', () => {
    expect(correctiveFor(1)).toEqual({ level: 1, minutes: 10 });
    expect(correctiveFor(2)).toEqual({ level: 2, minutes: 20 });
    expect(correctiveFor(3)).toEqual({ level: 3, minutes: 30 });
    expect(correctiveFor(9)).toEqual({ level: 3, minutes: 30 });
  });
  it('refuses a corrective without a confirmed violation', () => {
    expect(() => correctiveFor(0)).toThrow();
    expect(() => correctiveFor(1.5)).toThrow();
  });
  it('is due 72 elapsed hours after the notice, even across the DST change', () => {
    const notice = etWallTime('2026-10-31', 20); // 8 PM EDT
    expect(correctiveDueAt(notice).toISOString()).toBe('2026-11-04T00:00:00.000Z'); // 7 PM EST Nov 3
  });
});

describe('agreement gate (§1, §11, §12)', () => {
  const filed = ['2026-10-03'];

  it('is inactive until every execution record exists', () => {
    const gate = agreementGate({}, [], '2026-10-03');
    expect(gate.active).toBe(false);
    expect(gate.missing).toHaveLength(5);
    expect(appliesOn('2026-10-03', gate)).toBe(false);
  });

  it('is active from Day 1 when everything is verified on Day 1', () => {
    const gate = agreementGate(executed, filed, '2026-10-03');
    expect(gate).toMatchObject({ active: true, effectiveDate: '2026-10-03', missing: [] });
    expect(appliesOn('2026-10-03', gate)).toBe(true);
    expect(appliesOn('2026-10-02', gate)).toBe(false);
  });

  it('takes the latest of the five dates as the effective date', () => {
    const gate = agreementGate({ ...executed, consent_recording_date: '2026-10-05', consent_reviewed_on: '2026-10-06' }, ['2026-10-05'], '2026-10-07');
    expect(gate.effectiveDate).toBe('2026-10-06');
    expect(appliesOn('2026-10-05', gate)).toBe(false); // never retroactive
    expect(appliesOn('2026-10-06', gate)).toBe(true);
  });

  it('rejects signature verifications dated before the signed edition', () => {
    const gate = agreementGate({ ...executed, participant_signature_verified_on: '2026-09-20' }, filed, '2026-10-03');
    expect(gate.active).toBe(false);
  });

  it('requires a filed Edition 2 confirmation on the recorded consent date', () => {
    expect(agreementGate(executed, [], '2026-10-03').active).toBe(false);
    expect(agreementGate(executed, ['2026-09-14'], '2026-10-03').active).toBe(false);
  });

  it('requires Edition 2 and no future-dated records', () => {
    expect(agreementGate({ ...executed, agreement_edition: '1' }, filed, '2026-10-03').active).toBe(false);
    expect(agreementGate({ ...executed, consent_reviewed_on: '2026-10-04' }, filed, '2026-10-03').active).toBe(false);
  });

  it('fails closed when the recorded effective date disagrees', () => {
    expect(agreementGate({ ...executed, effective_date: '2026-10-03' }, filed, '2026-10-03').active).toBe(true);
    expect(agreementGate({ ...executed, effective_date: '2026-10-01' }, filed, '2026-10-03').active).toBe(false);
  });

  it('stops applying requirements on withdrawal (§11)', () => {
    const gate = agreementGate({ ...executed, withdrawn: '2026-10-10' }, filed, '2026-10-12');
    expect(gate.ended).toEqual({ kind: 'withdrawn', date: '2026-10-10' });
    expect(appliesOn('2026-10-09', gate)).toBe(true);
    expect(appliesOn('2026-10-10', gate)).toBe(false);
    expect(appliesOn('2026-10-11', gate)).toBe(false);
  });
});

describe('Evening Supervision schedule (§6)', () => {
  const gate = agreementGate(executed, ['2026-10-03'], '2026-10-10');
  it('defaults to Sunday through Thursday nights', () => {
    expect(supervisionRequiredOn('2026-10-04', gate, executed)).toBe(true); // Sunday
    expect(supervisionRequiredOn('2026-10-08', gate, executed)).toBe(true); // Thursday
    expect(supervisionRequiredOn('2026-10-09', gate, executed)).toBe(false); // Friday
    expect(supervisionRequiredOn('2026-10-03', gate, executed)).toBe(false); // Saturday
  });
  it('follows the schedule the AP records', () => {
    const state = { ...executed, supervision_days: '1,2,3' };
    expect(supervisionRequiredOn('2026-10-04', gate, state)).toBe(false);
    expect(supervisionRequiredOn('2026-10-05', gate, state)).toBe(true);
    expect(() => parseSupervisionDays('7')).toThrow();
  });
});

describe('packet components (§4)', () => {
  const full = { weight_lb: 338.2, video: 'v', photo_front: 'a', photo_left: 'b', photo_rear: 'c', photo_right: 'd' };
  it('is complete only with weight, video, four photos and the tracker row', () => {
    expect(packetComponents(full).complete).toBe(true);
    expect(packetComponents(null)).toMatchObject({ tracker: false, complete: false });
    expect(packetComponents({ ...full, photo_rear: null })).toMatchObject({ photos: 3, complete: false });
    expect(packetComponents({ ...full, weight_lb: null }).complete).toBe(false);
  });
});
