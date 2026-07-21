# Remimazolam TCI Simulator (Eleveld 2025)

A pharmacokinetic–pharmacodynamic (PK-PD) simulator for remimazolam, implementing the
**Eleveld 2025 model**. It computes and displays the effect-site concentration (Ce),
predicted **BIS**, and **MOAA/S** in real time, and reproduces accumulation of the active
metabolite **CNS7054** and its competitive antagonism of the BIS effect (tolerance).

Built with HTML / JavaScript / PWA — no build step, works offline.

🔗 **Live (PWA):** https://ysuzuki1978.github.io/remimazolam-eleveld-simulator/
&nbsp;·&nbsp; **Source:** https://github.com/ysuzuki1978/remimazolam-eleveld-simulator

> ⚠️ **This is a research/education simulator. Do not use it for clinical decisions or actual drug administration.**

![Screenshot of the BIS-target dosing plan](images/screenshot-tci.png)

---

## Features

Three modes:

1. **Induction (real-time)** — an initial bolus (default 0.1 mg/kg) plus a continuous infusion
   advance in real time, with live plots of Ce / predicted BIS / MOAA/S. Supports extra boluses
   and LOC snapshot recording. When you record LOC, **that effect-site Ce + 0.15 µg/mL** can be
   sent to the TCI tab as the target Ce.
2. **TCI / Dosing plan**
   - **Effect-site Ce target**: choose which effect-site to drive — **MOAA/S-site (ke0 0.298)** or
    **BIS-site (ke0 0.145)** — and derive the loading bolus and maintenance infusion schedule for that target Ce.
   - **★ Maintain a target effect (BIS or MOAA/S)**: back-calculate the effect-site Ce required for the target
     **BIS** (e.g. 60/50/40) or **MOAA/S** score (e.g. 3 / 2 / 0.5), and as CNS7054 accumulates, raise the
     required Ce / infusion rate to hold the effect constant (**reproducing tolerance**). Holding the *effect*
     — rather than a fixed concentration — is what keeps depth stable over long cases.
3. **Monitoring** — dose events are entered by **clock time** (relative to the anaesthesia start time set on
   the patient). The simulation runs until **120 min after the last event**, and the full time course is
   plotted and exported to CSV.

**Recovery prediction** (TCI & Monitoring result charts): a panel answers *"if the infusion stops now, when does
the patient recover?"* — time to **MOAA/S ≥ 4** and **BIS ≥ 70** (awakening), time for the effect-site Ce to fall
by a chosen **% (50 % ≈ context-sensitive half-time)**, and time to reach an **absolute target Ce** you type.
Hovering the chart moves the stop point to that time (*"from MM:SS"*), so induction / maintenance / pre-wake
scenarios can be compared. The accumulated metabolite (CNS7054) is carried through the washout, so tolerance is
reflected. Charts also support **wheel / pinch zoom and drag pan** (double-click resets).

Covariates: age, weight, sex, opioid co-administration, hepatic function (Pugh-Child > 8), renal function (ESRD).

When a new version is published, an "A new version is available" banner appears at the bottom of the app;
tapping "Update" reloads into the latest version (Service Worker update detection).

## Model notes

The implementation follows the paper (Table 1, Fig 1) and the Supplementary NONMEM code
(`$PK` / `$DES` / `$THETA` / `$ERR`) exactly.

- **8-state vector**: parent central + 2 peripheral + a depot (front-end kinetics) feeding the active
  metabolite CNS7054 (2 compartments) + 2 effect sites (BIS ke0 = 0.145, MOAA/S ke0 = 0.298 min⁻¹).
  Integrated with RK4.
- **BIS sigmoid exponent γ = 1**. The NONMEM BIS equation has no exponent term, and the paper states that
  estimating γ did not improve fit and was dropped from the final model. MOAA/S (proportional odds) is also γ = 1.
- **The metabolite has no separate effect site**; its **central (plasma) concentration** competitively
  antagonises the BIS / MOAA/S effect.
- BIS = Baseline · (1 − (Ce/Ce50) / (1 + Ce/Ce50 + Ca/Ca50)), Baseline = 93.7, Ce50 = 0.982, Ca50 = 8.41 (reference individual).
- **Closed-form BIS inversion**: E = 1 − BIS/Baseline, Ce = Ce50 · E·(1 + Ca/Ca50) / (1 − E). As the metabolite
  Ca rises, the required Ce increases → the infusion must increase to hold a constant BIS (tolerance).
- Internal units are consistent throughout: mg / L / µg·mL⁻¹. A molecular-weight correction (425.3/439.3) is
  applied to the depot transfer.

This version does not model venous-sample prediction (venous delay) or the ECMO / ICU adjustments (paper Table 2),
which are not needed for TCI use.

## Run locally

```bash
python3 -m http.server 8000   # = npm run serve
# → http://localhost:8000
```

## Model validation

```bash
npm run validate          # = model + TCI test suites (83 checks)
node validation/validate-model.js   # PK-PD core + recovery prediction (55 checks)
node validation/validate-tci.js     # TCI: effect-site Ce / BIS / MOAA/S targets (28 checks)
```

What is checked (selected):

- Every parameter of the paper's Table 1 is recovered (V1 = 4.31, CL = 1.12, ke0_BIS = 0.145, Ce50_BIS = 0.982, Baseline = 93.7, …)
- Numerical soundness (RK4 ≈ fine-step Euler, effect-site hysteresis)
- **Anaesthesia target concentration (5.25 × MOAA/S Ce50 = 0.96 µg/mL) → BIS ≈ 47.5** (reproduces the paper's "anaesthesia BIS ≈ 50")
- **Required Ce / loading dose decrease with age** (reproducing Eleveld's central claim)
- Effect-site Ce target: the selected effect-site (BIS / MOAA/S) converges to target
- Target BIS 60/50/40 and target MOAA/S 3/2.5/1 held to tolerance, with infusion escalation as the metabolite accumulates

## Known limitations

- This is a population model; inter-individual variability (especially BIS-PD: ke0 CV 85.5 %, Ce50 CV 50.6 %) is
  large. Predictions are population means.
- The authors report that population predictions are biased below **BIS 50** (benzodiazepine ceiling effect).
  Treat predictions in the deep range as indicative only.
- Venous-sample / ECMO / ICU adjustments are not implemented.

## Tech

Vanilla JS (globals), no build step. `js/remimazolam-eleveld-pkpd.js` is the model core; each mode
(induction / tci / monitoring) is an engine + Chart.js + a PWA service worker.

## Citation & license

PK-PD model parameters and equations are from:

> Eleveld DJ, Colin PJ, van den Berg JP, Koomen JV, Stoehr T, Struys MMRF.
> Development and analysis of a remimazolam pharmacokinetics and pharmacodynamics
> model with proposed dosing and concentrations for anaesthesia and sedation.
> *Br J Anaesth.* 2025;135(1):206-217. doi:[10.1016/j.bja.2025.02.038](https://doi.org/10.1016/j.bja.2025.02.038)
>
> © 2025 The Author(s). Open access, [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).

- The model parameters and equations are reused under **CC BY 4.0** with attribution to the original authors (see [NOTICE](NOTICE)).
- The software implementation is licensed under the **Apache License 2.0** (see [LICENSE](LICENSE)).

## Related

Built with the same design as an existing propofol TCI simulator (Eleveld 2018).
