# CLAUDE.md — Global Planner（B2B）

海外営業・貿易実務向けの「時差・現地祝日統合型の納期逆算＆日程調整 Web アプリ」。
コンテナ・トラックへの積み付けを 3D で確認できる「積載 3D シミュレーター（バンニング計算機）」と、EXW 価格に物流諸掛・保険・関税を
積み上げて条件別の提示価格を出す「Incoterms 輸出見積・コスト積算ボード」も備える。
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
- Tailwind CSS v4（`@tailwindcss/vite`。設定ファイルなし。`src/index.css` の `@import "tailwindcss";` を `main.tsx` で読み込み。
  テーマと独自ユーティリティ `stripes` / `stripes-dark` / `gantt-skip`（45° ストライプ）/ `no-spinner` も `src/index.css`）
- `date-holidays`（約 200 か国の祝日ルール）、`lucide-react`（アイコン）
- `three`（r187。素の `WebGLRenderer` ＋ `OrbitControls` を canvas の ref で制御。React 用ラッパーは使わない）と `@types/three`。
  タブ⑤の 3D ビューア（`LoadViewer3D`）は `React.lazy` で遅延読み込みし、three.js は独立チャンク `three-*.js` に分離
  （`vite.config.ts` の codeSplitting グループ。初期表示では読み込まれない）
- Vitest 4（Node 20 対応版）、oxlint
- GitHub Actions（GitHub Pages への自動デプロイ）

## ディレクトリ構成

```
.github/workflows/deploy.yml  main への push / 手動実行 → npm ci → npm run build → GitHub Pages へデプロイ
index.html                 lang="ja"。favicon は public/favicon.svg
vite.config.ts             base: './'（必須。リポジトリ名に依存せずサブパスで動作）・vendor/react チャンク分割
tsconfig.{app,node,test}.json  app はテスト除外 / test は node 型を含む
src/
  main.tsx, App.tsx        main.tsx は描画前に LocalStorage の旧キーを移行（`migrateLegacyStorage`）。App は左ペイン（固定）＋右ペイン（6 タブ）のレイアウトと、派生データ
                           （国設定→カレンダー→スケジュール→レポート）の useMemo による組み立て
  index.css                Tailwind 読み込み・テーマ・独自ユーティリティ
  types.ts                 PlannerState / Step / CountrySettings / DayOverride / CALENDAR_DAYS / PLANNER_TABS
  data/countries.ts        国カタログ（名称 EN/JA・既定 TZ・既定週末・地域・既定の祝日地域）とプリセット 6 か国
  data/flags.ts            国旗画像の URL 解決：flagcdn.com（主）／同梱の flag-icons SVG（フォールバック。import.meta.glob で個別アセット）
  data/holidayCorrections.ts  date-holidays と公式祝日一覧の差分補正（現在は AE。出典付き）
  data/containers.ts       海上コンテナ 3 種・国内トラック 3 種の内寸/ドア開口高/最大積載/容積、定型パレット寸法
  data/currencies.ts       見積通貨（JPY/USD/EUR/GBP/CNY/HKD/TWD/THB/SGD/MYR/AUD）の名称・目安レート・小数桁
  state/defaults.ts        初期状態・工程テンプレート・工程名候補・ID 生成・上限値・サンプル貨物・貨物の色パレット
  state/plannerReducer.ts  useReducer 用リデューサと sanitizeState（URL 等の外部入力を安全化）
  hooks/usePlanner.ts      状態 ⇄ URL クエリ（replaceState, 250ms debounce）⇄ LocalStorage（前回状態）
  hooks/useNow.ts, useStoredState.ts
  utils/dateCalc.ts        ★ YYYY-MM-DD 文字列ベースの純粋関数（日付演算・稼働日判定・順算/逆算エンジン）
  utils/dateFormat.ts      英語/日本語の日付表示（純粋関数）
  utils/holidays.ts        date-holidays ラッパー（キャッシュ・複数日祝日の展開・EN/現地名の対応付け）
  utils/timezone.ts        Intl ベースのタイムゾーン変換・営業時間の重なり計算・会議候補探索
  utils/calendars.ts       国設定の解決（ResolvedCountry）と WorkCalendar の構築、オーバーライドの範囲化
  utils/report.ts          スケジュール → 表示/出力用レポート（スキップ祝日・関係国の祝日一覧・発注期限）
  utils/binPacking.ts      ★ 3D 積み付け（エクストリームポイント＋奥・下・左優先、緩衝材・壁面クリアランス対応）、
                           正味/実質占有の容積・積載率、規格・台数の自動提案（純粋関数）
  utils/freightRates.ts    ★ 日本発の目安運賃テーブル（仕向地 × 20ft/40ft/LCL/Air、地域の目安、市況係数）、国内トラック運賃、
                           輸出諸掛（THC/バンニング/シール/CFS/上屋・通関料・B/L）、現地諸掛（DAP）プリセット（純粋関数）
  utils/incotermsCalc.ts   ★ EXW→FOB→CFR→CIF→DAP→DDP の積み上げ、R/T・課金重量、為替の適用レートと換算（純粋関数）
  utils/quotation.ts       タブ⑤の貨物 → 見積の連動（容積・重量・コンテナ本数・トラック台数）と見積結果の組み立て（純粋関数）
  utils/exportText.ts      英文テキスト生成：Standard Email / WhatsApp / Meeting Proposal / Price Quotation
                           ＋ Packing & Container Summary・Incoterms Price Quotation の追記（純粋関数）
  utils/urlState.ts        状態 ⇄ URL クエリ文字列
  utils/storage.ts         LocalStorage（プリセット・前回状態・出力設定、`gp:v2:` キー＋旧 `glp:v1:` からの移行）。全アクセス try/catch
  utils/clipboard.ts       クリップボードコピー（非セキュアコンテキスト用フォールバック付き）
  components/              UI（下記）。classes.ts = 共有クラス文字列、styles.ts = 日ステータス/工程の配色、
                           CountryFlag.tsx = 国旗画像（絵文字は使わない）、tabIds.ts = タブ／タブパネルの DOM id、
                           NumberField.tsx = 数値入力（有効な数値だけを確定、単位表示付き、表の行用の compact 表示）、
                           quoteStyles.ts = 見積ボードのコスト系列（チャートの色・バッジ名）・条件名・金額の書式
```

### UI（`src/components`）

| コンポーネント | 役割 |
| --- | --- |
| `AppHeader` | タイトル「Global Planner」、共有 URL コピー、プリセット保存/読込/削除（LocalStorage）、リセット |
| `TabBar` | 右ペインの 6 タブ切り替え（Lucide アイコン付きピル型。WAI-ARIA tabs、←/→/Home/End で移動） |
| `CountryPanel` | 基準国 select、比較対象国チップ（見出し `比較対象国 (6)`。国旗＋国名・現地時刻＋TZ 略称・⚙設定・×削除）、プリセット 6 か国トグル、国検索コンボボックス |
| `CountrySettingsModal` | 国ごとのタイムゾーン・地域（州）・週末（曜日トグル）・営業時間 |
| `MeetingPlanner` | 基準国時間の 24h 軸に各国営業時間バー（祝日/週末はハッチ）、基準国の営業時間帯（破線の薄緑帯）、全員の重なり、全行を貫く現在時刻線、ホバーで各国現地時刻 |
| `SchedulePanel` | 順算/逆算切替、基準日、工程（名称・日数・適用カレンダー・並べ替え・削除・テンプレート）、計算結果サマリーカード（最終納期・発注デッドライン・総所要日数・祝日でスキップした日数と祝日名）、「ガントチャートで確認する →」 |
| `Timeline` | 各国の稼働カレンダー＆工程ガントチャート：稼働日(緑)/週末(灰)/祝日(赤＋白点)/カスタム休日(アンバー)/臨時稼働(濃緑＋白点)、工程バー（スキップ日は 45° ストライプ）。セルのホバーで祝日名（英語/現地語）、クリックでオーバーライド切替 |
| `CustomHolidayManager` | 期間指定でカスタム休日/稼働日を追加、登録済み一覧と削除 |
| `ExportPanel` | 4 形式（Standard Email / WhatsApp / Chat / Meeting Proposal / Price Quotation）の切り替え・プレビュー・ワンクリックコピー・メール/WhatsApp で開く。Packing & Container Summary と Incoterms Price Quotation の追記オプション |
| `VanningPanel` | タブ⑤（シングルカラム）。① 3D ビューアカード（ヘッダー：海上/陸路の切替＋6 規格・自動判定バッジ・警告・視点ボタン・PNG 保存、本体：3D キャンバス、フッター：正味/実質占有容積・重量・床面積の 4 メーター）、② 緩衝材設定バー＋貨物リストのカード |
| `CushioningBar` | 緩衝材・クリアランス設定バー（1 行）：貨物間の緩衝材厚み・壁面クリアランス（数値＋クイック選択 0/30/50/100・0/20/50）、「上下段にも適用」＋上下段の厚み、3D 緩衝材ガイド ON/OFF、初期値に戻す。下に有効積載エリアなどの補足 |
| `CargoList` | 貨物（ケース/SKU）の入力表：識別カラー・名称・L×W×H・定型パレット（T11/ユーロ/T12/北米）・単体重量・個数・段積み・90°回転・個別緩衝材・複製/削除を 1 行に並べ、各行の下に容積（緩衝材込み）・重量・積載状況。下部に「＋ 貨物を追加」 |
| `QuotePanel` | タブ⑥。上部カード（タイトル・「英文見積をコピー」「英文出力タブで編集」・初期化、連動中の貨物スペックのバッジ 7 個と手動上書き）、2 カラム（左 `QuoteSettingsForm`／右 価格カード 5 枚＋`QuoteChart`）、下部に積算内訳表 |
| `QuoteSettingsForm` | 見積の入力（4 セクション）：① EXW 価格・見積通貨・実勢レート・為替安全バッファ（適用レート表示）・USD 換算レート ② 国内トラック運賃・輸出通関/港湾諸掛（自動/手動、内訳表示）③ 輸送モード・仕向地・市況 3 段階・運賃（テーブル運賃/上書き、USD⇄円）・運賃変動バッファ・保険料率 ④ DAP 費用（プリセット/上書き）・関税率（クイック 0/3/5/10%）・見積有効期限＋注意書き |
| `QuoteChart` | CSS のコスト積上げ階段チャート：EXW / FOB / CIF / DAP / DDP の 5 列、EXW の上に追加コストを積み、列の上端を細線でつなぐ。縮尺「上乗せを拡大」（EXW 部分を省略表示＋白い波線）/「実寸」、ラベル「金額 / 構成比」、列ホバー/フォーカスで内訳ツールチップ、凡例 |
| `LoadViewer3D` | three.js の 3D ビュー（遅延読み込み、高さ 420px）。荷室ワイヤーフレーム＋床グリッド、奥/ドアのラベルと矢印、トラックのキャビン、貨物ボックス＋黒エッジ、緩衝材込みの占有境界、ホバーで貨物情報。視点切替と PNG 保存は ref のハンドル（`setView` / `save`）でカードヘッダーから操作 |

## レイアウト仕様（変更時は維持すること）

「**左ペイン常時固定 ＋ 右ペイン 6 タブ切り替え**」のデスクトップ向けレイアウト。

- **全体**：ヘッダー（非固定）の下に `<main className="flex flex-row items-start gap-6 max-w-[1600px] mx-auto px-6 py-5">`。
  **ブレークポイントなしで常に左右 2 ペイン**（縦積みにしない）。ルートは `min-w-[1000px]` で、それより狭いウィンドウは横スクロール。
- **左ペイン（常時固定）**：`<aside className="w-[330px] min-w-[330px] shrink-0 sticky top-5 max-h-[calc(100vh-2.5rem)] overflow-y-auto">`。
  対象国と営業時間（基準国 select、比較対象国チップ、プリセット 6 か国、国検索）。国は「国旗画像＋日本語国名」。
  フッター（データ出典）は右ペインの中に置く（全幅のフッターだとページ末尾で sticky の左ペインが押し上げられて上端が隠れるため）。
- **右ペイン**：`flex-1 min-w-0`。上部にタブバー（`TabBar`）、その下に**選択中のタブだけ**を描画（`role="tabpanel"`）。
  タブ状態は `PlannerState.tab` に保持し、URL の `?tab=` と同期する。
  | `tab` | タブ | 内容 |
  | --- | --- | --- |
  | `meeting`（既定） | ① 会議可能時間帯 | `MeetingPlanner`（現在時刻と会議可能時間帯。対象日を選ぶと Meeting Proposal の起点にもなる） |
  | `schedule` | ② 納期計算 | `SchedulePanel`（左：モード・基準日・工程、右：計算結果サマリー、下部：「ガントチャートで確認する →」でタブ ③ へ） |
  | `calendar` | ③ 稼働カレンダー＆ガント | `Timeline` ＋ `CustomHolidayManager`（期間でカスタム休日を追加） |
  | `export` | ④ 英文メール / WhatsApp | `ExportPanel`（Standard Email / WhatsApp / Chat / Meeting Proposal） |
  | `vanning` | ⑤ 積載3Dシミュレーター | `VanningPanel`（上から順に：3D ビューアカード → 緩衝材設定バー＋貨物リストのカード） |
  | `quote` | ⑥ Incoterms 輸出見積 | `QuotePanel`（連動中の貨物スペック → 設定パネル｜見積価格カード＋階段チャート → 積算内訳） |
- 右ペインの幅はウィンドウ幅より約 400px 狭いので、右ペイン内の段組み（納期計算のサマリー、工程行、カスタム休日フォーム、
  出力の設定＋プレビュー、出力形式タイル）とタブバーの文字サイズは**ビューポートではなくコンテナクエリ**（`@container` / `@xl:` / `@2xl:` / `@3xl:`）
  で切り替える。タブバーはコンテナ幅 70rem（1120px、ウィンドウ幅 ≒ 1520px）未満で短いラベル
  （会議時間帯 / 納期計算 / カレンダー / 英文出力 / 積載3D / 輸出見積）、896px（`@4xl`）未満ではさらに 13px・余白小にして、
  1000px でも 6 タブが収まる。
- **タブ⑤（積載 3D）**：左右に分けず**上から下へのシングルカラム**（どちらのカードも全幅 `w-full`）。
  1. **3D ビューアカード**（最上部）：ヘッダー＝タイトル、輸送手段（海上コンテナ / 陸路トラック）の切替と規格ボタン（20ft / 40ft / 40ft HQ・
     2t / 4t / 10t、推奨バッジ）と規格の要点、海上・陸路の自動判定バッジ（`@3xl:grid-cols-2`）、警告（積み残し・ドア高・重量オーバー等）、
     カメラ視点ボタン（斜め俯瞰 / 側面 / 真上 / 正面（ドア側））と「3D画像を保存（PNG）」。本体＝3D キャンバス `w-full h-[420px]` と凡例。
     フッター＝消化率メーター 4 つ（純粋貨物容積 Net m³ / 緩衝材込み占有容積 Gross m³ / 重量 / 床面積、`grid-cols-2 @3xl:grid-cols-4`）。
  2. **貨物リストのカード**（`bg-white rounded-xl border border-slate-200 p-5`）：上部に緩衝材・クリアランス設定バー
     （`bg-slate-50 p-3.5 rounded-lg border border-slate-200 mb-4`、貨物間・壁面・上下段・3D ガイド ON/OFF を 1 行に。ウィンドウ幅 ≒ 1440px 以上で 1 行）、
     その下に貨物の入力表。リストの幅が 960px 以上（`@min-[960px]`、ウィンドウ ≒ 1400px 以上）では見出し行付きの 1 行 1 貨物の表
     （`grid-cols-[2rem_minmax(6rem,1fr)_13rem_5.5rem_5rem_4rem_4rem_4rem_4.75rem_3.5rem]`）、それより狭いと各行が 2 段に折り返す。
     表の下に「＋ 貨物を追加」・サンプル・すべて削除。
- **タブ⑥（輸出見積）**：上から ① 見出しカード（タイトル・操作ボタン・連動中の貨物スペック：純粋貨物容積 / 総重量 / 積載3Dの選択規格 /
  FCL コンテナ / 国内トラック / LCL R/T / Air 課金重量のバッジ。`grid-cols-2 @xl:grid-cols-4 @[70rem]:grid-cols-7`、選択中の輸送モードの
  課金単位を強調。「手動で上書き」で容積・重量・コンテナ・トラックの上書き欄）② 2 カラム `grid grid-cols-1 items-start gap-6
  @min-[54rem]:grid-cols-[420px_minmax(0,1fr)]`（依頼仕様の `xl:grid-cols-[420px_1fr]` をコンテナクエリで実現。右ペイン幅 54rem ≒
  ウィンドウ 1270px 以上で 2 カラム）。左＝設定パネル（4 セクション）、右＝見積価格カード（`grid-cols-2 @md:grid-cols-3 @2xl:grid-cols-5`、
  DDP は余りのセルを埋める `col-span-2 @2xl:col-span-1`）＋階段チャート。右カラムは 2 カラム時 `sticky top-5` ③ 積算内訳表（全幅）。
- **会議可能時間帯**の各行：`grid grid-cols-[220px_1fr] items-center gap-4`（左ラベル 220px ＋ 24h バー）。ラベル 1 段目 = 国旗＋国名（太字）＋営業中/時間外バッジ、
  2 段目 = `23:01 (火) · UTC+9 · 重なり 8時間`（重なりは `text-emerald-600 font-medium`。30 分単位は「5.5時間」。2 段目は省略表示せず、
  フォント幅で入りきらない場合は「· 重なり …」だけを次の行に送る）。
  バーは `relative h-9 bg-slate-100 rounded-md`、3 時間ごとのグリッド線、基準国の営業時間帯を全行に破線の薄緑帯で表示、
  各国の営業時間は `absolute h-6 top-1.5 bg-emerald-400/80 border border-emerald-600 rounded`（日をまたぐ場合は分割）、
  バーの下に現地時刻（基準時間の 0/6/12/18 時の位置）、現在時刻は全行を貫く 1 本の赤線（`w-0.5 bg-rose-500 z-20`）。
- **各国の稼働カレンダー＆ガントチャート**：パネル内の `overflow-x-auto` マトリクス。左ラベル列は `sticky left-0 z-10` の 210px
  ＋ `border-r`。1 日 = 28px 列（`w-7`）、セルは 26×28px ＋ 左右 1px マージン（列幅 28px を保ち、ヘッダー・ガントと 1px もずれない）。
  行の高さ 32px（`h-8`）。ヘッダーはバッジ行（今日 / 発注期限・希望納期 など＋縦の実線）→ 年月 → 曜日と日付。
  ガントバーは `h-6 rounded` で、開始日〜終了日のセル境界にぴったり揃える（left = 開始列×28+1, width = 日数×28−2）。
  重なり順：セル `z-[1]` < 縦の実線 `z-[5]` < ガントバー `z-[6]`（線がバーのラベルを横切らない）< 左ラベル列 `z-10`。

## UI 表記ルール（国旗・国名）

1. 国は常に **「国旗画像＋日本語の国名」** で表示する（左ペイン、会議可能時間帯、ガントチャートの行ラベル・工程の適用カレンダー表記、
   ツールチップ、カスタム休日一覧、設定ダイアログなどすべて）。
2. **`JP` / `TH` などの 2 文字の国コードを画面に出さない**（国コードは内部 ID・URL 用のみ。`CountryInfo.code` を表示に使わない）。
   州・地域のコード（例: `CA`、`10`）も表示しない。
3. **国旗に絵文字を使わない**（Windows では 🇯🇵 が「JP」の文字になる）。`components/CountryFlag.tsx` を使う。
   国旗は **flagcdn.com の PNG**（`https://flagcdn.com/w40/{国コード小文字}.png`、高 DPI では `w80`、`referrerPolicy="no-referrer"`）を優先し、
   読み込めない場合（オフライン・社内プロキシで遮断・該当画像なし）は同梱の `flag-icons`（MIT）SVG に自動で切り替え、それも無ければ灰色の枠を表示する。
   同梱 SVG は `?no-inline` で個別アセットにしているため、フォールバック時もブラウザは表示中の国旗だけを取得する。
4. `<select>` の option は画像を表示できないため国名のみとし、選択中の国旗を select の左端に重ねて表示する。
5. 英文出力（メール / WhatsApp）にも国旗絵文字を入れない（受信側が Windows の場合も文字化けさせない）。

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
- 初期状態：基準国 日本（Asia/Tokyo・JST）、比較対象は 韓国（Asia/Seoul・KST）・中国（Asia/Shanghai・CST）・アメリカ（America/New_York・EST/EDT）・
  イギリス（Europe/London・GMT/BST）・ドイツ（Europe/Berlin・CET/CEST）・インド（Asia/Kolkata・IST、UTC+5:30）の 6 か国をこの順に表示
  （`PRESET_PARTNER_COUNTRIES = KR, CN, US, GB, DE, IN`。プリセットとしてワンクリック追加/解除も可。台湾・タイ・マレーシア・ベトナム・シンガポール等は
  カタログに残り、検索から追加できる）、営業時間 09:00–18:00、逆算モード、希望納品日 = 今日 + 60 日、工程 = 基本 3 工程（JP 営業日 20 日 → 暦日 21 日 →
  先頭の比較対象国 = 韓国の営業日 3 日。テンプレートの「相手国」は `pickDefaultPartner` = 先頭の比較対象国）、表示タブ = 会議可能時間帯。
- 日本語の国名は `Intl.DisplayNames`（JA short）。読みにくいものは `NAME_JA_OVERRIDES` で上書き（GB:「英国」→「イギリス」）。
- 既定の祝日地域（`getDefaultRegion`）：GB → England（`ENG`）。UK の祝日は地域で異なり、UK 共通データには 8 月の Summer bank holiday が無いため、
  設定がなければイングランド（England & Wales）の Bank Holidays を使う。国設定ダイアログでは既定地域に「（既定）」を付け「全国」の選択肢を出さない
  （既定地域を選ぶと設定なし＝URL に出さない）。国チップの補足には既定地域を表示しない。
- 既定の週末：土日（UAE も 2022 年から土日）。金土 = SA, EG, QA, KW, BH, OM, JO, IL, BD, DZ, IQ, LY, SD, MV／金のみ = IR／金日 = BN／土のみ = NP／マレーシアのケダ・クランタン・トレンガヌ州（MY-02/03/11）は金土。国ごとに UI で上書き可能。
- タイムゾーン候補：US/CA/AU/BR/MX/RU は主要都市の厳選リスト、他は date-holidays の zones。地域を選ぶとその地域の TZ が既定になる（例 US-CA → America/Los_Angeles）。DST は Intl が自動反映。
- タイムゾーン略称：DST のない主要ゾーンは固定表記（JST, KST, CST〔中国・台湾〕, ICT, MYT, SGT, IST, WIB など）、DST のあるゾーンは Intl（EST/EDT, CET/CEST…）、
  それ以外は `UTC±h`。インド（UTC+5:30）など 30 分単位のオフセットも営業時間の重なり計算・表示に正しく反映される。

### 会議可能時間帯（`timezone.ts`）
- 対象日の基準国 00:00〜24:00（DST 日は 23/25h）をウィンドウとし、各国の営業時間を最大 3 つの現地日付にまたがって切り出す。現地の非稼働日（週末/祝日/カスタム休日）の枠はハッチ表示し、重なり計算から除外。
- 会議候補（`findUpcomingMeetingDays`）：Standard Email / WhatsApp は「明日」から、Meeting Proposal は会議タブの対象日（明日より前なら明日）から
  最大 21 日を走査し、基準国と相手国が 30 分以上重なる直近 3 日を提示。

## 積載 3D シミュレーター（タブ⑤・バンニング計算機）

### 規格データ（`data/containers.ts`、すべて内寸 mm・最大積載 kg）
| id | 規格 | 内寸 L × W × H | ドア開口高 | 最大積載 | 容積 |
| --- | --- | --- | --- | --- | --- |
| `20dc` | 20ft Dry | 5,898 × 2,352 × 2,393 | 2,280 | 24,000 | 33.2 m³ |
| `40dc` | 40ft Dry | 12,032 × 2,352 × 2,393 | 2,280 | 26,500 | 67.7 m³ |
| `40hc` | 40ft High Cube (HQ) | 12,032 × 2,352 × 2,698 | 2,585 | 26,500 | 76.4 m³ |
| `2t` | 2t トラック（標準/ロング） | 4,350 × 1,780 × 2,100 | 2,100 | 2,000 | 16.2 m³ |
| `4t` | 4t トラック（ワイド・62ボディ） | 6,200 × 2,380 × 2,400 | 2,400 | 3,500 | 35.4 m³ |
| `10t` | 10t トラック（大型・96ボディ） | 9,600 × 2,380 × 2,500 | 2,500 | 13,000 | 57.1 m³ |

- トラック（アルミバン・ウイング車）は後部ドア／ウイングで荷室高まで開くため、ドア開口高 = 荷室高として扱う。
- 容積は公表値（容積メーターの分母）。定型パレット：T11型 1100×1100、ユーロ 1200×800、T12型 1200×1000、北米 1219×1016（L×W を入力、H はそのまま）。

### 積み付けアルゴリズム（`utils/binPacking.ts`、純粋関数・決定的）
- 座標は荷室内の mm：x = 奥（前壁, 0）→ ドア、y = 幅方向、z = 床からの高さ。貨物は床の上で 90° 回すだけ（横倒ししない）。
- 貨物行を個数分のピースに展開（合計 `MAX_PIECES` = 1,000 個まで。超過分は `limit` として未計算を表示）。
- 先に除外：荷室内寸に入らない（`size`）、ドア開口高を超える（`door`、内寸に入っても搬入不可）、1 個で最大積載超（`weight`）。
- 積む順番：**段積み不可（上積み厳禁）を最優先** → 背が高い → 重い → 底面積が大きい → 行の順。
- 配置：エクストリームポイント法。候補点を「奥（x 小）→ 下（z 小）→ 左（y 小）」の順に試し、最初に置ける位置に置く
  （＝前壁側から床を埋め、置けるところは上に積み、ドアに向かって壁状に積み上がる）。同じ候補点では奥行きの短い向き
  （長辺を幅方向）を優先。
- 置ける条件：荷室内に収まる・他と重ならない・床以外では底面の **80 % 以上**（`SUPPORT_RATIO`）が下の貨物の天面に載る。
  支える貨物は段積み可で、**載せる貨物以上の重さ**（重い物を軽い物の上に載せない）。**段積み不可の貨物の上方には何も置かない**。
- 最大積載を超える分は積まない（`weight`）。同じ行のピースは連続するので、1 個が失敗したら残りも同理由で未積載。
- 結果（`analyzePacking`）：配置、行ごとの積載数と未積載理由、容積・重量・床面積（床に直置きの底面積）・使用荷室長、
  `overweight`（総重量 > 最大積載）、`doorBlocked`（ドア開口高超の行）、`oversize`（内寸に入らない行）。
- 自動提案（`suggestForCategory`）：海上 / 陸路それぞれ全規格で「1 本・1 台に詰め、余りを次へ」を繰り返して必要数を求め、
  **本数・台数が最少 → 小さい規格**を推奨。1 本・1 台で足りる場合は 容積率・重量率・荷室長のうち最大値で
  余裕あり（< 70 %）/ 適正（< 90 %）/ ほぼ満載 を表示。どの規格にも入らない貨物があれば理由付きで「不可」。
- 性能：1,000 ピースの積み付けは数十 ms、6 規格の提案も 50 ms 程度（Web Worker 不要）。テストで全ルールを検証
  （内側・非重複・支持 80 %・重量順・段積み不可・ドア高・最大積載、ランダム 24 ケース）。

### 緩衝材・クリアランス（Cushioning / Clearance）
- 設定は**輸送手段ごと**に保持（`PlannerState.cushioning.sea / .truck`、`CushionSettings`）。陸路トラックを選ぶと
  初期値 **貨物間 50 mm・壁面 30 mm**、海上コンテナは **0 mm**（`DEFAULT_CUSHIONING`）。どちらもいつでも変更・初期値に戻せる。
  - 貨物間の緩衝材厚み（Inter-cargo Gap）0〜500 mm、クイック選択 0 / 30 / 50 / 100 mm
  - 壁面・周囲クリアランス（Wall Margin）0〜500 mm、クイック選択 0 / 20 / 50 mm（側壁・前壁・ドア／アオリ・後扉との隙間）
  - 「上下段の間にも緩衝材を適用する」チェック＋上下段の厚み 0〜50 mm（OFF のときは水平方向（L・W）のみ）
  - 貨物ごとの個別緩衝材（+mm、0〜500）：その貨物の四方に追加する厚み（貨物間・壁面の設定に上乗せ）
- 計算（`Clearance` = `toClearance(settings)`、`stack` はチェック ON のときだけ）：
  - **実効占有サイズ** = 実寸 L・W ＋ 貨物間厚み ＋ 個別緩衝材 × 2、H ＋ 上下段厚み（`occupiedSize`）。
  - **有効積載エリア** = 内寸 L・W − 壁面クリアランス × 2（`usableArea`）。この内側にだけ実寸の貨物を置く。
  - 実装は「実効サイズを、有効積載エリアを貨物間厚み 1 つ分広げた領域」に詰めてから、座標を壁面クリアランス分ずらす。
    これで隣り合う貨物の間は**ちょうど貨物間厚み（＋個別緩衝材）**、壁との間は**ちょうど壁面クリアランス（＋個別緩衝材）**になる
    （外周に半分ずつの厚みが余分に付かない）。高さ方向は上下段厚みの分だけ領域を高くする（最上段の上には不要）。
  - 段積みの支持（80 %）と重量順の判定は**実寸の底面・天面**で行う（緩衝材は荷重を受けない）。
  - `Placement.occupied` = 緩衝材込みの占有ボックス（3D の境界表示と実質占有容積に使用）。
- 容積：**正味（Net Cargo Volume）** = 貨物の実寸の合計、**実質占有（Gross Occupied Volume）** = 実効占有サイズの合計
  （`totalGrossVolume` / `loadedGrossVolume`）。容積消化率の % とバーは実質占有（正味部分は濃色、緩衝材分はストライプ）。
  床面積占有率も緩衝材込みの底面積（貨物の底面のみの値を併記）。
- 自動提案は各輸送手段の設定で計算（海上は海上の設定、陸路は陸路の設定）。緩衝材なしなら従来と同じ結果。

### 画面とメーター
- 自動判定バッジ：「海上なら 20ft Dry で積載可能（余裕あり）」「陸路なら 4t トラック × 1台が最適」など。推奨規格へワンクリックで切替。
- メーター（3D ビューアカードのフッター）：純粋貨物容積（Net）`現在 15.5 m³ / 35.4 m³`、緩衝材込み占有容積（Gross）
  `現在 17.0 m³ / 35.4 m³`（緩衝材・隙間の増分を併記、バーはストライプ）、重量消化率 `現在 3,160 kg / 3,500 kg`、
  床面積占有率（床に直置きした貨物の緩衝材込みの底面積 / 荷室床面積）＋奥からの使用長。
- 警告：① 積みきれない貨物（未積載個数・内訳、全量を積める規格の提案）② ドア開口高超（40ft HQ なら搬入可などの提案）
  ③ 総重量オーバー、ほかに内寸超過・計算上限超過。問題がなければ「すべての貨物を積載できます」と残りの長さを表示。

### 3D ビューア（`components/LoadViewer3D.tsx`）
- `new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true })`（**3 つとも必須**。
  preserveDrawingBuffer がないと PNG 保存で真っ黒になる）。描画はオンデマンド（操作・データ変更・リサイズ時のみ）。
- 単位は m（mm/1000）、three の x = 長さ（奥 −L/2 → ドア +L/2）、y = 高さ、z = 幅。荷室は半透明の壁（ドア側は開口）＋
  輪郭線＋床グリッド（0.5 m）、ドア開口をオレンジ枠（海上コンテナはドア上部の梁を塗り分け）、「奥（前壁）」「ドア（積込口）」
  ラベル、ドア外から奥へ向かう矢印。トラックは簡易キャビン・シャシー・タイヤを前方/下に描く。
- 貨物は `MeshLambertMaterial`（行の色）＋ `EdgesGeometry` の黒い輪郭線。隣接面が見えるよう各辺 4 mm 内側に縮める。
- 「3Dガイド」（緩衝材設定バーの ON/OFF）：緩衝材込みの占有ボックス（`occupied`、荷室内に切り詰め）を薄い黄色の半透明ボックス＋オレンジの破線で、
  壁面クリアランスの内側（有効積載エリア）を床にオレンジの破線で描く（既定 ON）。ホバー表示にも緩衝材込みのサイズを出す。
- `OrbitControls`：ドラッグ回転・右ドラッグ移動・ホイールズーム。視点ボタン（カードヘッダー）：斜め俯瞰 / 側面 / 真上 / 正面（ドア側）
  （正面ではドア側のラベル・矢印を隠す。手で動かすとボタンの選択が外れる）。ホバーで貨物名・寸法・重量・位置（奥から / 床から）を表示。
- 遅延読み込みの境界を越えるため、ツールバーは `VanningPanel` 側にあり、ビューアは `ref`（React 19 の ref プロップ）で
  `LoadViewerHandle`（`setView` / `save`）を公開する。`view` プロップは規格変更時の再フレーミング用、`showCushion` は
  緩衝材設定バーの「3Dガイド」、`onUserMove` / `onReady`（WebGL の可否、保存ボタンの有効化）で状態を返す。
- 「3D画像を保存」：2 倍以上の解像度で再描画し、規格名・内寸・積載量（m³・kg・床面）・貨物リスト・警告・日付を
  緩衝材の設定・正味/実質占有の容積も含めて白背景に合成し、`vanning_{規格}_{日付}.png` をダウンロード（長い行は折り返し）。
- WebGL が使えない環境ではメッセージを表示（計算結果・メーター・リストはそのまま使える）。

## Incoterms 輸出見積・コスト積算ボード（タブ⑥）

社外・客先への提示にも使えるよう **製品原価・目標粗利（利益額）の項目は一切持たない**。EXW 価格（梱包込の工場出荷ベースの販売価格）に
物流諸掛・保険・関税を純粋に積み上げる。状態は `PlannerState.quote`（`QuoteSettings`、パーセントは % の数値で保持、`null` = 自動）。

### 積み上げ（`utils/incotermsCalc.ts`、すべて円・各段で円未満を四捨五入して内訳の合計を一致させる）
- `EXW` = 基準価格 / `FOB` = EXW + 国内トラック運賃 + 輸出通関・港湾諸掛 / `CFR` = FOB + 国際運賃 × (1 + 運賃変動バッファ)
- `CIF` = CFR ÷ (1 − 1.1 × 保険料率)（CIF の 110% に付保する循環参照の解）、保険料 = CIF − CFR
- `DAP` = CIF + 現地諸掛 / 関税 = CIF × 関税率 / `DDP` = DAP + 関税（輸入 VAT / GST は含まない）
- 外貨建て価格 = 円 ÷ 社内適用レート、**社内適用レート = 実勢レート × (1 − 為替安全バッファ)**（円高による為替差損を防ぐ厳しめのレート）。
  JPY 建てはレート 1・バッファなし。USD 建ての運賃・現地諸掛は USD 建てなら実勢レート、それ以外の通貨では「USD 換算レート」で円にする。

### タブ⑤との連動（`utils/quotation.ts` の `linkCargo` → `computeQuote`）
- 純粋貨物容積 V（貨物の実寸の合計 m³）・総重量 W（kg）・個数をタブ⑤の貨物から取得。
- FCL のコンテナ：タブ⑤で海上コンテナを選んでいればその規格で全量に必要な本数（`planUnits`）、トラックを選んでいれば海上の自動判定
  （本数最少 → 小さい規格）。国内トラック：選択中のトラック、それ以外は陸路の自動判定。貨物なしは 20ft / 2t × 1、どの規格にも入らない場合は
  `unavailable`（特殊コンテナ・車両の警告）。容積・重量・コンテナ・トラックは手動で上書きでき（`quote.volume` 等）、バッジに「手動」と出る。
- LCL の R/T = max(V, W / 1000)、最小 1.0 R/T。Air の課金重量 = max(W, V × 167 kg)。

### 目安レート（`utils/freightRates.ts`、日本の主要港・空港発、通常期の概算）
- 国際運賃（USD）：専用航路 41 か国（代表港つき。例 TH Laem Chabang 20ft 350 / 40ft 650 / 40ft HQ 700 / LCL 30 per R/T / Air 2.8 per kg）＋
  10 地域（東アジア〜オセアニア）の目安。全カタログ国を地域に割り当て済み（テストで網羅を検証）。40ft HQ（`fcl40hc`）は 40ft ＋ US$50（アジア域内）/
  ＋ US$100（その他）。欧州は GB Felixstowe / Southampton 20ft 1,600 / 40ft 2,800 / HQ 2,900、DE Hamburg 1,500 / 2,600 / 2,700（LCL 85・80 per R/T、Air 4.8 per kg）。
  Air は最低料金 US$80。**市況係数**：通常期 1.0 / 繁忙期 1.5 / 高騰期 2.5（テーブル運賃にだけ掛け、上書き運賃には掛けない）。
- 国内トラック（円/台）：2t 35,000 / 4t 55,000 / 10t 95,000。
- 輸出通関・港湾諸掛（円）：FCL 1 本あたり THC 20ft 45,000・40ft 64,000、バンニング 35,000・52,000、シール 1,800 ／ LCL CFS・THC 6,000 per R/T ／
  Air 上屋・取扱・X線 35 円/kg（最低 6,000）＋ 1 件あたり 輸出通関料 11,800・B/L 6,000（Air は AWB 5,000）。
- 現地諸掛（DAP、USD）：地域ごとのプリセット（例 東南アジア 20ft 400 / 40ft 550 / LCL 90 + 40 per R/T / Air 90 + 0.3 per kg）。
- 既定値：EXW 5,000,000 円、USD（実勢 150・バッファ 3%）、FCL、仕向地 = 自動（工程の相手国：最終の相手国カレンダー工程 → 先頭の比較対象国、
  日本は除外、なければ米国。初期状態では韓国。**URL の状態だけで決まる**ので共有リンクで同じ価格になる）、通常期、運賃変動バッファ 10%、保険料率 0.20%、
  関税 5.0%、見積有効期限 = 今日 + 14 日（`validUntil = null`）。繁忙期・高騰期は有効期限 7〜14 日を促す注意書き、過去日はエラー表示。

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
| `tab` | `meeting` / `schedule` / `calendar` / `export` / `vanning` / `quote` | 表示中のタブ（不正値は `meeting`） |
| `ct` | `20dc` / `40dc` / `40hc` / `2t` / `4t` / `10t` | 積載シミュレーターの規格（不正値は `20dc`） |
| `cg`（複数） | `1100x1100x1000_300_6_sr_f59e0b_Case #2` | 貨物 `{L}x{W}x{H}_{kg}_{個数}_{フラグ}_{色}_{名称}`（フラグ `s`=段積み可・`r`=90°回転可・`m100`=個別緩衝材 +100 mm・`-`=なし。名称は最後なので `_` を含んでよい。`cg=-` = 貨物なし。`cg` がなければサンプル貨物） |
| `cl`（複数） | `truck.50.30.20.v` | 緩衝材 `{sea\|truck}.{貨物間}.{壁面}.{上下段}.{v\|h}`（`v`=上下段にも適用、`h`=水平のみ）。初期値と違う輸送手段だけ出力し、ないものは初期値 |
| `qx` / `qcur` / `qfx` / `qfb` / `qusd` | `8000000` / `EUR` / `171.25` / `4.5` / `148.5` | 見積：EXW 価格（円）/ 見積通貨 / 実勢レート（通貨の目安レートと同じなら省略）/ 為替安全バッファ % / USD 換算レート |
| `qdom` / `qexp` | `60000` / `99600` | 国内トラック運賃 / 輸出通関・港湾諸掛の手動値（円。なければ自動） |
| `qm` / `qdst` / `qmk` | `lcl` / `DE` / `peak` | 輸送モード（`fcl`/`lcl`/`air`）/ 仕向地（なければ自動）/ 市況（`normal`/`peak`/`surge`） |
| `qfr` / `qloc` | `1800USD` / `98000JPY` | 国際運賃の上書き / 現地諸掛（DAP）の手動値（`{金額}{JPY\|USD}`） |
| `qcb` / `qins` / `qduty` / `qval` | `15` / `0.25` / `2.7` / `2027-01-15` | 運賃変動バッファ % / 保険料率 % / 関税率 % / 見積有効期限 |
| `qv` / `qw` / `qct` / `qtr` | `12.5` / `3200` / `40hc.2` / `10t.1` | 連動値の上書き：容積 m³ / 重量 kg / FCL コンテナ `{規格}.{本数}` / 国内トラック `{規格}.{台数}` |

- 状態変更のたびに `history.replaceState` で URL を更新。URL に状態がない場合は LocalStorage の前回状態 → 既定値の順で復元。
  `tab` だけのリンク（例 `?tab=export`）は状態として扱わず、復元した状態（前回状態 or 既定値）にタブだけを適用する。
- 不正値は `sanitizeState` で除去/既定値化（未知の国、存在しない日付、範囲外日数、未選択国のカレンダー → 基準国 など）。
  貨物は寸法 1〜20,000 mm、重量 0〜100,000 kg（0.1 kg 単位）、個数 1〜999、個別緩衝材 0〜500 mm、最大 30 行、名称 60 文字、
  不正な色はパレットから自動割当。緩衝材は貨物間・壁面 0〜500 mm、上下段 0〜50 mm（整数 mm）。
  見積（`sanitizeQuote`）は q* キーを**初期値と違うものだけ出力**し、ないキーは初期値（現在の状態ではない）。EXW 0〜1,000 億円、諸掛・運賃 0〜10 億円、
  レートは正の数（4 桁）・不正なら通貨の目安レート、為替バッファ 0〜10%、運賃変動バッファ 0〜30%、保険料率 0〜5%、関税 0〜30%、
  仕向地は既知の国のみ（日本＝出発国は不可 → 自動）、コンテナは海上規格・トラックはトラック規格のみ・数量 1〜99、日付不正は自動（14 日後）。
- LocalStorage キー：`gp:v2:presets`（名前付きプリセット = クエリ文字列）、`gp:v2:last-query`（前回状態）、`gp:v2:export-options`（宛名・署名等。**URL には含めない**）。
  旧キー `glp:v1:*`（改名前の旧バージョン）は起動時に `migrateLegacyStorage` がプリセットと出力設定だけを移し、前回状態は破棄する
  （旧 9 か国の国リストがキャッシュから復元されず、新しい 6 か国プリセットが表示される）。リセットボタンも常に 6 か国の初期状態に戻す。

## 英文出力（`report.ts` → `exportText.ts`）

- メール：Subject（順算 = Estimated Delivery / 逆算 = Order Deadline）→ 宛名 → KEY DATES → 逆算時の発注依頼文 → SCHEDULE BREAKDOWN（各工程の期間・日数・除外した祝日/カスタム休日）→ PUBLIC HOLIDAYS DURING THIS PERIOD → （任意）AVAILABLE MEETING TIMES → 免責・署名。
- WhatsApp / Chat：`*太字*`・絵文字（国旗絵文字は使わない）の短縮版。
- Meeting Proposal（`renderMeetingProposal`）：Subject `Meeting Request – Proposed Times` → 宛名 → 候補日時（番号付き、`11:00–18:00 JST / 09:00–16:00 ICT`）
  → 返信のお願い →（工程があれば）発注期限/納期の参考 → 署名。候補は「会議可能時間帯」タブの対象日（明日より前なら明日）から最大 21 日を走査し、
  基準国と相手国の営業時間が 30 分以上重なる直近 3 日（双方の週末・祝日・カスタム休日を除外）。重なりが無い国（例: 日本と米国東部）は
  双方の営業時間を示して時間外の打ち合わせを打診する文面にする。TZ 略称は候補ごとの日付で求める（期間中の夏時間切り替えに対応）。
- Price Quotation（`renderQuotationEmail`、タブ⑥の結果）：Subject `Price Quotation – EXW / FOB / CIF / DDP` → 宛名 →
  `PRICE QUOTATION ({通貨})`（`EXW Japan` / `FOB Japanese port`（Air は airport）/ `CIF {代表港}, {国}`（地域目安は `main port`）/
  `DDP your premises, {国}` の 4 条件。DAP は画面のみ）→ `SHIPMENT BASIS`（輸送手段と本数/R/T/課金重量、貨物の個数・m³・kg、
  `Exchange rate basis: USD 1 = JPY 145.50`（適用レート。外貨建てのみ）、保険 110%、関税率）→ `VALIDITY` → `FREIGHT DISCLAIMER`
  （繁忙期・高騰期は文頭に市況の注意）→（工程があれば）納期の参考 → 署名。為替・運賃のバッファ自体は記載しない。
  Standard Email / WhatsApp にはオプション `includeQuote` で `INCOTERMS PRICE QUOTATION` / `*Price quotation*` を追記（Packing の後）。
  タブ⑥の「英文見積をコピー」は Price Quotation をそのままコピーし、「英文出力タブで編集」は形式を Price Quotation にしてタブ④を開く。
- オプション：日付形式（`dmy` 既定 / `mdy` / `iso`）、祝日の記載範囲（関係国 = 基準国＋工程で使う国＋相手国 / 全選択国 / なし）、現地語祝日名の併記、会議候補の記載、相手国。
  Meeting Proposal では祝日関連のオプションは使わない（宛名・署名・参照番号・日付形式・相手国のみ）。
- Packing & Container Summary（オプション `includePacking`、Standard Email / WhatsApp）：タブ⑤の貨物から
  `buildPackingSummary`（輸送手段ごとの緩衝材設定を渡す）で作成。メールは PUBLIC HOLIDAYS の後に `PACKING & CONTAINER SUMMARY`
  （個数・種類数、`Net cargo volume`、`Gross occupied volume (incl. cushioning)`、総重量、最大寸法の貨物、段積み不可の個数、
  `Cushioning / clearance`（選択中の輸送手段の設定）、推奨（海上 / 陸路。積載計画と違う緩衝材で計算した側は `allowing …` を付記）、
  選択中規格での積載結果（実質占有の容積率）、貨物一覧（個別緩衝材は `+100 mm cushioning`）、注記）、
  WhatsApp は `*Packing summary*`（📦 個数・m³（緩衝材ありなら net / gross）・kg / 🚢 Sea / 🚚 Road）。
- 祝日一覧の注記：`company holiday`（カスタム休日）、`bank holiday`（type=bank、例: 日本の 1/2・1/3・12/31）、`falls on a weekend`。工程ごとの「Excludes」には週末以外の祝日/休業日のみ記載。

## テスト

`src/utils/*.test.ts`（130 件）：日付プリミティブ（1900–2100 全日のラウンドトリップ）、プリセット 6 か国の順序・日本語名・既定 TZ、
イギリス（「イギリス」表記、イングランドの Bank Holidays、スコットランド選択時）・ドイツ（国の祝日、半日のクリスマスイブは稼働日）、
GMT/BST・CET/CEST・EST/EDT・IST の略称と日本との営業時間の重なり、LocalStorage の旧キー移行、全カタログ国の国旗 SVG の有無・日本語名の重複なし、台湾（UTC+8・旧正月）・インド（UTC+5:30・日本との重なり 5.5 時間）、UAE の週末・複数日のイード、UAE 祝日補正（30 Ramadan の有無、アラファの日、National Day 2 日間、他国に影響しないこと）、稼働日演算、順算/逆算（400 ケースの不変条件チェック）、実行時 TZ を切り替えても結果が不変であること、date-holidays ラッパー（複数日・半日・地域・現地名対応）、国カタログ、タイムゾーン/DST/重なり計算、URL ラウンドトリップと不正入力（`tab` を含む）、リデューサ、英文出力（Meeting Proposal の候補表示と重なりなしの文面、Packing & Container Summary を含む）、積載シミュレーター（規格データ、床面いっぱいのパレット数、2 段積み、回転の可否、ドア開口高、最大積載、重量順・段積み不可、ランダム 36 ケースの物理ルール検証（半数は緩衝材・個別緩衝材をランダムに設定）、1,000 個の性能、規格・台数の提案、
緩衝材（貨物間の隙間、壁面クリアランス、陸路の初期値、上下段の緩衝材、個別緩衝材、正味/実質占有の容積、クリアランス込みの寸法超過））、
貨物と緩衝材の URL ラウンドトリップと不正入力、緩衝材のリデューサ、
輸出見積（全カタログ国の運賃地域の網羅、専用航路の妥当性、市況係数、モード別の課金単位、輸出諸掛・国内トラック・現地諸掛、
R/T・課金重量・適用レート、EXW→DDP の積み上げの具体値、保険の循環参照を含む 200 ケースの不変条件、タブ⑤からの連動（選択規格・自動判定・
複数本・規格外・貨物なし）、40ft HQ の運賃、上書き・市況・通貨換算・有効期限・仕向地の解決、q* キーの URL ラウンドトリップと不正入力、見積のリデューサ、
英文の Price Quotation（単独メール・メール/WhatsApp への追記、LCL・Air・JPY・高騰期の文面））。

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
- バンドル：アプリ本体 ~257 kB（gzip ~81 kB）、React ~220 kB、vendor（date-holidays の全世界ルール＋moment-timezone＋国旗 URL 表）~1.47 MB（gzip ~254 kB）。
  three.js ~570 kB（gzip ~140 kB）と 3D ビューア ~17 kB はタブ⑤を開いたときだけ読み込む。
  国旗は通常 flagcdn.com から取得。同梱のフォールバック用 SVG は 271 ファイル（合計 ~2.7 MB）だが、必要になったものだけが取得される。
  vendor は別チャンクでキャッシュが効く。

## 注意点・既知の制約

- 祝日データは date-holidays に依存（参考情報）。イスラム暦の祝日は計算値のため公式発表と 1 日ずれる場合がある。
  UAE（AE）は閣議決定 2024 年第 27 号（u.ae の公式祝日一覧）に合わせて補正済み：ラマダン初日・イスラーとミウラージュの夜は
  休業扱いしない（参考表示のみ）、ラマダンが 30 日の年は 30 日目もイード・アル＝フィトル休暇、アラファの日（9 Dhu al-Hijjah）を追加、
  National Day は 12/2–3 の 2 日間（12/1 の Commemoration Day は休日ではない）。ただし閣議による年ごとの振替
  （例: 2025 年の National Day は 12/1–2 に移動）と、月の目視による 1 日のずれは反映できないため、公式発表に合わせて
  カスタム休日/臨時稼働日で調整する。中国の振替出勤日（调休）や日本企業の年末年始休業（12/29〜）などは含まれないため、カスタム休日/臨時稼働日で補う。
- 台湾（TW）：date-holidays は土曜に重なる祝日の金曜振替を元日にしか適用しない（例: 2026 年の 2/28・10/10 の前日金曜は休日扱いにならない）。
  台湾の補班（振替出勤日）も未収録。行政院人事行政総処の公式カレンダーと照合し、カスタム休日/臨時稼働日で調整する。
- インド（IN）：date-holidays は国の祝日（共和国記念日・独立記念日・ガンディー生誕日など）中心で、ディワリやホーリーなど州・企業で異なる祝日は
  含まれない。必要に応じて地域（州）を選ぶか、カスタム休日で追加する。
- 工程名・カスタム休日名は英文メールにそのまま入るため英語推奨（UI 上に候補リストあり）。
- `useNow` は分単位で更新。現在時刻表示以外の計算は `today`（基準国 TZ の日付）に依存する。
- 実質占有容積は「実効占有サイズ × 個数」の合計（最上段の上の上下段緩衝材や、壁際の半分の隙間も含む概算）。
  個別緩衝材は四方（水平方向）のみで、上方には付けない。
- 積載シミュレーターは実用的なヒューリスティック（最適解の保証はない）。重心・軸重・固縛（ラッシング）・荷崩れ防止材、
  横倒し、貨物ごとの耐荷重（上に載せられる重さ）は考慮しない。トラックの寸法・最大積載は車両により異なるため目安。
