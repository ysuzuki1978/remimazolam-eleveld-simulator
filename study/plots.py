#!/usr/bin/env python3
"""Figures for the remimazolam fixed-rate TIVA simulation study (Japanese labels)."""
import json
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "results")
FIG = os.path.join(HERE, "figures")
os.makedirs(FIG, exist_ok=True)

# --- Japanese font ---
for cand in ["/System/Library/Fonts/Hiragino Sans GB.ttc",
             "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"]:
    if os.path.exists(cand):
        font_manager.fontManager.addfont(cand)
        matplotlib.rcParams["font.family"] = font_manager.FontProperties(fname=cand).get_name()
        break
matplotlib.rcParams["axes.unicode_minus"] = False
plt.rcParams.update({"figure.dpi": 130, "font.size": 11, "axes.grid": True,
                     "grid.alpha": 0.3, "axes.axisbelow": True})

REMI = "#2E7D5B"
PROP = "#C0504D"

def load(name):
    with open(os.path.join(RES, name)) as f:
        return json.load(f)

pk = load("pk_matrix.json")
traj = load("trajectories.json")
pdm = load("pd_matrix.json")
ages_sens = load("pd_age_sensitivity.json")

# ================= Fig 1: peripheral/deep volume V3 vs age =================
def fig1():
    normals = [r for r in pk if r["bodyType"] == "normal"]
    ages = [r["age"] for r in normals]
    rV3 = [r["remi"]["V3"] for r in normals]
    pV3 = [r["prop"]["V3"] for r in normals]
    fig, ax = plt.subplots(figsize=(6.2, 4.2))
    ax.plot(ages, pV3, "o-", color=PROP, label="プロポフォール V3", lw=2, ms=6)
    ax.plot(ages, rV3, "s-", color=REMI, label="レミマゾラム V3", lw=2, ms=6)
    ax.set_xlabel("年齢 (歳)"); ax.set_ylabel("深部コンパートメント容積 V3 (L)")
    ax.set_title("深部分布容積 V3 の年齢依存性（標準体型）")
    ax.legend(); ax.set_ylim(0, None)
    ax.annotate("プロポフォール: 巨大かつ加齢で縮小", (20, 200), color=PROP, fontsize=9)
    ax.annotate("レミマゾラム: 小さく加齢で増大", (40, 40), color=REMI, fontsize=9)
    fig.tight_layout(); fig.savefig(os.path.join(FIG, "fig1_v3_vs_age.png")); plt.close(fig)

# ============ Fig 2: frozen-rate Cp trajectories (plateau vs climb) ============
def fig2():
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.3), sharey=True)
    reps = [("child (10y, 32.5kg)", "小児 10歳 32.5kg"),
            ("adult (40y, 64.5kg)", "成人 40歳 64.5kg")]
    for ax, (key, title) in zip(axes, reps):
        d = traj[key]
        rt = [p["t"] for p in d["remi_freeze"]]; rc = [p["cpRel"] for p in d["remi_freeze"]]
        pt = [p["t"] for p in d["prop_freeze"]]; pc = [p["cpRel"] for p in d["prop_freeze"]]
        ax.plot(pt, pc, color=PROP, lw=2, label="プロポフォール")
        ax.plot(rt, rc, color=REMI, lw=2, label="レミマゾラム")
        ax.axhline(1.0, color="k", ls="--", lw=0.8, alpha=0.6)
        ax.axvline(20, color="gray", ls=":", lw=0.9)
        ax.set_title(title); ax.set_xlabel("時間 (min)")
        ax.set_xlim(0, 360)
    axes[0].set_ylabel("血漿濃度 Cp（目標比）")
    axes[0].legend(loc="upper left")
    axes[0].text(25, 0.55, "20分で維持速度を固定\n(以後ステップダウンなし)", fontsize=8, color="gray")
    fig.suptitle("固定速度維持での血漿濃度：レミマゾラムはプラトー、プロポフォールは上昇継続", fontsize=11)
    fig.tight_layout(); fig.savefig(os.path.join(FIG, "fig2_plateau_vs_climb.png")); plt.close(fig)

# ============ Fig 3: hold-rate profiles (step-down requirement) ============
def fig3():
    fig, ax = plt.subplots(figsize=(6.4, 4.3))
    d = traj["adult (40y, 64.5kg)"]
    rt = [p["t"] for p in d["remi_holdrate"]]; rr = [p["rateRel"] for p in d["remi_holdrate"]]
    pt = [p["t"] for p in d["prop_holdrate"]]; pr = [p["rateRel"] for p in d["prop_holdrate"]]
    ax.plot(pt, pr, color=PROP, lw=2, label="プロポフォール")
    ax.plot(rt, rr, color=REMI, lw=2, label="レミマゾラム")
    ax.set_xlabel("時間 (min)"); ax.set_ylabel("一定濃度維持に必要な注入速度\n(360分値=1に正規化)")
    ax.set_title("濃度一定に必要な注入速度の推移（成人 40歳）\n＝手動ステップダウン要求量")
    ax.set_xlim(0, 360); ax.legend()
    ax.text(120, 1.9, "プロポフォール: 6時間を通じて低下し続ける\n→ ステップダウン必須", color=PROP, fontsize=8.5)
    ax.text(120, 1.25, "レミマゾラム: 60分以降ほぼ平坦\n→ 固定速度で可", color=REMI, fontsize=8.5)
    fig.tight_layout(); fig.savefig(os.path.join(FIG, "fig3_stepdown_requirement.png")); plt.close(fig)

# ============ Fig 4: fixed-regimen band & freeze overshoot by age ============
def fig4():
    normals = [r for r in pk if r["bodyType"] == "normal"]
    ages = [r["age"] for r in normals]
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.3))
    # left: freeze overshoot at 360 min
    axes[0].plot(ages, [r["prop"]["freeze_overshoot_360_pct"] for r in normals], "o-", color=PROP, label="プロポフォール")
    axes[0].plot(ages, [r["remi"]["freeze_overshoot_360_pct"] for r in normals], "s-", color=REMI, label="レミマゾラム")
    axes[0].set_xlabel("年齢 (歳)"); axes[0].set_ylabel("6時間後の血漿濃度上昇 (%)")
    axes[0].set_title("維持速度を固定した場合の\n6時間後Cp上昇（ステップダウンを怠った代償）")
    axes[0].legend()
    # right: hold-rate decline 60->360
    axes[1].plot(ages, [r["prop"]["stepdown_decline_60to360_pct"] for r in normals], "o-", color=PROP, label="プロポフォール")
    axes[1].plot(ages, [r["remi"]["stepdown_decline_60to360_pct"] for r in normals], "s-", color=REMI, label="レミマゾラム")
    axes[1].set_xlabel("年齢 (歳)"); axes[1].set_ylabel("必要注入速度の減衰 60→360分 (%)")
    axes[1].set_title("維持相の注入速度低下量\n（大きいほどステップダウンが必要）")
    axes[1].legend()
    fig.tight_layout(); fig.savefig(os.path.join(FIG, "fig4_stepdown_by_age.png")); plt.close(fig)

# ============ Fig 5: PD — BIS drift and age sensitivity ============
def fig5():
    fig, axes = plt.subplots(1, 2, figsize=(10.5, 4.3))
    # left: BIS drift over time (normal body type, several ages)
    ax = axes[0]
    for r in [x for x in pdm if x["bodyType"] == "normal" and x["age"] in (20, 40, 60, 80)]:
        t = [30, 120, 240, 360]
        b = [r["bis_30"], r["bis_120"], r["bis_240"], r["bis_360"]]
        ax.plot(t, b, "o-", lw=1.8, label=f'{r["age"]}歳')
    ax.set_xlabel("時間 (min)"); ax.set_ylabel("予測 BIS")
    ax.set_title("固定速度でも BIS は経時的に上昇（軽くなる）\n＝代謝物 CNS7054 蓄積による耐性")
    ax.legend(title="年齢", fontsize=9); ax.set_xlim(0, 360)
    # right: age sensitivity heatmap-ish (BIS at fixed Ce)
    ax = axes[1]
    ages = ages_sens["ages"]; ces = ages_sens["ceLevels"]
    for ce in ces:
        ax.plot(ages, ages_sens["grid"][str(ce)], "o-", lw=1.6, label=f"Ce {ce}")
    ax.set_xlabel("年齢 (歳)"); ax.set_ylabel("予測 BIS（代謝物なし）")
    ax.set_title("同一効果部位濃度でも BIS は年齢で大きく異なる\n（高齢ほど高感受性）")
    ax.legend(title="Ce (ug/mL)", fontsize=8.5)
    fig.tight_layout(); fig.savefig(os.path.join(FIG, "fig5_pd_drift_agesens.png")); plt.close(fig)

for f in (fig1, fig2, fig3, fig4, fig5):
    f(); print("ok:", f.__name__)
print("figures ->", FIG)
