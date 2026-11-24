'use strict';

const InviteScope = ((ICAL) => {
  const HOUR = 3600000;
  const DAY = HOUR * 24;
  const issueCodes = ['floating', 'no-zone-definition', 'embedded-vs-iana', 'fold', 'gap',
    'recurrence', 'duration', 'canceled'];
  const formatters = new Map();

  function civil(value, minimumYear = 1900) {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(Z)?)?$/.exec(value);
    if (!match) throw new Error('无法识别邀请中的日期或时间。');
    const [, y, mo, d, h = '0', mi = '0', s = '0'] = match;
    const epoch = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
    const expected = match[4] ? value.slice(0, 19) : value.slice(0, 10);
    if (+y < minimumYear || +y > 2099 || new Date(epoch).toISOString().slice(0, expected.length) !== expected) {
      throw new Error('日期或时间超出支持范围，或包含无效值。');
    }
    return epoch;
  }

  function formatter(zone) {
    if (typeof zone !== 'string' || zone.length > 90 || !/^[A-Za-z0-9_+\-/]+$/.test(zone)) {
      throw new Error('无效的时区名称。');
    }
    if (!formatters.has(zone)) {
      let fmt;
      try {
        fmt = new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
          timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
        });
      } catch {
        throw new Error('浏览器无法识别时区 ' + zone + '。');
      }
      formatters.set(zone, fmt);
    }
    return formatters.get(zone);
  }

  function localParts(epoch, zone) {
    const fields = {};
    for (const { type, value } of formatter(zone).formatToParts(epoch)) {
      if (type !== 'literal') fields[type] = value;
    }
    const { year, month, day, hour, minute, second } = fields;
    const iso = year + '-' + month + '-' + day + 'T' + hour + ':' + minute + ':' + second;
    const offset = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second) - epoch;
    return { iso, offset };
  }

  function resolveIana(wall, zone) {
    const offsets = new Set();
    for (let hours = -48; hours <= 48; hours += 6) {
      offsets.add(localParts(wall + hours * HOUR, zone).offset);
    }
    const alternatives = [...offsets].map(offset => {
      const instant = wall - offset;
      return { instant, actual: instant + localParts(instant, zone).offset };
    });
    const exact = alternatives.filter(a => a.actual === wall).sort((a, b) => a.instant - b.instant);
    if (exact.length) return { instant: exact[0].instant, warning: exact.length > 1 ? 'fold' : null };
    const later = alternatives.filter(a => a.actual > wall).sort((a, b) => a.actual - b.actual);
    if (!later.length) throw new Error('无法按此时区解释这段本地时间。');
    return { instant: later[0].instant, warning: 'gap' };
  }

  function sourceLine(component, name, required = false) {
    const rows = component.getAllProperties(name);
    if (rows.length > 1 || (required && !rows.length)) throw new Error('邀请中的 ' + name.toUpperCase() + ' 字段缺失或重复。');
    return rows[0];
  }

  function embeddedRules(component, year) {
    const rules = component.getAllSubcomponents().filter(part => ['standard', 'daylight'].includes(part.name));
    if (!rules.length || rules.length > 24) throw new Error('邀请中的时区规则为空或过多。');
    const transitions = [];
    for (const rule of rules) {
      const firstLine = sourceLine(rule, 'dtstart', true);
      const first = firstLine.jCal[3];
      if (!/T.*[^Z]$/.test(first) || firstLine.getParameter('tzid')) throw new Error('时区变更需要使用本地日期时间。');
      const before = sourceLine(rule, 'tzoffsetfrom', true).getFirstValue().toSeconds() * 1000;
      const after = sourceLine(rule, 'tzoffsetto', true).getFirstValue().toSeconds() * 1000;
      if (![before, after].every(x => Number.isFinite(x) && Math.abs(x) < DAY)) throw new Error('时区偏移超出有效范围。');
      const add = value => {
        if (typeof value !== 'string' || value.length !== 19 || value.endsWith('Z')) throw new Error('时区变更需要使用本地日期时间。');
        transitions.push({ instant: civil(value, 1601) - before, before, after });
      };
      add(first);
      for (const rdate of rule.getAllProperties('rdate')) {
        for (const value of rdate.jCal.slice(3)) add(value);
      }
      const recurrence = sourceLine(rule, 'rrule')?.getFirstValue();
      if (recurrence) {
        if (recurrence.freq !== 'YEARLY' || Object.entries(recurrence.parts).some(([key, values]) =>
          !['BYMONTH', 'BYDAY', 'BYMONTHDAY', 'BYSETPOS'].includes(key) || values.length > 7)) {
          throw new Error('此邀请使用了暂不支持的 VTIMEZONE 变更规则。');
        }
        const iterator = recurrence.iterator(ICAL.Time.fromDateTimeString(first));
        let next;
        let count = 0;
        while ((next = iterator.next()) && next.year <= Math.min(year + 1, 2099)) {
          if (++count > 520) throw new Error('此邀请的 VTIMEZONE 变更规则过于密集。');
          add(next.toString());
        }
      }
    }
    transitions.sort((a, b) => a.instant - b.instant);
    const unique = [];
    for (const item of transitions) {
      const previous = unique.at(-1);
      if (previous?.instant === item.instant) {
        if (previous.before !== item.before || previous.after !== item.after) throw new Error('邀请对同一时区变更给出了冲突规则。');
      } else unique.push(item);
    }
    return unique;
  }

  function resolveEmbedded(wall, component) {
    const transitions = embeddedRules(component, new Date(wall).getUTCFullYear());
    const offsets = new Set(transitions.flatMap(item => [item.before, item.after]));
    const exact = [...offsets].map(offset => [wall - offset, offset]).filter(([instant, offset]) => {
      const previous = transitions.findLast(item => item.instant <= instant);
      return offset === (previous ? previous.after : transitions[0].before);
    }).map(([instant]) => instant).sort((a, b) => a - b);
    if (exact.length) return { instant: exact[0], warning: exact.length > 1 ? 'fold' : null };
    const gap = transitions.find(item => item.after > item.before &&
      wall >= item.instant + item.before && wall < item.instant + item.after);
    if (gap) return { instant: wall - gap.before, warning: 'gap' };
    throw new Error('邀请内的时区规则无法解释该时间。');
  }

  function parse(text) {
    if (typeof text !== 'string' || text.length > 262144) throw new Error('请选择小于 256 KiB 的单个 .ics 文件。');
    let calendar;
    try {
      calendar = new ICAL.Component(ICAL.parse(text.replace(/^\uFEFF/, '')));
    } catch {
      throw new Error('无法读取 .ics 格式。');
    }
    if (calendar.name !== 'vcalendar') throw new Error('需要包含一个 VCALENDAR 的 .ics 文件。');
    const events = calendar.getAllSubcomponents('vevent');
    if (!events.length || events.length > 500) throw new Error('请提供包含 1 到 500 个日程的邀请。');
    const zones = new Map();
    for (const zone of calendar.getAllSubcomponents('vtimezone')) {
      const id = sourceLine(zone, 'tzid', true).getFirstValue();
      if (zones.has(id) || zones.size >= 16) throw new Error('邀请包含重复或过多的时区定义。');
      zones.set(id, zone);
    }
    return { calendar, events, zones };
  }

  function inspect(supplied, index) {
    const event = supplied.events[index];
    if (!event) throw new Error('请选择一个日程。');
    const warnings = new Set();
    if (['rrule', 'rdate', 'exdate', 'recurrence-id'].some(key => event.hasProperty(key))) warnings.add('recurrence');
    if (supplied.calendar.getFirstPropertyValue('method') === 'CANCEL' || event.getFirstPropertyValue('status') === 'CANCELLED') warnings.add('canceled');

    function endpoint(property) {
      const date = property.jCal[3];
      const zone = property.getParameter('tzid');
      const wall = civil(date);
      if (typeof zone !== 'undefined' && typeof zone !== 'string') throw new Error('邀请给同一时间指定了多个时区。');
      if (property.type === 'date') {
        if (zone || date.length !== 10) throw new Error('全天日程的日期不能附带时区。');
        return { kind: 'date', value: wall };
      }
      if (property.type !== 'date-time' || date.length < 19) throw new Error('邀请的时间字段格式无效。');
      if (date.endsWith('Z')) {
        if (zone) throw new Error('邀请同时指定 UTC 和另一个时区。');
        return { kind: 'fixed', value: wall, zone: 'UTC' };
      }
      if (!zone) {
        warnings.add('floating');
        return { kind: 'floating', value: wall };
      }
      const embedded = supplied.zones.get(zone);
      const choice = embedded ? resolveEmbedded(wall, embedded) : resolveIana(wall, zone);
      if (!embedded) warnings.add('no-zone-definition');
      if (embedded) {
        let inferred;
        try { inferred = resolveIana(wall, zone); } catch { /* custom zone has no IANA counterpart */ }
        if (inferred && inferred.instant !== choice.instant) warnings.add('embedded-vs-iana');
      }
      if (choice.warning) warnings.add(choice.warning);
      return { kind: 'fixed', value: choice.instant, zone };
    }

    const start = endpoint(sourceLine(event, 'dtstart', true));
    const endProperty = sourceLine(event, 'dtend');
    const duration = sourceLine(event, 'duration');
    if (endProperty && duration) throw new Error('邀请同时指定 DTEND 和 DURATION，无法确认结束时间。');
    if (duration) warnings.add('duration');
    const end = endProperty ? endpoint(endProperty) : undefined;
    if (end && (end.kind !== start.kind || end.value <= start.value)) throw new Error('结束时间与开始时间类型不一致，或早于开始时间。');
    return {
      title: String(event.getFirstPropertyValue('summary') || '无标题日程').slice(0, 250),
      sourceZone: start.zone || null, kind: start.kind, start: start.value,
      end: end?.value ?? (start.kind === 'date' && !duration ? start.value + DAY : null), warnings: [...warnings],
    };
  }

  function shareData(data, zones) {
    const { kind, start, end, warnings } = data;
    const inRange = epoch => Number.isSafeInteger(epoch) && epoch >= Date.UTC(1899, 11, 30) &&
      epoch <= Date.UTC(2100, 0, 3) && epoch % 1000 === 0;
    if (!['fixed', 'floating', 'date'].includes(kind) || !inRange(start) ||
      !(end === null || (inRange(end) && end > start)) ||
      (kind === 'date' && (start % DAY !== 0 || (end !== null && end % DAY !== 0))) ||
      !Array.isArray(warnings) || warnings.length > issueCodes.length || !warnings.every(code => issueCodes.includes(code)) ||
      !Array.isArray(zones) || zones.length !== 3 || new Set(zones).size !== 3) {
      throw new Error('分享链接的日期、时区或提示格式无效。');
    }
    zones.forEach(formatter);
    return { v: 1, kind, start, end, warnings: [...new Set(warnings)], zones: [...zones] };
  }

  function encode(data, zones) {
    return btoa(JSON.stringify(shareData(data, zones))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  }

  function decode(encoded) {
    if (!/^[A-Za-z0-9_-]{1,1536}$/.test(encoded)) throw new Error('分享链接格式无效。');
    let raw;
    try { raw = JSON.parse(atob(encoded.replaceAll('-', '+').replaceAll('_', '/'))); }
    catch { throw new Error('分享链接格式无效。'); }
    if (raw?.v !== 1 || Object.keys(raw).sort().join(',') !== 'end,kind,start,v,warnings,zones') {
      throw new Error('分享链接版本或字段无法识别。');
    }
    return shareData(raw, raw.zones);
  }

  return { parse, inspect, resolveIana, localParts, encode, decode };
})(typeof module !== 'undefined' && module.exports ? require('ical.js') : globalThis.ICAL);

if (typeof module !== 'undefined' && module.exports) module.exports = InviteScope;
