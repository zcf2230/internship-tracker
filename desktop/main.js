/* 金融实习网申通 · 桌面版外壳（Electron）
 *
 * 站点本身是「纯静态 + 前端解密」，桌面壳只做三件事：
 *   1. 用自定义 app:// 协议把站点文件当「安全源」提供 —— fetch()、crypto.subtle
 *      只有在安全源下才可用（解密和读取巡检结果都靠它们），file:// 做不到；
 *   2. 数据自动保鲜：启动后台对比线上密文（和网页版同一个地址），
 *      有新版就校验后缓存到用户目录并静默刷新页面，失败则继续用内置数据；
 *   3. 打包成双击即用的 Windows 应用（见 package.json 的 build 配置）。
 *
 * 安全边界与网页版一致：数据仍是密文，解锁口令只在你本机派生密钥；
 * 渲染进程 sandbox + contextIsolation，拿不到 Node 能力。
 */
const { app, BrowserWindow, Menu, protocol, net, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

const APP_ROOT = path.join(__dirname, 'app');
const LIVE_DATA = 'https://zcf2230.github.io/internship-tracker/js/data.enc.js';
const DATA_REL = path.join('js', 'data.enc.js');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/* 日志同时写文件：打包版是 GUI 子系统，从终端看不到 stdout，
 * 出问题时让用户把 %APPDATA%/金融实习网申通/desktop.log 发来即可定位 */
function log(...a) {
  const s = '[desktop] ' + a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  try { console.log(s); } catch (e) {}
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'desktop.log'), new Date().toISOString() + ' ' + s + '\n'); } catch (e) {}
}

// 列表类应用用不到 GPU 加速；禁掉可避开各类显卡/远程桌面环境下的渲染崩溃
app.disableHardwareAcceleration();

/* 免安装版（portable）默认把数据写进随机的临时目录，重启就丢——
 * 这里把数据目录固定到 exe 旁边的 Data\ 文件夹：
 * 收藏、投递进度、主题选择、数据保鲜缓存都跟着 exe 走，换电脑也不丢。 */
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  try {
    const dataDir = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'Data');
    fs.mkdirSync(dataDir, { recursive: true });
    app.setPath('userData', dataDir);
  } catch (e) {}
}

/* app:// 协议：把 app/ 目录映射成 https 风格的安全源 */
function makeHandler() {
  return (request) => {
    try {
      const u = new URL(request.url);
      let p = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
      p = path.normalize(p).replace(/^(\.\.[\/\\])+/, '');        // 防目录穿越
      let file = path.join(APP_ROOT, p);
      // 数据文件优先用「自动保鲜缓存」，没有再回退到打包内置的
      if (path.normalize(p) === path.normalize(DATA_REL)) {
        const cache = path.join(app.getPath('userData'), 'data-cache.enc.js');
        if (fs.existsSync(cache)) file = cache;
      }
      const body = fs.readFileSync(file);
      return new Response(body, {
        headers: { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' }
      });
    } catch (e) {
      log('app:// 取文件失败', request.url, String(e.message).slice(0, 80));
      return new Response('not found', { status: 404 });
    }
  };
}

function registerAppProtocol() {
  const handler = makeHandler();
  /* ⚠️ 协议处理器是按「会话（session）」注册的：protocol.handle 只覆盖默认会话，
   * 而窗口用的是 partition 'persist:itr'（为了持久化收藏/主题）——
   * 必须在**那个会话**上也注册，否则窗口加载 app:// 时找不到处理器，
   * Electron 会把它当外部链接丢给 Windows，弹「没有可打开此 app 链接的应用」。 */
  protocol.handle('app', handler);
  session.fromPartition('persist:itr').protocol.handle('app', handler);
}

/* 当前实际服务的密文文本（缓存优先，回退内置） */
function currentDataText() {
  const cache = path.join(app.getPath('userData'), 'data-cache.enc.js');
  try { if (fs.existsSync(cache)) return fs.readFileSync(cache, 'utf8'); } catch (e) {}
  return fs.readFileSync(path.join(APP_ROOT, DATA_REL), 'utf8');
}

/* 数据自动保鲜：下载线上密文 → 结构校验 → 原子写入缓存 → 静默刷新。
 * 校验失败（大小/结构不对）一律放弃，宁可继续用旧数据也不写坏缓存；
 * 离线或 GitHub 访问受限时静默跳过，不影响使用。 */
async function checkForDataUpdate(win) {
  try {
    const res = await net.fetch(LIVE_DATA, { cache: 'no-store' });
    if (!res.ok) return log('数据检查：线上返回', res.status, '，跳过');
    const txt = await res.text();
    if (txt.length < 100 * 1024 || txt.length > 3 * 1024 * 1024) return log('数据检查：体积异常，忽略');
    if (!/window\.ENC_DATA=\{v:2,zip:"gzip",salt:"[A-Za-z0-9+/=]+",iv:"[A-Za-z0-9+/=]+",ct:"[A-Za-z0-9+/=]+"\};?/
        .test(txt.trim())) return log('数据检查：结构异常，忽略');
    if (txt === currentDataText()) return log('数据检查：已是最新');
    const cache = path.join(app.getPath('userData'), 'data-cache.enc.js');
    const tmp = cache + '.tmp';
    fs.writeFileSync(tmp, txt, 'utf8');
    fs.renameSync(tmp, cache);                                   // 原子替换
    log('数据检查：发现新版，已缓存并刷新页面');
    if (win && !win.isDestroyed()) win.webContents.reload();
  } catch (e) {
    log('数据检查失败（离线或网络受限，继续用本地数据）：', String(e.message).slice(0, 80));
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 960, minHeight: 600,
    backgroundColor: '#faf8f5',
    autoHideMenuBar: true,
    title: '金融实习网申通',
    webPreferences: {
      partition: 'persist:itr',      // localStorage / sessionStorage 持久化（收藏、进度、主题选择）
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.webContents.on('did-fail-load', (e, code, desc, url) => log('加载失败', code, desc, url));
  win.webContents.on('render-process-gone', (e, d) => log('渲染进程退出', JSON.stringify(d).slice(0, 120)));
  /* 页面里「官网网申 ↗」「搜官方入口」都是 target=_blank 的 https 外链：
   * 统一交给系统默认浏览器开，不让应用里冒出第二个窗口；
   * 同时拦下所有离开 app:// 的导航（双保险，防止再出现把 app:// 交给系统的情况）。 */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('app://')) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  win.loadURL('app://bundle/index.html');
  win.webContents.on('did-finish-load', () => {
    log('页面加载完成');
    setTimeout(() => checkForDataUpdate(win), 4000);   // 避开首屏，后台静默检查
  });
  return win;
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

app.whenReady().then(() => {
  log('应用就绪，注册 app:// 协议，根目录 ' + APP_ROOT);
  registerAppProtocol();
  Menu.setApplicationMenu(null);
  createWindow();
  log('窗口已创建');
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
