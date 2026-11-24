'use strict';

const get = id => document.getElementById(id);
const zoneControls = ['zone-one', 'zone-two', 'zone-three'].map(get);
const defaultZones = ['America/New_York', 'Europe/London', 'Asia/Shanghai'];
const warnings = {
  floating: '邀请没有指定固定时区。各地按自己的当地时钟解释，同一个钟点可能对应不同的 UTC 时间。',
  'no-zone-definition': '文件使用了 TZID，却没有附带对应的 VTIMEZONE。此处按浏览器的时区规则预览，客户端结果可能不同。',
  'embedded-vs-iana': '邀请附带的时区规则与浏览器同名时区不同。本结果使用邀请内的规则。',
  fold: '夏令时回拨使至少一个时间出现两次。按 RFC 5545 采用第一次。',
  gap: '夏令时跳变使至少一个时间不存在。按 RFC 5545 使用跳变前的偏移。',
  recurrence: '文件包含重复规则或例外。此处只显示选中条目所列的时间。',
  duration: '文件用 DURATION 指定时长。本版只显示开始时间。',
  canceled: '文件把此日程标记为取消。',
};
const names = {
  'America/New_York': '纽约', 'America/Los_Angeles': '洛杉矶', 'Europe/London': '伦敦',
  'Asia/Shanghai': '北京时间', 'Asia/Tokyo': '东京', 'Asia/Kolkata': '印度时间', 'UTC': 'UTC',
};
const sample = (title, start, end) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//InviteScope//Demo//EN',
  'BEGIN:VEVENT', 'UID:demo@example.invalid', 'DTSTAMP:20261120T120000Z', 'SUMMARY:' + title, start, end,
  'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
const examples = {
  fold: sample('纽约 01:30 出现了两次', 'DTSTART;TZID=America/New_York:20261101T013000', 'DTEND;TZID=America/New_York:20261101T023000'),
  floating: sample('各地的 09:30 是同一场会议吗？', 'DTSTART:20261203T093000', 'DTEND:20261203T100000'),
  rollover: sample('伦敦周四晚上，北京已是周五', 'DTSTART:20261203T233000Z', 'DTEND:20261204T000000Z'),
};
let source;
let model;
let shared = false;
let selectedZones = [...defaultZones];
let importRevision = 0;

const iso = epoch => new Date(epoch).toISOString().replace('.000Z', 'Z');
const spaced = value => value.replace('T', ' ').replace(/Z$/, ' UTC');
const selectedTitle = data => data.title || '日历邀请时间核对';

function text(tag, value) {
  const element = document.createElement(tag);
  element.textContent = value;
  return element;
}

function offsetLabel(offset) {
  const sign = offset >= 0 ? '+' : '−';
  const seconds = Math.abs(offset) / 1000;
  const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor(seconds % 3600 / 60)).padStart(2, '0');
  const rest = seconds % 60 ? ':' + String(seconds % 60).padStart(2, '0') : '';
  return 'UTC' + sign + hours + ':' + minutes + rest;
}

function timeRow(data, zone) {
  const row = document.createElement('li');
  row.className = 'time-row';
  row.dataset.zone = zone;
  row.append(text('strong', names[zone] ? names[zone] + ' · ' + zone : zone));
  const body = document.createElement('div');
  row.append(body);
  if (data.kind === 'date') {
    body.append(text('time', iso(data.start).slice(0, 10)));
    if (data.end !== null) body.append(text('small', '结束日期不含当天 ' + iso(data.end).slice(0, 10)));
    return row;
  }
  if (data.kind === 'floating') {
    const start = spaced(iso(data.start).slice(0, -1));
    body.append(text('time', start + '（当地）'));
    const local = InviteScope.resolveIana(data.start, zone);
    body.append(text('small', '在此时区开始相当于 ' + spaced(iso(local.instant)) +
      (local.warning ? '，当天有夏令时变更' : '')));
    return row;
  }
  const start = InviteScope.localParts(data.start, zone);
  const end = data.end === null ? null : InviteScope.localParts(data.end, zone);
  body.append(text('time', spaced(start.iso)));
  body.append(text('small', offsetLabel(start.offset) + (end ? ' · 结束 ' + spaced(end.iso) +
    (end.offset !== start.offset ? ' ' + offsetLabel(end.offset) : '') : '')));
  return row;
}

function report() {
  get('message').textContent = '';
  get('sharing').hidden = true;
  get('report').hidden = !model;
  if (!model) return;
  get('mode').textContent = shared ? '链接中的时间预览 · 未读取原始邀请' :
    ({ fixed: '固定时间', floating: '浮动时间', date: '全天日程' }[model.kind]);
  get('event-title').textContent = selectedTitle(model);
  let reference;
  if (model.kind === 'fixed') reference = spaced(iso(model.start)) + (model.end === null ? '' : ' → ' + spaced(iso(model.end)));
  else if (model.kind === 'date') reference = '全天日期在各时区保持一致。';
  else reference = '邀请没有指定一个全世界共同的开始时刻。';
  if (model.sourceZone) reference += ' · 邀请时区 ' + model.sourceZone;
  get('reference').textContent = reference;
  get('times').replaceChildren(...selectedZones.map(zone => timeRow(model, zone)));
  get('warnings').replaceChildren(...model.warnings.map(code => text('li', warnings[code])));
  get('warnings').hidden = !model.warnings.length;
}

function fail(error) {
  model = null;
  report();
  get('message').textContent = error instanceof Error ? error.message : String(error);
}

function openEvent() {
  try {
    model = InviteScope.inspect(source, Number(get('event').value) || 0);
    report();
  } catch (error) { fail(error); }
}

function loadCalendar(data, example) {
  source = InviteScope.parse(data);
  shared = false;
  const selector = get('event');
  selector.replaceChildren(...source.events.map((event, index) => {
    const option = text('option', String(event.getFirstPropertyValue('summary') || '日程 ' + (index + 1)).slice(0, 250));
    option.value = String(index);
    return option;
  }));
  get('event-control').hidden = source.events.length === 1 && Boolean(example);
  openEvent();
}

function renderZones() {
  zoneControls.forEach((control, index) => {
    const selected = selectedZones[index];
    if (![...control.options].some(option => option.value === selected)) {
      const option = text('option', selected);
      option.value = selected;
      control.append(option);
    }
    control.value = selected;
    for (const option of control.options) {
      option.disabled = selectedZones.includes(option.value) && option.value !== selected;
    }
  });
}

const otherZones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') :
  ['America/Chicago', 'Asia/Singapore', 'Australia/Sydney', 'Europe/Paris'];
const zoneList = [...new Set(['UTC', ...defaultZones, ...otherZones])];
zoneControls.forEach((control, index) => {
  control.replaceChildren(...zoneList.map(zone => {
    const option = text('option', names[zone] ? names[zone] + ' · ' + zone : zone);
    option.value = zone;
    return option;
  }));
  control.addEventListener('change', () => {
    selectedZones[index] = control.value;
    renderZones();
    if (model) report();
  });
});
get('event').addEventListener('change', openEvent);
get('file').addEventListener('change', async event => {
  const revision = ++importRevision;
  const file = event.target.files[0];
  if (!file) return;
  source = null;
  get('event-control').hidden = true;
  model = null;
  report();
  document.querySelector('[aria-current="page"]')?.removeAttribute('aria-current');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  try {
    if (file.size > 262144) throw new Error('请选择小于 256 KiB 的 .ics 文件。');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    if (revision === importRevision) loadCalendar(content, false);
  } catch (error) { if (revision === importRevision) fail(error); }
});

get('share').addEventListener('click', () => {
  try {
    const result = new URL(location.protocol === 'file:' ?
      'https://thitrang20160-cell.github.io/invitescope/' : location.href);
    result.search = '';
    result.hash = 'r=' + InviteScope.encode(model, selectedZones);
    get('share-url').value = result.href;
    get('copy-status').textContent = '';
    get('sharing').hidden = false;
    get('share-url').focus();
    get('share-url').select();
  } catch (error) { get('message').textContent = error.message; }
});
get('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(get('share-url').value);
    get('copy-status').textContent = '已复制结果链接。';
  } catch {
    get('share-url').focus();
    get('share-url').select();
    get('copy-status').textContent = '链接已选中，可以用键盘复制。';
  }
});

try {
  const url = new URL(location.href);
  if (url.hash.startsWith('#r=')) {
    model = InviteScope.decode(url.hash.slice(3));
    shared = true;
    selectedZones = model.zones;
    report();
  } else {
    const requested = url.searchParams.get('example');
    const example = Object.hasOwn(examples, requested) ? requested : 'fold';
    get('sample-' + example).setAttribute('aria-current', 'page');
    loadCalendar(examples[example], true);
  }
} catch (error) { fail(error); }
renderZones();
