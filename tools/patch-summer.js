#!/usr/bin/env node
/* 给已核实的机构补「暑期实习」批次（面向 2027 年暑期）。
 * 只写有公开依据的条目：每条 note 里都带上了来源与年份，方便日后复核。
 * 用法：node tools/patch-summer.js
 */
const fs = require("fs");
const path = require("path");

const RAW = path.join(__dirname, "raw");

/* file -> name -> batch。按公司名匹配，避免 raw 数组顺序变化时错位。 */
const EDITS = {
  "big4.json": {
    "毕马威": {
      add: {
        type: "暑期实习", open: "3月下旬", close: "4月30日",
        note: "官网「实习生项目」已列出2027暑期实习（实习期2027年7-9月），投递通道预计2027年春季开放；面向本科/硕士在读"
      }
    },
    "德勤": {
      add: {
        type: "暑期实习", open: "约2-3月", close: "招满即止",
        note: "官网实习生计划原话：「冬季招聘已开启；暑假招聘二至三月开展」，实习期2至4个月，面向1-2年内毕业的学生；入口 wecruit.hotjob.cn"
      }
    }
  },
  "banks.json": {
    "招商银行": {
      add: {
        type: "暑期实习", open: "3月下旬", close: "4月24日",
        note: "总行「梦工场」暑期实习生：上一轮2026-03-27启动、4月中下旬截止、6月下旬报到、8月下旬结业答辩；面向全体在校生，下一轮预计2027年春季"
      }
    }
  },
  "brokers.json": {
    "平安证券": {
      add: {
        type: "暑期实习", open: "约4-5月", close: "招满即止",
        note: "2026年5月曾发布面向2027届硕士的暑期实习简章（研究所/投行/IT）；下一轮预计2027年春季，以官网为准"
      }
    }
  },
  "brokers2.json": {
    "瑞银证券（UBS）": {
      note: "2027 Summer Internship（Global Markets / Global Banking 上海）已于2026年秋季在招聘官网挂出，外资暑期批在前一年秋季开放"
    }
  },
  "dachang.json": {
    "阿里巴巴": {
      add: {
        type: "暑期实习", open: "约3-4月", close: "招满即止",
        note: "实习生招聘每年3月前后启动（2026-03-18官宣2027届实习生招聘全球启动，工作地含杭州/北京/上海），暑期到岗走该批次"
      }
    },
    "腾讯": {
      add: {
        type: "暑期实习", open: "约3月", close: "招满即止",
        note: "2026-03-06官宣启动实习生招聘、提供超一万实习机会（面向2026年9月-2027年12月毕业人群）；暑期到岗走该批次"
      }
    },
    "字节跳动": {
      add: {
        type: "暑期实习", open: "约3月", close: "招满即止",
        note: "2026年3月与腾讯同期启动大规模实习生招聘，面向2027届毕业生；暑期实习走同一入口，以校招官网为准"
      }
    },
    "美团": {
      add: {
        type: "暑期实习", open: "约3-4月", close: "招满即止",
        note: "官网校招行程设实习生批次（往年约3-4月启动），毕业时间在2027年12月后的同学走实习岗"
      }
    }
  }
};

let added = 0, updated = 0, missing = [];
for (const [file, byName] of Object.entries(EDITS)) {
  const p = path.join(RAW, file);
  const arr = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const [name, edit] of Object.entries(byName)) {
    const c = arr.find((x) => x && x.name === name);
    if (!c) { missing.push(file + " :: " + name); continue; }
    c.batches = c.batches || [];
    if (edit.add) {
      const exist = c.batches.find((b) => b && /暑期/.test(String(b.type || "")));
      if (exist) {
        Object.assign(exist, edit.add);
        console.log("覆盖已有暑期批:", name);
        updated++;
      } else {
        // 暑期批放在最前面，暑假模式下卡片第一行就是它
        c.batches.unshift(edit.add);
        console.log("新增暑期批:", name, "->", edit.add.open, "~", edit.add.close);
        added++;
      }
    }
    if (edit.note) {
      const t = c.batches.find((b) => b && /暑期/.test(String(b.type || "")));
      if (!t) { missing.push(file + " :: " + name + " (无暑期批)"); continue; }
      t.note = edit.note;
      console.log("补充暑期批备注:", name);
      updated++;
    }
  }
  fs.writeFileSync(p, JSON.stringify(arr, null, 2) + "\n", "utf8");
}

console.log("---");
console.log("新增", added, "条，更新", updated, "条");
if (missing.length) {
  console.log("!! 未匹配到公司:", missing.join(" | "));
  process.exitCode = 1;
}
