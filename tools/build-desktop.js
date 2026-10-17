#!/usr/bin/env node
/* 把站点文件同步到桌面壳（desktop/app/），可选执行 electron-builder 打包。
 *
 * 用法：
 *   node tools/build-desktop.js            # 仅同步站点文件
 *   node tools/build-desktop.js --build    # 同步后打包（nsis 安装包 + portable 免安装 exe）
 *
 * 打包用的是「金融考研择校通」工程里的 electron + electron-builder（见 KAOYAN 常量），
 * 避免在本仓库装第二套 node_modules。
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DEST = path.join(ROOT, "desktop", "app");
// 「金融考研择校通」的 node_modules（electron 33 + electron-builder 25 都在里面）
const KAOYAN = path.join(ROOT, "..", "jinrong-kaoyan");

const FILES = [
  ["index.html", "index.html"],
  ["css/style.css", "css/style.css"],
  ["js/app.js", "js/app.js"],
  ["js/data.enc.js", "js/data.enc.js"],
  ["js/link-status.json", "js/link-status.json"]
];

function sync() {
  let n = 0;
  FILES.forEach(([src, dest]) => {
    const from = path.join(ROOT, src), to = path.join(DEST, dest);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    n++;
  });
  console.log("已同步 " + n + " 个站点文件 → desktop/app/");
}

function build() {
  const builder = path.join(KAOYAN, "node_modules", "electron-builder", "cli.js");
  if (!fs.existsSync(builder)) {
    console.error("找不到 electron-builder：" + builder);
    process.exit(1);
  }
  console.log("开始打包（nsis + portable），需要几分钟…");
  const child = spawn(process.execPath, [builder, "--win", "nsis", "portable"], {
    cwd: path.join(ROOT, "desktop"), stdio: "inherit"
  });
  child.on("close", (code) => {
    console.log(code === 0 ? "打包完成 → desktop/dist/" : "打包失败，退出码 " + code);
    process.exit(code);
  });
}

sync();
if (process.argv.indexOf("--build") >= 0) build();
