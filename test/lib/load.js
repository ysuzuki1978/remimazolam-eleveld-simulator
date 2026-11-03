/**
 * Loads the app's classic <script> files that have no DOM dependency into one
 * vm context, in index.html order, so the engines are tested as shipped.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const FILES = [
  'js/clock.js', 'js/format.js', 'js/series.js', 'js/summary.js', 'js/models.js',
  'js/remimazolam-eleveld-pkpd.js', 'js/induction-engine.js', 'js/tci-engine.js', 'js/monitoring-engine.js'
];

/** @param {{root?: string}} [options] root: directory to load from (e.g. a snapshot of an older tree) */
function loadApp({ root = ROOT } = {}) {
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {}, info() {} },
    Math, Date, window: {},
    setInterval() { return 1; }, clearInterval() {}
  });
  for (const file of FILES) {
    const full = path.join(root, file);
    if (fs.existsSync(full)) vm.runInContext(fs.readFileSync(full, 'utf8'), context, { filename: file });
  }
  // top-level const / class declarations live in the context's lexical scope, not on the global
  const get = (name) => vm.runInContext(name, context);
  return { context, get, run: (code) => vm.runInContext(code, context) };
}

module.exports = { loadApp, ROOT };
