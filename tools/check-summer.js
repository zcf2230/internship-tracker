#!/usr/bin/env node
/* 校验暑期批：数量、解析出的时间窗口是否落在 2027 暑期申请季内、以及新补的 8 家是否生效。
 * 用法：node tools/check-summer.js
 */
const fs = require("fs");
const path = require("path");

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "data.json"), "utf8"));

/* 与 js/app.js 同一套解析规则的独立实现，用来验证数据本身能被正确解析。 */
const DAY_OF = { "上旬": 6, "中旬": 15, "下旬": 24, "初": 3, "中": 15, "底": 27, "末": 27 };
function parseOne(str, type) {
  if (!str) return null;
  const s = String(str).replace(/约|左右|2026年|2027年|每年|前后/g, "").trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  const m = s.match(/(\d{1,2})\s*月(?:\s*(上旬|中旬|下旬|初|中|底|末)|\s*(\d{1,2})\s*日)?/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = m[2] ? DAY_OF[m[2]] : (m[3] ? parseInt(m[3], 10) : 10);
  const year = month >= 9 ? 2026 : 2027;
  return new Date(year, month - 1, day || 15);
}
function parseWindow(openStr, closeStr, type) {
  if (/全年|滚动|长期|随时|常年在招/.test(String(openStr || ""))) return { rolling: true };
  let open = parseOne(openStr, type);
  if (!open) return null;
  let close = parseOne(closeStr, type);
  if (!close && openStr) {
    const parts = String(openStr).split(/[-—–~至]|到/);
    if (parts.length === 2) {
      let left = parts[0], right = parts[1];
      if (!/月/.test(left) && /月/.test(right)) left += "月";
      const ro = parseOne(left, type), rc = parseOne(right, type);
      if (ro && rc) { open = ro; close = rc; }
    }
  }
  if (close && close < open) close = new Date(close.getFullYear() + 1, close.getMonth(), close.getDate());
  const untilFilled = !close && /招满即止|额满即止|岗位满即止/.test(String(closeStr || ""));
  return { open, close: close || null, untilFilled };
}
const fmt = (d) => d ? d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") : "—";

const summer = DATA.companies.filter((c) => (c.batches || []).some((b) => /暑期/.test(String(b.type || ""))));
console.log("已收录暑期批机构:", summer.length, "/", DATA.companies.length,
  "（覆盖率", Math.round(summer.length / DATA.companies.length * 100) + "%）");

const WATCH = ["毕马威", "招商银行", "平安证券", "瑞银证券（UBS）", "阿里巴巴", "腾讯", "字节跳动", "美团", "中国银河证券"];
let bad = 0;
console.log("\n新补/改动的条目解析结果：");
for (const name of WATCH) {
  const c = DATA.companies.find((x) => x.name === name);
  if (!c) { console.log("  !! 找不到公司:", name); bad++; continue; }
  const b = c.batches.find((x) => /暑期/.test(String(x.type || "")));
  if (!b) { console.log("  !!", name, "没有暑期批"); bad++; continue; }
  const w = parseWindow(b.open, b.close, b.type);
  if (!w || !w.open) { console.log("  !!", name, "无法解析:", b.open, "~", b.close); bad++; continue; }
  const ok = w.open >= new Date(2026, 7, 1) && w.open <= new Date(2027, 7, 31);
  if (!ok) { console.log("  !!", name, "窗口落在暑假时间轴之外:", fmt(w.open)); bad++; }
  console.log("  ", (ok ? "OK " : "   "), name.padEnd(14, " "),
    JSON.stringify(b.open), "~", JSON.stringify(b.close), "->", fmt(w.open), "→", fmt(w.close));
}

/* 全量暑期批的窗口分布，用来确认时间轴不会挤在某一个月 */
const buckets = {};
summer.forEach((c) => {
  const b = c.batches.find((x) => /暑期/.test(String(x.type || "")));
  const w = parseWindow(b.open, b.close, b.type);
  const k = w && w.open ? w.open.getFullYear() + "-" + String(w.open.getMonth() + 1).padStart(2, "0") : "无法解析";
  buckets[k] = (buckets[k] || 0) + 1;
});
console.log("\n暑期批开放月份分布：");
Object.keys(buckets).sort().forEach((k) => console.log("  ", k, buckets[k], "家"));

console.log("---");
if (bad) { console.log("❌ 有", bad, "处问题"); process.exitCode = 1; }
else console.log("✅ 暑期批校验通过");
