import { parseIcal, unfold } from './ical';
import {
  calendarHost,
  fromCalendar,
  guessKind,
  normaliseLifeEvents,
  servedLifeEvents,
  toCalendarUrl,
  toManualEvent,
} from './life-events';

const CAL = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:a@example.com',
  'SUMMARY:Summer holiday in\\, well\\, Cornwall',
  'DTSTART;VALUE=DATE:20250801',
  'DTEND;VALUE=DATE:20250815',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:b',
  'SUMMARY:Dentist',
  'DTSTART:20250903T090000Z',
  'DTEND:20250903T100000Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:c',
  'SUMMARY:Weekend in',
  '  Edinburgh',
  'DTSTART;TZID=Europe/London:20251017T180000',
  'DURATION:P2DT6H',
  'BEGIN:VALARM',
  'DTSTART:19700101T000000',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:d',
  'SUMMARY:Cancelled trip',
  'STATUS:CANCELLED',
  'DTSTART;VALUE=DATE:20251101',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:e',
  'SUMMARY:Bank holiday',
  'DTSTART;VALUE=DATE:20251225',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('iCal reader', () => {
  it('unfolds continued lines', () => {
    expect(unfold('A:1\r\n B\r\n\tC\nD:2')).toEqual(['A:1BC', 'D:2']);
  });

  it('reads the events, with all-day ends exclusive and alarms ignored', () => {
    const events = parseIcal(CAL);
    expect(events.map((e) => [e.uid, e.summary, e.start, e.end, e.allDay])).toEqual([
      ['a@example.com', 'Summer holiday in, well, Cornwall', '2025-08-01', '2025-08-14', true],
      ['b', 'Dentist', '2025-09-03', '2025-09-03', false],
      ['c', 'Weekend in Edinburgh', '2025-10-17', '2025-10-19', false],
      ['e', 'Bank holiday', '2025-12-25', '2025-12-25', true],
    ]);
    expect(events[1].hours).toBe(1);
    expect(events[2].hours).toBe(54);
  });

  it('keeps all-day and long events only, with a guessed kind', () => {
    const events = fromCalendar(parseIcal(CAL));
    expect(events.map((e) => [e.id, e.kind, e.source])).toEqual([
      ['cal-a@example.com', 'holiday', 'calendar'],
      ['cal-c', 'trip', 'calendar'],
      ['cal-e', 'holiday', 'calendar'],
    ]);
  });

  it('copes with junk', () => {
    expect(parseIcal('')).toEqual([]);
    expect(parseIcal('BEGIN:VEVENT\nSUMMARY:no date\nEND:VEVENT')).toEqual([]);
  });
});

describe('life events', () => {
  it('checks events typed by hand', () => {
    expect(toManualEvent({ title: ' Baby ', kind: 'baby', start: '2025-03-01' }, 'x')).toEqual({
      id: 'x',
      title: 'Baby',
      kind: 'baby',
      start: '2025-03-01',
      end: '2025-03-01',
      source: 'manual',
    });
    expect(toManualEvent({ title: 'A', kind: 'nope', start: '2025-03-01' }, 'x').kind).toBe(
      'other',
    );
    expect(() => toManualEvent({ title: '', start: '2025-03-01' }, 'x')).toThrow('name');
    expect(() => toManualEvent({ title: 'A', start: '2025-13-01' }, 'x')).toThrow('start');
    expect(() =>
      toManualEvent({ title: 'A', start: '2025-03-02', end: '2025-03-01' }, 'x'),
    ).toThrow('before');
  });

  it('reads the file leniently and serves events without the address', () => {
    const f = normaliseLifeEvents({
      events: [{ id: 'b', title: 'B', kind: 'move', start: '2025-02-01' }, { id: 'bad' }],
      calendar: {
        url: 'https://cal.example/secret-token/basic.ics',
        events: [{ id: 'cal-a', title: 'A', kind: 'holiday', start: '2025-01-01' }],
      },
    });
    expect(f.events).toHaveLength(1);
    const served = servedLifeEvents(f);
    expect(served.map((e) => e.id)).toEqual(['cal-a', 'b']);
    expect(JSON.stringify(served)).not.toContain('secret');
    expect(calendarHost(f.calendar.url)).toBe('cal.example');
  });

  it('takes http(s) and webcal calendar addresses', () => {
    expect(toCalendarUrl('webcal://example.com/a.ics')).toBe('https://example.com/a.ics');
    expect(toCalendarUrl('')).toBe('');
    expect(() => toCalendarUrl('ftp://example.com/a.ics')).toThrow();
    expect(() => toCalendarUrl('not a url')).toThrow();
  });

  it('guesses kinds from names', () => {
    expect(guessKind('First day at Acme')).toBe('job');
    expect(guessKind('Moving day')).toBe('move');
    expect(guessKind('Paternity leave')).toBe('baby');
    expect(guessKind('Flight to Rome')).toBe('trip');
    expect(guessKind('Easter')).toBe('holiday');
  });
});
