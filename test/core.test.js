'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parse, inspect, localParts, encode, decode } = require('../core');
const views = ['America/New_York', 'Europe/London', 'Asia/Shanghai'];
const calendar = (lines, prefix = []) => [
  'BEGIN:VCALENDAR', 'VERSION:2.0', ...prefix, 'BEGIN:VEVENT', 'UID:secret-key',
  'SUMMARY:Confidential title', 'LOCATION:Hidden meeting room', 'ATTENDEE:mailto:private@example.invalid',
  ...lines, 'END:VEVENT', 'END:VCALENDAR', '',
].join('\r\n');
const read = (lines, prefix) => inspect(parse(calendar(lines, prefix)), 0);
const iso = value => new Date(value).toISOString();

test('IANA fall-back uses the first of two occurrences', () => {
  const r = read(['DTSTART;TZID=America/New_York:20261101T013000', 'DTEND;TZID=America/New_York:20261101T023000']);
  assert.equal(iso(r.start), '2026-11-01T05:30:00.000Z');
  assert.equal(iso(r.end), '2026-11-01T07:30:00.000Z');
  assert.deepEqual(r.warnings, ['no-zone-definition', 'fold']);
  assert.equal(localParts(r.start, 'Asia/Shanghai').iso, '2026-11-01T13:30:00');
});

test('IANA skipped wall time uses the offset before the DST gap', () => {
  const r = read(['DTSTART;TZID=America/New_York:20260308T023000']);
  assert.equal(iso(r.start), '2026-03-08T07:30:00.000Z');
  assert(r.warnings.includes('gap'));
});

test('floating, all-day, UTC and the next calendar date stay distinct', () => {
  const floating = read(['DTSTART:20261203T093000', 'DTEND:20261203T100000']);
  assert.equal(floating.kind, 'floating');
  assert.deepEqual(floating.warnings, ['floating']);
  const allDay = read(['DTSTART;VALUE=DATE:20261203']);
  assert.equal(allDay.kind, 'date');
  assert.equal(iso(allDay.end), '2026-12-04T00:00:00.000Z');
  const utc = read(['DTSTART:20261203T233000Z', 'DTEND:20261204T000000Z']);
  assert.equal(localParts(utc.start, 'Asia/Shanghai').iso, '2026-12-04T07:30:00');
  assert.equal(localParts(utc.start, 'America/New_York').iso, '2026-12-03T18:30:00');
});

test('an explicit VTIMEZONE takes precedence and differs from a same-name IANA zone', () => {
  const zone = ['BEGIN:VTIMEZONE', 'TZID:Europe/London', 'BEGIN:STANDARD', 'DTSTART:16010101T000000',
    'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0200', 'END:STANDARD', 'END:VTIMEZONE'];
  const r = read(['DTSTART;TZID=Europe/London:20260108T120000'], zone);
  assert.equal(iso(r.start), '2026-01-08T10:00:00.000Z');
  assert.deepEqual(r.warnings, ['embedded-vs-iana']);
});

test('a recurring embedded timezone applies its own transitions, including a fall-back fold', () => {
  const zone = ['BEGIN:VTIMEZONE', 'TZID:Custom/DST', 'BEGIN:DAYLIGHT', 'DTSTART:20200308T020000',
    'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'DTSTART:20201101T020000', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD', 'END:VTIMEZONE'];
  assert.equal(iso(read(['DTSTART;TZID=Custom/DST:20261101T013000'], zone).start), '2026-11-01T05:30:00.000Z');
  assert.equal(iso(read(['DTSTART;TZID=Custom/DST:20260308T023000'], zone).start), '2026-03-08T07:30:00.000Z');
  assert(read(['DTSTART;TZID=Custom/DST:20260308T023000'], zone).warnings.includes('gap'));
});

test('unknown zones and invalid dates fail while repetitions and duration are explicit', () => {
  assert.throws(() => read(['DTSTART;TZID=Other/Unknown:20261101T013000']), /无法识别时区/);
  assert.throws(() => read(['DTSTART:20260230T100000Z']), /无效值/);
  const r = read(['DTSTART:20261203T233000Z', 'RRULE:FREQ=DAILY;COUNT=3', 'DURATION:PT30M', 'STATUS:CANCELLED']);
  assert.deepEqual(r.warnings, ['recurrence', 'canceled', 'duration']);
  assert.equal(r.end, null);
});

test('a recipient can reopen time-only results without receiving any calendar metadata', () => {
  const r = read(['DTSTART:20261203T233000Z', 'URL:https://private.example.invalid/not-for-sharing']);
  const value = encode(r, views);
  const data = decode(value);
  assert.equal(data.start, r.start);
  assert.deepEqual(data.zones, views);
  const decoded = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  assert.doesNotMatch(decoded, /Confidential|private|secret|title|sourceZone/);
  assert.throws(() => decode(btoa(JSON.stringify({ ...data, title: 'untrusted' })).replace(/=+$/, '')), /字段/);
  assert.throws(() => decode('x'.repeat(1537)), /格式无效/);
});
