/** The shipped files agree with each other: scripts, precache list, version. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('index.html');
const sw = read('sw.js');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);

test('every script in index.html exists and is in the service worker precache list', () => {
  assert.ok(scripts.length > 10);
  for (const src of scripts) {
    assert.ok(fs.existsSync(path.join(ROOT, src)), `${src} exists`);
    assert.ok(sw.includes(`'./${src}'`), `${src} is in sw.js`);
  }
});

test('scripts load in dependency order: clock, format and series before models, models before engines, engines before main', () => {
  const at = (name) => scripts.indexOf(`js/${name}.js`);
  for (const [a, b] of [['clock', 'models'], ['format', 'models'], ['series', 'tci-engine'], ['summary', 'main'],
    ['models', 'remimazolam-eleveld-pkpd'], ['remimazolam-eleveld-pkpd', 'tci-engine'], ['tci-engine', 'main'],
    ['monitoring-engine', 'main'], ['induction-engine', 'main']]) {
    assert.ok(at(a) >= 0 && at(b) >= 0 && at(a) < at(b), `${a} before ${b}`);
  }
});

test('the version is the same in package.json, index.html, sw.js and the README history', () => {
  const v = JSON.parse(read('package.json')).version;
  assert.ok(html.includes(`v${v}`), 'index.html footer');
  assert.ok(sw.includes(`remimazolam-eleveld-v${v}`), 'service worker cache name');
  assert.ok(read('README.md').includes(`**${v}**`), 'README history row');
  assert.ok(read('CHANGELOG.md').includes(`## [${v}]`), 'CHANGELOG entry');
});
