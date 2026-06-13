#!/usr/bin/env python3
"""Generate reference TDLM outputs from the installed `tdlm` package.

Saves a fixed `probas` + `tf` and the resulting true-row (identity permutation)
forward/backward sequenceness, plus the intermediate `betas`, to JSON. The Node
parity test (parity_test.mjs) loads this and asserts the JS port matches.

The true row (permutation index 0) is RNG-independent, so parity does not depend
on matching NumPy's permutation RNG. We also export the exact permutation list
used so the test can optionally check shuffled rows too.
"""
import json
import os
import numpy as np

from tdlm.core import _find_betas, compute_1step, signflit_test
from tdlm.utils import unique_permutations

OUT = os.path.join(os.path.dirname(__file__), "reference.json")


def build_probas(n_samples, n_states, lag, breadth, magnitude, noise, seed):
    """A simple, deterministic replay-like probas series (no package RNG needed)."""
    rng = np.random.default_rng(seed)
    probas = rng.standard_normal((n_samples, n_states)) * noise
    # one forward sweep 0->1->...->n_states-1 starting at sample 200
    onset = 200
    t = np.arange(n_samples)
    for s in range(n_states):
        center = onset + s * lag
        bump = magnitude * np.exp(-0.5 * ((t - center) / breadth) ** 2)
        probas[:, s] += bump
    return probas


def main():
    n_states = 5
    max_lag = 60
    n_shuf = 24
    n_samples = 1500
    lag = 7

    probas = build_probas(n_samples, n_states, lag=lag, breadth=2.0,
                          magnitude=1.0, noise=0.15, seed=42)

    # forward transition matrix for sequence 0->1->2->3->4
    tf = np.zeros((n_states, n_states))
    for i in range(n_states - 1):
        tf[i, i + 1] = 1

    # betas (alpha off) and with an alpha confound, for granular checks
    betas = _find_betas(probas, n_states, max_lag, alpha_freq=None)
    betas_alpha = _find_betas(probas, n_states, max_lag, alpha_freq=10)

    # full compute with an explicit, exported permutation list
    perms = unique_permutations(np.arange(n_states), n_shuf, rng=0)
    # monkey-inject the same perms by computing manually is hard; instead rely on
    # the fact that row 0 (identity) is deterministic. We still export perms so the
    # JS test can reproduce shuffled rows by feeding them in.
    sf, sb = compute_1step(probas, tf, n_shuf=n_shuf, max_lag=max_lag, rng=0)

    # also compute with alpha correction for a second curve check
    sf_a, sb_a = compute_1step(probas, tf, n_shuf=n_shuf, max_lag=max_lag,
                               alpha_freq=10, rng=0)

    # sign-flip test reference: fixed (n_subj x n_lags) matrix; t_obs is
    # RNG-independent so we can assert it in the JS port.
    sf_rng = np.random.default_rng(7)
    sx = sf_rng.standard_normal((12, 20)) + 0.4  # 12 subjects, 20 lags, small effect
    sf_res = signflit_test(sx, n_perms=2000, rng=0)

    data = {
        "params": {"n_states": n_states, "max_lag": max_lag, "n_shuf": n_shuf,
                   "n_samples": n_samples, "lag": lag, "alpha_freq": 10},
        "signflip_sx": sx.tolist(),
        "signflip_t_obs": float(sf_res.t_obs),
        "probas": probas.tolist(),
        "tf": tf.tolist(),
        "betas": np.nan_to_num(betas).tolist(),
        "betas_alpha": np.nan_to_num(betas_alpha).tolist(),
        "perms": perms.tolist(),
        "seq_fwd_true": np.nan_to_num(sf[0]).tolist(),
        "seq_bkw_true": np.nan_to_num(sb[0]).tolist(),
        "seq_fwd_true_alpha": np.nan_to_num(sf_a[0]).tolist(),
        "seq_bkw_true_alpha": np.nan_to_num(sb_a[0]).tolist(),
    }
    with open(OUT, "w") as f:
        json.dump(data, f)
    print(f"wrote {OUT}")
    print(f"  probas {np.array(data['probas']).shape}, tf {np.array(tf).shape}")
    print(f"  forward peak lag (samples) ~ {np.nanargmax(sf[0])} (expect ~{lag})")
    print(f"  fwd[true] max = {np.nanmax(sf[0]):.5f}")


if __name__ == "__main__":
    main()
