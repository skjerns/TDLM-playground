// Numerical parity test: JS TDLM port vs Python `tdlm` package.
// Run:  node tools/parity_test.mjs   (after: python3 tools/gen_reference.py)
//
// Loads tools/reference.json (produced from the installed Python package) and
// asserts the JS findBetas / compute1step true-row outputs match to a tight tol.

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// expose ml-matrix as the global the modules expect
globalThis.mlMatrix = require(join(here, 'ml-matrix.cjs'));

const { findBetas, compute1step, signflipTest } = await import(join(root, 'src/tdlm.js'));

const ref = JSON.parse(readFileSync(join(here, 'reference.json'), 'utf8'));
const { n_states, max_lag, alpha_freq } = ref.params;

// --- helpers ---------------------------------------------------------------
function maxAbsDiff(a, b) {
  let m = 0;
  const fa = a.flat(Infinity), fb = b.flat(Infinity);
  if (fa.length !== fb.length) throw new Error(`length mismatch ${fa.length} vs ${fb.length}`);
  for (let i = 0; i < fa.length; i++) {
    const av = Number.isNaN(fa[i]) ? 0 : fa[i];
    const bv = Number.isNaN(fb[i]) ? 0 : fb[i];
    m = Math.max(m, Math.abs(av - bv));
  }
  return m;
}

const results = [];
function check(name, diff, tol) {
  const ok = diff <= tol;
  results.push({ name, diff, tol, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(32)} maxAbsDiff=${diff.toExponential(3)} (tol ${tol.toExponential(1)})`);
}

const TOL = 1e-9;

// --- 1. first-level betas (alpha off) -------------------------------------
const betasJs = findBetas(ref.probas, n_states, max_lag, null);
check('findBetas (alpha off)', maxAbsDiff(betasJs, ref.betas), TOL);

// --- 2. first-level betas (alpha confound) --------------------------------
const betasAlphaJs = findBetas(ref.probas, n_states, max_lag, alpha_freq);
check('findBetas (alpha freq)', maxAbsDiff(betasAlphaJs, ref.betas_alpha), TOL);

// --- 3. true-row sequenceness (alpha off) ---------------------------------
// row 0 = identity permutation, RNG-independent.
const r1 = compute1step(ref.probas, ref.tf, { perms: [ [...Array(n_states).keys()] ], maxLag: max_lag });
check('seq_fwd true (alpha off)', maxAbsDiff(r1.seqFwd[0], ref.seq_fwd_true), TOL);
check('seq_bkw true (alpha off)', maxAbsDiff(r1.seqBkw[0], ref.seq_bkw_true), TOL);

// --- 4. true-row sequenceness (alpha correction) --------------------------
const r2 = compute1step(ref.probas, ref.tf, {
  perms: [ [...Array(n_states).keys()] ], maxLag: max_lag, alphaFreq: alpha_freq,
});
check('seq_fwd true (alpha freq)', maxAbsDiff(r2.seqFwd[0], ref.seq_fwd_true_alpha), TOL);
check('seq_bkw true (alpha freq)', maxAbsDiff(r2.seqBkw[0], ref.seq_bkw_true_alpha), TOL);

// --- 5. sign-flip observed max-t (RNG-independent) ------------------------
const sfJs = signflipTest(ref.signflip_sx, 10); // few perms; we only check tObs
check('signflip t_obs', Math.abs(sfJs.tObs - ref.signflip_t_obs), 1e-9);

// --- summary ---------------------------------------------------------------
const failed = results.filter(r => !r.ok);
console.log('\n' + (failed.length ? `${failed.length} CHECK(S) FAILED` : 'ALL PARITY CHECKS PASSED'));
process.exit(failed.length ? 1 : 0);
