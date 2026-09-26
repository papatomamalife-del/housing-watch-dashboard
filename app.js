/* housing-watch ダッシュボード。
 * データは index.html 内の <script id="hw-data" type="application/json"> に埋め込まれている。
 * fetch を使わないため file:// で開いても動作する(バックアップからの閲覧を想定)。
 */
(function () {
  "use strict";

  const DATA = JSON.parse(document.getElementById("hw-data").textContent);
  const CATEGORY_ORDER = ["rental", "used_mansion", "used_house"];
  /** 市場全体の相場だけを見る画面。カテゴリではないので別扱いにする。 */
  const MARKET_TAB = "market";

  /** 一覧を「条件に合う物件だけ」に絞るかどうか。既定は絞る。 */
  let onlyMatching = true;
  try {
    const saved = localStorage.getItem("hw-only-matching");
    if (saved !== null) onlyMatching = saved === "1";
  } catch (error) { /* 非対応環境は既定値のまま */ }

  /** 絞り込みが有効なら、条件に合う行だけを返す。 */
  function filtered(rows) {
    if (!onlyMatching) return rows || [];
    return (rows || []).filter((row) => row.matches !== false);
  }

  // --- 表示ユーティリティ -------------------------------------------------

  /** スマホ幅かどうか(CSS の @media (max-width: 700px) と合わせる)。 */
  function isNarrow() {
    return window.matchMedia && window.matchMedia("(max-width: 700px)").matches;
  }

  function yen(value, category) {
    if (value === null || value === undefined) return "—";
    if (category === "rental") return Math.round(value).toLocaleString("ja-JP") + "円";
    // 値下げ額など負の値も万円表記にするため絶対値で判定する
    if (Math.abs(value) >= 10000) return (value / 10000).toLocaleString("ja-JP", { maximumFractionDigits: 0 }) + "万円";
    return Math.round(value).toLocaleString("ja-JP") + "円";
  }

  function num(value, digits) {
    if (value === null || value === undefined) return "—";
    return Number(value).toLocaleString("ja-JP", { maximumFractionDigits: digits === undefined ? 1 : digits });
  }

  function pct(value) {
    if (value === null || value === undefined) return "—";
    const sign = value > 0 ? "+" : "";
    return sign + value.toFixed(1) + "%";
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (key === "class") node.className = value;
      else if (key === "html") node.innerHTML = value;
      else if (value !== null && value !== undefined) node.setAttribute(key, value);
    });
    (children || []).forEach((child) => node.appendChild(typeof child === "string" ? document.createTextNode(child) : child));
    return node;
  }

  // --- 部品 ---------------------------------------------------------------

  function kpiCard(label, value, sub, deltaClass) {
    return el("div", { class: "kpi" }, [
      el("div", { class: "label" }, [label]),
      el("div", { class: "value " + (deltaClass || "") }, [value]),
      el("div", { class: "sub" }, [sub || ""]),
    ]);
  }

  /** 棒1本の中身を一言で表す。「何の中央値なのか」を必ず添えるため。 */
  function barMeta(row, valueKey) {
    const parts = [];
    if (valueKey !== "count") parts.push(row.count + "件");
    if (row.median_area_sqm !== null && row.median_area_sqm !== undefined) {
      parts.push(num(row.median_area_sqm) + "㎡");
    }
    if (row.median_building_age !== null && row.median_building_age !== undefined) {
      parts.push("築" + num(row.median_building_age, 0) + "年");
    }
    const layouts = row.layouts || [];
    if (layouts.length > 0) {
      const share = row.top_layout_share;
      // 上位の間取りが半分以上を占めるなら、その中央値は実質その間取りの値。
      // 見誤りやすいので「◯◯が◯割」と明示する。
      parts.push(
        share !== null && share !== undefined && share >= 0.4
          ? layouts[0].label + "が" + Math.round(share * 100) + "%"
          : layouts.map((l) => l.label).join("と")
      );
    }
    return parts.join("・");
  }

  function barChart(rows, category, valueKey) {
    if (!rows || rows.length === 0) {
      return el("p", { class: "empty" }, ["この条件に当てはまる物件がありません"]);
    }
    const max = Math.max.apply(null, rows.map((row) => row[valueKey] || 0)) || 1;
    const wrap = el("div", {});
    rows.forEach((row) => {
      const width = Math.round(((row[valueKey] || 0) / max) * 100);
      wrap.appendChild(
        el("div", { class: "bar-row" }, [
          el("div", {}, [
            el("div", {}, [row.label]),
            el("div", { class: "bar-meta" }, [barMeta(row, valueKey)]),
          ]),
          el("div", { class: "bar-track" }, [el("div", { class: "bar-fill", style: "width:" + width + "%" })]),
          el("div", { class: "bar-value" }, [
            valueKey === "count" ? row.count + "件" : yen(row[valueKey], category),
          ]),
        ])
      );
    });
    return wrap;
  }

  /** 月次推移の折れ線グラフ(SVG を手書きする。外部ライブラリ不要)。 */
  function lineChart(series, key, category) {
    const points = series.filter((row) => row[key] !== null && row[key] !== undefined);
    if (points.length < 2) return el("p", { class: "empty" }, ["推移を描くにはデータが足りません(2か月以上必要)"]);

    const W = 320, H = 180, PAD = 34;
    const values = points.map((row) => row[key]);
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const span = max - min || 1;
    const x = (i) => PAD + (i * (W - PAD - 8)) / (points.length - 1);
    const y = (v) => H - PAD - ((v - min) / span) * (H - PAD - 16);

    const path = points.map((row, i) => (i === 0 ? "M" : "L") + x(i).toFixed(1) + "," + y(row[key]).toFixed(1)).join(" ");
    const parts = [
      '<line x1="' + PAD + '" y1="' + (H - PAD) + '" x2="' + W + '" y2="' + (H - PAD) + '" stroke="currentColor" opacity="0.2"/>',
      '<path d="' + path + '" fill="none" stroke="var(--accent)" stroke-width="2"/>',
    ];
    points.forEach((row, i) => {
      parts.push('<circle cx="' + x(i).toFixed(1) + '" cy="' + y(row[key]).toFixed(1) + '" r="2.5" fill="var(--accent)"/>');
    });
    parts.push('<text x="2" y="14" font-size="10" fill="currentColor" opacity="0.6">' + yen(max, category) + "</text>");
    parts.push('<text x="2" y="' + (H - PAD) + '" font-size="10" fill="currentColor" opacity="0.6">' + yen(min, category) + "</text>");
    parts.push('<text x="' + PAD + '" y="' + (H - 10) + '" font-size="10" fill="currentColor" opacity="0.6">' + points[0].month + "</text>");
    parts.push('<text x="' + (W - 52) + '" y="' + (H - 10) + '" font-size="10" fill="currentColor" opacity="0.6">' + points[points.length - 1].month + "</text>");

    // SVG は名前空間が必要なため createElement ではなく innerHTML で組み立てる
    const holder = el("div", {});
    holder.innerHTML =
      '<svg class="line" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none">' + parts.join("") + "</svg>";
    return holder;
  }

  /** スマホのカードで大きく出す列(お金の列)。 */
  const MONEY_COLUMNS = ["月額総額", "月額総額(変更後)", "家賃", "最終家賃", "価格", "最終価格",
    "変更後", "管理費＋修繕積立金"];

  function cellNode(cell) {
    return cell && cell.nodeType
      ? cell
      : document.createTextNode(String(cell === null || cell === undefined ? "—" : cell));
  }

  /**
   * 表。パソコンでは普通の表、スマホ(幅700px未満)では1物件1枚のカードで見せる。
   * 12列ある表を幅400pxの画面で横スクロールさせると、月額総額や契約が画面3枚ぶん
   * 右に隠れて比べられないため。どちらを出すかは CSS が決める(両方作っておく)。
   */
  function table(columns, rows, render) {
    if (!rows || rows.length === 0) return el("p", { class: "empty" }, ["該当なし"]);
    const head = el("tr", {}, columns.map((label) => el("th", {}, [label])));
    const body = rows.map((row) => el("tr", {}, render(row).map((cell, index) => {
      // 1列目は物件名。長い広告文が多いので幅を制限する(CSS 側で … 省略)
      const attrs = index === 0 ? { class: "title-cell" } : {};
      return el("td", attrs, [cellNode(cell)]);
    })));
    const wide = el("div", { class: "scroll wide-view" },
      [el("table", {}, [el("thead", {}, [head]), el("tbody", {}, body)])]);

    const cards = el("div", { class: "card-view" }, rows.map((row) => {
      const cells = render(row);  // DOM は2か所に置けないので、カード用に作り直す
      const money = [];
      const rest = [];
      cells.slice(1).forEach((cell, i) => {
        const label = columns[i + 1];
        const pair = el("div", { class: "item-pair" }, [
          el("span", { class: "item-label" }, [label]),
          el("span", { class: "item-value" }, [cellNode(cell)]),
        ]);
        (MONEY_COLUMNS.indexOf(label) >= 0 ? money : rest).push(pair);
      });
      return el("div", { class: "item" }, [
        el("div", { class: "item-title" }, [cellNode(cells[0])]),
        money.length ? el("div", { class: "item-money" }, money) : el("span", {}),
        el("div", { class: "item-grid" }, rest),
      ]);
    }));
    return el("div", {}, [wide, cards]);
  }

  /** 「土橋駅 徒歩13分」。駅が分からない物件(バス便など)は「—」。 */
  function access(row) {
    if (!row.station) return "—";
    return row.station + (row.walk_minutes === null || row.walk_minutes === undefined ? "" : " 徒歩" + row.walk_minutes + "分");
  }

  /** 「75.5㎡」 */
  function sqm(row) {
    return row.area_sqm === null || row.area_sqm === undefined ? "—" : num(row.area_sqm) + "㎡";
  }

  /** 「築12年(2014年3月)」。築年月が分かるものは併記する。 */
  function age(row) {
    if (row.building_age === null || row.building_age === undefined) return "—";
    const years = "築" + Math.floor(row.building_age) + "年";
    if (!row.built_year_month) return years;
    const parts = String(row.built_year_month).split("-");
    const built = parts.length > 1 ? parts[0] + "年" + Number(parts[1]) + "月" : parts[0] + "年";
    return years + "(" + built + ")";
  }

  /** 「普通借家」「定期借家」。詳細ページを見るまでは「確認中」。
   *  見たうえで書かれていなかったものは「記載なし」と区別する。 */
  function contract(row) {
    const map = { normal: "普通借家", fixed_term: "定期借家" };
    if (map[row.contract_type]) return map[row.contract_type];
    const checked = row.detail_checked !== undefined ? row.detail_checked : row.checked === 1;
    // 同じ建物・同じ面積の別掲載で定期借家が確認されている場合は注意を出す。
    // SUUMO は同じ部屋を複数の不動産会社が別々に掲載し、
    // 契約期間を書く会社と書かない会社があるため。
    if (row.same_building_fixed_term) {
      return el("span", {
        class: "warn-text",
        title: "同じ建物・同じ面積の別の掲載で定期借家が確認されています。問い合わせ前に契約形態をご確認ください。",
      }, ["定借の可能性"]);
    }
    return checked ? "記載なし" : "確認中";
  }

  /** 「2台 0円」「1台 8,800円」「なし」。未取得は「確認中」。 */
  function parking(row) {
    if (row.parking_capacity === 0) return "なし";
    if (row.parking_capacity === null || row.parking_capacity === undefined) {
      const checked = row.detail_checked !== undefined ? row.detail_checked : row.checked === 1;
      return checked ? "記載なし" : "確認中";
    }
    const fee = row.parking_fee === null || row.parking_fee === undefined
      ? "" : (row.parking_fee === 0 ? " 無料" : " " + row.parking_fee.toLocaleString("ja-JP") + "円");
    return row.parking_capacity + "台" + fee;
  }

  /** 勤務先までの車の所要時間。 */
  function commute(row) {
    if (row.commute_minutes === null || row.commute_minutes === undefined) return "—";
    return "車" + Math.round(row.commute_minutes) + "分";
  }

  /** 賃貸の実質月額(家賃＋管理費＋共益費＋駐車場＋その他)。内訳を title に出す。 */
  function totalMonthly(row, category) {
    const value = row.effective_monthly_cost !== undefined && row.effective_monthly_cost !== null
      ? row.effective_monthly_cost : row.monthly;
    if (value === null || value === undefined) return "—";
    const parts = [];
    if (row.price) parts.push("家賃 " + row.price.toLocaleString("ja-JP"));
    if (row.management_fee) parts.push("管理費 " + row.management_fee.toLocaleString("ja-JP"));
    if (row.common_fee) parts.push("共益費 " + row.common_fee.toLocaleString("ja-JP"));
    if (row.parking_fee) parts.push("駐車場 " + row.parking_fee.toLocaleString("ja-JP"));
    if (row.other_monthly_fee) parts.push("その他(毎月) " + row.other_monthly_fee.toLocaleString("ja-JP"));
    const parkingUnknown = row.parking_fee_unknown !== undefined
      ? row.parking_fee_unknown
      : ((row.parking_fee === null || row.parking_fee === undefined) && row.parking_capacity !== 0);
    if (parkingUnknown) {
      // 駐車場代が分からない物件は、その分を足せていない。低めに出ていることを示す
      return el("span", {
        title: parts.join(" ＋ ") + "\n※駐車場代が不明のため含んでいません",
      }, [yen(value, category) + "＋駐車場"]);
    }
    return el("span", { title: parts.join(" ＋ ") }, [yen(value, category)]);
  }

  /** 売買の毎月かかる費用(管理費＋修繕積立金)。 */
  function monthlyCost(row, category) {
    const value = row.monthly_fixed_cost !== undefined && row.monthly_fixed_cost !== null
      ? row.monthly_fixed_cost : row.monthly;
    if (value === null || value === undefined) {
      const checked = row.detail_checked !== undefined ? row.detail_checked : row.checked === 1;
      return checked ? "記載なし" : "確認中";
    }
    const parts = [];
    if (row.management_fee) parts.push("管理費 " + row.management_fee.toLocaleString("ja-JP"));
    if (row.repair_reserve) parts.push("修繕積立金 " + row.repair_reserve.toLocaleString("ja-JP"));
    return el("span", { title: parts.join(" ＋ ") }, [yen(value, "rental") + "/月"]);
  }

  /** 「見つけてから消えるまで」を、確認しなかった日のぶんの幅つきで表す。 */
  function seenSpan(row) {
    const lo = row.days_seen_min !== undefined && row.days_seen_min !== null
      ? row.days_seen_min : row.days_on_market;
    const hi = row.days_seen_max;
    if (lo === null || lo === undefined) return "—";
    if (hi === null || hi === undefined || hi === lo) return lo + "日";
    return lo + "〜" + hi + "日";
  }

  function link(row) {
    const text = row.title || row.source_listing_id || "(名称不明)";
    // title 属性を付けておくと、省略されていてもマウスを乗せれば全文が読める
    return row.url
      ? el("a", { href: row.url, target: "_blank", rel: "noopener", title: text }, [text])
      : el("span", { title: text }, [text]);
  }

  /** 条件を満たす駅の一覧。折りたたみで表示する(数が多いため)。 */
  function stationList(data) {
    const stations = data.commute_stations || [];
    if (stations.length === 0) return el("span", {});

    const text = stations
      .map((s) => s.name.replace(/駅$/, "") + Math.round(s.minutes) + "分")
      .join("・");

    const details = el("details", { style: "width:100%;margin-top:2px" });
    details.appendChild(
      el("summary", { class: "empty", style: "cursor:pointer;margin:0" }, [
        "対象の駅 " + stations.length + "駅（クリックで一覧）",
      ])
    );
    details.appendChild(
      el("div", { class: "empty", style: "margin:6px 0 0;line-height:1.8" }, [text])
    );
    return details;
  }

  /** 「条件に合う物件だけ」の切り替えスイッチ。 */
  function filterToggle(data, onChange) {
    const box = el("input", { type: "checkbox", id: "only-matching" });
    box.checked = onlyMatching;
    box.addEventListener("change", () => {
      onlyMatching = box.checked;
      try { localStorage.setItem("hw-only-matching", onlyMatching ? "1" : "0"); } catch (e) {}
      onChange();
    });

    const label = el("label", { for: "only-matching", style: "cursor:pointer;user-select:none" }, [
      "希望条件に合う物件だけ表示",
    ]);

    // 条件の全文は長く、スマホだと数字にたどり着くまで1画面以上かかるため、
    // 狭い画面では折りたたんでおく(タップで開く)。
    const details = el("details", { style: "width:100%" });
    if (!isNarrow()) details.setAttribute("open", "");
    details.appendChild(el("summary", { class: "empty", style: "cursor:pointer;margin:0" }, [
      "条件の詳細（該当 " + (data.matching_count || 0) + "件 / 掲載中 " + data.kpi.active_count + "件）",
    ]));
    details.appendChild(el("div", { style: "display:flex;flex-direction:column;gap:8px;margin-top:8px" }, [
      el("span", { class: "empty", style: "margin:0" }, ["条件: " + (data.criteria_label || "なし")]),
      el("span", { class: "empty", style: "margin:0" }, [
        "車通勤の基準地: " + (data.commute_origin || "—") +
        "　※朝7時台の目安(実際の通勤時間で補正済み)",
      ]),
      stationList(data),
    ]));

    return el("div", { class: "card", style: "display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:16px" }, [
      box,
      label,
      details,
    ]);
  }

  function section(title, content) {
    return el("section", {}, [el("h2", {}, [title]), el("div", { class: "card" }, [content])]);
  }

  /** 見出しの下に「この数字は何か」を一行で置くための節。 */
  function chartSection(title, caption, content) {
    return el("section", {}, [
      el("h2", {}, [title]),
      el("div", { class: "card" }, [
        el("p", { class: "chart-caption" }, [caption]),
        content,
      ]),
    ]);
  }

  /** グラフの母集団。カテゴリ画面では希望条件が既定。 */
  let chartScope = "matching";
  try {
    const saved = localStorage.getItem("hw-chart-scope2");
    if (saved === "matching" || saved === "family") chartScope = saved;
  } catch (error) { /* 非対応環境は既定値のまま */ }

  function scopeSwitch(data, onChange, allowed) {
    const scopes = (data.distribution_scopes || [])
      .filter((s) => !allowed || allowed.indexOf(s.key) >= 0);
    const current = scopes.filter((s) => s.key === chartScope)[0] || scopes[0];
    const buttons = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" });

    scopes.forEach((scope) => {
      const active = scope.key === chartScope;
      const button = el("button", {
        type: "button",
        class: "scope-button" + (active ? " active" : ""),
      }, [scope.label + "（" + scope.count + "件）"]);
      button.addEventListener("click", () => {
        chartScope = scope.key;
        try { localStorage.setItem("hw-chart-scope2", chartScope); } catch (e) {}
        onChange();
      });
      buttons.appendChild(button);
    });

    return el("div", { class: "card", style: "margin-bottom:16px" }, [
      el("div", { style: "font-weight:600;margin-bottom:8px" }, ["数字とグラフの集計対象"]),
      buttons,
      isNarrow() && current && current.key === "matching"
        ? el("span", {})  // 条件の全文は上の「条件の詳細」にあるので繰り返さない
        : el("p", { class: "empty", style: "margin:10px 0 0" }, [current ? current.note : ""]),
      isNarrow() ? el("span", {}) : el("p", { class: "empty", style: "margin:6px 0 0" }, [
        "※ どれを選んでもデータベースには全件残ります。ここで変わるのは数字とグラフの集計対象だけです。",
      ]),
    ]);
  }

  /** 棒グラフ7種をまとめて描く。各グラフに「何の数字か」を明記する。 */
  function chartsBlock(root, data, category, rerender, opts) {
    opts = opts || {};
    const key = opts.scope || chartScope;
    const scopes = data.distribution_scopes || [];
    const dist = (data.distributions || {})[key]
      || (data.distributions || {}).all
      || data.distributions;
    if (!dist || !dist.price) return;

    const scope = scopes.filter((s) => s.key === key)[0] || { label: "掲載中すべて", count: 0 };
    const priceWord = category === "rental" ? "家賃" : "価格";
    const who = scope.label + " " + scope.count + "件が対象";

    root.appendChild(el("h2", { style: "margin-top:26px" }, [opts.title || "地域別・条件別の内訳"]));
    // 7つのグラフは見出しの中身(開け閉めの単位にしない)。1つずつ畳めると、かえって手数が増える
    const sub = (node) => { node.classList.add("sub"); return node; };

    root.appendChild(sub(chartSection(
      priceWord + "帯ごとの件数",
      who + "。棒の長さ＝その" + priceWord + "帯の物件数です。",
      barChart(dist.price, category, "count")
    )));
    root.appendChild(sub(chartSection(
      "市区町村別の" + priceWord + "中央値",
      who + "。棒の長さ＝その市区町村の" + priceWord + "の中央値（真ん中の物件の" + priceWord + "）です。",
      barChart(dist.city, category, "median_price")
    )));
    root.appendChild(sub(chartSection(
      "町名別の" + priceWord + "中央値（件数の多い12町）",
      who + "。棒の長さ＝その町の" + priceWord + "の中央値です。件数が少ない町は数字が動きやすい点にご注意ください。",
      barChart(dist.town, category, "median_price")
    )));
    root.appendChild(sub(chartSection(
      "駅別の" + priceWord + "中央値（件数の多い12駅）",
      who + "。棒の長さ＝その駅の物件の" + priceWord + "の中央値です。" +
      "駅ごとに間取りの構成が違うため、各棒の下に件数・面積・間取りを書いています。",
      barChart(dist.station, category, "median_price")
    )));
    root.appendChild(sub(chartSection(
      "築年数別の" + priceWord + "中央値",
      who + "。棒の長さ＝その築年数帯の" + priceWord + "の中央値です。",
      barChart(dist.building_age, category, "median_price")
    )));
    root.appendChild(sub(chartSection(
      "駅からの徒歩分数別の" + priceWord + "中央値",
      who + "。棒の長さ＝その徒歩分数帯の" + priceWord + "の中央値です。",
      barChart(dist.walk, category, "median_price")
    )));
    root.appendChild(sub(chartSection(
      "面積別の" + priceWord + "中央値",
      who + "。棒の長さ＝その面積帯の" + priceWord + "の中央値です。",
      barChart(dist.area, category, "median_price")
    )));
  }

  // --- 大項目の開け閉め ---------------------------------------------------

  /** スマホで最初から開いておく大項目。それ以外は畳んでおく(死ぬほどスクロールしないように)。 */
  const OPEN_ON_PHONE = ["この条件の物件の数字", "新着"];

  /** 見出しから件数や「／希望条件に合うもの」を除いた、覚えておくための名前。 */
  function foldName(title) {
    return title.replace(/[（(][^）)]*[）)]/g, "").replace(/／.*/, "").trim();
  }

  function foldKey(page, title) {
    return "hw-fold:" + page + ":" + foldName(title);
  }

  function foldIsOpen(page, title) {
    try {
      const saved = localStorage.getItem(foldKey(page, title));
      if (saved !== null) return saved === "1";
    } catch (error) { /* 保存できない環境は既定値 */ }
    if (!isNarrow()) return true;
    const name = foldName(title);
    return OPEN_ON_PHONE.some((word) => name.indexOf(word) === 0);
  }

  /** 見出し(h2)を持つ要素なら、その h2 を返す。 */
  function headingOf(node) {
    if (!node || node.nodeType !== 1) return null;
    if (node.tagName === "H2") return node;
    return node.querySelector(":scope > h2, :scope > * > h2");
  }

  /**
   * ページを組み立てたあとで、h2 の見出しごとに「開け閉めできる箱」に包み直す。
   * 各部品を個別に書き換えるより、ここで一括して包むほうが漏れがない。
   * 状態は項目ごとに覚えておき、次に開いたときもそのまま。
   */
  function foldSections(root, page) {
    const nodes = Array.prototype.slice.call(root.childNodes);
    root.innerHTML = "";
    const folds = [];
    let body = null;

    nodes.forEach((node) => {
      const heading = headingOf(node);
      const isSub = node.nodeType === 1 && node.classList.contains("sub");
      if (heading && !isSub) {
        const title = heading.textContent;
        const box = el("details", { class: "fold" });
        if (foldIsOpen(page, title)) box.open = true;
        box.appendChild(el("summary", { class: "fold-summary" }, [title]));
        body = el("div", { class: "fold-body" });
        box.appendChild(body);
        if (node !== heading) {
          heading.remove();
          body.appendChild(node);
        }
        box.addEventListener("toggle", () => {
          try { localStorage.setItem(foldKey(page, title), box.open ? "1" : "0"); } catch (e) {}
        });
        folds.push(box);
        root.appendChild(box);
      } else if (body) {
        body.appendChild(node);
      } else {
        root.appendChild(node);
      }
    });

    if (folds.length > 1) {
      const openAll = el("button", { type: "button", class: "fold-button" }, ["すべて開く"]);
      const closeAll = el("button", { type: "button", class: "fold-button" }, ["すべて閉じる"]);
      openAll.addEventListener("click", () => folds.forEach((f) => { f.open = true; }));
      closeAll.addEventListener("click", () => folds.forEach((f) => { f.open = false; }));
      root.insertBefore(
        el("div", { class: "fold-bar" }, [el("span", {}, ["項目"]), openAll, closeAll]),
        folds[0]
      );
    }
    return root;
  }

  // --- 相場感(市場全体)の画面 ----------------------------------------------

  /** 市場全体の相場。個別の物件を選ぶためではなく、地域の水準を見るための画面。 */
  function renderMarket() {
    const root = el("div", {});
    root.appendChild(el("div", { class: "card", style: "margin-bottom:16px" }, [
      el("div", { style: "font-weight:600;margin-bottom:6px" }, ["市場全体の相場感"]),
      el("p", { class: "empty", style: "margin:0" }, [
        "ワンルーム・1K や通勤圏外も含む、掲載されている物件すべてが対象です。" +
        "個別の物件を選ぶための画面ではありません。" +
        "「地域の家賃や価格が上がっているのか下がっているのか」を見るために使ってください。",
      ]),
      el("p", { class: "empty", style: "margin:8px 0 0" }, [
        "希望条件に合う物件の数字とグラフは、上の「賃貸」「中古マンション」「中古戸建」の各タブにあります。",
      ]),
    ]));

    CATEGORY_ORDER.forEach((category) => {
      const data = DATA.categories[category];
      if (!data || !data.kpi) return;
      const kpi = (data.kpi_by_scope || {}).all || data.kpi;
      const monthly = (data.monthly_by_scope || {}).all || data.monthly;
      const priceWord = category === "rental" ? "家賃" : "価格";
      const momClass = kpi.mom_price_pct > 0 ? "delta-up" : kpi.mom_price_pct < 0 ? "delta-down" : "";

      root.appendChild(el("h2", { style: "margin-top:26px" }, [data.label + "　相場"]));
      root.appendChild(el("div", { class: "card" }, [
        el("p", { class: "chart-caption" }, [
          "掲載中すべて " + kpi.active_count + "件が対象。",
        ]),
        el("div", { class: "kpi-grid" }, [
          kpiCard("掲載中", kpi.active_count + "件", "直近30日 新着 " + kpi.new_30d + "件"),
          kpiCard(priceWord + "中央値", yen(kpi.price.median, category),
            "平均 " + yen(kpi.price.mean, category)),
          kpiCard("㎡単価中央値", yen(kpi.price_per_sqm.median, category) + "/㎡",
            "面積中央値 " + num(kpi.area_sqm.median) + "㎡"),
          kpiCard("前月比", pct(kpi.mom_price_pct), "前年同月比 " + pct(kpi.yoy_price_pct), momClass),
        ]),
        el("h3", { style: "font-size:13px;margin:16px 0 6px;color:var(--muted)" },
          [priceWord + "の月次推移（中央値）"]),
        lineChart(monthly, "median_price", category),
        el("h3", { style: "font-size:13px;margin:16px 0 6px;color:var(--muted)" },
          ["㎡単価の月次推移（中央値）"]),
        lineChart(monthly, "median_price_per_sqm", category),
      ]));

      chartsBlock(root, data, category, null, {
        scope: "all",
        title: data.label + "　地域別の内訳（全体）",
      });
    });

    return root;
  }

  // --- カテゴリ画面 -------------------------------------------------------

  function renderCategory(category) {
    const data = DATA.categories[category];
    const root = el("div", {});
    if (!data || data.kpi.active_count === 0) {
      root.appendChild(el("p", { class: "empty" }, ["まだデータがありません。collector を実行してください。"]));
      return root;
    }

    const isRental = category === "rental";
    // 数字もグラフも「希望条件に合う物件」を既定にする。
    // 探しているのはその物件であって、ワンルームだらけの市場全体ではないため。
    // 市場全体の相場は「相場感」タブに分けてある。
    const scopeInfo = (data.distribution_scopes || [])
      .filter((s) => s.key === chartScope)[0] || { label: "希望条件に合う物件", count: 0, note: "" };
    const kpi = (data.kpi_by_scope || {})[chartScope] || data.kpi;
    const monthly = (data.monthly_by_scope || {})[chartScope] || data.monthly;
    const momClass = kpi.mom_price_pct > 0 ? "delta-up" : kpi.mom_price_pct < 0 ? "delta-down" : "";

    root.appendChild(filterToggle(data, () => select(category)));
    root.appendChild(scopeSwitch(data, () => select(category), ["matching", "family"]));

    root.appendChild(el("h2", {}, ["この条件の物件の数字（" + scopeInfo.count + "件）"]));
    root.appendChild(
      el("section", {}, [
        el("div", { class: "kpi-grid" }, [
          kpiCard("該当する掲載中", kpi.active_count + "件",
            scopeInfo.label + "。直近30日 新着 " + kpi.new_30d + "件"),
          kpiCard(category === "rental" ? "家賃中央値" : "価格中央値", yen(kpi.price.median, category),
            "平均 " + yen(kpi.price.mean, category)),
          isRental && kpi.monthly_total
            ? kpiCard("月額総額の中央値", yen(kpi.monthly_total.median, category),
                "平均 " + yen(kpi.monthly_total.mean, category) +
                "。家賃＋管理費・共益費＋駐車場＋毎月のその他費用" +
                (kpi.monthly_total_parking_unknown
                  ? "（" + kpi.monthly_total_parking_unknown + "件は駐車場代不明のため含まず）"
                  : ""))
            : el("span", {}),
          kpiCard("㎡単価中央値", yen(kpi.price_per_sqm.median, category) + "/㎡",
            "面積中央値 " + num(kpi.area_sqm.median) + "㎡"),
          kpiCard("前月比", pct(kpi.mom_price_pct), "前年同月比 " + pct(kpi.yoy_price_pct), momClass),
          kpiCard("掲載終了(30日)", kpi.disappeared_30d + "件", "※成約とは限らない"),
          kpiCard("値下げ(30日)", kpi.price_drop_30d + "件", ""),
          kpiCard("築年数中央値", kpi.building_age.median === null ? "—" : num(kpi.building_age.median) + "年", ""),
          kpiCard("見つけてからの日数", num(kpi.days_listed.median, 0) + "日",
            "掲載中物件の中央値。掲載開始日ではなく初確認日から数えています"),
        ]),
      ])
    );

    const priceWordTop = category === "rental" ? "家賃" : "価格";
    const monthlyNote =
      scopeInfo.label + "だけを対象にした推移です（" + scopeInfo.count + "件）。" +
      "月ごとに、その月の最後に見た" + priceWordTop + "を1物件につき1つ数えた中央値です。";
    root.appendChild(chartSection(
      priceWordTop + "の月次推移（中央値）", monthlyNote,
      lineChart(monthly, "median_price", category)));
    root.appendChild(chartSection(
      "㎡単価の月次推移（中央値）",
      monthlyNote + " 1㎡あたりに直すと、広さの違いをならして比べられます。",
      lineChart(monthly, "median_price_per_sqm", category)));

    if (category === "rental" && data.supply) {
      const supply = data.supply;
      const span = (lo, hi) =>
        lo === null || lo === undefined ? "—"
          : (hi === null || hi === undefined || hi === lo)
            ? num(lo, 0) + "日"
            : num(lo, 0) + "〜" + num(hi, 0) + "日";
      const withinCards = (supply.within || []).map((hit) => kpiCard(
        hit.days + "日以内に消えた",
        hit.ratio === null ? "—" : Math.round(hit.ratio * 100) + "%",
        hit.count.toLocaleString("ja-JP") + "件 / " + hit.total.toLocaleString("ja-JP") + "件"
      ));

      root.appendChild(
        section("消えるまでの速さ", el("div", {}, [
          el("p", { class: "chart-caption" }, [
            "賃貸の掲載中すべてが対象。観測開始 " + (supply.observed_since || "—") +
            "（" + supply.observed_days + "日目・確認 " + supply.check_count + "回）。" +
            "ここで数えているのは掲載期間ではなく、" +
            "「このサイトが見つけてから、消えるまで」の日数です。" +
            "物件はそれ以前から載っていた可能性があるため、実際の掲載期間はこれより長くなります。",
          ]),
          el("div", { class: "kpi-grid" }, [
            supply.new_per_month_avg === null
              ? kpiCard("新着の累計", supply.new_total.toLocaleString("ja-JP") + "件",
                  "観測" + supply.observed_days + "日ぶん。月平均は1か月たってから出します")
              : kpiCard("月平均 新着", supply.new_per_month_avg + "件", "直近1年の平均"),
            kpiCard("消えた物件", supply.gone_total.toLocaleString("ja-JP") + "件",
              "観測" + supply.observed_days + "日ぶんの累計"),
            kpiCard("見つけてから消えるまで",
              span(supply.days_seen_min.median, supply.days_seen_max.median),
              "中央値。最長でも " + num(supply.days_seen_max.max, 0) + "日"),
            kpiCard("確認の最大あき", supply.max_gap_days === null ? "—" : supply.max_gap_days + "日",
              "ここが空くほど日数の幅が広がります"),
          ]),
          withinCards.length === 0 ? el("span", {})
            : el("div", { class: "kpi-grid", style: "margin-top:10px" }, withinCards),
          el("h3", { style: "font-size:13px;margin:18px 0 6px;color:var(--muted)" },
            ["いつ見つけて、いつ消えていたか"]),
          table(
            ["見つけた日", "消えていた日", "件数", "見つけてから"],
            supply.cohorts || [],
            (row) => [row.first_seen_on, row.noticed_gone_on,
                      row.count.toLocaleString("ja-JP") + "件",
                      span(row.days_min, row.days_max)]
          ),
          el("p", { class: "empty", style: "margin:10px 0 0" }, [
            "「1〜7日」のような幅は、確認しなかった日があるために出ます。" +
            "最後に見た日の翌日に消えたのか、次に確認する直前まで残っていたのかは区別できません。" +
            "毎日確認できていれば幅は1日になります。",
          ]),
          el("p", { class: "empty", style: "margin:6px 0 0" }, [
            "※ 収集する市やページ数を広げた日は、以前から載っていた物件もまとめて" +
            "「新着」として数えられます。掲載開始日そのものは、観測を続けて" +
            "「載った瞬間から見ていた物件」がたまるまで分かりません。",
          ]),
        ]))
      );
    }

    if (data.transactions && data.transactions.length > 0) {
      const sold = data.transactions;
      const latest = sold[sold.length - 1];
      const diff = kpi.sold_vs_listing_pct;
      root.appendChild(
        section("実際の成約価格(国土交通省データ)", el("div", {}, [
          el("div", { class: "kpi-grid" }, [
            kpiCard("成約価格中央値", yen(latest.median_price, category), latest.quarter + " / " + latest.count + "件"),
            kpiCard("売出中との水準差", diff === null || diff === undefined ? "—" : pct(diff),
              "同一物件の値引き率ではない", diff < 0 ? "delta-down" : diff > 0 ? "delta-up" : ""),
            kpiCard("成約 ㎡単価", yen(latest.median_price_per_sqm, category) + "/㎡", ""),
            kpiCard("成約物件の築年数", latest.median_building_age === null ? "—" : num(latest.median_building_age) + "年", ""),
          ]),
          el("p", { class: "empty", style: "margin:10px 0 0" }, [
            "※ この差は「同じ物件が売出価格からいくら下がって成約したか」ではありません。" +
            "成約データは国土交通省が公表する別の物件群(" +
            (category === "used_house" ? "新築を含む宅地・建物の取引" : "中古マンション等の取引") +
            ")の中央値で、売出中の物件とは対象が異なります。地域全体の水準の比較としてご覧ください。",
          ]),
          el("h3", { style: "font-size:13px;margin:14px 0 6px;color:var(--muted)" }, ["成約価格の推移(直近1年の平均)"]),
          lineChart(sold.map((row) => ({ month: row.quarter, median_price: row.median_price_ma })), "median_price", category),
          el("p", { class: "empty", style: "margin:4px 0 0" }, [
            "四半期ごとの中央値は物件のばらつきで大きく上下するため、直近4四半期(1年)を" +
            "ならした値を表示しています。",
          ]),
        ]))
      );
    }

    chartsBlock(root, data, category, () => select(category));

    root.appendChild(
      section("新着(直近30日)" + (onlyMatching ? "／希望条件に合うもの" : ""), isRental
        ? table(
            ["物件", "エリア", "駅・徒歩", "車通勤", "間取り", "面積", "築年数", "家賃", "月額総額", "契約", "駐車場", "掲載日"],
            filtered(data.new_listings),
            (row) => [link(row), (row.town || row.city || "—"), access(row), commute(row), row.layout, sqm(row),
                      age(row), yen(row.price, category),
                      totalMonthly(row, category), contract(row), parking(row), row.listed_on]
          )
        : table(
            ["物件", "エリア", "駅・徒歩", "車通勤", "間取り", "面積", "築年数", "価格", "管理費＋修繕積立金", "掲載日"],
            filtered(data.new_listings),
            (row) => [link(row), (row.town || row.city || "—"), access(row), commute(row), row.layout, sqm(row),
                      age(row), yen(row.price, category), monthlyCost(row, category), row.listed_on]
          ))
    );

    root.appendChild(
      section("値下げ物件(直近90日)" + (onlyMatching ? "／希望条件に合うもの" : ""), table(
        isRental
          ? ["物件", "エリア", "駅・徒歩", "間取り", "面積", "築年数", "変更前", "変更後", "差額", "月額総額(変更後)", "日付"]
          : ["物件", "エリア", "駅・徒歩", "間取り", "面積", "築年数", "変更前", "変更後", "差額", "日付"],
        filtered(data.price_drops),
        (row) => isRental
          ? [link(row), (row.town || row.city || "—"), access(row), row.layout, sqm(row), age(row),
             yen(row.old_price, category), yen(row.new_price, category),
             el("span", { class: "delta-down" }, [yen(row.delta, category)]),
             totalMonthly(row, category), row.changed_on]
          : [link(row), (row.town || row.city || "—"), access(row), row.layout, sqm(row), age(row),
             yen(row.old_price, category), yen(row.new_price, category),
             el("span", { class: "delta-down" }, [yen(row.delta, category)]), row.changed_on]
      ))
    );

    root.appendChild(
      section("掲載が終了した物件(直近180日)" + (onlyMatching ? "／希望条件に合うもの" : ""), el("div", {}, [
        el("p", { class: "empty", style: "margin:0 0 8px" }, [
          "サイトから消えた物件の記録です。成約したとは限りません" +
          "(掲載期限切れや取り下げの場合もあります)。" +
          "良い物件がどれくらいの速さで決まるかの目安になります。",
        ]),
        el("p", { class: "empty", style: "margin:0 0 10px" }, [
          "「見つけてから」は、このサイトが最初に確認した日から数えた日数です。" +
          "物件がいつサイトに載ったかは分からないため、実際の掲載期間はこれより長くなります。" +
          "「1〜7日」のような幅は、確認しなかった日があるぶんの不確かさです。",
        ]),
        table(
          isRental
            ? ["物件", "エリア", "駅・徒歩", "車通勤", "間取り", "面積", "築年数", "最終家賃", "月額総額", "契約", "駐車場", "見つけてから", "終了日"]
            : ["物件", "エリア", "駅・徒歩", "車通勤", "間取り", "面積", "築年数", "最終価格", "初回価格", "値下げ", "見つけてから", "終了日"],
          filtered(data.disappeared),
          (row) => isRental
            ? [link(row), (row.town || row.city || "—"), access(row), commute(row), row.layout, sqm(row), age(row),
               yen(row.last_price, category), totalMonthly(row, category), contract(row), parking(row),
               seenSpan(row), row.disappeared_on]
            : [link(row), (row.town || row.city || "—"), access(row), commute(row), row.layout, sqm(row), age(row),
               yen(row.last_price, category), yen(row.first_price, category),
               row.price_drop_count + "回", seenSpan(row), row.disappeared_on]
        ),
      ]))
    );

    root.appendChild(
      section("掲載が長い物件" + (onlyMatching ? "／希望条件に合うもの" : ""), table(
        isRental
          ? ["物件", "エリア", "駅・徒歩", "間取り", "面積", "築年数", "家賃", "月額総額", "契約", "駐車場", "見つけてから", "値下げ"]
          : ["物件", "エリア", "駅・徒歩", "間取り", "面積", "築年数", "価格", "見つけてから", "初回価格", "値下げ"],
        filtered(data.long_listed).slice(0, 20),
        (row) => isRental
          ? [link(row), (row.town || row.city || "—"), access(row), row.layout, sqm(row), age(row),
             yen(row.price, category), totalMonthly(row, category), contract(row), parking(row),
             row.days_listed + "日", row.price_drop_count + "回"]
          : [link(row), (row.town || row.city || "—"), access(row), row.layout, sqm(row), age(row),
             yen(row.price, category), row.days_listed + "日",
             yen(row.first_price, category), row.price_drop_count + "回"]
      ))
    );

    root.appendChild(el("section", {}, [searchSection(category)]));

    return root;
  }

  // --- 絞り込み検索 -------------------------------------------------------
  //
  // 物件は5年で100万件規模になる見込みで、全件をこのページに埋め込むと開けなくなる。
  // そのため検索用データは search.json に分けてあり、検索欄を開いたときだけ読み込む。

  let searchData = null;      // 読み込み済みのデータ
  let searchLoading = false;

  function loadSearchData(onDone) {
    if (searchData || searchLoading) { onDone(); return; }
    searchLoading = true;
    fetch("./search.json?v=" + encodeURIComponent(DATA.generated_at))
      .then((r) => r.json())
      .then((json) => {
        const cols = {};
        json.columns.forEach((name, i) => { cols[name] = i; });
        searchData = { cols: cols, categories: json.categories, window: json.window_months };
      })
      .catch(() => { searchData = { error: true }; })
      .then(() => { searchLoading = false; onDone(); });
  }

  /** 1行(配列)を名前でひけるオブジェクトに変換する。 */
  function asRecord(row, cols) {
    const out = {};
    Object.keys(cols).forEach((name) => { out[name] = row[cols[name]]; });
    return out;
  }

  function field(labelText, control) {
    return el("label", { style: "display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--muted)" },
      [labelText, control]);
  }

  function input(attrs) {
    return el("input", Object.assign({
      style: "background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:5px 7px;font-size:13px;min-width:0",
    }, attrs));
  }

  function selectBox(options) {
    const node = el("select", {
      style: "background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:5px 7px;font-size:13px",
    });
    options.forEach((o) => {
      const opt = el("option", { value: o.value }, [o.label]);
      node.appendChild(opt);
    });
    return node;
  }

  function searchSection(category) {
    const root = el("div", {});
    const body = el("div", {});
    root.appendChild(el("h2", {}, ["物件を探す（絞り込み検索）"]));
    root.appendChild(body);

    body.appendChild(el("div", { class: "card" }, [
      el("p", { class: "empty", style: "margin:0" }, ["データを読み込んでいます…"]),
    ]));

    loadSearchData(function () {
      body.innerHTML = "";
      if (!searchData || searchData.error) {
        body.appendChild(el("div", { class: "card" }, [
          el("p", { class: "empty", style: "margin:0" }, [
            "検索データを読み込めませんでした。" +
            "ファイルを直接開いた場合は使えません（公開URLから開いてください）。",
          ]),
        ]));
        return;
      }
      body.appendChild(buildSearchUi(category));
    });
    return root;
  }

  function buildSearchUi(category) {
    const cols = searchData.cols;
    const rows = searchData.categories[category] || [];
    const isRental = category === "rental";

    // 選択肢は実データから作る（存在しない駅や間取りを並べない）
    const uniq = (name) => {
      const set = {};
      rows.forEach((r) => { const v = r[cols[name]]; if (v) set[v] = true; });
      return Object.keys(set).sort();
    };

    const controls = {
      text: input({ type: "text", placeholder: "物件名・町名" }),
      status: selectBox([
        { value: "", label: "すべて" },
        { value: "on", label: "掲載中のみ" },
        { value: "gone", label: "掲載終了のみ" },
      ]),
      station: selectBox([{ value: "", label: "すべての駅" }].concat(
        uniq("station").map((v) => ({ value: v, label: v })))),
      layout: selectBox([{ value: "", label: "すべての間取り" }].concat(
        uniq("layout").map((v) => ({ value: v, label: v })))),
      priceMin: input({ type: "number", placeholder: isRental ? "万円" : "万円", min: "0" }),
      priceMax: input({ type: "number", placeholder: isRental ? "万円" : "万円", min: "0" }),
      areaMin: input({ type: "number", placeholder: "㎡", min: "0" }),
      ageMax: input({ type: "number", placeholder: "年", min: "0" }),
      walkMax: input({ type: "number", placeholder: "分", min: "0" }),
      commuteMax: input({ type: "number", placeholder: "分", min: "0" }),
      dateFrom: input({ type: "date" }),
      dateTo: input({ type: "date" }),
      dateKind: selectBox([
        { value: "gone_on", label: "掲載終了日" },
        { value: "first_seen", label: "初めて見つけた日" },
      ]),
      onlyMatch: input({ type: "checkbox" }),
      onlyRelevant: input({ type: "checkbox" }),
      sort: selectBox([
        { value: "last_seen_desc", label: "新しい順" },
        { value: "price_asc", label: "価格が安い順" },
        { value: "price_desc", label: "価格が高い順" },
        { value: "days_asc", label: "見つけてからの日数が短い順" },
        { value: "days_desc", label: "見つけてからの日数が長い順" },
        { value: "commute_asc", label: "通勤が近い順" },
      ]),
    };

    const priceUnit = 10000;   // 入力は万円、データは円

    function matches(r) {
      const g = (name) => r[cols[name]];
      const c = controls;

      if (c.status.value === "on" && ["active", "relisted"].indexOf(g("status")) < 0) return false;
      if (c.status.value === "gone" && g("status") !== "disappeared") return false;
      if (c.onlyMatch.checked && g("matches") !== 1) return false;
      if (c.onlyRelevant.checked && g("relevant") !== 1) return false;
      if (c.station.value && g("station") !== c.station.value) return false;
      if (c.layout.value && g("layout") !== c.layout.value) return false;

      const price = g("price");
      if (c.priceMin.value && (price === null || price < Number(c.priceMin.value) * priceUnit)) return false;
      if (c.priceMax.value && (price === null || price > Number(c.priceMax.value) * priceUnit)) return false;
      if (c.areaMin.value && (g("area") === null || g("area") < Number(c.areaMin.value))) return false;
      if (c.ageMax.value && (g("age") === null || g("age") > Number(c.ageMax.value))) return false;
      if (c.walkMax.value && (g("walk") === null || g("walk") > Number(c.walkMax.value))) return false;
      if (c.commuteMax.value && (g("commute") === null || g("commute") > Number(c.commuteMax.value))) return false;

      if (c.dateFrom.value || c.dateTo.value) {
        const value = g(c.dateKind.value);
        if (!value) return false;
        if (c.dateFrom.value && value < c.dateFrom.value) return false;
        if (c.dateTo.value && value > c.dateTo.value) return false;
      }

      if (c.text.value) {
        const needle = c.text.value.toLowerCase();
        const hay = [g("title"), g("town"), g("city"), g("station")].join(" ").toLowerCase();
        if (hay.indexOf(needle) < 0) return false;
      }
      return true;
    }

    function sorted(list) {
      const g = (r, name) => r[cols[name]];
      const key = controls.sort.value;
      const cmp = {
        last_seen_desc: (a, b) => String(g(b, "last_seen")).localeCompare(String(g(a, "last_seen"))),
        price_asc: (a, b) => (g(a, "price") || 1e15) - (g(b, "price") || 1e15),
        price_desc: (a, b) => (g(b, "price") || -1) - (g(a, "price") || -1),
        days_asc: (a, b) => (g(a, "days") || 1e9) - (g(b, "days") || 1e9),
        days_desc: (a, b) => (g(b, "days") || -1) - (g(a, "days") || -1),
        commute_asc: (a, b) => (g(a, "commute") || 1e9) - (g(b, "commute") || 1e9),
      }[key];
      return list.slice().sort(cmp);
    }

    const results = el("div", {});

    const summary = el("p", { class: "empty", style: "margin:10px 0 6px" }, []);
    const SHOW = 100;

    function render() {
      const hits = sorted(rows.filter(matches));
      summary.textContent = `該当 ${hits.length.toLocaleString("ja-JP")}件` +
        (hits.length > SHOW ? `（上位${SHOW}件を表示。絞り込むと全部見られます）` : "");

      results.innerHTML = "";
      if (hits.length === 0) {
        results.appendChild(el("p", { class: "empty" }, ["条件に合う物件がありません"]));
        return;
      }
      const records = hits.slice(0, SHOW).map((r) => asRecord(r, cols));
      records.forEach((rec) => {
        rec.commute_minutes = rec.commute;
        rec.area_sqm = rec.area;
        rec.walk_minutes = rec.walk;
        rec.building_age = rec.age;
        rec.built_year_month = rec.built;
        rec.contract_type = rec.contract;
        rec.parking_capacity = rec.parking_cap;
        rec.parking_fee = rec.parking_fee;
      });

      results.appendChild(table(
        isRental
          ? ["物件", "エリア", "駅・徒歩", "車通勤", "間取り", "面積", "築年数", "家賃", "月額総額", "契約", "駐車場", "状態", "見つけてから", "終了日"]
          : ["物件", "エリア", "駅・徒歩", "車通勤", "間取り", "面積", "築年数", "価格", "初回価格", "値下げ", "状態", "見つけてから", "終了日"],
        records,
        (rec) => {
          const state = ["active", "relisted"].indexOf(rec.status) >= 0 ? "掲載中" : "終了";
          return isRental
            ? [link(rec), (rec.town || rec.city || "—"), access(rec), commute(rec), rec.layout, sqm(rec), age(rec),
               yen(rec.price, category), totalMonthly(rec, category), contract(rec), parking(rec), state,
               (rec.days || "—") + "日", rec.gone_on || "—"]
            : [link(rec), (rec.town || rec.city || "—"), access(rec), commute(rec), rec.layout, sqm(rec), age(rec),
               yen(rec.price, category), yen(rec.first_price, category), rec.drops + "回", state,
               (rec.days || "—") + "日", rec.gone_on || "—"];
        }
      ));
    }

    Object.keys(controls).forEach((k) => {
      controls[k].addEventListener("input", render);
      controls[k].addEventListener("change", render);
    });

    const reset = el("button", {
      style: "background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 12px;font-size:13px;cursor:pointer",
    }, ["条件をクリア"]);
    reset.addEventListener("click", () => {
      Object.keys(controls).forEach((k) => {
        const c = controls[k];
        if (c.type === "checkbox") c.checked = false;
        else if (c.tagName === "SELECT") c.selectedIndex = 0;
        else c.value = "";
      });
      render();
    });

    const download = el("button", {
      style: "background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 12px;font-size:13px;cursor:pointer",
    }, ["この結果をCSVで保存"]);
    download.addEventListener("click", () => {
      const hits = sorted(rows.filter(matches));
      const names = Object.keys(cols);
      const escape = (v) => '"' + String(v === null || v === undefined ? "" : v).replace(/"/g, '""') + '"';
      const csv = "\ufeff" + [names.join(",")].concat(
        hits.map((r) => names.map((n) => escape(r[cols[n]])).join(","))).join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = el("a", { href: url, download: "housing-watch-" + category + ".csv" });
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    });

    const grid = el("div", {
      style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px",
    }, [
      field("キーワード", controls.text),
      field("状態", controls.status),
      field("駅", controls.station),
      field("間取り", controls.layout),
      field(isRental ? "家賃 下限(万円)" : "価格 下限(万円)", controls.priceMin),
      field(isRental ? "家賃 上限(万円)" : "価格 上限(万円)", controls.priceMax),
      field("面積 下限(㎡)", controls.areaMin),
      field("築年数 上限(年)", controls.ageMax),
      field("駅徒歩 上限(分)", controls.walkMax),
      field("車通勤 上限(分)", controls.commuteMax),
      field("日付の種類", controls.dateKind),
      field("日付 開始", controls.dateFrom),
      field("日付 終了", controls.dateTo),
      field("並び順", controls.sort),
    ]);

    const relevantCount = rows.filter((r) => r[cols.relevant] === 1).length;

    const matchLine = el("div", {
      style: "display:flex;gap:16px;flex-wrap:wrap;margin-top:10px",
    }, [
      el("label", { style: "display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer" },
        [controls.onlyMatch, "希望条件に合うものだけ"]),
      el("label", { style: "display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer" },
        [controls.onlyRelevant, "候補になりうる物件だけ（全期間保存の対象）"]),
    ]);

    const card = el("div", { class: "card" }, [
      el("p", { class: "empty", style: "margin:0 0 10px" }, [
        `検索できる物件 ${rows.length.toLocaleString("ja-JP")}件。` +
        `うち「候補になりうる物件」${relevantCount.toLocaleString("ja-JP")}件は` +
        `期間の制限なく、いつまでも検索できます。` +
        `それ以外（ワンルームや通勤圏外など）は直近${searchData.window}か月ぶんです。` +
        `どちらもデータベースには全期間残っており、CSVで取り出せます。`,
      ]),
      grid,
      matchLine,
      el("div", { style: "display:flex;gap:8px;margin-top:10px;flex-wrap:wrap" }, [reset, download]),
      summary,
      results,
    ]);

    render();
    return card;
  }

  // --- 初期化 -------------------------------------------------------------

  function renderHealth() {
    const health = DATA.data_health;
    if (!health.warnings || health.warnings.length === 0) return null;
    return el("div", { class: "warn" }, [
      el("strong", {}, ["データ取得の警告"]),
      el("ul", {}, health.warnings.map((message) => el("li", {}, [message]))),
      el("div", {}, ["警告が出ている期間は、掲載終了の判定が保留されています(データを壊さないための仕様)。"]),
    ]);
  }

  let select = function () {};

  function main() {
    const tabs = document.getElementById("tabs");
    const content = document.getElementById("content");

    select = function (category) {
      Array.prototype.forEach.call(tabs.children, (button) => {
        button.setAttribute("aria-selected", String(button.dataset.category === category));
      });
      content.innerHTML = "";
      const warning = renderHealth();
      if (warning) content.appendChild(warning);
      const page = category === MARKET_TAB ? renderMarket() : renderCategory(category);
      content.appendChild(foldSections(page, category));
      try { localStorage.setItem("hw-category", category); } catch (error) { /* 非対応環境は無視 */ }
      window.scrollTo(0, 0);
    };

    CATEGORY_ORDER.concat([MARKET_TAB]).forEach((category) => {
      const data = DATA.categories[category];
      const long = category === MARKET_TAB ? "相場感（全体）" : ((data && data.label) || category);
      const short = { rental: "賃貸", used_mansion: "マンション", used_house: "戸建", market: "相場感" }[category] || long;
      const button = el("button", { class: "tab", role: "tab", "aria-selected": "false" }, [
        el("span", { class: "long" }, [long]),
        el("span", { class: "short" }, [short]),
      ]);
      button.dataset.category = category;
      button.addEventListener("click", () => select(category));
      tabs.appendChild(button);
    });

    let initial = CATEGORY_ORDER[0];
    try {
      const saved = localStorage.getItem("hw-category");
      if (saved && CATEGORY_ORDER.concat([MARKET_TAB]).indexOf(saved) >= 0) initial = saved;
    } catch (error) { /* 非対応環境は無視 */ }
    select(initial);

    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  main();
})();
