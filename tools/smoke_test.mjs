// End-to-end smoke test of the sim -> TDLM pipeline (no Plotly).
// Verifies that a clean forward replay yields a forward sequenceness peak near
// the configured lag that exceeds the permutation-max threshold, and that
// raising noise sinks it below threshold.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
globalThis.mlMatrix = require(join(here, 'ml-matrix.cjs'));

const { generateProbas } = await import(join(root, 'src/sim.js'));
const { compute1step, signflipTest, transitionMatrixFromSequence } = await import(join(root, 'src/tdlm.js'));
const { RNG } = await import(join(root, 'src/rng.js'));

const sfreq = 100;
const lagSamp = 7;

function run(noise, nEvents, seed) {
  const sim = {
    nStates: 5, nSamples: 1500, sfreq, baseline: 0,
    noise: { global: noise, perState: null },
    magnitude: { global: 1, perState: null }, magnitudeModifier: 1,
    breadth: { global: 2, perState: null },
    lag: lagSamp, sequence: [0, 1, 2, 3, 4], nEvents, jitter: 0, refractory: 10,
    osc: { enabled: false }, clipZero: true, normalize: false, seed,
  };
  const { probas, onsets } = generateProbas(sim);
  const tf = transitionMatrixFromSequence([0, 1, 2, 3, 4], 5);
  const { seqFwd, seqBkw } = compute1step(probas, tf, {
    nShuf: 60, maxLag: 30, rng: new RNG(seed + 1),
  });

  // forward true curve and threshold
  const fwdTrue = seqFwd[0];
  let peakLag = 1, peakVal = -Infinity;
  for (let l = 1; l < fwdTrue.length; l++) if (fwdTrue[l] > peakVal) { peakVal = fwdTrue[l]; peakLag = l; }

  const permMax = (() => {
    let m = 0;
    for (let p = 1; p < seqFwd.length; p++)
      for (let l = 1; l < seqFwd[p].length; l++) m = Math.max(m, Math.abs(seqFwd[p][l]));
    return m;
  })();
  return { onsets: onsets.length, peakLag, peakVal, permMax, ratio: peakVal / permMax };
}

let fail = 0;
function expect(cond, msg) { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; }

console.log('--- clean replay (low noise, many events) ---');
const clean = run(0.1, 15, 1);
console.log(clean);
expect(Math.abs(clean.peakLag - lagSamp) <= 2, `forward peak lag ${clean.peakLag} ~ ${lagSamp}`);
expect(clean.ratio > 1, `forward peak ${clean.ratio.toFixed(2)}x above perm-max threshold`);
expect(clean.onsets === 15, `inserted ${clean.onsets} events`);

console.log('\n--- noisy / no real replay (high noise, 1 event) ---');
const noisy = run(1.5, 1, 2);
console.log(noisy);
expect(noisy.ratio < clean.ratio, `noisy ratio ${noisy.ratio.toFixed(2)} < clean ${clean.ratio.toFixed(2)}`);

// --- sign-flip across subjects: clean replay should be significant ---------
console.log('\n--- sign-flip test (12 subjects, clean replay) ---');
function diffSeq(noise, seed) {
  const sim = {
    nStates: 5, nSamples: 1500, sfreq, baseline: 0,
    noise: { global: noise, perState: null },
    magnitude: { global: 1, perState: null }, magnitudeModifier: 1,
    breadth: { global: 2, perState: null },
    lag: lagSamp, sequence: [0, 1, 2, 3, 4], nEvents: 10, jitter: 0,
    osc: { enabled: false }, clipZero: true, normalize: false, seed,
  };
  const { probas } = generateProbas(sim);
  const tf = transitionMatrixFromSequence([0, 1, 2, 3, 4], 5);
  const { seqFwd, seqBkw } = compute1step(probas, tf, {
    perms: [[0, 1, 2, 3, 4]], maxLag: 30,
  });
  const out = [];
  for (let l = 1; l <= 30; l++) out.push(seqFwd[0][l] - seqBkw[0][l]);
  return out;
}
const sx = [];
for (let s = 0; s < 12; s++) sx.push(diffSeq(0.4, 100 + s));
const sf = signflipTest(sx, 5000, new RNG(1));
console.log({ tObs: +sf.tObs.toFixed(3), pvalue: sf.pvalue });
expect(sf.pvalue < 0.05, `sign-flip p=${sf.pvalue} < 0.05 for clean replay`);

console.log('\n' + (fail ? `${fail} CHECK(S) FAILED` : 'SMOKE TEST PASSED'));
process.exit(fail ? 1 : 0);
