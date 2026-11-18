// probe.mjs — load a page headlessly and report errors and counts. A quick sanity check
// before a capture, and the tool that named the page's first console error during the build.
//
//   node tools/probe.mjs [url] [width] [height]

import { collectDiagnostics, launch } from './capture.mjs';

const url = process.argv[2] || 'http://127.0.0.1:8080/';
const width = parseInt(process.argv[3] || '1280', 10);
const height = parseInt(process.argv[4] || '800', 10);

const page = await launch({ width, height });
try {
  await page.goto(url);
  const ready = await page.waitFor('window.__ready === true || document.querySelector("#overlay.show")', 40000);
  await new Promise((r) => setTimeout(r, 1200));
  const state = await page.evaluate(`(() => {
    const g = window.__game;
    return {
      ready: readyFlag(),
      title: document.title,
      hasGame: !!g,
      mode: g ? g.mode : null,
      shotError: window.__shotError || null,
      buildings: g ? g.world.buildings.length : null,
      lamps: g ? g.world.lampCount : null,
      props: g ? g.world.props.length : null,
      palms: g ? g.world.palmCount : null,
      cars: g ? g.cars.cars.length : null,
      peds: g ? g.traffic.peds.length : null,
      layout: g ? g.world.layoutHash() : null,
      canvas: (() => { const c = document.getElementById('game'); return c ? [c.width, c.height] : null; })(),
      overlay: !!document.querySelector('#overlay.show'),
      buttons: Array.from(document.querySelectorAll('#overlay button')).map((b) => b.textContent),
    };
    function readyFlag() { return window.__ready === true; }
  })()`);
  const diag = collectDiagnostics(page.cdp.drainEvents());
  console.log(JSON.stringify({ url, state, ...diag }, null, 2));
  const bad = diag.exceptions.length + diag.consoleMessages.filter((m) => m.type === 'error').length;
  console.log(bad === 0 ? 'probe: clean' : `probe: ${bad} problem(s)`);
} catch (err) {
  console.error('probe failed:', err.message);
  process.exitCode = 1;
} finally {
  await page.close();
}
