#!/usr/bin/env node
/* 把 tools/raw/*.json 合并成 js/data.js
 * raw 文件：dachang.json / channels.json / banks.json / funds.json / brokers.json / big4.json
 * 用法：node tools/build-data.js
 */
const fs = require("fs");
const path = require("path");

const RAW = path.join(__dirname, "raw");
const OUT = path.join(__dirname, "..", "js", "data.js");

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
      referral: c.referral || "",
      source: c.source || "",
      confidence: ["高", "中", "低"].includes(c.confidence) ? c.confidence : "低"
    };
  });
}

const files = ["brokers.json", "funds.json", "banks.json", "big4.json", "dachang.json"];
let companies = [];
for (const f of files) companies = companies.concat(companiesFrom(f));

let channels = {}, guides = [];
const chFile = path.join(RAW, "channels.json");
if (fs.existsSync(chFile)) {
  const ch = JSON.parse(fs.readFileSync(chFile, "utf8"));
  channels = ch.channels || ch || {};
  guides = ch.guides || [];
}

const data = { updatedAt: "2026-09-26", companies, channels, guides };
const js = "/* 本文件由 tools/build-data.js 生成，编辑请改 tools/raw/ 下源文件后重新生成 */\nwindow.DATA = " + JSON.stringify(data, null, 1) + ";\n";
fs.writeFileSync(OUT, js, "utf8");
console.log(`OK: ${companies.length} 家公司，${guides.length} 篇攻略，渠道 ${(channels.official || []).length + (channels.platforms || []).length + (channels.referral || []).length} 条 -> ${OUT}`);
