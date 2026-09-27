/* 金融实习网申通 —— 主逻辑 */
(function () {
  "use strict";

  var DATA = window.DATA || { updatedAt: "", companies: [], channels: {}, guides: [] };
  var LS_KEY = "internship_progress_v1";
  var FAV_KEY = "internship_favorites_v1";
  function loadFavorites() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY)) || {}; } catch (e) { return {}; }
  }
  var favorites = loadFavorites();
  function saveFavorites() { localStorage.setItem(FAV_KEY, JSON.stringify(favorites)); }
  function isFav(id) { return !!favorites[id]; }
  var STAGES = [
    { key: "none", label: "未投递" },
    { key: "applied", label: "网申中" },
    { key: "written", label: "已笔试" },
    { key: "interview", label: "已面试" },
    { key: "offer", label: "已Offer" },
    { key: "drop", label: "放弃" }
  ];

  /* ---------- 工具 ---------- */
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveProgress(p) { localStorage.setItem(LS_KEY, JSON.stringify(p)); }
  var progress = loadProgress();

  /* ---------- 模糊日期解析：'10月中旬' / '11月底' / '10月中旬-11月中旬' / '全年滚动' ---------- */
  var DAY_OF = { "上旬": 6, "中旬": 15, "下旬": 24, "初": 3, "中": 15, "底": 27, "末": 27 };
  function parseOne(str, type) {
    if (!str) return null;
    var s = String(str).replace(/约|左右|2026年|2027年|每年|前后/g, "").trim();
    var m = s.match(/(\d{1,2})\s*月(?:\s*(上旬|中旬|下旬|初|中|底|末))?/);
    if (!m) return null;
    var month = parseInt(m[1], 10), day = m[2] ? DAY_OF[m[2]] : 10;
    if (!day) day = 15;
    var year;
    if (type && type.indexOf("暑期") >= 0) year = month >= 9 ? 2026 : 2027;
    else year = month >= 9 ? 2026 : 2027; // 9-12月属2026年申请季，1-8月属2027年
    return new Date(year, month - 1, day);
  }
  function isRolling(str) { return /全年|滚动|长期|招满即止|随时|常年在招/.test(String(str || "")); }
  // 解析一个批次的窗口 -> {open:Date, close:Date, rolling:bool}
  function parseWindow(openStr, closeStr, type) {
    if (isRolling(openStr) || isRolling(closeStr)) return { rolling: true };
    var open = parseOne(openStr, type);
    if (!open) return null;
    var close = parseOne(closeStr, type);
    if (!close && openStr) {
      // open 里可能自带区间 "10月中旬-11月中旬"
      var parts = String(openStr).split(/[-—–~至]|到/);
      if (parts.length === 2) {
        open = parseOne(parts[0], type);
        close = parseOne(parts[1], type);
      }
    }
    if (close && close < open) close = new Date(close.getFullYear() + 1, close.getMonth(), close.getDate());
    return { open: open, close: close || (open ? new Date(open.getFullYear(), open.getMonth() + 1, open.getDate()) : null), rolling: false };
  }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

  /* ---------- 公司状态计算 ---------- */
  function companyWindows(c) {
    var out = [];
    (c.batches || []).forEach(function (b) {
      var w = parseWindow(b.open, b.close, b.type);
      if (w) out.push({ batch: b, w: w });
    });
    return out;
  }
  // 返回 {state: 'opening'|'rolling'|'soon'|'closed'|'unknown', days: n, best: {batch,w}}
  function companyStatus(c) {
    var wins = companyWindows(c);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var best = null, order = { opening: 0, rolling: 1, soon: 2, unknown: 3, closed: 4 };
    wins.forEach(function (it) {
      var st;
      if (it.w.rolling) st = { state: "rolling", days: 0 };
      else {
        var o = it.w.open, cl = it.w.close;
        if (o && today >= o && (!cl || today <= cl)) st = { state: "opening", days: cl ? daysBetween(today, cl) : null };
        else if (o && today < o) st = { state: "soon", days: daysBetween(today, o) };
        else if (cl && today > cl) st = { state: "closed", days: null };
        else st = { state: "unknown", days: null };
      }
      if (!best || order[st.state] < order[best.state] ||
          (st.state === "soon" && best.state === "soon" && st.days < best.days)) {
        st.batch = it; best = st;
      }
    });
    if (!best) best = { state: "unknown", days: null, batch: null };
    return best;
  }
  function statusLabel(st) {
    switch (st.state) {
      case "opening": return "预计开放中";
      case "rolling": return "常年滚动招聘";
      case "soon": return st.days === 0 ? "预计即将开放" : "约 " + st.days + " 天后开放";
      case "closed": return "往年批次已截止";
      default: return "时间待更新";
    }
  }
  function statusClass(st) {
    return { opening: "status-open", rolling: "status-open", soon: "status-soon", closed: "status-closed", unknown: "status-unknown" }[st.state];
  }
  function cardBorderClass(st) {
    return { opening: "opening", rolling: "opening", soon: "soon", closed: "", unknown: "" }[st.state];
  }

  /* ---------- 筛选 ---------- */
  var filters = { q: "", cats: [], city: "", batch: "", degree: "", test: "", hz: "", status: "" };
  function isBachelorOk(c) {
    return /本科可投|本科即可|本科在读可投|本科生可投|学历不限|不限学历|本科及以上|本科为主|对本科/.test(String(c.degree || ""));
  }
  function isMasterOnly(c) {
    return !isBachelorOk(c) && /硕士|研究生/.test(String(c.degree || ""));
  }
  function hasTest(c) {
    var t = String(c.writtenTest || "").trim();
    if (!t) return null;
    if (/^无|不需要|无需|不设/.test(t)) return false;
    return true;
  }
  function matchCompany(c) {
    var st = companyStatus(c);
    if (filters.q) {
      var hay = [c.name, c.subcategory, (c.cities || []).join(" "), c.major, c.skills, c.degree].join(" ").toLowerCase();
      if (hay.indexOf(filters.q.toLowerCase()) < 0) return false;
    }
    if (filters.cats.length && filters.cats.indexOf(c.category) < 0) return false;
    if (filters.city && (c.cities || []).indexOf(filters.city) < 0) return false;
    if (filters.batch) {
      var has = (c.batches || []).some(function (b) { return b.type && b.type.indexOf(filters.batch) >= 0; });
      if (!has) return false;
    }
    if (filters.degree === "bachelor-ok" && !isBachelorOk(c)) return false;
    if (filters.degree === "master" && !isMasterOnly(c)) return false;
    if (filters.test === "yes" && hasTest(c) !== true) return false;
    if (filters.test === "no" && hasTest(c) !== false) return false;
    if (filters.hz === "hz" && (c.cities || []).indexOf("杭州") < 0) return false;
    if (filters.status) {
      if (filters.status === "fav") { if (!isFav(c.id)) return false; }
      else {
        var pg = progress[c.id] ? progress[c.id].stage : "none";
        if (filters.status === "none" && pg !== "none") return false;
        if (filters.status !== "none" && pg !== filters.status) return false;
      }
    }
    return true;
  }
  function sortCompanies(a, b) {
    var fa = isFav(a.id), fb = isFav(b.id);
    if (fa !== fb) return fa ? -1 : 1; // 收藏的永远置顶
    var oa = companyStatus(a), ob = companyStatus(b);
    var order = { opening: 0, rolling: 1, soon: 2, unknown: 3, closed: 4 };
    if (order[oa.state] !== order[ob.state]) return order[oa.state] - order[ob.state];
    if (oa.state === "soon" && ob.state === "soon" && oa.days !== ob.days) return oa.days - ob.days;
    return a.name.localeCompare(b.name, "zh");
  }

  /* ---------- 渲染：公司库 ---------- */
  function renderCategories() {
    var cats = [];
    DATA.companies.forEach(function (c) { if (cats.indexOf(c.category) < 0) cats.push(c.category); });
    $("#categoryFilters").innerHTML = cats.map(function (cat) {
      return '<button class="chip" data-cat="' + esc(cat) + '">' + esc(cat) + "</button>";
    }).join("");
    // 城市下拉 = 高频真实城市 + 固定重点城市（含嘉兴），按岗位数排序
    var cityCount = {};
    DATA.companies.forEach(function (c) {
      (c.cities || []).forEach(function (ct) {
        if (/全国|多地|以官网|以岗位|城市$/.test(ct)) return;
        cityCount[ct] = (cityCount[ct] || 0) + 1;
      });
    });
    ["杭州", "嘉兴"].forEach(function (ct) { cityCount[ct] = (cityCount[ct] || 0) + 1; });
    var cityList = Object.keys(cityCount).sort(function (a, b) {
      if (a === "杭州") return -1; if (b === "杭州") return 1;
      if (a === "嘉兴") return -1; if (b === "嘉兴") return 1;
      return cityCount[b] - cityCount[a];
    }).slice(0, 22);
    $("#cityFilter").innerHTML = '<option value="">全部城市</option>' + cityList.map(function (ct) {
      return '<option value="' + esc(ct) + '">' + esc(ct) + (cityCount[ct] > 1 ? " (" + cityCount[ct] + ")" : "") + "</option>";
    }).join("");
    $("#timelineCategory").innerHTML = '<option value="">全部行业</option>' + cats.map(function (cat) {
      return '<option value="' + esc(cat) + '">' + esc(cat) + "</option>";
    }).join("");
  }

  function batchLine(b) {
    var win;
    if (isRolling(b.open) || isRolling(b.close)) win = "全年滚动 · 招满即止";
    else win = '<span class="win">' + esc(b.open || "?") + " ~ " + esc(b.close || "?") + "</span>";
    return '<div class="batch-line"><b>' + esc(b.type) + "</b>：" + win + (b.note ? ' <span class="note">(' + esc(b.note) + ")</span>" : "") + "</div>";
  }

  function renderList() {
    var list = DATA.companies.filter(matchCompany).sort(sortCompanies);
    $("#resultCount").textContent = "共 " + list.length + " 家（数据总量 " + DATA.companies.length + " 家）";
    $("#emptyState").hidden = list.length > 0;
    $("#companyList").innerHTML = list.map(function (c) {
      var st = companyStatus(c);
      var pg = progress[c.id] || { stage: "none" };
      var meta = [];
      if (c.cities && c.cities.length) meta.push("📍 " + esc(c.cities.join(" / ")));
      if (c.degree) meta.push("🎓 " + esc(c.degree));
      if (c.salary) meta.push("💰 " + esc(c.salary));
      if (c.housing && /包|提供|住宿|餐/.test(c.housing)) meta.push("🏠 " + esc(c.housing));
      if (c.writtenTest) meta.push("✍️ 笔试: " + esc(c.writtenTest));
      var conf = c.confidence && c.confidence !== "高" ? '<span class="tag conf-' + esc(c.confidence) + '">可信度' + esc(c.confidence) + "</span>" : "";
      return '<div class="company-card ' + cardBorderClass(st) + '" id="card-' + esc(c.id) + '">' +
        '<div class="card-head"><div class="card-title">' +
          "<h3>" + esc(c.name) + "</h3>" +
          '<span class="tag cat">' + esc(c.category) + " · " + esc(c.subcategory || "") + "</span>" + conf +
        "</div>" +
        '<span class="status-pill ' + statusClass(st) + '">' + statusLabel(st) + "</span></div>" +
        '<div class="card-batches">' + (c.batches || []).map(batchLine).join("") + "</div>" +
        '<div class="card-meta">' + meta.join("") + "</div>" +
        '<div class="card-actions">' +
          '<button class="btn-star' + (isFav(c.id) ? " on" : "") + '" data-fav="' + esc(c.id) + '" title="' + (isFav(c.id) ? "取消收藏" : "收藏置顶") + '">★</button>' +
          '<button class="btn" data-detail="' + esc(c.id) + '">详情 / 要求</button>' +
          (c.applyLink ? '<a class="btn apply" href="' + esc(c.applyLink) + '" target="_blank" rel="noopener">官网网申 ↗</a>' : "") +
          '<a class="btn secondary" href="https://www.bing.com/search?q=' + encodeURIComponent(c.name + " 实习生招聘 官方网申") + '" target="_blank" rel="noopener" title="打不开官网链接时，用必应搜该公司官方招聘入口">🔍 搜官方入口</a>' +
          '<span class="progress-mini" data-company="' + esc(c.id) + '">' +
            STAGES.map(function (s) {
              return '<button data-stage="' + s.key + '" class="' + (pg.stage === s.key ? "on " + (s.key === "offer" ? "done" : s.key === "drop" ? "drop" : "") : "") + '">' + s.label + "</button>";
            }).join("") +
          "</span>" +
        "</div></div>";
    }).join("");
  }

  /* ---------- 渲染：详情弹窗 ---------- */
  function openDetail(id) {
    var c = null;
    DATA.companies.forEach(function (x) { if (x.id === id) c = x; });
    if (!c) return;
    var st = companyStatus(c);
    function row(k, v) { return v ? "<dt>" + k + "</dt><dd>" + esc(v) + "</dd>" : ""; }
    $("#modalBody").innerHTML =
      '<button class="modal-close" id="modalClose">✕</button>' +
      "<h2>" + esc(c.name) + "</h2>" +
      '<span class="tag cat">' + esc(c.category) + " · " + esc(c.subcategory || "") + "</span> " +
      '<span class="status-pill ' + statusClass(st) + '">' + statusLabel(st) + "</span>" +
      '<div class="detail-section"><h4>📅 网申批次（往年时间）</h4>' +
        '<div class="card-batches">' + (c.batches || []).map(batchLine).join("") + "</div></div>" +
      '<div class="detail-section"><h4>🎓 用人要求</h4><dl class="detail-grid">' +
        row("学历要求", c.degree) + row("专业方向", c.major) + row("证书", c.certs) +
        row("技能", c.skills) + row("英语", c.english) +
      "</dl></div>" +
      '<div class="detail-section"><h4>📝 考核流程</h4><dl class="detail-grid">' +
        row("笔试", c.writtenTest) + row("面试", c.interviews) +
      "</dl></div>" +
      '<div class="detail-section"><h4>💰 待遇与留用</h4><dl class="detail-grid">' +
        row("薪资", c.salary) + row("食宿", c.housing) + row("留用", c.retention) +
      "</dl></div>" +
      '<div class="detail-section"><h4>📨 投递与内推渠道</h4><dl class="detail-grid">' +
        row("官方渠道", c.referral) + (c.applyLink ? '<dt>网申链接</dt><dd><a href="' + esc(c.applyLink) + '" target="_blank" rel="noopener">' + esc(c.applyLink) + "</a></dd>" : "") +
        row("城市", (c.cities || []).join(" / ")) +
      "</dl></div>" +
      '<div class="source-note">🔎 ' + esc(c.source || "") + (c.confidence ? " · 信息可信度：" + esc(c.confidence) : "") +
      "<br>⚠️ 以上为往年时间整理，投递前请以官方最新公告为准。</div>";
    $("#modal").hidden = false;
    $("#modalClose").onclick = closeModal;
  }
  function closeModal() { $("#modal").hidden = true; }

  /* ---------- 渲染：时间轴 ---------- */
  var TL_START = new Date(2026, 8, 1), TL_END = new Date(2027, 2, 28); // 2026-09 ~ 2027-03
  var TL_SPAN = TL_END - TL_START;
  function pct(d) { return Math.max(0, Math.min(100, ((d - TL_START) / TL_SPAN) * 100)); }
  function renderTimeline() {
    var cat = $("#timelineCategory").value;
    var list = DATA.companies.filter(function (c) { return !cat || c.category === cat; });
    list = list.filter(function (c) { return companyWindows(c).length > 0; });
    var months = [];
    for (var m = new Date(2026, 8, 1); m <= TL_END; m.setMonth(m.getMonth() + 1)) {
      months.push(m.getFullYear() + "年" + (m.getMonth() + 1) + "月");
    }
    var html = '<div class="tl-months" style="grid-template-columns:repeat(' + months.length + ',1fr)">' +
      months.map(function (x) { return "<div>" + x + "</div>"; }).join("") + "</div>";
    html += list.sort(sortCompanies).map(function (c) {
      var st = companyStatus(c);
      var bars = companyWindows(c).map(function (it) {
        if (it.w.rolling) {
          return '<div class="tl-bar rolling" style="left:0;width:100%" data-goto="' + esc(c.id) + '" title="' + esc(it.batch.type) + ' 全年滚动">' + esc(it.batch.type) + " · 滚动</div>";
        }
        var l = pct(it.w.open), r = pct(it.w.close);
        if (r <= 0 || l >= 100) return "";
        var cls = st.batch && st.batch.batch === it.batch && (st.state === "opening") ? " opening" : "";
        return '<div class="tl-bar' + cls + '" style="left:' + l.toFixed(1) + "%;width:" + Math.max(3, r - l).toFixed(1) + '%" data-goto="' + esc(c.id) + '" title="' + esc(it.batch.type + " " + it.batch.open + "~" + it.batch.close) + '">' + esc(it.batch.type) + "</div>";
      }).join("");
      return '<div class="tl-row"><div class="tl-name" title="' + esc(c.name) + '">' + esc(c.name) + "<small>" + esc((c.cities || []).slice(0, 3).join("/")) + "</small></div>" +
        '<div class="tl-track">' + bars + "</div></div>";
    }).join("");
    $("#timelineWrap").innerHTML = html || '<p class="hint">暂无数据</p>';
  }

  /* ---------- 渲染：投递进度 ---------- */
  var kanbanCat = {}; // 每列的公司类型筛选
  function renderProgress() {
    var stats = { none: 0, applied: 0, written: 0, interview: 0, offer: 0, drop: 0 };
    DATA.companies.forEach(function (c) {
      stats[progress[c.id] ? progress[c.id].stage : "none"]++;
    });
    $("#progressStats").innerHTML =
      '<div class="stat-box"><b>' + DATA.companies.length + "</b><span>公司总数</span></div>" +
      '<div class="stat-box"><b>' + stats.applied + "</b><span>网申中</span></div>" +
      '<div class="stat-box"><b>' + stats.written + "</b><span>已笔试</span></div>" +
      '<div class="stat-box"><b>' + stats.interview + "</b><span>已面试</span></div>" +
      '<div class="stat-box"><b>' + stats.offer + "</b><span>已Offer</span></div>";
    var cats = [];
    DATA.companies.forEach(function (c) { if (cats.indexOf(c.category) < 0) cats.push(c.category); });
    $("#kanban").innerHTML = STAGES.map(function (s) {
      var cat = kanbanCat[s.key] || "";
      var items = DATA.companies.filter(function (c) {
        if ((progress[c.id] ? progress[c.id].stage : "none") !== s.key) return false;
        if (cat && c.category !== cat) return false;
        return true;
      });
      var opts = '<option value="">全部类型</option>' + cats.map(function (x) {
        return '<option value="' + esc(x) + '"' + (cat === x ? " selected" : "") + ">" + esc(x) + "</option>";
      }).join("");
      return '<div class="kanban-col" data-stage="' + s.key + '"><div class="kanban-head"><h4>' + s.label + "（" + items.length + "）</h4>" +
        '<select class="kanban-cat" data-stage="' + s.key + '">' + opts + "</select></div>" +
        (items.length ? items.map(function (c) {
          var st = companyStatus(c);
          return '<div class="kanban-item" draggable="true" data-drag="' + esc(c.id) + '" data-detail="' + esc(c.id) + '">' + esc(c.name) +
            "<small>" + esc(c.category) + " · " + statusLabel(st) + "</small></div>";
        }).join("") : '<div class="kanban-empty">拖拽卡片到这里</div>') + "</div>";
    }).join("");
    bindKanban();
  }
  function bindKanban() {
    // 每列类型筛选
    $$(".kanban-cat").forEach(function (sel) {
      sel.onchange = function () {
        kanbanCat[sel.dataset.stage] = sel.value;
        try { localStorage.setItem(LS_KEY + "_kanbanCat", JSON.stringify(kanbanCat)); } catch (e) {}
        renderProgress();
      };
      sel.onclick = function (e) { e.stopPropagation(); };
    });
    // 拖拽：从一列拖到另一列即改变阶段
    var dragId = null;
    $$(".kanban-item").forEach(function (it) {
      it.addEventListener("dragstart", function () { dragId = it.dataset.drag; it.classList.add("dragging"); });
      it.addEventListener("dragend", function () { it.classList.remove("dragging"); });
      it.addEventListener("click", function () { openDetail(it.dataset.detail); });
    });
    $$(".kanban-col").forEach(function (col) {
      col.addEventListener("dragover", function (e) { e.preventDefault(); col.classList.add("drag-over"); });
      col.addEventListener("dragleave", function () { col.classList.remove("drag-over"); });
      col.addEventListener("drop", function (e) {
        e.preventDefault();
        col.classList.remove("drag-over");
        if (!dragId) return;
        var stage = col.dataset.stage;
        if (progress[dragId] && progress[dragId].stage === stage) { dragId = null; return; }
        progress[dragId] = { stage: stage, updated: new Date().toISOString() };
        if (stage === "none") delete progress[dragId];
        saveProgress(progress);
        dragId = null;
        renderProgress();
        renderList();
      });
    });
  }

  /* ---------- 渲染：渠道与攻略 ---------- */
  function renderChannels() {
    var ch = DATA.channels || {};
    function card(title, items) {
      if (!items || !items.length) return "";
      return '<div class="chan-card"><h3>' + title + "</h3><ul>" + items.map(function (x) {
        return "<li><b>" + esc(x.org || x.name || x.type || "") + "</b> " + esc((x.channel || "").replace(/官网：?https?:\/\/\S+/g, "").trim() || x.note || "") +
          (x.url ? ' <a href="' + esc(x.url) + '" target="_blank" rel="noopener">直达官网 ↗</a>' : "") +
          (x.note && (x.org || x.name || x.type) ? "<span>" + esc(x.note) + "</span>" : "") + "</li>";
      }).join("") + "</ul></div>";
    }
    var html = "";
    if (ch.official) html += card("🏛 官方招聘公众号与官网入口（部分）", ch.official);
    if (ch.platforms) html += card("🌐 权威信息平台", ch.platforms);
    if (ch.referral) html += card("🤝 内推机制说明", ch.referral);
    $("#channelsWrap").innerHTML = html || '<p class="hint">数据加载中…</p>';
  }
  function renderGuides() {
    $("#guidesWrap").innerHTML = (DATA.guides || []).map(function (g) {
      var res = (g.resources || []).map(function (r) {
        if (!r || !r.url) return "";
        var host = r.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
        return '<li><span class="res-platform">' + esc(r.platform || host) + "</span> <a href=\"" + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.title || host) + "</a>" +
          (r.note ? '<span class="res-note">' + esc(r.note) + "</span>" : "") + "</li>";
      }).join("");
      return '<div class="guide-card"><h3>' + esc(g.category) + "：" + esc(g.title || "") + "</h3><p>" + esc(g.content) + "</p>" +
        (res ? '<h4 class="res-title">🔗 优质资源直达</h4><ul class="res-list">' + res + "</ul>" : "") + "</div>";
    }).join("") || '<p class="hint">数据加载中…</p>';
  }

  /* ---------- 提醒条 ---------- */
  function renderAlert() {
    var opening = [], soon = [];
    DATA.companies.forEach(function (c) {
      var st = companyStatus(c);
      if (st.state === "opening") opening.push(c.name);
      else if (st.state === "soon" && st.days != null && st.days <= 21) soon.push(c.name + "（约 " + st.days + " 天后开闸）");
    });
    var parts = [];
    if (opening.length) parts.push("<b>按往年时间，预计正在开放：</b>" + esc(opening.slice(0, 6).join("、")) + (opening.length > 6 ? " 等 " + opening.length + " 家" : ""));
    if (soon.length) parts.push("<b>近期预计开闸：</b>" + esc(soon.slice(0, 5).join("、")));
    parts.push("现在正是<b>简历打磨 + 提前批网申</b>的窗口期，别等 11 月才动手。");
    $("#alertBar").innerHTML = "<ul><li>" + parts.join("</li><li>") + "</li></ul>";
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    $$(".tab").forEach(function (t) {
      t.onclick = function () {
        $$(".tab").forEach(function (x) { x.classList.remove("active"); });
        $$(".tab-pane").forEach(function (x) { x.classList.remove("active"); });
        t.classList.add("active");
        $("#tab-" + t.dataset.tab).classList.add("active");
        if (t.dataset.tab === "timeline") renderTimeline();
        if (t.dataset.tab === "progress") renderProgress();
      };
    });
    $("#searchBox").oninput = function () { filters.q = this.value.trim(); renderList(); };
    $("#categoryFilters").onclick = function (e) {
      if (!e.target.classList.contains("chip")) return;
      e.target.classList.toggle("active");
      filters.cats = $$("#categoryFilters .chip.active").map(function (x) { return x.dataset.cat; });
      renderList();
    };
    ["cityFilter", "batchFilter", "degreeFilter", "testFilter", "cityHZFilter", "statusFilter"].forEach(function (id) {
      $("#" + id).onchange = function () {
        var map = { cityFilter: "city", batchFilter: "batch", degreeFilter: "degree", testFilter: "test", cityHZFilter: "hz", statusFilter: "status" };
        filters[map[id]] = this.value;
        renderList();
      };
    });
    $("#resetFilters").onclick = function () {
      filters = { q: "", cats: [], city: "", batch: "", degree: "", test: "", hz: "", status: "" };
      $("#searchBox").value = "";
      $$("#categoryFilters .chip.active").forEach(function (x) { x.classList.remove("active"); });
      ["cityFilter", "batchFilter", "degreeFilter", "testFilter", "cityHZFilter", "statusFilter"].forEach(function (id) { $("#" + id).value = ""; });
      renderList();
    };
    $("#companyList").onclick = function (e) {
      var f = e.target.closest("[data-fav]");
      if (f) {
        var fid = f.dataset.fav;
        if (favorites[fid]) delete favorites[fid]; else favorites[fid] = 1;
        saveFavorites();
        renderList();
        return;
      }
      var b = e.target.closest("[data-detail]");
      if (b) return openDetail(b.dataset.detail);
      var p = e.target.closest(".progress-mini button");
      if (p) {
        var cid = p.parentElement.dataset.company;
        var stage = p.dataset.stage;
        if (progress[cid] && progress[cid].stage === stage) delete progress[cid];
        else progress[cid] = { stage: stage, updated: new Date().toISOString() };
        saveProgress(progress);
        renderList();
      }
    };
    $("#modalMask").onclick = closeModal;
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
    $("#timelineCategory").onchange = renderTimeline;
    $("#timelineWrap").onclick = function (e) {
      var b = e.target.closest("[data-goto]");
      if (b) openDetail(b.dataset.goto);
    };
  }

  /* ---------- 启动 ---------- */
  function init() {
    var now = new Date();
    $("#todayText").textContent = "今天是 " + now.getFullYear() + " 年 " + (now.getMonth() + 1) + " 月 " + now.getDate() + " 日";
    $("#updatedAt").textContent = DATA.updatedAt || "整理中";
    // 数据行补 id
    DATA.companies.forEach(function (c, i) { if (!c.id) c.id = "c" + i; });
    try { kanbanCat = JSON.parse(localStorage.getItem(LS_KEY + "_kanbanCat")) || {}; } catch (e) { kanbanCat = {}; }
    renderCategories();
    renderAlert();
    renderList();
    renderChannels();
    renderGuides();
    renderProgress();
    bindEvents();
    // 返回顶部
    var backTop = $("#backTop");
    window.addEventListener("scroll", function () {
      backTop.classList.toggle("show", window.scrollY > 600);
    }, { passive: true });
    backTop.onclick = function () { window.scrollTo({ top: 0, behavior: "smooth" }); };
    // 进度备份：导出/导入
    $("#exportProgress").onclick = function () {
      var payload = { app: "internship-tracker", exportedAt: new Date().toISOString(), progress: progress, favorites: favorites };
      var blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
      var a = document.createElement("a");
      var d = new Date();
      a.href = URL.createObjectURL(blob);
      a.download = "实习投递进度-" + d.getFullYear() + (d.getMonth() + 1) + d.getDate() + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    };
    $("#importProgress").onclick = function () { $("#importFile").click(); };
    $("#importFile").onchange = function () {
      var file = this.files[0];
      this.value = "";
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          if (!data || typeof data !== "object" || !data.progress) throw new Error("格式不对");
          var np = data.progress || {}, nf = data.favorites || {};
          var pCount = 0, fCount = 0;
          Object.keys(np).forEach(function (k) { progress[k] = np[k]; pCount++; });
          Object.keys(nf).forEach(function (k) { favorites[k] = 1; fCount++; });
          saveProgress(progress);
          saveFavorites();
          renderList();
          renderProgress();
          alert("恢复完成：导入 " + pCount + " 条投递进度、" + fCount + " 个收藏。");
        } catch (err) {
          alert("导入失败：" + err.message + "。请确认选择的是本站导出的备份文件。");
        }
      };
      reader.readAsText(file);
    };
  }
  document.addEventListener("DOMContentLoaded", boot);

  /* ---------- 登录门：解密加密数据 ---------- */
  var KEY_CACHE = "itr_session_key";
  function b64ToBuf(b64) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  function bufToB64(buf) {
    var arr = new Uint8Array(buf), bin = "";
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }
  function deriveKey(user, pass, saltBuf) {
    return crypto.subtle.importKey("raw", new TextEncoder().encode(user + ":" + pass), "PBKDF2", false, ["deriveKey"])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: "PBKDF2", salt: saltBuf, iterations: 150000, hash: "SHA-256" },
          base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
      });
  }
  function decryptData(key) {
    var enc = window.ENC_DATA;
    var ct = b64ToBuf(enc.ct);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBuf(enc.iv) }, key, ct)
      .then(function (plain) {
        window.DATA = JSON.parse(new TextDecoder().decode(plain));
        DATA = window.DATA; // 同步闭包变量（加载时指向空对象）
        return true;
      });
  }
  function showLogin(msg) {
    var gate = $("#loginGate");
    gate.hidden = false;
    $("#loginErr").textContent = msg || "";
  }
  function hideLogin() { $("#loginGate").hidden = true; }
  function afterUnlock() {
    hideLogin();
    init();
  }
  function boot() {
    if (!window.ENC_DATA) { init(); return; } // 兼容无加密数据的情况
    // 会话内已解锁：静默解密
    var cached = sessionStorage.getItem(KEY_CACHE);
    if (cached) {
      crypto.subtle.importKey("jwk", JSON.parse(cached), { name: "AES-GCM" }, true, ["decrypt"])
        .then(decryptData)
        .then(afterUnlock)
        .catch(function () { sessionStorage.removeItem(KEY_CACHE); showLogin(); });
      return;
    }
    showLogin();
    function attempt() {
      var u = $("#loginUser").value.trim(), p = $("#loginPass").value;
      if (!u || !p) { $("#loginErr").textContent = "请输入账号和密码"; return; }
      var btn = $("#loginBtn");
      btn.textContent = "解密中…"; btn.disabled = true;
      deriveKey(u, p, b64ToBuf(window.ENC_DATA.salt))
        .then(function (key) {
              return decryptData(key).then(function () {
                  return crypto.subtle.exportKey("jwk", key).then(function (jwk) {
              sessionStorage.setItem(KEY_CACHE, JSON.stringify(jwk));
                    });
          });
        })
        .then(afterUnlock)
        .catch(function (e) {
              btn.textContent = "解锁并进入"; btn.disabled = false;
          $("#loginErr").textContent = "账号或密码错误（或数据损坏）";
        });
    }
    $("#loginBtn").onclick = attempt;
    $("#loginPass").onkeydown = function (e) { if (e.key === "Enter") attempt(); };
    $("#loginUser").onkeydown = function (e) { if (e.key === "Enter") $("#loginPass").focus(); };
  }
})();
