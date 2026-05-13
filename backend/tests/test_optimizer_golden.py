"""Golden-vector regression tests for the Markowitz optimizer.

We build a tiny 3-asset textbook problem where the closed-form analytical
solution is known, then check that `optimizer.py` returns the same weights.
This serves as a regression guard — if anyone breaks the math, these tests
go red immediately.

The 3-asset example is constructed with simple "round" numbers so the
analytical answer is easy to recompute by hand and audit.

Math reference: Bodie / Kane / Marcus — Investments (10th ed.), Chapter 7,
formulas for the global minimum-variance portfolio and the tangency
portfolio in the long-only case.

The closed-form formulas assumed below:
    GMVP weights:        w_gmvp  = (Σ⁻¹ · 1) / (1ᵀ · Σ⁻¹ · 1)
    Tangency weights:    w_tan   = (Σ⁻¹ · (μ − rf·1)) / (1ᵀ · Σ⁻¹ · (μ − rf·1))
    Target-return ε:     min wᵀΣw  s.t.  μᵀw = ε  and  1ᵀw = 1
                         (solved via Lagrangian, see same chapter)
"""
from __future__ import annotations

import numpy as np
import pytest

from app.services import optimizer as opt
from app.services import metrics as M


# ---------------------------------------------------------------------------
# Fixture: the 3-asset toy universe (all numbers in MONTHLY units to avoid
# any annualisation noise during the test — the optimizer is unit-agnostic).
# ---------------------------------------------------------------------------

@pytest.fixture
def toy_universe():
    """Three uncorrelated-ish assets with distinct expected returns.

    Asset A: low return / low vol  (e.g. bond-like)
    Asset B: medium return / medium vol  (e.g. broad equity)
    Asset C: high return / high vol  (e.g. tech)
    """
    mu = np.array([0.005, 0.010, 0.015])  # monthly μ: 6%, 12%, 18% annualised
    # Std-devs (monthly)
    sd = np.array([0.020, 0.040, 0.060])  # 6.9% / 13.9% / 20.8% annualised
    # Correlation matrix
    corr = np.array([
        [1.0, 0.30, 0.10],
        [0.30, 1.0, 0.50],
        [0.10, 0.50, 1.0],
    ])
    sigma = np.outer(sd, sd) * corr
    return mu, sigma


# ---------------------------------------------------------------------------
# Analytical helpers (closed-form, no solver involved)
# ---------------------------------------------------------------------------

def _gmvp_analytical(sigma: np.ndarray) -> np.ndarray:
    """Unconstrained (no long-only) GMVP — closed form."""
    inv = np.linalg.inv(sigma)
    ones = np.ones(sigma.shape[0])
    return (inv @ ones) / (ones @ inv @ ones)


def _tangency_analytical(mu: np.ndarray, sigma: np.ndarray, rf: float) -> np.ndarray:
    """Unconstrained tangency portfolio — closed form."""
    inv = np.linalg.inv(sigma)
    excess = mu - rf
    raw = inv @ excess
    return raw / raw.sum()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestGMVP:
    """Global minimum-variance portfolio matches the analytical solution."""

    def test_unconstrained_weights_match_closed_form(self, toy_universe):
        _, sigma = toy_universe
        w_analytical = _gmvp_analytical(sigma)
        # Toy universe is set up so all weights are positive — long-only and
        # unconstrained answers coincide.
        assert (w_analytical > 0).all()

        w_solver = opt.optimize_min_variance(sigma, long_only=True)
        assert w_solver is not None
        np.testing.assert_allclose(w_solver, w_analytical, atol=1e-5)

    def test_weights_sum_to_one(self, toy_universe):
        _, sigma = toy_universe
        w = opt.optimize_min_variance(sigma, long_only=True)
        assert abs(float(w.sum()) - 1.0) < 1e-6

    def test_variance_lower_than_individual_assets(self, toy_universe):
        _, sigma = toy_universe
        w = opt.optimize_min_variance(sigma, long_only=True)
        port_var = float(w @ sigma @ w)
        individual_min_var = float(np.diag(sigma).min())
        assert port_var <= individual_min_var, (
            f"GMVP variance {port_var:.6f} should be ≤ smallest single-asset "
            f"variance {individual_min_var:.6f}"
        )


class TestTangency:
    """Max-Sharpe (tangency) portfolio matches the analytical solution."""

    def test_unconstrained_weights_match_closed_form(self, toy_universe):
        mu, sigma = toy_universe
        rf_monthly = 0.002  # 2.4% annualised — plausibly below all μ_i
        w_analytical = _tangency_analytical(mu, sigma, rf_monthly)
        # Make sure all closed-form weights are positive in this toy universe.
        assert (w_analytical > 0).all()

        w_solver = opt.optimize_max_sharpe(mu, sigma, rf_monthly=rf_monthly, long_only=True)
        assert w_solver is not None
        np.testing.assert_allclose(w_solver, w_analytical, atol=1e-5)

    def test_sharpe_ratio_is_maximum(self, toy_universe):
        """No long-only convex combination should produce a higher Sharpe."""
        mu, sigma = toy_universe
        rf = 0.002
        w = opt.optimize_max_sharpe(mu, sigma, rf_monthly=rf, long_only=True)

        def sharpe(w):
            ret = float(w @ mu) - rf
            vol = float(np.sqrt(w @ sigma @ w))
            return ret / vol if vol > 0 else -np.inf

        s_optimal = sharpe(w)

        # Probe a few random feasible portfolios and the three single-asset
        # portfolios — none should beat the solver's answer.
        rng = np.random.default_rng(0)
        for _ in range(50):
            r = rng.dirichlet(np.ones(3))
            assert sharpe(r) <= s_optimal + 1e-6
        for i in range(3):
            single = np.zeros(3)
            single[i] = 1.0
            assert sharpe(single) <= s_optimal + 1e-6


class TestTargetReturn:
    """Target-return portfolio satisfies the return constraint at the lowest possible variance."""

    def test_returns_match_target(self, toy_universe):
        mu, sigma = toy_universe
        # Pick a target between min and max single-asset return.
        target = 0.0125  # halfway between asset B (0.010) and asset C (0.015)
        w = opt.optimize_target_return(mu, sigma, target, long_only=True)
        assert w is not None
        achieved = float(w @ mu)
        assert achieved >= target - 1e-6, (
            f"target_return solver returned ret={achieved} < target={target}"
        )

    def test_variance_at_target_geq_gmvp(self, toy_universe):
        """For any target ≥ GMVP return, the target-return variance must be ≥ GMVP variance."""
        mu, sigma = toy_universe
        w_gmvp = opt.optimize_min_variance(sigma, long_only=True)
        v_gmvp = float(w_gmvp @ sigma @ w_gmvp)
        # Target above GMVP return
        target = float(w_gmvp @ mu) + 0.003
        w_tr = opt.optimize_target_return(mu, sigma, target, long_only=True)
        v_tr = float(w_tr @ sigma @ w_tr)
        assert v_tr >= v_gmvp - 1e-6


class TestTargetRisk:
    """Target-risk portfolio satisfies the volatility cap and maximises return inside it."""

    def test_volatility_respects_cap(self, toy_universe):
        mu, sigma = toy_universe
        # Pick a cap above GMVP vol so the problem is feasible
        w_gmvp = opt.optimize_min_variance(sigma, long_only=True)
        gmvp_vol = float(np.sqrt(w_gmvp @ sigma @ w_gmvp))
        target_vol = gmvp_vol * 1.5  # 50% headroom above floor
        w = opt.optimize_target_risk(mu, sigma, target_vol, long_only=True)
        assert w is not None
        port_vol = float(np.sqrt(w @ sigma @ w))
        # Allow small numerical slack
        assert port_vol <= target_vol + 1e-5

    def test_infeasible_below_gmvp_returns_none(self, toy_universe):
        """Optimizer must return None (not crash) when target_vol < GMVP vol."""
        _, sigma = toy_universe
        w_gmvp = opt.optimize_min_variance(sigma, long_only=True)
        gmvp_vol = float(np.sqrt(w_gmvp @ sigma @ w_gmvp))
        # Cap below the floor → infeasible
        w = opt.optimize_target_risk(np.zeros(3), sigma, gmvp_vol * 0.5, long_only=True)
        assert w is None


class TestSharpeAndVol:
    """Metric helpers in `metrics.py` produce the expected scalars."""

    def test_portfolio_vol_annual(self, toy_universe):
        _, sigma = toy_universe
        w = np.array([1/3, 1/3, 1/3])
        # Hand-compute: monthly var = wᵀΣw, annual vol = √(monthly var × 12)
        var_m = float(w @ sigma @ w)
        expected = np.sqrt(var_m * 12.0)
        got = M.portfolio_vol_annual(w, sigma)
        assert abs(got - expected) < 1e-8

    def test_portfolio_return_annual(self, toy_universe):
        mu, _ = toy_universe
        w = np.array([1/3, 1/3, 1/3])
        expected = float(w @ mu) * 12.0
        got = M.portfolio_return_annual(w, mu)
        assert abs(got - expected) < 1e-8

    def test_sharpe_ratio_formula(self, toy_universe):
        """Sharpe annualised = (μ_a - rf_a) / σ_a."""
        mu, sigma = toy_universe
        w = np.array([1/3, 1/3, 1/3])
        rf_annual = 0.04
        ret_a = M.portfolio_return_annual(w, mu)
        vol_a = M.portfolio_vol_annual(w, sigma)
        expected = (ret_a - rf_annual) / vol_a
        got = M.sharpe_ratio_annual(w, mu, sigma, rf_annual)
        assert abs(got - expected) < 1e-8
