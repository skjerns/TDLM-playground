// Port of tdlm/core.py (GLM 1-step sequenceness) to JS.
// Mirrors `_find_betas`, `unique_permutations`, and `compute_1step` so that
// results match the Python `tdlm` package (see tools/parity_test.mjs).

import { pinv, matmul, zeros, eye, ones, transpose, flattenF, reshapeF, permuteSquare } from './linalg.js';
import { RNG } from './rng.js';

/**
 * Build the lag design matrix used by `_find_betas`.
 * For each state kk and lag L (1..max_lag), the column at index
 * kk*max_lag + (L-1) holds probas[:,kk] shifted down by L (causal, zero-padded).
 * This reproduces hstack([toeplitz(probas[:,kk], zeros(max_lag+1))[:,1:] ...]).
 * @returns {number[][]} shape (n_samples, n_states*max_lag)
 */
export function buildDesignMatrix(probas, nStates, maxLag) {
  const nSamples = probas.length;
  const dm = zeros(nSamples, nStates * maxLag);
  for (let kk = 0; kk < nStates; kk++) {
    const base = kk * maxLag;
    for (let L = 1; L <= maxLag; L++) {
      const col = base + (L - 1);
      for (let i = L; i < nSamples; i++) {
        dm[i][col] = probas[i - L][kk];
      }
    }
  }
  return dm;
}

/**
 * First-level GLM: regress each state's probability on the lagged copies of all
 * states. Mirrors `_find_betas`. `alphaFreq` (in SAMPLES, not Hz) controls the
 * column grouping for alpha-oscillation confounding; null => grouping by lag.
 * @returns {number[][]} betas of shape (n_states*max_lag, n_states)
 */
export function findBetas(probas, nStates, maxLag, alphaFreq = null) {
  const nSamples = probas.length;
  const dm = buildDesignMatrix(probas, nStates, maxLag);
  const betas = zeros(nStates * maxLag, nStates);
  const bins = alphaFreq || maxLag;

  for (let ilag = 0; ilag < bins; ilag++) {
    // gather columns at stride `bins` starting at `ilag`
    const idx = [];
    for (let c = 0; c < nStates * maxLag; c += bins) idx.push(c + ilag);

    // ilag_X = [selected columns | ones], shape (n_samples, idx.length+1)
    const ilagX = zeros(nSamples, idx.length + 1);
    for (let i = 0; i < nSamples; i++) {
      for (let j = 0; j < idx.length; j++) ilagX[i][j] = dm[i][idx[j]];
      ilagX[i][idx.length] = 1; // constant term
    }

    // ilag_betas = pinv(ilag_X) @ probas, shape (idx.length+1, n_states)
    const ilagBetas = matmul(pinv(ilagX), probas);

    // betas[idx, :] = ilag_betas[0:-1, :]   (drop the constant row)
    for (let j = 0; j < idx.length; j++) {
      betas[idx[j]] = ilagBetas[j].slice();
    }
  }
  return betas;
}

/**
 * Port of utils.unique_permutations(arange(n_states), nShuf, ...).
 * Row 0 is always the identity (non-shuffled). Remaining rows are unique random
 * permutations. Optional maxTrueTrans filters perms whose 1-step transition
 * overlap with the identity sequence exceeds the bound.
 * @returns {number[][]} shape (n_perms, n_states); n_perms <= nShuf
 */
export function uniquePermutations(nStates, nShuf, rng, maxTrueTrans = null) {
  const factorial = (n) => { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; };
  const maxPerms = factorial(nStates);
  const k = Math.min(nShuf, maxPerms);

  const identity = Array.from({ length: nStates }, (_, i) => i);
  const key = (a) => a.join(',');

  // transitions of the identity sequence, as a set of "i>j" strings
  const trueTrans = new Set();
  for (let i = 0; i < nStates - 1; i++) trueTrans.add(identity[i] + '>' + identity[i + 1]);
  const overlap = (perm) => {
    let n = 0;
    for (let i = 0; i < perm.length - 1; i++) if (trueTrans.has(perm[i] + '>' + perm[i + 1])) n++;
    return n;
  };

  const seen = new Set([key(identity)]);
  const perms = [identity.slice()];
  const discarded = new Set();

  while (perms.length < k) {
    const p = rng.permutation(nStates);
    const kp = key(p);
    if (seen.has(kp) || discarded.has(kp)) continue;
    if (maxTrueTrans !== null && overlap(p) > maxTrueTrans) {
      discarded.add(kp);
      if (seen.size + discarded.size >= maxPerms) break; // no more valid perms
      continue;
    }
    seen.add(kp);
    perms.push(p);
  }
  return perms;
}

/**
 * Compute 1-step forward/backward sequenceness. Mirrors `compute_1step`.
 *
 * @param {number[][]} probas  (n_samples x n_states) probability time series
 * @param {number[][]} tf      (n_states x n_states) forward transition matrix
 * @param {object} opts
 *   tb         backward transitions; default tf transposed
 *   nShuf      number of permutations (incl. identity at row 0). default 100
 *   maxLag     max lag in samples. default 50
 *   alphaFreq  alpha confound freq in SAMPLES (null = off)
 *   maxTrueTrans  perm transition-overlap cap (null = off)
 *   rng        RNG instance (seedable). default new RNG(0)
 *   perms      optional explicit permutation list (overrides rng) — used by tests
 * @returns {{seqFwd:number[][], seqBkw:number[][], perms:number[][]}}
 *   seqFwd/seqBkw shape (n_perms, max_lag+1); row 0 = true, column 0 = NaN.
 */
export function compute1step(probas, tf, opts = {}) {
  const {
    tb = transpose(tf),
    nShuf = 100,
    maxLag = 50,
    alphaFreq = null,
    maxTrueTrans = null,
    rng = new RNG(0),
    perms: explicitPerms = null,
  } = opts;

  const nStates = probas[0].length;
  if (tf.length !== nStates) throw new Error(`tf size ${tf.length} must equal n_states ${nStates}`);

  const perms = explicitPerms || uniquePermutations(nStates, nShuf, rng, maxTrueTrans);
  const nPerms = perms.length;

  // first-level GLM
  const betas = findBetas(probas, nStates, maxLag, alphaFreq);
  // reshape (n_states*max_lag, n_states) -> (max_lag, n_states^2), Fortran order
  const betasStage = reshapeF(flattenF(betas), maxLag, nStates * nStates);
  const betasStageT = transpose(betasStage); // (n_states^2, max_lag)

  const tAuto = eye(nStates);
  const tConst = ones(nStates, nStates);
  const squashAuto = flattenF(tAuto);
  const squashConst = flattenF(tConst);

  const seqFwd = zeros(nPerms, maxLag + 1, NaN);
  const seqBkw = zeros(nPerms, maxLag + 1, NaN);

  for (let i = 0; i < nPerms; i++) {
    const rp = perms[i];
    const tfPerm = permuteSquare(tf, rp);
    const tbPerm = permuteSquare(tb, rp);

    // dm columns: [squash(tf), squash(tb), squash(auto), squash(const)]
    const sf = flattenF(tfPerm), sb = flattenF(tbPerm);
    const nsq = nStates * nStates;
    const dm = zeros(nsq, 4);
    for (let r = 0; r < nsq; r++) {
      dm[r][0] = sf[r];
      dm[r][1] = sb[r];
      dm[r][2] = squashAuto[r];
      dm[r][3] = squashConst[r];
    }

    // bbb = pinv(dm) @ betasStageT  -> (4, max_lag)
    const bbb = matmul(pinv(dm), betasStageT);
    for (let L = 0; L < maxLag; L++) {
      seqFwd[i][L + 1] = bbb[0][L];
      seqBkw[i][L + 1] = bbb[1][L];
    }
  }

  return { seqFwd, seqBkw, perms };
}

/**
 * One-sided max-t sign-flip permutation test across observations (subjects).
 * Port of core.py::signflit_test. `sx` is (n_obs x n_lags) — usually each row is
 * one subject's sequenceness across time lags. For each permutation a random
 * subset of observations is sign-flipped, a per-lag t-stat is computed using the
 * fixed SE from the original data, and the max across lags is recorded; the
 * observed max-t is compared against that null. Accounts for multiple comparisons.
 *
 * @returns {{pvalue:number, tObs:number, tPerms:number[], tCols:number[]}}
 *   tObs and tCols are RNG-independent; pvalue/tPerms depend on the RNG.
 */
export function signflipTest(sx, nPerms = 5000, rng = new RNG(0)) {
  const nObs = sx.length;
  if (nObs < 2) throw new Error(`sign-flip test needs n_obs > 1, got ${nObs}`);
  const nLags = sx[0].length;

  // per-lag mean and SE (ddof=1)
  const mean = new Array(nLags).fill(0);
  for (let o = 0; o < nObs; o++) for (let l = 0; l < nLags; l++) mean[l] += sx[o][l];
  for (let l = 0; l < nLags; l++) mean[l] /= nObs;

  const se = new Array(nLags);
  for (let l = 0; l < nLags; l++) {
    let v = 0;
    for (let o = 0; o < nObs; o++) { const d = sx[o][l] - mean[l]; v += d * d; }
    se[l] = Math.sqrt(v / (nObs - 1)) / Math.sqrt(nObs);
  }

  const tCols = mean.map((m, l) => (se[l] > 0 ? m / se[l] : NaN));
  const tObs = tCols.reduce((a, b) => (Number.isNaN(b) ? a : Math.max(a, b)), -Infinity);

  const tPerms = new Array(nPerms);
  const flips = new Array(nObs);
  for (let p = 0; p < nPerms; p++) {
    for (let o = 0; o < nObs; o++) flips[o] = rng.uniform() < 0.5 ? -1 : 1;
    let maxT = -Infinity;
    for (let l = 0; l < nLags; l++) {
      if (!(se[l] > 0)) continue;
      let s = 0;
      for (let o = 0; o < nObs; o++) s += flips[o] * sx[o][l];
      const t = (s / nObs) / se[l];
      if (t > maxT) maxT = t;
    }
    tPerms[p] = maxT;
  }

  let ge = 0;
  for (let p = 0; p < nPerms; p++) if (tPerms[p] >= tObs) ge++;
  const pvalue = (ge + 1) / (nPerms + 1);

  return { pvalue, tObs, tPerms, tCols };
}

/** Build a forward transition matrix from a sequence order, tf[seq[i], seq[i+1]] = 1. */
export function transitionMatrixFromSequence(sequence, nStates) {
  const tf = zeros(nStates, nStates);
  for (let i = 0; i < sequence.length - 1; i++) tf[sequence[i]][sequence[i + 1]] = 1;
  return tf;
}
