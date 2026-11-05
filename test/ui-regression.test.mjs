import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { historyOutcomeLabel } from '../src/history.mjs';
import { architectureSvg } from '../src/diagram.mjs';
import { EXAMPLES } from '../src/examples.mjs';

// DOM-free coverage for browser-only fixes. Pure logic is unit-tested; DOM
// wiring below is asserted as static tripwires so accidental removal fails.
test('history outcome labels stay consistent across UI, history, and export', () => {
  assert.equal(historyOutcomeLabel('interrupted'), 'Interrupted · earlier results kept');
  assert.equal(historyOutcomeLabel('passed'), 'Passed');
  assert.equal(historyOutcomeLabel('no_selection'), 'No change selected');
  assert.equal(historyOutcomeLabel('insufficient'), 'Insufficient');
  assert.equal(historyOutcomeLabel('tested'), 'Before tested');
  assert.equal(historyOutcomeLabel('unknown'), 'Before tested');
});

test('browser-only fixes remain wired in app and style sources', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const app = readFileSync(root + '/src/app.js', 'utf8');
  const css = readFileSync(root + '/src/style.css', 'utf8');
  // Finding 8: incompatible-history open shows an actionable modal with a back path.
  assert.ok(app.includes('backHistory') && app.includes('cannot be opened'), 'history open error UI present');
  // Finding 10: dirty warning preserved alongside the findings link.
  assert.ok(app.includes(`(s.dirty?'Inputs changed. Run a new test. ':'')+'<button id="jumpFindings"`), 'dirty hint plus findings link present');
  // Finding 9: no-selection wording (behavior covered in no-selection.test.mjs; wording tripwire here).
  for (const s of ['No change selected', 'Passing alternative · none selected', 'Why no change was selected']) assert.ok(app.includes(s), 'missing UI wording: ' + s);
  // Finding 3: corrections displayed separately in review.
  assert.ok(app.includes('Corrections applied:') && app.includes('g.corrections'), 'corrections display present');
  // Findings 6-7: review grid fits ID + delete; focus restored after add/delete.
  assert.ok(css.includes('.review-nodes>div{display:grid;grid-template-columns:1.5fr 1fr auto auto'), 'desktop review grid present');
  assert.ok(css.includes('.review-nodes>div{grid-template-columns:1fr 1fr}'), 'mobile review grid present');
  assert.ok(app.includes(`$('addConnection')?.focus()`), 'delete-connection focus restore present');
  assert.ok(app.includes(`$('addComponent')?.focus()`), 'delete-node focus restore present');
  assert.ok(app.includes(`document.querySelector('[data-label="'`), 'new-component focus present');
  assert.ok(app.includes(`document.querySelector('[data-edge="'`), 'new-connection focus present');
});

test('each rendered diagram keeps a unique id namespace so filters and markers resolve locally', () => {
  const a = architectureSvg(EXAMPLES[0].graph), b = architectureSvg(EXAMPLES[1].graph);
  const ids = s => [...s.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const refs = s => [...s.matchAll(/url\(#([^)]+)\)/g)].map(m => m[1]);
  assert.equal(new Set(ids(a)).size, ids(a).length, 'duplicate ids within one render');
  for (const id of ids(a)) assert.ok(!ids(b).includes(id), 'shared id across renders: ' + id);
  for (const ref of refs(a)) assert.ok(ids(a).includes(ref), 'dangling reference: ' + ref);
});

test('tour slide transitions stay wired', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const app = readFileSync(root + '/src/app.js', 'utf8');
  const css = readFileSync(root + '/src/style.css', 'utf8');
  assert.ok(app.includes('el.classList.add(dir)'), 'slide animation retrigger present');
  for (const s of ['@keyframes slide-in', '@keyframes slide-in-back', '@keyframes view-in', '@keyframes pop-in']) assert.ok(css.includes(s), 'missing motion keyframes: ' + s);
});

test('brand wordmark stays two-tone with a sized logo slot', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const app = readFileSync(root + '/src/app.js', 'utf8');
  const css = readFileSync(root + '/src/style.css', 'utf8');
  const html = readFileSync(root + '/src/index.html', 'utf8');
  assert.ok(css.includes('.brand>span:first-child'), 'logo slot scoping present');
  assert.ok(css.includes('.brand em'), 'wordmark accent present');
  assert.ok(html.includes('<span>Napkin<em>Cloud</em></span>'), 'two-tone wordmark present');
  assert.ok(app.includes('mascot-orbit'), 'cute animated logo present');
});
