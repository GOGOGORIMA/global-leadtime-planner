# CLAUDE.md — B2B Global Lead-Time Planner

海外営業・貿易実務向けの「時差・現地祝日統合型の納期逆算＆日程調整 Web アプリ」。
サーバー不要の静的 SPA（Vite + React + TypeScript + Tailwind CSS）で、`npm run build` の `dist/` を
Cloudflare Pages / GitHub Pages にそのまま配置できる。`main` への push で GitHub Actions が GitHub Pages へ自動デプロイする
（`.github/workflows/deploy.yml`）。すべての計算はブラウザ内で完結する。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー（Vite） |
| `npm run build` | `tsc -b`（app / node / test の 3 プロジェクトを型チェック）→ `vite build` で `dist/` 出力 |
| `npm run preview` | ビルド成果物のローカル確認 |
| `npm test` | Vitest（`src/**/*.test.ts`） |
| `npm run test:tz` | システム TZ を UTC−11 / UTC+14 / LA に変えてテスト（日付ズレがないことの確認、POSIX シェル用） |
| `npm run lint` | oxlint |

変更後は **`npm run lint && npm test && npm run build`** がすべてエラーなしで通ること。
Node は `^20.19.0 || >=22.12.0`（CI は Node 20。ツールチェーンは Node 20 / 22 の両方で検証済み。Node 20 で動かない
パッケージを追加しないこと — 例: vitest 5 は Node 22 以上が必要なため vitest 4 を使用）。

## 技術スタック

- Vite 8（Rolldown）/ React 19 / TypeScript 7（`tsc` はネイティブ版。`erasableSyntaxOnly`・`verbatimModuleSyntax` 有効 → `enum`・`namespace` 禁止、型のみの import は `import type`）
- Tailwind CSS v4（`@tailwindcss/vite`。設定ファイルなし。テーマ・独自ユーティリティ `stripes` / `stripes-dark` / `no-spinner` は `src/index.css`）
- `date-holidays`（約 200 か国の祝日ルール）、`lucide-react`（アイコン）
- Vitest 4（Node 20 対応版）、oxlint
- GitHub Actions（GitHub Pages への自動デプロイ）

## ディレクトリ構成

```
.github/workflows/deploy.yml  main への push / 手動実行 → npm ci → npm run build → GitHub Pages へデプロイ
index.html                 lang="ja"。favicon は public/favicon.svg
vite.config.ts             base: './'（必須。リポジトリ名に依存せずサブパスで動作）・vendor/react チャンク分割
tsconfig.{app,node,test}.json  app はテスト除外 / test は node 型を含む
src/
  main.tsx, App.tsx        ルート。派生データ（国設定→カレンダー→スケジュール→レポート）を useMemo で組み立て
  index.css                Tailwind 読み込み・テーマ・独自ユーティリティ
  types.ts                 PlannerState / Step / CountrySettings / DayOverride / CALENDAR_DAYS
  data/countries.ts        国カタログ（名称 EN/JA・国旗・既定 TZ・既定週末・地域）とプリセット
  data/holidayCorrections.ts  date-holidays と公式祝日一覧の差分補正（現在は AE。出典付き）
  state/defaults.ts        初期状態・工程テンプレート・工程名候補・ID 生成・上限値
  state/plannerReducer.ts  useReducer 用リデューサと sanitizeState（URL 等の外部入力を安全化）
  hooks/usePlanner.ts      状態 ⇄ URL クエリ（replaceState, 250ms debounce）⇄ LocalStorage（前回状態）
  hooks/useNow.ts, useStoredState.ts, useMediaQuery.ts
  utils/dateCalc.ts        ★ YYYY-MM-DD 文字列ベースの純粋関数（日付演算・稼働日判定・順算/逆算エンジン）
  utils/dateFormat.ts      英語/日本語の日付表示（純粋関数）
  utils/holidays.ts        date-holidays ラッパー（キャッシュ・複数日祝日の展開・EN/現地名の対応付け）
  utils/timezone.ts        Intl ベースのタイムゾーン変換・営業時間の重なり計算・会議候補探索
  utils/calendars.ts       国設定の解決（ResolvedCountry）と WorkCalendar の構築、オーバーライドの範囲化
  utils/report.ts          スケジュール → 表示/出力用レポート（スキップ祝日・関係国の祝日一覧・発注期限）
  utils/exportText.ts      英文メール / WhatsApp テキスト生成（純粋関数）
  utils/urlState.ts        状態 ⇄ URL クエリ文字列
  utils/storage.ts         LocalStorage（プリセット・前回状態・出力設定）。全アクセス try/catch
  utils/clipboard.ts       クリップボードコピー（非セキュアコンテキスト用フォールバック付き）
  components/              UI（下記）。classes.ts = 共有クラス文字列、styles.ts = 日ステータス/工程の配色
```

### UI（`src/components`）

| コンポーネント | 役割 |
| --- | --- |
| `AppHeader` | 共有 URL コピー、プリセット保存/読込/削除（LocalStorage）、リセット |
| `CountryPanel` | 基準国 select、比較対象国チップ（現地時刻・⚙設定・×削除）、プリセット 10 か国トグル、国検索コンボボックス |
| `CountrySettingsModal` | 国ごとのタイムゾーン・地域（州）・週末（曜日トグル）・営業時間 |
| `MeetingPlanner` | 基準国時間の 24h 軸に各国営業時間バー（祝日/週末はハッチ）、基準国との重なり、全員の重なり、現在時刻線、ホバーで各国現地時刻 |
| `SchedulePanel` | 順算/逆算切替、基準日、工程（名称・日数・適用カレンダー・並べ替え・削除・テンプレート）、結果サマリー |
| `Timeline` | ガントチャート：国別の稼働日(緑)/週末(灰)/祝日(赤)/カスタム休日(橙ハッチ)/臨時稼働(濃緑)、工程バー（スキップ日はハッチ）。セルのホバーで祝日名（英語/現地語）、クリックでオーバーライド切替 |
| `CustomHolidayManager` | 期間指定でカスタム休日/稼働日を追加、登録済み一覧と削除 |
| `ExportPanel` | 英文メール / WhatsApp の生成・プレビュー・ワンクリックコピー・メール/WhatsApp で開く |

## 最重要ルール：日付の扱い（タイムゾーンずれ防止）

1. **暦日付はすべて `ISODate`（`YYYY-MM-DD` 文字列）**。`new Date('YYYY-MM-DD')` や `getDate()` 等のローカル TZ 依存 API で日付を計算しない。
2. `utils/dateCalc.ts` は **`Date`・`Intl`・現在時刻・グローバル状態に一切触れない純粋関数**のみ。日付は Hinnant のアルゴリズムで「1970-01-01 からの通日」整数に変換して演算する。新しい日付ロジックはここに追加し、テストを書く。
3. 「瞬間」（現在時刻・営業時間の重なり）は **epoch ms + 明示的な IANA タイムゾーン**で、`utils/timezone.ts` だけが扱う（`Intl.DateTimeFormat#formatToParts`）。
4. 祝日の配置は date-holidays が返す **`date` 文字列（現地の暦日）のみ**を使う。`start`/`end` の Date は複数日祝日の日数算出にだけ使う。
5. 表示用フォーマットも `utils/dateFormat.ts` の純粋関数を使う（`toLocaleDateString` で日付を作らない）。

## 計算仕様

### 稼働日カレンダー（`WorkCalendar`）
- 判定の優先順位：**手動オーバーライド > 祝日 > 週末 > 稼働日**。`allDays: true`（暦日）は全日稼働。
- 祝日として休業扱いにするのは type が `public` / `bank` で、00:00 開始の終日祝日のみ（`BLOCKING_HOLIDAY_TYPES`）。
  14:00 開始などの半日祝日（例: DE のクリスマスイブ、CN の婦人節）や `observance` / `optional` / `school` は参考表示のみ。
- 複数日祝日（KR 설날 P3D、VN Tết P5D、イード等）は日ごとに展開。年末開始で翌年にまたがる分（1/1〜1/14）は前年データも参照。
- 地域（州）を選ぶと `new Holidays(country, state)` で地域祝日を追加。
- **祝日の補正**：`data/holidayCorrections.ts` に登録された国は、date-holidays のインスタンス生成時にルールを
  `remove`（削除）/ `set`（追加・上書き、date-holidays のルール文法）で公式一覧に合わせる。他国のインスタンスには影響しない。
  `onlyIfDistinctFrom` は、生成日が指定ルールの祝日と同じ日なら捨てる条件（例: 29 日で終わるラマダンでは date-holidays が
  「30 Ramadan」を 1 Shawwal に重ねるため）。補正由来の祝日は `HolidayEntry.corrected = true` となり、ツールチップに「補正」、
  国設定ダイアログに出典が表示される。補正を追加するときは出典（法令・政府サイト）を必ず記載し、テストを書く。

### 工程スケジュール（`computeSchedule`）
- 工程は finish-to-start。各工程は「前工程終了の翌日」から、**その工程のカレンダーの次の稼働日**に開始し、`days` 稼働日を占有する（開始日を 1 日目と数える）。
- 適用カレンダー：`'calendar'`（暦日・全日稼働）または選択中の国コード（その国の週末・祝日・オーバーライドを除外）。
- **順算（forward）**：`start = nextWorkingDay(cursor)`, `end = addWorkingDays(start, days)`, `cursor = end + 1`（cursor 初期値 = 開始日）→ 最終工程の `end` が納期。
- **逆算（backward）**：最終工程から `end = previousWorkingDay(cursor)`, `start = subtractWorkingDays(end, days)`, `cursor = start - 1`（cursor 初期値 = 希望納品日）。
- **発注デッドライン** = 先頭工程の開始日以前で最も遅い**基準国の稼働日**（`report.orderDeadline`）。
- 日数は 1〜999 に正規化、工程は最大 20、比較対象国は最大 30。稼働日が 3660 日以内に見つからないカレンダーはエラー（無限ループ防止）。
- 不変条件（テスト済み）：`forward(backward(T).start).end <= T`、`backward(forward(S).end).start >= forward(S).start`。
- UI でモードを切り替えると、基準日を現在の計画の終了日（→逆算）/開始日（→順算）に置き換え、同じ計画を反対方向から表示する。

### 国・タイムゾーン・週末
- カタログ = date-holidays 対応国（約 207）＋祝日データなしの追加国（KH, LA, MM, NP, MN, QA, KW, OM, JO, IQ, MV。週末と TZ のみ）。名称は `Intl.DisplayNames`（EN long / JA short）。
- 初期状態：基準国 `JP`、比較対象 `KR, TH, MY, VN, ID, KE, ZA, NG, US, DE, AE`（`PRESET_PARTNER_COUNTRIES`。プリセットとしてワンクリック追加/解除も可）、営業時間 09:00–18:00、逆算モード、希望納品日 = 今日 + 60 日、工程 = 基本 3 工程（JP 営業日 20 日 → 暦日 21 日 → TH 営業日 3 日）。
- 既定の週末：土日（UAE も 2022 年から土日）。金土 = SA, EG, QA, KW, BH, OM, JO, IL, BD, DZ, IQ, LY, SD, MV／金のみ = IR／金日 = BN／土のみ = NP／マレーシアのケダ・クランタン・トレンガヌ州（MY-02/03/11）は金土。国ごとに UI で上書き可能。
- タイムゾーン候補：US/CA/AU/BR/MX/RU は主要都市の厳選リスト、他は date-holidays の zones。地域を選ぶとその地域の TZ が既定になる（例 US-CA → America/Los_Angeles）。DST は Intl が自動反映。

### 会議可能時間帯（`timezone.ts`）
- 対象日の基準国 00:00〜24:00（DST 日は 23/25h）をウィンドウとし、各国の営業時間を最大 3 つの現地日付にまたがって切り出す。現地の非稼働日（週末/祝日/カスタム休日）の枠はハッチ表示し、重なり計算から除外。
- メールの会議候補は「明日」から最大 21 日を走査し、基準国と相手国が 30 分以上重なる直近 3 日を提示。

## URL クエリ（共有リンク）

| キー | 例 | 内容 |
| --- | --- | --- |
| `v` | `1` | フォーマットバージョン |
| `base` | `JP` | 基準国 |
| `c` | `KR,TH,US` | 比較対象国（順序保持） |
| `mode` | `fwd` / `bwd` | 順算 / 逆算 |
| `d` | `2027-01-15` | 基準日（順算=開始日、逆算=希望納品日） |
| `s`（複数） | `20.JP.Production` | 工程 `{日数}.{カレンダー}.{名称}`（カレンダー `cal` = 暦日） |
| `tz`（複数） | `US:America/Los_Angeles` | 国別タイムゾーン |
| `wk`（複数） | `MY:56` / `TH:-` | 国別週末（0=日…6=土、`-`=なし） |
| `hr`（複数） | `JP:0830-1730` | 国別営業時間 |
| `rg`（複数） | `MY:10` | 国別の祝日地域（州） |
| `off` / `work`（複数） | `TH:2027-02-16..2027-02-18:Lunar New Year` | カスタム休日 / 臨時稼働日（範囲・名称は任意） |

- 状態変更のたびに `history.replaceState` で URL を更新。URL に状態がない場合は LocalStorage の前回状態 → 既定値の順で復元。
- 不正値は `sanitizeState` で除去/既定値化（未知の国、存在しない日付、範囲外日数、未選択国のカレンダー → 基準国 など）。
- LocalStorage キー：`glp:v1:presets`（名前付きプリセット = クエリ文字列）、`glp:v1:last-query`、`glp:v1:export-options`（宛名・署名等。**URL には含めない**）。

## 英文出力（`report.ts` → `exportText.ts`）

- メール：Subject（順算 = Estimated Delivery / 逆算 = Order Deadline）→ 宛名 → KEY DATES → 逆算時の発注依頼文 → SCHEDULE BREAKDOWN（各工程の期間・日数・除外した祝日/カスタム休日）→ PUBLIC HOLIDAYS DURING THIS PERIOD → （任意）AVAILABLE MEETING TIMES → 免責・署名。
- WhatsApp：`*太字*`・絵文字・国旗付きの短縮版。
- オプション：日付形式（`dmy` 既定 / `mdy` / `iso`）、祝日の記載範囲（関係国 = 基準国＋工程で使う国＋相手国 / 全選択国 / なし）、現地語祝日名の併記、会議候補の記載、相手国。
- 祝日一覧の注記：`company holiday`（カスタム休日）、`bank holiday`（type=bank、例: 日本の 1/2・1/3・12/31）、`falls on a weekend`。工程ごとの「Excludes」には週末以外の祝日/休業日のみ記載。

## テスト

`src/utils/*.test.ts`（63 件）：日付プリミティブ（1900–2100 全日のラウンドトリップ）、プリセット国（UAE の週末・複数日のイードを含む）、UAE 祝日補正（30 Ramadan の有無、アラファの日、National Day 2 日間、他国に影響しないこと）、稼働日演算、順算/逆算（400 ケースの不変条件チェック）、実行時 TZ を切り替えても結果が不変であること、date-holidays ラッパー（複数日・半日・地域・現地名対応）、国カタログ、タイムゾーン/DST/重なり計算、URL ラウンドトリップと不正入力、リデューサ、英文出力。

## デプロイ

### GitHub Pages（GitHub Actions による自動デプロイ）
- ワークフロー：`.github/workflows/deploy.yml`
  - トリガー：`main` への push（＝ PR マージ）と `workflow_dispatch`（Actions タブから手動実行）
  - `permissions`: `contents: read` / `pages: write` / `id-token: write`、`concurrency: pages`（実行中のデプロイはキャンセルしない）
  - `build` ジョブ：`actions/checkout@v4` → `actions/setup-node@v4`（Node 20、npm キャッシュ）→ `npm ci` → `npm run build`
    → `actions/configure-pages@v5` → `actions/upload-pages-artifact@v3`（`path: ./dist`）
  - `deploy` ジョブ：`actions/deploy-pages@v4`（environment `github-pages`、URL はジョブ出力 `page_url`）
- **初回のみ**：リポジトリの Settings → Pages → Build and deployment → Source を **GitHub Actions** にする
  （未設定だと `configure-pages` が失敗する）。公開 URL は `https://<owner>.github.io/<repo>/`。
- `vite.config.ts` の `base: './'` によりアセットは相対パスで参照されるため、リポジトリ名（サブパス）を変えても設定変更は不要。
  ルーティングはクエリのみなので 404.html などの SPA フォールバックも不要。

### その他の静的ホスティング
- **Cloudflare Pages**：Build command `npm run build`、Build output directory `dist`。
- バンドル：アプリ本体 ~105 kB、React ~220 kB、vendor（date-holidays の全世界ルール＋moment-timezone）~1.45 MB（gzip ~250 kB）。vendor は別チャンクでキャッシュが効く。

## 注意点・既知の制約

- 祝日データは date-holidays に依存（参考情報）。イスラム暦の祝日は計算値のため公式発表と 1 日ずれる場合がある。
  UAE（AE）は閣議決定 2024 年第 27 号（u.ae の公式祝日一覧）に合わせて補正済み：ラマダン初日・イスラーとミウラージュの夜は
  休業扱いしない（参考表示のみ）、ラマダンが 30 日の年は 30 日目もイード・アル＝フィトル休暇、アラファの日（9 Dhu al-Hijjah）を追加、
  National Day は 12/2–3 の 2 日間（12/1 の Commemoration Day は休日ではない）。ただし閣議による年ごとの振替
  （例: 2025 年の National Day は 12/1–2 に移動）と、月の目視による 1 日のずれは反映できないため、公式発表に合わせて
  カスタム休日/臨時稼働日で調整する。中国の振替出勤日（调休）や日本企業の年末年始休業（12/29〜）などは含まれないため、カスタム休日/臨時稼働日で補う。
- 工程名・カスタム休日名は英文メールにそのまま入るため英語推奨（UI 上に候補リストあり）。
- `useNow` は分単位で更新。現在時刻表示以外の計算は `today`（基準国 TZ の日付）に依存する。
