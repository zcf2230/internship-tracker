#!/usr/bin/env node
/* 把小而美公司源数据（tools/sbc-src.txt，管道分隔）转成 raw 数据
 * 产出：tools/raw/smallbeauty.json（再由 tools/build-data.js 合并进 tools/data.json）
 *
 * 用法：node tools/build-smallbeauty.js
 *
 * 源文件每行：id | name | 细分分类 | 城市 | 规模量级 | 主营业务 | 适合投递方向 | 备注
 *   - 以 # 开头的行是注释，空行忽略；字段内不要出现竖线
 *
 * ⚠️ 数据诚信约定（沿用本站「标注可信度」的规矩）：
 *   每家只写**有公开出处**的内容（机构名、细分、城市、主营方向、投递入口）；
 *   「用人要求」按细分领域填**同类机构通用规律**，并在 source 里写明是推断；
 *   所有新增条目 confidence = "低"，批次统一为「日常实习·全年滚动」——
 *   中小机构本来就不发统一寒假批，滚动招聘是事实，不编造具体网申窗口。
 */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "sbc-src.txt");
const OUT = path.join(__dirname, "raw", "smallbeauty.json");

// 细分分类短名（卡片 tag 上显示，太长会挤）
const SUBCAT = {
  "量化私募": "量化私募",
  "私募证券（主观）": "私募证券",
  "PE / VC": "PE·VC",
  "中小公募 / 资管": "中小公募资管",
  "精品投行 / FA": "精品投行FA",
  "中小券商": "中小券商",
  "精品咨询 / 研究": "精品咨询研究",
  "评级 / 信用服务": "评级信评",
  "金融科技 / 数据": "金融科技数据",
  "消费金融": "消费金融",
  "融资租赁 / 汽车金融": "融资租赁",
  "保险 / 保险中介": "保险资管",
  "城商行 / 农商行": "城商行农商行",
  "信托 / AMC": "信托AMC",
  "会计师事务所": "会计师事务所",
  "金融基础设施 / 其他": "金融基础设施"
};

// 每类的投递入口（写进 referral 字段）
const HIRE = {
  "量化私募": "官网招聘页 / 实习僧 / 招聘公众号（多为实习转正）",
  "私募证券（主观）": "官网招聘页 / 招聘公众号（多为实习转正）",
  "PE / VC": "官网招聘页 / 招聘公众号（多为实习转正）",
  "中小公募 / 资管": "官网校招页 / 招聘公众号（秋招 + 暑期实习）",
  "精品投行 / FA": "官网招聘页 / 公众号 / 邮箱投递（暑期实习为主）",
  "中小券商": "官网校招页网申 / 研究所可用邮箱投递",
  "精品咨询 / 研究": "官网招聘页 / 公众号 / 邮箱投递（实习转正）",
  "评级 / 信用服务": "官网招聘页 / 招聘公众号（校招 + 实习）",
  "金融科技 / 数据": "官网校招页 / 牛客网 / 实习僧",
  "消费金融": "官网校招页 / 招聘公众号",
  "融资租赁 / 汽车金融": "官网 / 51job / 招聘公众号（业务岗接受本科应届）",
  "保险 / 保险中介": "官网校招页 / 招聘公众号",
  "城商行 / 农商行": "官网校招页（秋招为主）",
  "信托 / AMC": "官网招聘页 / 招聘公众号",
  "会计师事务所": "官网校招页 / 实习生计划",
  "金融基础设施 / 其他": "官网招聘页 / 官方招聘公众号"
};

// 用人要求（degree/major/skills/retention…）不写进每家记录——
// 596 条里这些内容按细分领域完全重复，写进数据会让加密包翻倍。
// 它们统一放在 js/app.js 的 SB_DEFAULTS 里，渲染时按 subcategory 兜底。

// 逐家单独校正（只有拿到官方/招聘网站具体信息时才写进这里）
const OVERRIDES = {
  l_zhongli: {
    salary: "约 5-8K/月（无责底薪）+ 月度/季度奖金，六险一金",
    retention: "业务岗年度两次调薪，晋升路径：业务专员→主任→组长→总监",
    source: "仲利国际招聘公告（应届生求职网/前程无忧，2026-09）+ 公开资料"
  },
  s_huaxin: {
    retention: "研究所实习 6 个月以上并通过答辩可留用（官方实习公告口径）"
  },
  s_huafu: {
    retention: "研究所面向 2027 届开放留用招聘（研究助理/机构销售）"
  },
  q_jiukun: {
    extra: "体量：员工超 500 人（私募排排网口径）"
  }
};

const DEFAULT_SOURCE = "机构名单与主营方向整理自公开资料（公司官网、监管持牌/备案名单、行业榜单等）；" +
  "批次与用人要求为同类机构通用规律推断，未经该机构官方确认，投递前请以官网为准";

const errors = [];

function main() {
  const raw = fs.readFileSync(SRC, "utf-8");
  const seen = new Set();
  const out = [];

  raw.split(/\r?\n/).forEach(function (line, i) {
    const ln = i + 1;
    const s = line.trim();
    if (!s || s.charAt(0) === "#") return;
    const c = s.split("|").map(function (x) { return x.trim(); });
    if (c.length !== 8) { errors.push(ln + ": 列数应为 8，实际 " + c.length); return; }
    const id = c[0], name = c[1], cat = c[2], city = c[3], scale = c[4], biz = c[5], jobs = c[6], note = c[7];
    if (!SUBCAT[cat]) { errors.push(ln + ": 未知细分分类「" + cat + "」"); return; }
    if (seen.has(id)) { errors.push(ln + ": id 重复 " + id); return; }
    seen.add(id);

    const ov = OVERRIDES[id] || {};
    const o = {
      name: name,
      category: "小而美公司",
      subcategory: SUBCAT[cat],
      cities: [city || "全国多地"],
      batches: [{
        type: "日常实习",
        open: "全年滚动",
        close: "招满即止",
        note: "中小机构多为日常实习+实习转正，无统一寒假批次"
      }],
      biz: biz,
      jobs: jobs,
      scale: scale || "",
      note: note || "",
      referral: HIRE[cat],
      source: ov.source || "",
      confidence: "低"
    };
    for (const k in ov) if (k !== "extra" && ov[k]) o[k] = ov[k];
    if (ov.extra) o.note = (o.note ? o.note + "｜" : "") + ov.extra;

    // 源码里的 id 留一份，方便以后回到原始源文件对照（不进渲染）
    o.srcId = id;
    out.push(o);
  });

  if (errors.length) {
    console.error("❌ 源文件校验未通过：");
    errors.slice(0, 30).forEach(function (e) { console.error("   · " + e); });
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1), "utf-8");

  const bySub = {};
  out.forEach(function (o) { bySub[o.subcategory] = (bySub[o.subcategory] || 0) + 1; });
  console.log("已生成 " + path.relative(path.join(__dirname, ".."), OUT) + "：共 " + out.length + " 家");
  Object.keys(bySub).forEach(function (k) { console.log("   " + k + " " + bySub[k]); });
  const cities = {};
  out.forEach(function (o) { cities[o.cities[0]] = (cities[o.cities[0]] || 0) + 1; });
  console.log("覆盖城市 " + Object.keys(cities).length + " 个；用人要求等通用字段由 js/app.js 的 SB_DEFAULTS 按细分领域兜底，不占数据体积");
  console.log("✅ 完成，下一步：node tools/build-data.js && node tools/encrypt-data.js");
}

main();
