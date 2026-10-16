#!/usr/bin/env node
/* 「其他分类」扩展数据生成脚本
 *
 * 用法：node tools/build-more.js
 *
 * 读 tools/more-src-1.txt / more-src-2.txt（管道分隔，见文件头注释），
 * 产出 tools/raw/more.json，再由 tools/build-data.js 合并进 tools/data.json。
 *
 * 与 build-smallbeauty.js 的分工：
 *   - 小而美公司（596 家）：独立分类，用人要求按 16 个细分领域兜底
 *   - 本脚本（原有 7 个分类扩充）：批次按 分类|细分 预设给定，用人要求按主分类兜底（js/app.js 的 EXTRA_DEFAULTS）
 *
 * ⚠️ 数据诚信：公司名/主营/城市整理自公开资料；批次时间为同类机构规律推算（有公开报道口径的写进备注），
 *    用人要求为同主分类通用规律，可信度统一标「低/中」，不编造精确数字。
 */
const fs = require("fs");
const path = require("path");

const SRC_FILES = ["more-src-1.txt", "more-src-2.txt"];
const OUT = path.join(__dirname, "raw", "more.json");
const RAW_DIR = path.join(__dirname, "raw");

const CATS = ["券商/投行", "基金/资管/PE·VC", "银行/保险/信托", "四大/咨询", "大厂/金融科技", "上市公司", "央国企"];

// 投递入口：按主分类统一给（逐家重复写没意义）
const HIRE = {
  "券商/投行": "官网校招页网申 / 研究所可用邮箱投递",
  "基金/资管/PE·VC": "官网招聘页 / 招聘公众号（多为实习转正）",
  "银行/保险/信托": "官网校招页（秋招为主）/ 招聘公众号",
  "四大/咨询": "官网校招页 / 官方招聘公众号",
  "大厂/金融科技": "官网校招页 / 牛客网 / 实习僧",
  "上市公司": "公司官网「校园招聘 / 人才招聘」/ 招聘公众号",
  "央国企": "官方招聘网 / 招聘公众号（部分单位走统一考试）"
};

// 批次预设：key = "主分类|细分"，细分写 "*" 表示该分类的兜底
// 时间口径来自公开汇总报道（2026-09 ~ 10 检索），属「往年时间推算」，页面已整体加了免责声明
const BATCHES = {
  // 券商/投行
  "券商/投行|头部券商": [
    { type: "暑期实习", open: "约3-5月", close: "招满即止", note: "暑期实习是留用主渠道，提前批更早" },
    { type: "寒假实习", open: "约10-12月", close: "招满即止", note: "多与秋招并行，以部门/分公司日常实习形式发布" },
    { type: "日常实习", open: "全年滚动", close: "招满即止", note: "研究所与业务部门按需发布" }
  ],
  "券商/投行|区域强券商": [
    { type: "寒假实习", open: "约11-12月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止", note: "研究所、投行小组按需发布" }
  ],
  "券商/投行|外资投行": [
    { type: "暑期实习", open: "约8-10月", close: "招满即止", note: "面向次年暑期，海外与中国香港流程更早" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],

  // 基金/资管/PE·VC
  "基金/资管/PE·VC|公募基金": [
    { type: "暑期实习", open: "约3-5月", close: "招满即止", note: "研究员岗留用的主渠道" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" },
    { type: "秋招", open: "约9-10月", close: "招满即止", note: "2027届部分公募 9 月中旬已开启网申（公开汇总口径）" }
  ],
  "基金/资管/PE·VC|外资公募": [
    { type: "暑期实习", open: "约3-5月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],
  "基金/资管/PE·VC|券商资管": [
    { type: "暑期实习", open: "约4-6月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],
  "基金/资管/PE·VC|头部PE/VC": [
    { type: "暑期实习", open: "约3-6月", close: "招满即止", note: "以暑期/日常实习转正为主要入口" },
    { type: "日常实习", open: "全年滚动", close: "招满即止", note: "投资岗滚动招募，随项目需要" }
  ],
  "基金/资管/PE·VC|产业/国资基金": [
    { type: "暑期实习", open: "约4-6月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],
  "基金/资管/PE·VC|保险资管": [
    { type: "暑期实习", open: "约4-6月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],

  // 银行/保险/信托
  "银行/保险/信托|政策性银行": [
    { type: "秋招", open: "约9-10月", close: "招满即止", note: "2027届农发行 9/15 前后已开启网申（公开汇总口径）" },
    { type: "寒假实习", open: "约11-12月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],
  "银行/保险/信托|股份行": [
    { type: "秋招", open: "约9-10月", close: "约10月中下旬截止", note: "2027届 9 月中旬开启网申、10 月下旬集中截止，笔试 10 月下旬至 11 月上旬" },
    { type: "寒假实习", open: "约11-12月", close: "招满即止", note: "以分行/子公司为主" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],
  "银行/保险/信托|城商行": [
    { type: "秋招", open: "约9-10月", close: "招满即止", note: "2027届多数城商行 9 月中旬开启网申（公开汇总口径）" },
    { type: "寒假实习", open: "约11-12月", close: "招满即止" }
  ],
  "银行/保险/信托|民营银行": [
    { type: "秋招", open: "约9-11月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],
  "银行/保险/信托|保险集团": [
    { type: "秋招", open: "约9-11月", close: "招满即止", note: "2027届部分保险机构 9 月中旬已开启网申" },
    { type: "寒假实习", open: "约11-12月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],
  "银行/保险/信托|外资保险": [
    { type: "秋招", open: "约9-11月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],
  "银行/保险/信托|寿险公司": [
    { type: "秋招", open: "约9-11月", close: "招满即止" },
    { type: "寒假实习", open: "约11-12月", close: "招满即止" }
  ],
  "银行/保险/信托|财险公司": [
    { type: "秋招", open: "约9-11月", close: "招满即止" },
    { type: "寒假实习", open: "约11-12月", close: "招满即止" }
  ],
  "银行/保险/信托|信托公司": [
    { type: "暑期实习", open: "约4-6月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],
  "银行/保险/信托|金融租赁": [
    { type: "寒假实习", open: "约11-12月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],

  // 四大/咨询
  "四大/咨询|四大": [
    { type: "寒假实习", open: "约10-11月", close: "约11月底截止", note: "官网口径：寒假实习招聘周期一般在 10-11 月，实习期 2-4 个月" },
    { type: "暑期实习", open: "约3-4月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],
  "四大/咨询|一线咨询": [
    { type: "暑期实习", open: "约9-11月", close: "招满即止", note: "面向次年暑期，流程启动早" },
    { type: "PTA", open: "全年滚动", close: "招满即止", note: "项目制滚动招募，是进入咨询的常见切口" },
    { type: "寒假实习", open: "约10-12月", close: "招满即止", note: "正式寒假批数量少于暑期" }
  ],
  "四大/咨询|内资咨询": [
    { type: "日常实习", open: "全年滚动", close: "招满即止" },
    { type: "寒假实习", open: "约11-12月", close: "招满即止" }
  ],
  "四大/咨询|征信机构": [
    { type: "暑期实习", open: "约4-6月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],
  "四大/咨询|内资八大": [
    { type: "寒假实习", open: "约10-12月", close: "招满即止", note: "年审旺季前集中招募寒假实习" },
    { type: "秋招", open: "约9-10月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],

  // 大厂/金融科技
  "大厂/金融科技|互联网大厂": [
    { type: "暑期实习", open: "约3-5月", close: "招满即止", note: "提前批更早（部分大厂 3 月启动）" },
    { type: "秋招", open: "约8-10月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],
  "大厂/金融科技|科技硬件": [
    { type: "暑期实习", open: "约3-5月", close: "招满即止" },
    { type: "秋招", open: "约8-10月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],
  "大厂/金融科技|新能源车企": [
    { type: "暑期实习", open: "约3-5月", close: "招满即止" },
    { type: "秋招", open: "约8-10月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],
  "大厂/金融科技|企业软件": [
    { type: "暑期实习", open: "约4-6月", close: "招满即止" },
    { type: "秋招", open: "约9-10月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],
  "大厂/金融科技|金融科技": [
    { type: "暑期实习", open: "约4-6月", close: "招满即止" },
    { type: "秋招", open: "约9-10月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],
  "大厂/金融科技|财经媒体": [
    { type: "日常实习", open: "全年滚动", close: "招满即止", note: "以长期实习+转正为主" }
  ],

  // 央国企
  "央国企|*": [
    { type: "秋招", open: "约9-11月", close: "招满即止", note: "央企校招分批推进，部分持续到 12 月，个别走统一笔试" },
    { type: "寒假实习", open: "约11-12月", close: "招满即止", note: "部分单位设寒假实习/开放日" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ],
  "央国企|地方国企": [
    { type: "秋招", open: "约9-11月", close: "招满即止" },
    { type: "日常实习", open: "全年滚动", close: "招满即止" }
  ]
};

// 上市公司：行业间批次差别不大，统一预设
const LISTED_BATCHES = [
  { type: "秋招", open: "约9-11月", close: "招满即止", note: "以总部职能岗（财务/证券事务/投资）为主" },
  { type: "寒假实习", open: "约11-12月", close: "招满即止" },
  { type: "日常实习", open: "全年滚动", close: "招满即止" }
];

function batchesFor(cat, sub) {
  if (cat === "上市公司") return LISTED_BATCHES;
  return BATCHES[cat + "|" + sub] || BATCHES[cat + "|*"] || null;
}

const errors = [];
const seenId = new Set();
const out = [];

function readExistingNames() {
  const names = new Set();
  for (const f of fs.readdirSync(RAW_DIR)) {
    if (!f.endsWith(".json") || f === "more.json" || f === "channels.json" || f === "guides.json") continue;
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), "utf8"));
      if (Array.isArray(arr)) arr.forEach(c => c && c.name && names.add(c.name));
    } catch (e) { /* 忽略读不了的 */ }
  }
  return names;
}

function main() {
  const existing = readExistingNames();

  for (const f of SRC_FILES) {
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) { errors.push("缺少源文件 " + f); continue; }
    fs.readFileSync(p, "utf8").split(/\r?\n/).forEach(function (line, i) {
      const ln = i + 1;
      const s = line.trim();
      if (!s || s.charAt(0) === "#") return;
      const c = s.split("|").map(x => x.trim());
      if (c.length !== 8) { errors.push(f + ":" + ln + " 列数应为 8，实际 " + c.length); return; }
      const [id, name, cat, sub, city, biz, jobs, note] = c;
      if (!/^[a-z0-9_]+$/.test(id)) errors.push(f + ":" + ln + " id 只能用小写字母/数字/下划线：" + id);
      if (seenId.has(id)) errors.push(f + ":" + ln + " id 重复：" + id);
      seenId.add(id);
      if (CATS.indexOf(cat) < 0) errors.push(f + ":" + ln + " 未知主分类「" + cat + "」（只能是 " + CATS.join(" / ") + "）");
      for (const [k, v] of [["name", name], ["sub", sub], ["city", city], ["biz", biz], ["jobs", jobs]]) {
        if (!v) errors.push(f + ":" + ln + " 字段 " + k + " 不能为空（" + name + "）");
      }
      if (existing.has(name)) errors.push(f + ":" + ln + " 与已有公司重名（会被去重逻辑吞掉，请改名或删除）：" + name);
      const batches = batchesFor(cat, sub);
      if (!batches) errors.push(f + ":" + ln + " 没有匹配的批次预设：分类「" + cat + "」细分「" + sub + "」（请在 BATCHES 里补，或给 " + cat + "|* 兜底）");

      out.push({
        name: name,
        category: cat,
        subcategory: sub,
        cities: [city],
        batches: batches || [],
        biz: biz,
        jobs: jobs,
        note: note || "",
        referral: HIRE[cat] || "",
        // source 留空：由 js/app.js 的 EXTRA_SOURCE 统一兜底（逐条重复写会让密文白白大 60KB）
        source: "",
        // 备注里带了公开报道/日期口径的，可信度给「中」，其余「低」
        confidence: /网申|已开启|公开报道|口径|官网/.test(note || "") ? "中" : "低"
      });
    });
  }

  if (errors.length) {
    console.error("❌ 校验未通过（未写出文件）：");
    errors.slice(0, 40).forEach(e => console.error("   · " + e));
    if (errors.length > 40) console.error("   …… 另有 " + (errors.length - 40) + " 条");
    process.exit(1);
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 1), "utf-8");

  const byCat = {};
  out.forEach(o => { byCat[o.category] = (byCat[o.category] || 0) + 1; });
  console.log("已生成 " + path.relative(path.join(__dirname, ".."), OUT) + "：共 " + out.length + " 家");
  CATS.forEach(c => console.log("   " + c.padEnd(16) + (byCat[c] || 0)));
  console.log("✅ 完成，下一步：node tools/build-data.js && node tools/encrypt-data.js && node tools/check-data.js");
}

main();
