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
  /* 状态缓存 —— 搜索卡顿的元凶之一。
     companyStatus() 每次都要构造 Date、解析批次时间字符串，而一次列表渲染会调用它**上万次**：
     筛选遍历 1064 次 + 排序里每次比较算 2 次（1000+ 次比较）+ 渲染 1064 次。
     状态只取决于 c.batches 和「今天」，一次会话内不会变，所以按 id 缓存一次就够。
     实测：这一步把单次搜索的 JS 耗时从 ~900ms 降到几十毫秒。 */
  var STATUS_CACHE = Object.create(null);
  function statusOf(c) {
    var k = c.id || c.name;
    var s = STATUS_CACHE[k];
    if (!s) { s = STATUS_CACHE[k] = companyStatus(c); }
    return s;
  }

  /* 搜索用的「可搜文本」也按公司缓存一次（小写）。
     原来每次输入都现拼 10 个字段再 toLowerCase()，1064 家 × 约 1KB = 每次按键 1MB 字符串分配，
     搜索时的卡顿很大一部分来自这里。 */
  var HAY_CACHE = Object.create(null);
  function haystack(c) {
    var k = c.id || c.name;
    var h = HAY_CACHE[k];
    if (h === undefined) {
      h = HAY_CACHE[k] = [c.name, c.subcategory, (c.cities || []).join(" "), c.major, c.skills, c.degree,
        c.biz, c.jobs, c.scale, c.note, (c.tags || []).join(" ")].join(" ").toLowerCase();
    }
    return h;
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

  /* ---------- 「小而美公司」分类：通用用人要求兜底 ----------
     596 家中小机构没法逐家核实用人要求，把共性部分按细分领域写在这里，
     渲染时只填该家为空的字段——逐家拿到官方信息时，直接写进数据即可覆盖。
     全部条目标可信度「低」，详情页底部会注明这是同类机构通用规律推断。 */
  var SB_SOURCE = "机构名单与主营方向整理自公开资料（公司官网、监管持牌/备案名单、行业榜单等）；" +
    "用人要求为同类机构通用规律推断，未经该机构官方确认，投递前请以官网为准";
  var SB_DEFAULTS = {
    "量化私募": {
      degree: "以硕士/博士在读为主，数学、物理、计算机、统计背景优先",
      major: "数学/统计/物理/计算机/金融工程等理工科背景为主",
      certs: "无硬性证书要求",
      skills: "Python/C++、机器学习、统计建模、算法与数据结构",
      retention: "多为长期日常实习后转正，实习是主要招聘入口"
    },
    "私募证券": {
      degree: "投研岗以硕士在读为主，偏好有相关行业研究经历",
      major: "金融/经济/财会，理工科复合背景加分",
      certs: "CFA/CPA 加分",
      skills: "财务分析、行业研究、Wind、研究报告写作",
      retention: "实习表现优秀可转正，投研岗多为长期实习考察"
    },
    "PE·VC": {
      degree: "本科及以上，投资岗偏好硕士在读",
      major: "金融/经济/理工复合，偏好有产业或投行实习经历",
      certs: "CFA/CPA 加分",
      skills: "行业研究、财务与估值建模、Wind/企查查、PPT",
      retention: "投资岗以实习转正为主要入口"
    },
    "中小公募资管": {
      degree: "研究岗硕士及以上为主，销售与运营岗本科可投",
      major: "金融/经济/财会/统计",
      certs: "基金从业资格优先，CFA/CPA 加分",
      skills: "Wind、财务分析、渠道沟通，量化岗需 Python",
      retention: "研究员岗多通过长期实习选拔后转正"
    },
    "精品投行FA": {
      degree: "本科及以上，大四保研/研一时间充裕者优先",
      major: "金融/经济/财会，理工科复合加分",
      certs: "无硬性证书要求，CFA/CPA 加分",
      skills: "Excel 财务模型、PPT、行业研究、英文材料阅读",
      retention: "暑期/日常实习转正是主要招聘入口"
    },
    "中小券商": {
      degree: "研究所与投行岗硕士优先，部分实习岗本科可投",
      major: "金融/经济/财会/法律，理工复合加分",
      certs: "证券从业资格优先，CPA/CFA/法考加分",
      skills: "Wind、Excel、PPT、财务建模、报告写作",
      retention: "研究所实习通过答辩或考核后可留用"
    },
    "精品咨询研究": {
      degree: "本科及以上，硕士优先",
      major: "专业不限，金融/经济/统计/管理优先",
      certs: "无硬性证书要求",
      skills: "案头研究、专家访谈、Excel/PPT、英文报告",
      retention: "实习转正为主，表现优秀可提前拿全职 Offer"
    },
    "评级信评": {
      degree: "硕士优先，财务或金融背景",
      major: "金融/经济/财会",
      certs: "CPA/CFA 加分",
      skills: "财务分析、Excel、信用评级与行业分析方法",
      retention: "实习后转正是常见入口"
    },
    "金融科技数据": {
      degree: "本科及以上，技术岗偏好硕士",
      major: "金融/经济/统计/计算机，复合背景优先",
      certs: "无硬性证书要求",
      skills: "Excel/SQL、数据分析、产品运营，研发岗需编程",
      retention: "实习转正与社招并行"
    },
    "消费金融": {
      degree: "本科及以上",
      major: "金融/经济/财会/统计/计算机",
      certs: "无硬性证书要求",
      skills: "数据分析、风控逻辑、Excel/SQL、产品沟通",
      retention: "校招生培养体系较完整，实习可转正"
    },
    "融资租赁": {
      degree: "本科及以上（业务岗接受应届本科）",
      major: "金融/经济/财会/市场营销，业务岗专业不限",
      certs: "无硬性证书要求",
      skills: "客户开发、财务与资信分析、Excel、沟通谈判",
      retention: "业务岗以校招+实习为主，业绩考核明确"
    },
    "保险资管": {
      degree: "本科及以上，精算岗偏好硕士",
      major: "金融/保险/精算/统计，健康险相关可接受医学背景",
      certs: "精算师/CPA 等加分",
      skills: "精算与数据分析、Excel、产品与合规、沟通",
      retention: "校招与实习并行"
    },
    "城商行农商行": {
      degree: "本科及以上（应届）",
      major: "金融/经济/财会/管理，多数岗位专业不限",
      certs: "银行从业资格优先",
      skills: "Excel、沟通与营销、基础财务分析",
      retention: "管培生/校招生培养体系完整，转正率高"
    },
    "信托AMC": {
      degree: "硕士优先",
      major: "金融/经济/财会/法律",
      certs: "CPA/法考加分",
      skills: "财务与尽调分析、Excel、法律与合规基础",
      retention: "实习表现优秀可转正"
    },
    "会计师事务所": {
      degree: "本科及以上（应届）",
      major: "会计/财会/审计/金融，多数岗位专业不限",
      certs: "CPA 通过部分科目优先",
      skills: "会计准则与审计流程、Excel、CPA 科目学习",
      retention: "实习转正是主要入口，CPA 通过科目有加分"
    },
    "金融基础设施": {
      degree: "硕士及以上为主",
      major: "金融/经济/统计/计算机",
      certs: "证券/基金从业资格优先",
      skills: "数据分析、行业研究、规则文档理解",
      retention: "以校招为主，事业/公司制平台"
    }
  };
  /* ---------- 原有 7 个分类扩充分类的用人要求兜底 ----------
     与「小而美公司」同理：这批新增条目不再逐条重复写通用用人要求，
     按**主分类**兜底；逐家拿到官方口径时直接写进数据即可覆盖。
     可信度由数据里的 confidence 决定（带公开报道口径的标「中」，其余「低」）。 */
  var EXTRA_SOURCE = "公司公开信息（官网 / 招聘公告 / 公开报道）整理；" +
    "批次时间为同类机构规律推算，用人要求为同主分类通用规律，未逐家核实";
  var EXTRA_DEFAULTS = {
    "券商/投行": {
      degree: "研究所与投行岗硕士优先，部分实习岗本科可投",
      major: "金融/经济/财会/法律，理工复合加分",
      certs: "证券从业资格优先，CPA/CFA/法考加分",
      skills: "Wind、Excel、PPT、财务建模、报告写作",
      retention: "实习表现优秀可留用，暑期实习是留用主渠道"
    },
    "基金/资管/PE·VC": {
      degree: "研究/投资岗硕士及以上为主，销售与运营岗本科可投",
      major: "金融/经济/财会/统计，理工复合加分",
      certs: "基金从业资格优先，CFA/CPA 加分",
      skills: "Wind、财务分析、财务与估值建模，量化岗需 Python",
      retention: "研究员与投资岗主要靠长期实习转正"
    },
    "银行/保险/信托": {
      degree: "本科及以上（应届），总行与管培生岗偏好硕士",
      major: "金融/经济/财会/管理/计算机，部分岗位专业不限",
      certs: "银行从业/证券从业资格优先，精算岗看精算师考试科目",
      skills: "Excel、沟通与营销、基础财务分析，科技岗需 SQL 或编程",
      retention: "校招培养体系完整，实习表现优秀可留用"
    },
    "四大/咨询": {
      degree: "本科及以上，硕士优先",
      major: "专业不限，财会/金融/经济/统计/管理优先",
      certs: "会计线看 CPA 通过科目，咨询线无硬性证书要求",
      skills: "Excel/PPT、案头研究、财务分析、英文报告",
      retention: "实习转正是主要入口，寒假实习表现好可锁定后续机会"
    },
    "大厂/金融科技": {
      degree: "本科及以上，技术/数据岗偏好硕士",
      major: "金融/经济/统计/计算机，复合背景优先",
      certs: "无硬性证书要求",
      skills: "数据分析（SQL/Python）、产品与运营思维，财务岗看 Excel 建模",
      retention: "暑期实习是主要入口，实习转正比例较高"
    },
    "上市公司": {
      degree: "本科及以上，总部职能岗偏好硕士",
      major: "财会/金融/经济/法律/管理，行业对口专业加分",
      certs: "CPA/CFA 加分，证券事务岗看董秘资格",
      skills: "财务分析、Excel、财务建模，证券事务岗需写作与信息披露基础",
      retention: "以校招与实习转正为主，总部职能岗机会少于金融机构"
    },
    "央国企": {
      degree: "本科及以上，多数单位偏好硕士",
      major: "金融/经济/财会/管理/法律，理工科对口专业加分",
      certs: "部分岗位看 CPA/CFA 等职业资格",
      skills: "财务与资金管理、数据分析、公文写作与合规意识",
      retention: "以校招为主，部分单位有统一笔试与政审环节"
    }
  };

  function applyDefaults(c) {
    var k;
    if (c.category === "小而美公司") {
      var d = SB_DEFAULTS[c.subcategory];
      if (d) { for (k in d) { if (!c[k]) c[k] = d[k]; } }
      if (!c.source) c.source = SB_SOURCE;
      return;
    }
    // 原有 7 个分类里的扩充分类：按主分类兜底（已有精心整理的条目字段齐全，不会被覆盖）
    var e = EXTRA_DEFAULTS[c.category];
    if (e) {
      for (k in e) { if (!c[k]) c[k] = e[k]; }
      if (!c.source) c.source = EXTRA_SOURCE;
    }
  }
  // 卡片/详情里那行「主营 · 适合投递 · 体量」
  function sbLine(c) {
    var parts = [];
    if (c.biz) parts.push("主营：" + esc(c.biz));
    if (c.jobs) parts.push("适合投递：" + esc(c.jobs));
    if (c.scale) parts.push("体量：≈" + esc(c.scale));
    if (c.note) parts.push("备注：" + esc(c.note));
    return parts.join("　·　");
  }

  /* ---------- 筛选 ---------- */
  var filters = { q: "", cats: [], city: "", batch: "", degree: "", test: "", hz: "", status: "" };
  // 一家公司可以在多个分类里出现：category 是主分类，tags 是附加分类
  // （例如宁波银行主分类是「银行/保险/信托」，同时挂了 tag「小而美公司」）
  function inCat(c, cat) {
    if (c.category === cat) return true;
    return (c.tags || []).indexOf(cat) >= 0;
  }
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
    // 注意：这里不需要算状态。以前有一句 `var st = companyStatus(c)` 算完却没用，
    // 等于每敲一个字就白算 1064 次日期解析，已删除。
    if (filters.q) {
      // 搜索用的「大字符串」按公司缓存一次。原来每敲一个字都要给 1064 家公司
      // 重新拼接 10 个字段再转小写（每次约 1MB 字符串分配），是输入卡顿的主因之一。
      if (haystack(c).indexOf(filters.qLower) < 0) return false;
    }
    if (filters.cats.length) {
      var hit = false;
      for (var i = 0; i < filters.cats.length; i++) { if (inCat(c, filters.cats[i])) { hit = true; break; } }
      if (!hit) return false;
    }
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
    var oa = statusOf(a), ob = statusOf(b);
    var order = { opening: 0, rolling: 1, soon: 2, unknown: 3, closed: 4 };
    if (order[oa.state] !== order[ob.state]) return order[oa.state] - order[ob.state];
    if (oa.state === "soon" && ob.state === "soon" && oa.days !== ob.days) return oa.days - ob.days;
    return a.name.localeCompare(b.name, "zh");
  }

  /* ---------- 「来源」标记 ----------
     这个字段原本只显示「可信度低」，但那个「低」其实只说明一件事：
     该公司的网申时间不是从官方公告抄来的，而是按同类机构往年的规律推算。
     机构名、城市、主营、投递入口这些反而是靠谱的（还有 400+ 家官网是程序实测过的）。
     一条笼统的「可信度低」把两件事混在一起，既吓人又没信息量，所以拆开写清楚。 */
  var CONF_LABEL = { "高": "来源：官方公告", "中": "来源：公开报道", "低": "来源：规律推算" };
  var CONF_TITLE = {
    "高": "网申时间与用人要求来自该单位官方公告/招生简章",
    "中": "网申时间与用人要求来自公开报道或官方招聘页，非逐家官方公告",
    "低": "该公司不单独发公告，时间按同类机构往年规律推算；用人要求为同类机构通用规律"
  };
  var VERIFIED_TITLE = "官网链接由程序实测可访问（HTTP 200 且页面出现公司名），实测日期 2026-10-16";

  /* ---------- 渲染：公司库 ---------- */
  function allCategories() {
    var cats = [];
    DATA.companies.forEach(function (c) {
      if (cats.indexOf(c.category) < 0) cats.push(c.category);
      (c.tags || []).forEach(function (t) { if (cats.indexOf(t) < 0) cats.push(t); });
    });
    return cats;
  }

  function renderCategories() {
    var cats = allCategories();
    // 分类条做成「目录」的样子：序号 + 名称 + 家数，比一排纯文字 chip 更好扫读
    $("#categoryFilters").innerHTML = cats.map(function (cat, i) {
      // 记住已选中的分类：分类条重建时要还原高亮，否则 UI 与 filters.cats 会不一致
      var on = filters.cats.indexOf(cat) >= 0 ? " active" : "";
      var n = 0;
      for (var k = 0; k < DATA.companies.length; k++) { if (inCat(DATA.companies[k], cat)) n++; }
      return '<button class="chip' + on + '" data-cat="' + esc(cat) + '">' +
        "<i>" + (i + 1 < 10 ? "0" : "") + (i + 1) + "</i>" +
        esc(cat) + "<b>" + n + "</b></button>";
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

  /* 单张卡片的 HTML。抽出来是为了能在渐进渲染里分批调用。 */
  function cardHTML(c) {
    var st = statusOf(c);
    var pg = progress[c.id] || { stage: "none" };
    var meta = [];
    if (c.cities && c.cities.length) meta.push("📍 " + esc(c.cities.join(" / ")));
    if (c.degree) meta.push("🎓 " + esc(c.degree));
    if (c.salary) meta.push("💰 " + esc(c.salary));
    if (c.housing && /包|提供|住宿|餐/.test(c.housing)) meta.push("🏠 " + esc(c.housing));
    if (c.writtenTest) meta.push("✍️ 笔试: " + esc(c.writtenTest));
    var conf = c.confidence
      ? '<span class="tag conf-' + esc(c.confidence) + '" title="' + esc(CONF_TITLE[c.confidence] || "") + '">' +
        esc(CONF_LABEL[c.confidence] || ("来源：" + c.confidence)) + "</span>"
      : "";
    var verified = c.linkVerified ? '<span class="tag verified" title="' + esc(VERIFIED_TITLE) + '">✓ 官网已实测</span>' : "";
    // 每日自动巡检的结果（tools/ci-check-links.js 生成 js/link-status.json）：
    // 同一条官网连续 3 天连不上才提示，避免把「对方限制了程序访问」误报成失效。
    var ls = LINK_STATUS && LINK_STATUS.entries ? LINK_STATUS.entries[c.id] : null;
    var deadTag = (ls && ls.s === "bad")
      ? '<span class="tag dead" title="自动巡检已连续 ' + ls.f + ' 天连不上该官网（首次发现 ' + esc(ls.first) +
        '）。可能已失效，也可能只是对方限制了程序访问——点「搜官方入口」能立刻交叉核对。">⚠️ 链接可能失效</span>'
      : "";
    var extra = sbLine(c);
    return '<div class="company-card ' + cardBorderClass(st) + '" id="card-' + esc(c.id) + '">' +
      '<div class="card-head"><div class="card-title">' +
        "<h3>" + esc(c.name) + "</h3>" +
        '<span class="tag cat">' + esc(c.category) + " · " + esc(c.subcategory || "") + "</span>" +
        (c.category !== "小而美公司" && (c.tags || []).indexOf("小而美公司") >= 0
          ? '<span class="tag sb">小而美公司</span>' : "") + verified + conf + deadTag +
      "</div>" +
      '<span class="status-pill ' + statusClass(st) + '">' + statusLabel(st) + "</span></div>" +
      '<div class="card-batches">' + (c.batches || []).map(batchLine).join("") + "</div>" +
      '<div class="card-meta">' + meta.join("") + "</div>" +
      (extra ? '<div class="card-extra">' + extra + "</div>" : "") +
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
  }

  /* ---------- 列表渲染（渐进式）----------
     为什么分批：1064 张卡 = 约 2.8 万个 DOM 节点。一次性 innerHTML 写进去，浏览器要一口气
     做样式计算 + 布局 + 绘制，在 CPU 降速 4 倍（≈中端手机）下实测「输入一个字」要 3.5 秒、
     清空重画全量要 5 秒，期间完全无响应。
     现在改成：先同步画前 FIRST_PAINT 张（首屏立刻有内容），剩下的按帧分批追加。
     最终 DOM 仍然是完整的（Ctrl+F 能搜到），只是不再阻塞首帧。
     ⚠️ 中途若筛选条件又变了，靠 renderGen 令牌让旧的这批直接放弃。 */
  var FIRST_PAINT = 80;   // 首屏同步渲染张数
  var CHUNK = 120;        // 之后每批追加张数
  var renderGen = 0;

  function scheduleChunk(fn) {
    if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout: 120 });
    else setTimeout(fn, 0);
  }

  function renderList() {
    var gen = ++renderGen;
    filters.qLower = (filters.q || "").toLowerCase();   // 只转一次，别在每个公司上重复转
    var list = DATA.companies.filter(matchCompany).sort(sortCompanies);
    $("#resultCount").innerHTML = (list.length === DATA.companies.length
      ? "共 <b>" + list.length + "</b> 家机构"
      : "筛出 <b>" + list.length + "</b> 家 · 全库 " + DATA.companies.length + " 家");
    $("#emptyState").hidden = list.length > 0;

    var box = $("#companyList");
    box.innerHTML = list.slice(0, FIRST_PAINT).map(cardHTML).join("");
    if (list.length <= FIRST_PAINT) { delete box.dataset.rendering; return; }

    // 还没画完：打上标记（自检和「导出/统计」类逻辑可以据此等待）
    box.dataset.rendering = "1";
    var i = FIRST_PAINT;
    function more() {
      if (gen !== renderGen) return;            // 期间又改了筛选条件，这批作废
      box.insertAdjacentHTML("beforeend", list.slice(i, i + CHUNK).map(cardHTML).join(""));
      i += CHUNK;
      if (i < list.length) scheduleChunk(more);
      else delete box.dataset.rendering;
    }
    scheduleChunk(more);
  }


  /* ---------- 渲染：详情弹窗 ---------- */
  function openDetail(id) {
    var c = null;
    DATA.companies.forEach(function (x) { if (x.id === id) c = x; });
    if (!c) return;
    var st = statusOf(c);
    function row(k, v) { return v ? "<dt>" + k + "</dt><dd>" + esc(v) + "</dd>" : ""; }
    // 没有内容的区块直接不渲染，避免详情页出现「空标题 + 什么都不显示」
    function sec(title, body) {
      return body ? '<div class="detail-section"><h4>' + title + '</h4><dl class="detail-grid">' + body + "</dl></div>" : "";
    }
    $("#modalBody").innerHTML =
      '<button class="modal-close" id="modalClose">✕</button>' +
      "<h2>" + esc(c.name) + "</h2>" +
      '<span class="tag cat">' + esc(c.category) + " · " + esc(c.subcategory || "") + "</span> " +
      '<span class="status-pill ' + statusClass(st) + '">' + statusLabel(st) + "</span>" +
      '<div class="detail-section"><h4>📅 网申批次（往年时间）</h4>' +
        '<div class="card-batches">' + (c.batches || []).map(batchLine).join("") + "</div></div>" +
      sec("🧭 机构信息", row("主营业务", c.biz) + row("适合投递方向", c.jobs) +
        row("规模量级", c.scale ? "≈ " + c.scale + "（按公开信息粗判，非精确人数）" : "") + row("备注", c.note)) +
      sec("🎓 用人要求", row("学历要求", c.degree) + row("专业方向", c.major) + row("证书", c.certs) +
        row("技能", c.skills) + row("英语", c.english)) +
      sec("📝 考核流程", row("笔试", c.writtenTest) + row("面试", c.interviews)) +
      sec("💰 待遇与留用", row("薪资", c.salary) + row("食宿", c.housing) + row("留用", c.retention)) +
      '<div class="detail-section"><h4>📨 投递与内推渠道</h4><dl class="detail-grid">' +
        row("官方渠道", c.referral) + (c.applyLink ? '<dt>网申链接</dt><dd><a href="' + esc(c.applyLink) + '" target="_blank" rel="noopener">' + esc(c.applyLink) + "</a></dd>" : "") +
        row("城市", (c.cities || []).join(" / ")) +
      "</dl></div>" +
      '<div class="source-note">🔎 ' + esc(c.source || "") +
        "<br>📌 <b>网申时间与用人要求</b>：" + esc(CONF_LABEL[c.confidence] || "未标注") +
        (CONF_TITLE[c.confidence] ? "　<span>（" + esc(CONF_TITLE[c.confidence]) + "）</span>" : "") +
        "<br>🔗 <b>官网链接</b>：" +
        (c.linkVerified ? "已由程序实测可访问（2026-10-16）"
          : c.applyLink ? "来自公开资料整理，未逐条实测"
            : "未收录，请用卡片上的「🔍 搜官方入口」按钮查找") +
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
    var list = DATA.companies.filter(function (c) { return !cat || inCat(c, cat); });
    list = list.filter(function (c) { return companyWindows(c).length > 0; });
    var months = [];
    for (var m = new Date(2026, 8, 1); m <= TL_END; m.setMonth(m.getMonth() + 1)) {
      months.push(m.getFullYear() + "年" + (m.getMonth() + 1) + "月");
    }
    var html = '<div class="tl-months" style="grid-template-columns:repeat(' + months.length + ',1fr)">' +
      months.map(function (x) { return "<div>" + x + "</div>"; }).join("") + "</div>";
    html += list.sort(sortCompanies).map(function (c) {
      var st = statusOf(c);
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
    DATA.companies.forEach(function (c) {
      if (cats.indexOf(c.category) < 0) cats.push(c.category);
      (c.tags || []).forEach(function (t) { if (cats.indexOf(t) < 0) cats.push(t); });
    });
    $("#kanban").innerHTML = STAGES.map(function (s) {
      var cat = kanbanCat[s.key] || "";
      var items = DATA.companies.filter(function (c) {
        if ((progress[c.id] ? progress[c.id].stage : "none") !== s.key) return false;
        if (cat && !inCat(c, cat)) return false;
        return true;
      });
      var opts = '<option value="">全部类型</option>' + cats.map(function (x) {
        return '<option value="' + esc(x) + '"' + (cat === x ? " selected" : "") + ">" + esc(x) + "</option>";
      }).join("");
      return '<div class="kanban-col" data-stage="' + s.key + '"><div class="kanban-head"><h4>' + s.label + "（" + items.length + "）</h4>" +
        '<select class="kanban-cat" data-stage="' + s.key + '">' + opts + "</select></div>" +
        (items.length ? items.map(function (c) {
          var st = statusOf(c);
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
        invalidateTab("progress");
        invalidateTab("list");
      });
    });
  }

  /* ---------- 官网链接巡检结果 ----------
     js/link-status.json 由 tools/ci-check-links.js 每日生成（GitHub Actions），只含公司 id、
     连续失败天数和日期——没有公司名、没有 URL，所以能放进公开仓库。
     文件不存在（首次部署/离线）时一切都照旧，巡检只是锦上添花。 */
  var LINK_STATUS = null;
  function loadLinkStatus() {
    if (typeof fetch !== "function") return;
    fetch("js/link-status.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.entries) return;
        LINK_STATUS = j;
        invalidateTab("list");   // 给命中的卡片补标记
        renderStatStrip();       // 概览条补上「上次巡检」
      })
      .catch(function () {});
  }

  /* ---------- 报头：数据概览条 + 新鲜度 ----------
     概览条模仿日报的「12 件大事 | 11 个来源 | …」：一眼看到规模、目录数和「有几家正在开放」。
     「正在开放」是按今天的日期实时算的（statusOf），所以这一项每天都在变。 */
  function renderStatStrip() {
    var box = $("#statStrip");
    if (!box) return;
    var cs = DATA.companies;
    var open = 0;
    for (var i = 0; i < cs.length; i++) { if (statusOf(cs[i]).state === "opening") open++; }
    var links = 0, verified = 0;
    cs.forEach(function (c) { if (c.applyLink) links++; if (c.linkVerified) verified++; });
    function item(label, val, accent) {
      return "<span" + (accent ? ' class="accent"' : "") + "><b>" + val + "</b>" + label + "</span>";
    }
    var html =
      item("家机构", cs.length) +
      item("个分类", allCategories().length) +
      item("家正在开放网申", open, true) +
      item("条官网直链", links) +
      item("条官网已实测", verified);
    if (LINK_STATUS && LINK_STATUS.checkedAt) {
      var d = new Date(LINK_STATUS.checkedAt);
      if (!isNaN(d.getTime())) {
        var today = new Date(); today.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0);
        var n = Math.round((today - d) / 86400000);
        html += item("上次链接巡检", n <= 0 ? "今天" : n + " 天前");
      }
    }
    box.innerHTML = html;
  }

  /* 数据整理距今多少天。数据是静态打包的，不会自己变新，
     所以把「几天没更新」直接写在报头上，比装作实时要诚实。 */
  function renderFreshness() {
    var el = $("#freshness");
    if (!el) return;
    var d = new Date(DATA.updatedAt);
    if (isNaN(d.getTime())) { el.hidden = true; return; }
    var today = new Date(); today.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0);
    var days = Math.round((today - d) / 86400000);
    var txt, cls = "freshness";
    if (days <= 0) txt = "今天更新";
    else if (days === 1) txt = "1 天前更新";
    else if (days < 30) txt = days + " 天前更新";
    else { txt = "已 " + days + " 天未更新 · 建议核对官网"; cls += days >= 60 ? " stale" : " warn"; }
    el.className = cls;
    el.textContent = txt;
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
      var st = statusOf(c);
      if (st.state === "opening") opening.push(c.name);
      else if (st.state === "soon" && st.days != null && st.days <= 21) soon.push(c.name + "（约 " + st.days + " 天后开闸）");
    });
    var parts = [];
    if (opening.length) parts.push("<b>按往年时间，预计正在开放：</b>" + esc(opening.slice(0, 6).join("、")) + (opening.length > 6 ? " 等 " + opening.length + " 家" : ""));
    if (soon.length) parts.push("<b>近期预计开闸：</b>" + esc(soon.slice(0, 5).join("、")));
    parts.push("现在正是<b>简历打磨 + 提前批网申</b>的窗口期，别等 11 月才动手。");
    $("#alertBar").innerHTML = "<ul><li>" + parts.join("</li><li>") + "</li></ul>";
  }

  /* ---------- 标签页懒渲染 ----------
     启动时只渲染当前可见的那个页签。原先 5 个页签开机时一次性全渲染，
     可「投递进度」的 1064 张看板卡、「时间轴」的 1712 个色块、「渠道」「攻略」都不在首屏，
     白白多花约 400ms 渲染时间和上万个 DOM 节点（实测总节点数 36441）。
     现在改成切过去才渲染，切回来直接复用已渲好的 DOM。
     任何会改动某页签数据的地方调 invalidateTab()：正在看的立刻重渲，没在看的等切过去再说。 */
  var currentTab = "list";
  var tabDirty = { list: false, timeline: true, progress: true, channels: true, guides: true };
  var TAB_RENDERER = {
    list: function () { renderList(); },
    timeline: function () { renderTimeline(); },
    progress: function () { renderProgress(); },
    channels: function () { renderChannels(); },
    guides: function () { renderGuides(); }
  };
  function ensureTab(tab) {
    if (!TAB_RENDERER[tab] || !tabDirty[tab]) return;
    tabDirty[tab] = false;
    TAB_RENDERER[tab]();
  }
  function invalidateTab(tab) {
    tabDirty[tab] = true;
    if (tab === currentTab) ensureTab(tab);
  }
  function switchTab(tab) {
    currentTab = tab;
    ensureTab(tab);
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    $$(".tab").forEach(function (t) {
      t.onclick = function () {
        $$(".tab").forEach(function (x) { x.classList.remove("active"); });
        $$(".tab-pane").forEach(function (x) { x.classList.remove("active"); });
        t.classList.add("active");
        $("#tab-" + t.dataset.tab).classList.add("active");
        switchTab(t.dataset.tab);
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
        invalidateTab("list");
        invalidateTab("progress");
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
    DATA.companies.forEach(function (c, i) { if (!c.id) c.id = "c" + i; applyDefaults(c); });
    renderFreshness();
    renderStatStrip();
    loadLinkStatus();
    try { kanbanCat = JSON.parse(localStorage.getItem(LS_KEY + "_kanbanCat")) || {}; } catch (e) { kanbanCat = {}; }
    // 只渲染首屏可见的「公司库」；其余 4 个页签等用户点过去再渲染（见 ensureTab）
    renderCategories();
    renderAlert();
    renderList();
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
          // 进度和收藏都变了：两个页签都标脏（当前看的会立刻重渲）
          invalidateTab("list");
          invalidateTab("progress");
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
  // v2 数据是「先 gzip 再加密」的（见 tools/encrypt-data.js），解密出来要解压。
  // 用浏览器原生的 DecompressionStream，不引入任何第三方库。
  function gunzip(buf) {
    if (typeof DecompressionStream === "undefined") {
      return Promise.reject(new Error("浏览器太旧：不支持 gzip 解压，请用新版 Chrome / Edge / Safari"));
    }
    var stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer().then(function (ab) {
      return new TextDecoder().decode(ab);
    });
  }
  function decryptData(key) {
    var enc = window.ENC_DATA;
    var ct = b64ToBuf(enc.ct);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBuf(enc.iv) }, key, ct)
      .then(function (plain) {
        // 老格式（没有 zip 标记）解出来就是 JSON 文本；新格式要先 gunzip
        return enc.zip === "gzip" ? gunzip(plain) : new TextDecoder().decode(plain);
      })
      .then(function (txt) {
        window.DATA = JSON.parse(txt);
        DATA = window.DATA; // 同步闭包变量（加载时指向空对象）
        return true;
      });
  }
  function showLogin(msg) {
    var gate = $("#loginGate");
    gate.hidden = false;
    $("#loginErr").textContent = msg || "";
  }
  function hideLogin() { $("#loginGate").hidden = true; $("#loginErr").textContent = ""; }
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
