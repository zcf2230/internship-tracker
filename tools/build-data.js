#!/usr/bin/env node
/* 把 tools/raw/*.json 合并成 js/data.js
 * raw 文件：dachang.json / channels.json / banks.json / funds.json / brokers.json / big4.json
 * 用法：node tools/build-data.js
 */
const fs = require("fs");
const path = require("path");

const RAW = path.join(__dirname, "raw");
const OUT = path.join(__dirname, "data.json");

const SB_CAT = "小而美公司";   // 「小而美公司」分类名（见 tools/build-smallbeauty.js）

const CAT_MAP = {
  "大厂": "大厂/金融科技",
  "金融科技": "大厂/金融科技",
  "上市公司": "上市公司",
  "券商/投行": "券商/投行",
  "基金/资管/PE-VC": "基金/资管/PE·VC",
  "基金/资管/PE·VC": "基金/资管/PE·VC",
  "银行/保险/信托": "银行/保险/信托",
  "银行": "银行/保险/信托",
  "保险": "银行/保险/信托",
  "信托": "银行/保险/信托",
  "金融租赁": "银行/保险/信托",
  "消费金融": "银行/保险/信托",
  "央国企": "央国企",
  "杭州科技公司": "大厂/金融科技",
  "实体企业": "上市公司",
  "四大/咨询": "四大/咨询"
};

function companiesFrom(file) {
  const p = path.join(RAW, file);
  if (!fs.existsSync(p)) return [];
  let arr = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!Array.isArray(arr)) return [];
  return arr.map((c, i) => {
    const cat = CAT_MAP[c.category] || c.category;
    return {
      id: file.replace(".json", "") + "-" + i,
      name: c.name || "未命名",
      category: cat,
      subcategory: c.subcategory || "",
      cities: c.cities || [],
      batches: (c.batches || []).filter(b => b && b.type),
      degree: c.degree || "",
      major: c.major || "",
      certs: c.certs || "",
      skills: c.skills || "",
      english: c.english || "",
      writtenTest: c.writtenTest || "",
      interviews: c.interviews || "",
      salary: c.salary || "",
      housing: c.housing || "",
      retention: c.retention || "",
      applyLink: (String(c.applyLink || "").match(/^https?:\/\/[^\s（(，,]+/) || [""])[0],
      // 「小而美公司」专用字段（其他来源留空）：
      // biz/jobs/scale/note 是这家机构的差异化信息，渲染层再拼成「主营/适合投递/体量」一行
      tags: Array.isArray(c.tags) ? c.tags : [],
      biz: c.biz || "",
      jobs: c.jobs || "",
      scale: c.scale || "",
      note: c.note || "",
      srcId: c.srcId || "",
      referral: c.referral || "",
      source: c.source || "",
      confidence: ["高", "中", "低"].includes(c.confidence) ? c.confidence : "低"
    };
  });
}

const files = ["brokers.json", "funds.json", "banks.json", "big4.json", "dachang.json", "region.json", "brokers2.json", "buyout.json", "tech.json", "soe.json", "smallbeauty.json", "more.json"];
let companies = [];
for (const f of files) companies = companies.concat(companiesFrom(f));

/* ⭐「小而美公司」去重：
 * 596 家名单里有 44 家站点本来就收录了（幻方、九坤、天职国际、宁波银行…），
 * 这些原有条目信息更完整（多城市、已核实的批次），所以**不重复建卡**——
 * 改成在原条目上加 tag「小而美公司」，筛选时两边都能命中，列表里不会出现两张同名卡。 */
const sbNames = new Set(companies.filter(c => c.category === SB_CAT).map(c => c.name));
const hasOther = new Set(companies.filter(c => c.category !== SB_CAT).map(c => c.name));
let sbMerged = 0;
companies = companies.filter(c => {
  if (c.category !== SB_CAT) {
    if (sbNames.has(c.name) && c.tags.indexOf(SB_CAT) < 0) { c.tags.push(SB_CAT); sbMerged++; }
    return true;
  }
  return !hasOther.has(c.name);   // 名单里与已有公司重名的，丢弃重复卡
});
const sbNew = companies.filter(c => c.category === SB_CAT).length;

/* ⭐「小而美公司」的条目按细分领域挂上它天然所属的**原分类**标签。
 * 例如「城商行农商行」的小而美条目同时属于「银行/保险/信托」，
 * 「中小券商」同时属于「券商/投行」——双向归属，两边 chip 都能筛到，且不重复建卡。
 * 不映射的细分（如金融基础设施）就只留在「小而美公司」里。 */
const SB_SECONDARY = {
  "量化私募": "基金/资管/PE·VC",
  "私募证券": "基金/资管/PE·VC",
  "PE·VC": "基金/资管/PE·VC",
  "中小公募资管": "基金/资管/PE·VC",
  "精品投行FA": "券商/投行",
  "中小券商": "券商/投行",
  "精品咨询研究": "四大/咨询",
  "评级信评": "四大/咨询",
  "会计师事务所": "四大/咨询",
  "金融科技数据": "大厂/金融科技",
  "消费金融": "银行/保险/信托",
  "融资租赁": "银行/保险/信托",
  "保险资管": "银行/保险/信托",
  "城商行农商行": "银行/保险/信托",
  "信托AMC": "银行/保险/信托"
};
let sbSecondaryTagged = 0;
companies.forEach(c => {
  if (c.category !== SB_CAT) return;
  const sec = SB_SECONDARY[c.subcategory];
  if (sec && c.tags.indexOf(sec) < 0) { c.tags.push(sec); sbSecondaryTagged++; }
});


/* ⭐ 官网直链：tools/links.json（由 tools/verify-links.js 实测产生：能访问 200 且页面含公司名）
 * 优先级高于原始数据里的 applyLink —— 既用来「补」原来没链接的机构，也用来「修」失效的旧链接。
 * links.json 是明文（含公司名），按本站约定不进仓库，已在 .gitignore。 */
const LINK_RAW = (() => {
  const p = path.join(__dirname, "links.json");
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { console.error("links.json 解析失败，忽略：", e.message); return {}; }
})();
const LINK_OVERRIDES = LINK_RAW.links || LINK_RAW;   // 兼容旧版无包装格式
const LINK_VERIFIED_AT = (LINK_RAW.verifiedAt || "").slice(0, 10);
let linkAdded = 0, linkFixed = 0;
companies.forEach(c => {
  const u = LINK_OVERRIDES[c.name];
  if (u && /^https?:\/\//.test(u)) {
    if (c.applyLink) linkFixed++; else linkAdded++;
    c.applyLink = u;
    // 这家机构的官网/招生页是「程序实测过能访问」的（见 tools/verify-links.js 的三层校验），
    // 和原作者人工整理、或从公开资料推断出来的条目区分开——卡片上会给一个「官网已实测」的标记。
    c.linkVerified = true;
  } else if (c.linkVerified) {
    delete c.linkVerified;   // 名单调整后不再是实测来源的，标记要撤掉，避免虚标
  }
});

let channels = {}, guides = [];
const chFile = path.join(RAW, "channels.json");
if (fs.existsSync(chFile)) {
  const ch = JSON.parse(fs.readFileSync(chFile, "utf8"));
  channels = ch.channels || ch || {};
  guides = ch.guides || [];
}
const guidesFile = path.join(RAW, "guides.json");
if (fs.existsSync(guidesFile)) guides = JSON.parse(fs.readFileSync(guidesFile, "utf8"));

const data = {
  updatedAt: "2026-10-16",
  // 官网直链最近一次实测日期（tools/verify-links.js 写在 links.json 里），页面标记用它
  verifiedAt: LINK_VERIFIED_AT || null,
  companies, channels, guides
};
const js = JSON.stringify(data, null, 1);
fs.writeFileSync(OUT, js, "utf8");
const sb = companies.filter(c => c.category === SB_CAT || c.tags.indexOf(SB_CAT) >= 0).length;
const cats = [];
companies.forEach(c => {
  if (cats.indexOf(c.category) < 0) cats.push(c.category);
  c.tags.forEach(t => { if (cats.indexOf(t) < 0) cats.push(t); });
});
const withLink = companies.filter(c => c.applyLink).length;
const chCount = (channels.official || []).length + (channels.platforms || []).length + (channels.referral || []).length;
console.log(`OK: ${companies.length} 家公司（「小而美公司」共 ${sb} 家 = 新建 ${sbNew} + 并入已有 ${sbMerged}；另有 ${sbSecondaryTagged} 条挂了原分类标签）`);
console.log(`    ${cats.length} 个分类，${guides.length} 篇攻略，渠道 ${chCount} 条 -> ${OUT}`);
console.log(`    官网直链 ${withLink}/${companies.length}（实测新增 ${linkAdded}、修正失效 ${linkFixed}）`);
