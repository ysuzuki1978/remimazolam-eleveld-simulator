# Study: レミマゾラム固定速度 TIVA の薬物動態シミュレーション

Eleveld 2025 レミマゾラム PK-PD モデル（本リポジトリの検証済みエンジン）と
Eleveld 2018 プロポフォール PK モデルを用い、固定速度維持で濃度がプラトーに達し
手動ステップダウンを要しないかを、小児〜超高齢・多様体型で検証する。

## 再現手順

```bash
# 1. PK 解析（マトリクス・ステップダウン指標・固定レジメン帯域）
node sim.js                 # -> results/pk_matrix.json, results/pk_summary.csv

# 2. 代表時系列（プラトー vs 上昇、ステップダウン要求量の形）
node traj.js                # -> results/trajectories.json

# 3. PD 解析（代謝物耐性による効果ドリフト、年齢感受性）
node pd.js                  # -> results/pd_matrix.json, results/pd_age_sensitivity.json

# 4. 集計（論文用の要約統計）
node agg.js

# 5. 図（uv venv + matplotlib, 日本語ラベル）
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python matplotlib numpy
.venv/bin/python plots.py   # -> figures/*.png
```

## ファイル

- `sim.js` — 汎用3コンパートメント+効果部位シミュレータ（両薬）、マトリクス生成、主要指標
- `traj.js` — 代表患者の時系列（figures用）
- `pd.js` — 全 remi エンジン（代謝物含む）による PD 解析
- `agg.js` — 論文用の範囲内集計
- `plots.py` — 図1〜5生成
- `manuscript_ja.md` — 論文ドラフト（日本語, IMRAD）
- `results/` — JSON/CSV 出力
- `figures/` — PNG 図

## 主要所見（範囲内 6〜93歳・21〜171kg, n=20）

| 指標 | レミマゾラム | プロポフォール |
|---|---|---|
| 深部容積 V3 | 2.7–32 L | 48–235 L |
| 維持速度減衰 60→360分 | 平均 10.7% | 平均 19.6% |
| 固定時 6h後 濃度上昇 | +34.6%（プラトー） | +45.4%（上昇継続）|
| 単一固定レジメン帯域 | ±19.9% | ±21.1% |

副次：固定速度でも BIS は 6h で平均+10 上昇（代謝物耐性）、同一 Ce でも BIS は
年齢で約30ポイント差（高齢ほど高感受性）。
