# モノと情報の流れ図

ブラウザで「モノと情報の流れ図」（バリューストリームマップ）を作成できる静的Webアプリです。ビルド不要・外部ライブラリなし（HTML / CSS / JavaScript のみ）。

## 機能
- 図形: 工程（C/T・段取り・稼働率・人数のデータボックス付き）、供給者/顧客、在庫、生産管理、輸送/出荷、スーパーマーケット、作業者、改善ポイント、テキスト
- 矢印: モノの流れ、プッシュ、引き取り（プル）、情報（手作業）、情報（電子）／直線・カギ線
- 生産リードタイム（在庫日数の合計）と付加価値時間（C/T の合計）を自動集計
- ドラッグ移動、拡大縮小、元に戻す／やり直し、ブラウザへの自動保存
- PNG / SVG 書き出し、JSON 保存・読み込み

## ローカルで動かす
```
cd flow-diagram
python3 -m http.server 8000
# http://localhost:8000 を開く
```

## Vercel へのデプロイ
1. https://vercel.com に GitHub アカウントでログイン
2. 「Add New… → Project」でこのリポジトリ（kazu25.github.io）を Import
3. 「Root Directory」で `flow-diagram` を選択
4. Framework Preset は「Other」、Build Command / Output Directory は空のまま「Deploy」

以降は GitHub に push するたびに自動で再デプロイされます。
