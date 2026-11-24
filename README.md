# InviteScope

**Check what time an `.ics` invitation means in three time zones, then share the result.**

[Try it in your browser](https://thitrang20160-cell.github.io/invitescope/) · [Download the offline edition](https://github.com/thitrang20160-cell/invitescope/releases/latest) · [Report a calendar discrepancy](https://github.com/thitrang20160-cell/invitescope/issues)

The first example opens with a result already on screen. On 1 November 2026, clocks in New York show 01:30 twice. InviteScope shows which occurrence RFC 5545 specifies and the corresponding times in London and Shanghai. The first release interface is in Simplified Chinese.

| Try an example | What to look for |
| --- | --- |
| [Daylight saving ends](https://thitrang20160-cell.github.io/invitescope/?example=fold) | The repeated 01:30 is interpreted as the first occurrence. |
| [An invitation with no fixed time zone](https://thitrang20160-cell.github.io/invitescope/?example=floating) | Each city sees the same wall-clock time, corresponding to a different UTC instant. |
| [A meeting crosses midnight](https://thitrang20160-cell.github.io/invitescope/?example=rollover) | The calendar date changes with the selected time zone. |

## Why it exists

A user reported an Outlook export appearing at the wrong time in Google Calendar, and maintainers discussed how omitting `VTIMEZONE` produces inconsistent interpretations between clients. InviteScope gives the organizer and recipient the same time comparison to discuss. It interprets fields from the invitation and flags the assumptions it made. [Outlook export report](https://gist.github.com/florisvanvugt/b6ef1c67f98c20944ec3c9ebd7da76d4) · [calendar-links issue](https://github.com/spatie/calendar-links/issues/235) · [RFC 5545 time rules](https://datatracker.ietf.org/doc/html/rfc5545#section-3.3.5)

## 怎样试用

1. 打开在线试用页，先看「夏令时回拨」样例。
2. 选择自己的 `.ics` 文件。文件中有多个日程时，可以切换要核对的那一条。
3. 选择三个时区，点击「生成分享链接」。对方打开链接就能看到同一组核对结果。

**日历文件在浏览器内处理。** 分享链接仅含开始与结束时间、所选时区、时间类型和提示编号。标题、地点、参与者、会议链接和原文件不会写入链接。收到链接的人都可以读取其中的时间信息。

首版按文件中的单条日程核对时间。重复日程显示当前条目的日期和时间，不展开所有未来场次。若文件仅用 `DURATION` 给出时长，结果只显示开始时间。遇到不同日历显示不一致，欢迎在 Issues 说明客户端、文件的时区字段和你看到的差异，可用脱敏样例复现。

## Develop

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run check:build
```

Open the generated `index.html` directly. It is the same single-file bundle served by GitHub Pages, and it also works offline. The repository's application code is MIT licensed. The bundled [ical.js 2.2.1 source](https://www.npmjs.com/package/ical.js/v/2.2.1) is available under MPL-2.0, with its notice and licence included in the bundle.
