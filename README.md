# Remimazolam TCI Simulator (Eleveld 2025)

レミマゾラムの薬物動態・薬力学（PK-PD）シミュレータです。**Eleveld 2025 モデル**を実装し、
効果部位濃度 (Ce)・予測 **BIS**・**MOAA/S** をリアルタイムに計算・表示します。活性代謝物
**CNS7054** の蓄積と、それによる BIS への競合的拮抗（耐性現象）も再現します。

HTML / JavaScript / PWA で実装され、ビルド不要・オフライン動作します。

> ⚠️ **研究・教育目的のシミュレータです。臨床判断や実際の薬剤投与には使用しないでください。**

---

## 主な機能

- **導入モード**：ボーラス＋持続投与のリアルタイムシミュレーション（Ce / BIS / MOAA/S）
- **TCI / 投与計画モード**
  - 効果部位 Ce 目標 → 注入速度スケジュール自動算出
  - **目標 BIS（60 / 50 / 40 など）を維持する投与計画**（BIS から必要 Ce を逆算、代謝物蓄積に伴う漸増に対応）
- **モニタリングモード**：任意の投与イベント列 → 全時系列をグラフ表示・CSV 出力
- 共変量対応：年齢・体重・性別・オピオイド併用・肝機能 (Pugh-Child) ・腎機能 (ESRD)

## モデルの要点

実装は論文本文と Supplementary（NONMEM コード）に厳密準拠しています。

- 親薬 3 コンパートメント + front-end kinetics の depot を介して活性代謝物 CNS7054 (2 コンパートメント) を生成
- 効果部位は親薬の **2 系統**（BIS 用 ke0 = 0.145、MOAA/S 用 ke0 = 0.298、いずれも min⁻¹）
- **BIS の sigmoid 指数 γ = 1**（NONMEM コードに指数項なし。論文も「γ 推定は適合を改善せず最終モデルから除外」と明記）
- 代謝物に独立した効果部位はなく、**中心（血漿）濃度**が BIS / MOAA/S を競合的に拮抗
- BIS = Baseline · (1 − (Ce/Ce50) / (1 + Ce/Ce50 + Ca/Ca50))、Baseline = 93.7
- 内部単位は mg / L / µg·mL⁻¹ で一貫

初版では静脈サンプル予測（venous delay）および ECMO / ICU 補正は扱いません（TCI 用途では不要のため）。

## ローカルでの起動

```bash
# 任意の静的サーバで配信（例）
python3 -m http.server 8000
# → http://localhost:8000
```

## モデル検証

```bash
node validation/validate-model.js
```
論文 Table 1 のパラメータ逆算照合、数値積分の健全性、加齢に伴う投与量低下などを確認します。

## 出典・ライセンス

PK-PD モデル（パラメータ・式）の出典：

> Eleveld DJ, Colin PJ, van den Berg JP, Koomen JV, Stoehr T, Struys MMRF.
> Development and analysis of a remimazolam pharmacokinetics and pharmacodynamics
> model with proposed dosing and concentrations for anaesthesia and sedation.
> *Br J Anaesth.* 2025;135(1):206-217. doi:[10.1016/j.bja.2025.02.038](https://doi.org/10.1016/j.bja.2025.02.038)
>
> © 2025 The Author(s). Open access, [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).

- モデルのパラメータ・式は **CC BY 4.0** に基づき原著者のクレジットを明記して利用しています（[NOTICE](NOTICE) 参照）。
- 本ソフトウェアの実装は **Apache License 2.0**（[LICENSE](LICENSE)）です。

## 関連

既存のプロポフォール TCI シミュレータ（Eleveld 2018）と同じ設計思想で実装されています。
