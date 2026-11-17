# Global Lead-Time Planner（B2B）

海外営業・貿易実務向けの **時差・現地祝日統合型「納期逆算＆日程調整」Web アプリ**です。
基準国（自社）と取引先各国の **タイムゾーン・週末・祝日** をまとめて扱い、複数工程の納期を順算／逆算し、
結果を海外顧客にそのまま送れる **英文メール / WhatsApp テキスト** として出力します。

サーバー不要の静的サイト（Vite + React + TypeScript + Tailwind CSS）で、計算はすべてブラウザ内で完結します。
`main` ブランチへの push（PR マージ）で **GitHub Pages に自動デプロイ** されます。

## 画面構成

- **左ペイン（常に表示）**：対象国と営業時間。基準国・比較対象国・プリセット 9 か国・国検索。スクロールしても固定されます。
- **右ペイン（4 つのタブ）**：① 会議可能時間帯 ／ ② 納期計算 ／ ③ 稼働カレンダー＆ガント ／ ④ 英文メール / WhatsApp。
  表示中のタブは URL（`?tab=meeting` / `schedule` / `calendar` / `export`）にも保存されるので、共有リンクで同じタブを開けます。

## 主な機能

### 1. マルチリージョン・時差＆祝日比較
- 基準国（既定: 日本）と比較対象国を複数選択。初期プリセット（この順に表示）：韓国 / 台湾 / 中国 / アメリカ / タイ / マレーシア / インド / ベトナム / シンガポール。検索から約 200 か国を追加可能。
- 国は「国旗画像＋日本語の国名」で表示（国旗は flagcdn.com の画像で、取得できない環境では同梱の SVG に自動で切り替わります。絵文字ではないので Windows でも文字化けせず、`JP` などの国コードも表示しません）。
- 各国の現在時刻と、営業時間（既定 9:00〜18:00）の **重なり＝会議可能時間帯** を 24 時間バーで表示。ホバーで全員の現地時刻を確認。
- 国ごとの週末定義（土日・金土など）、`date-holidays` による祝日の自動判定、州・地域の祝日、タイムゾーン（夏時間対応）を個別に設定可能。

### 2. 複数工程の納期 順算・逆算エンジン
- **順算**：開始日 → 最終納期 ／ **逆算**：希望納品日 → 発注デッドライン を切り替え。
- 工程（例: 国内手配・製造 → 海上輸送・通関 → 現地搬入）ごとに「所要日数」と「適用カレンダー（基準国営業日 / 相手国営業日 / 暦日）」を設定。テンプレートも用意。
- **計算結果サマリー**（最終納期・発注デッドライン・総所要日数・祝日でスキップした日数と祝日名）をリアルタイム表示。「ガントチャートで確認する →」でガントのタブへ。
- 日付計算は `YYYY-MM-DD` 文字列ベースの純粋関数（`src/utils/dateCalc.ts`）で実装し、閲覧者のタイムゾーンによる日付ズレが起きません。
- カレンダーの日付をクリックして **カスタム休日（旧正月・工場の長期休暇など）／臨時稼働日** を追加・解除。期間指定での一括登録も可能。

### 3. ガントチャート表示＆英文出力・共有
- 各国の稼働日（緑）・週末（グレー）・祝日（赤、ホバーで英語／現地語の祝日名）と工程期間を縦に並べて比較。
- 英文を 3 つの形式でワンクリックコピー：**Standard Email**（各工程の日程・スキップした祝日・関係国の祝日一覧）、**WhatsApp / Chat**（短い要約）、
  **Meeting Proposal**（相手国と営業時間が重なる直近 3 日を候補にした会議の打診。起点は「会議可能時間帯」タブで選んだ日付）。
- 選択国・工程・カスタム休日などを **URL クエリに自動同期**（URL を共有するだけで同じ状態を再現）。**LocalStorage へのプリセット保存** にも対応。

## 開発

```bash
npm install
```

```bash
npm run dev
```

| コマンド | 内容 |
| --- | --- |
| `npm run build` | 型チェック（`tsc -b`）＋本番ビルド → `dist/` |
| `npm run preview` | ビルド結果をローカルで確認 |
| `npm test` | ユニットテスト（Vitest） |
| `npm run test:tz` | システムのタイムゾーンを変えてテスト（日付ズレがないことの確認） |
| `npm run lint` | oxlint |

Node.js `^20.19.0 || >=22.12.0` が必要です（CI は Node 20）。

## デプロイ

### GitHub Pages（自動デプロイ）

`.github/workflows/deploy.yml` が `main` への push（PR のマージ）ごとに `npm ci` → `npm run build` を実行し、`dist/` を GitHub Pages に公開します。Actions タブからの手動実行（`workflow_dispatch`）にも対応しています。

**初回のみ必要な設定**：リポジトリの **Settings → Pages → Build and deployment → Source** を **「GitHub Actions」** に変更してください。

公開 URL：https://gogogorima.github.io/global-leadtime-planner/

`vite.config.ts` は `base: './'`（相対パス）なので、リポジトリ名やサブパスが変わっても設定変更は不要です。

### その他

`dist/` はそのまま任意の静的ホスティングに置けます。Cloudflare Pages の場合は Build command `npm run build` ／ Build output directory `dist`。

## 共有 URL の例

```
?v=1&base=JP&c=TH,US&mode=bwd&d=2027-01-15
&s=20.JP.Procurement+%26+Production&s=21.cal.Ocean+Freight&s=3.TH.Local+Delivery
&off=TH:2027-02-16..2027-02-18:Lunar+New+Year+holidays&tab=schedule
```

パラメータの詳細は [CLAUDE.md](./CLAUDE.md) を参照してください。

## 注意

- 祝日データは [date-holidays](https://github.com/commenthol/date-holidays)（データ: CC BY-SA 4.0）に基づく参考情報です。重要な日程は現地にご確認ください。
- UAE の祝日は、公式一覧（[閣議決定 2024 年第 27 号 / u.ae](https://u.ae/en/information-and-services/public-holidays-and-religious-affairs/public-holidays)）に合わせてアプリ側で補正しています（ツールチップに「補正」と表示）。年ごとの振替は公式発表に合わせてカスタム休日で調整してください。
- 宛名・署名などの出力設定はブラウザ内（LocalStorage）にのみ保存され、共有 URL には含まれません。
