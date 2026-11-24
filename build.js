'use strict';

const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const read = name => readFileSync(join(__dirname, name), 'utf8').replace(/\r\n/g, '\n');
const files = {
  CSS: 'style.css', LIB: 'node_modules/ical.js/dist/ical.es5.min.cjs',
  CORE: 'core.js', APP: 'app.js',
};
const applicationLicense = read('LICENSE');
const libraryLicense = read('node_modules/ical.js/LICENSE');
if ([applicationLicense, libraryLicense].some(license => license.includes('-->'))) {
  throw new Error('Unexpected HTML comment delimiter in bundled license.');
}
const template = read('page.html').replace('<!-- ICAL-LICENSE -->', () =>
  '<!-- InviteScope application code\n' + applicationLicense + '\n-->\n' +
  '<!-- ical.js 2.2.1, MPL-2.0. Corresponding source: https://www.npmjs.com/package/ical.js/v/2.2.1\n' +
  libraryLicense + '\n-->');
const html = template.replace(/\/\* (CSS|LIB|CORE|APP) \*\//g, (_, key) => {
  const source = read(files[key]);
  if (/<\/(script|style)/i.test(source)) throw new Error('Unexpected closing tag in ' + files[key]);
  return source;
});
if (process.argv.includes('--check')) {
  if (read('index.html') !== html) throw new Error('The standalone HTML is stale.');
} else {
  writeFileSync(join(__dirname, 'index.html'), html);
}
