/**
 * 脚本名称：经典农场获取code
 * 功能说明：根据platform参数识别QQ/微信，按批次收敛后仅通知最后一个code
 * 使用方法：
 *  - 拦截请求URL:
 *    https://gate-obt.nqf.qq.com/prod/ws?platform=qq&os=iOS&ver=1.6.1.16_20251224&code=xxxx&openID=
 *  - 直接捕获并通知最终收敛后的code
 *
 * Surge 配置：
 * [MITM]
 * hostname = gate-obt.nqf.qq.com
 * [Script]
 * 经典农场获取code = type=http-request,pattern=^https?:\/\/gate-obt\.nqf\.qq\.com\/prod\/ws\?,requires-body=0,max-size=0,timeout=30,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/get_farm_code.js,script-update-interval=0
 *
 * Loon 配置：
 * [MITM]
 * hostname = gate-obt.nqf.qq.com
 * [Script]
 * http-request ^https?:\/\/gate-obt\.nqf\.qq\.com\/prod\/ws\? tag=经典农场获取code,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/get_farm_code.js,requires-body=0
 *
 * Quantumult X 配置：
 * [mitm]
 * hostname = gate-obt.nqf.qq.com
 * [rewrite_local]
 * ^https?:\/\/gate-obt\.nqf\.qq\.com\/prod\/ws\? url script-request-header https://raw.githubusercontent.com/jy0703/scripts/main/scripts/get_farm_code.js
 */

const $ = new Env('QQ经典农场获取code');
const NOTIFY_DEBOUNCE_MS = 3000;
const QQ_BATCH_WINDOW_MS = 5000;
const WX_BATCH_WINDOW_MS = 8000;
const NOTIFY_POLL_INTERVAL_MS = 500;
$.Messages = [];

// 解析URL参数
function parseParam(url, key) {
  const re = new RegExp(`[?&]${key}=([^&#]*)`, 'i');
  const match = url.match(re);
  if (!match) return '';
  return safeDecode(match[1]);
}

// 安全解码
function safeDecode(value) {
  if (typeof value !== 'string') return '';
  try {
    return decodeURIComponent(value.replace(/\+/g, '%20'));
  } catch {
    return value;
  }
}

function getBatchWindowMs(isWechat) {
  return isWechat ? WX_BATCH_WINDOW_MS : QQ_BATCH_WINDOW_MS;
}

async function waitForSettledBatch(temp$, reqId, latestReqKey, batchDeadlineKey) {
  while (true) {
    const latestReqId = temp$.getdata(latestReqKey);
    if (latestReqId !== reqId) {
      return false;
    }

    const batchDeadline = Number(temp$.getdata(batchDeadlineKey) || 0);
    const remainingMs = batchDeadline - Date.now();
    if (remainingMs <= 0) {
      return true;
    }

    await temp$.wait(Math.min(remainingMs, NOTIFY_POLL_INTERVAL_MS));
  }
}

// 捕获code
async function captureCodeFromRequest() {
  const url = ($request && $request.url) || '';
  if (!url) throw new Error('Request url is empty');

  const code = parseParam(url, 'code');
  if (!code) throw new Error('No `code` found in request url');

  const platform = parseParam(url, 'platform');
  const isQQ = platform === 'qq';
  const isWechat = platform === 'wx';
  const platformName = isQQ ? 'QQ' : isWechat ? '微信' : '未知平台';
  const envName = `${platformName}经典农场获取code`;
  const temp$ = new Env(envName);
  const batchWindowMs = getBatchWindowMs(isWechat);
  const LATEST_CODE_KEY = 'farm_latest_code';
  const LATEST_REQ_KEY = 'farm_latest_req';
  const LATEST_TIMESTAMP_KEY = 'farm_latest_timestamp';
  const LATEST_PLATFORM_KEY = 'farm_latest_platform';
  const BATCH_FIRST_TIMESTAMP_KEY = 'farm_batch_first_timestamp';
  const BATCH_DEADLINE_KEY = 'farm_batch_deadline';

  // 生成唯一请求ID和时间戳
  const reqId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = Date.now();
  const previousBatchDeadline = Number(temp$.getdata(BATCH_DEADLINE_KEY) || 0);
  const previousBatchFirstTimestamp = Number(temp$.getdata(BATCH_FIRST_TIMESTAMP_KEY) || 0);
  const batchFirstTimestamp =
    previousBatchDeadline && previousBatchFirstTimestamp && timestamp <= previousBatchDeadline
      ? previousBatchFirstTimestamp
      : timestamp;
  const batchDeadline = Math.max(batchFirstTimestamp + batchWindowMs, timestamp + NOTIFY_DEBOUNCE_MS);
  

  // 存储当前批次的最新code、请求ID和时间戳
  temp$.setdata(code, LATEST_CODE_KEY);
  temp$.setdata(reqId, LATEST_REQ_KEY);
  temp$.setdata(timestamp.toString(), LATEST_TIMESTAMP_KEY);
  temp$.setdata(platformName, LATEST_PLATFORM_KEY);
  temp$.setdata(batchFirstTimestamp.toString(), BATCH_FIRST_TIMESTAMP_KEY);
  temp$.setdata(batchDeadline.toString(), BATCH_DEADLINE_KEY);
  temp$.log(`captured ${platformName} code: ${code}, reqId: ${reqId}, timestamp: ${timestamp}, batchDeadline: ${batchDeadline}`);

  // 等待当前批次真正收敛后，只由最后一条请求负责通知
  const isFinalRequest = await waitForSettledBatch(temp$, reqId, LATEST_REQ_KEY, BATCH_DEADLINE_KEY);

  if (!isFinalRequest) {
    temp$.log(`skip outdated ${platformName} code: ${code}, reqId: ${reqId}`);
    return;
  }

  // 再次获取最新的code，确保使用的是当前批次最后一次存储的
  const latestCode = temp$.getdata(LATEST_CODE_KEY) || code;
  const latestPlatformName = temp$.getdata(LATEST_PLATFORM_KEY) || platformName;
  
  // 清除之前的消息，只保留最新的
  $.Messages = [];
  $.Messages.push(`${latestPlatformName} code获取成功: ${latestCode}`);
}

// 脚本执行入口
!(async () => {
  if (typeof $request !== 'undefined') {
    await captureCodeFromRequest();
  } else {
    $.log('No request context. This script only works in http-request mode.');
    $.Messages.push('No request context. This script only works in http-request mode.');
  }
})()
  .catch((err) => {
    const msg = err && err.message ? err.message : String(err);
    $.log(`Error: ${msg}`);
    $.Messages.push(`Capture failed: ${msg}`);
  })
  .finally(async () => {
    if ($.Messages.length > 0) {
      await sendMsg($.Messages.join('\n'));
    }
    $.done({abort: true});
  });

// 发送消息
async function sendMsg(message) {
  if (!message) return;
  try {
    if ($.isNode()) {
      try {
        var notify = require('./sendNotify');
      } catch (e) {
        var notify = require('./utils/sendNotify');
      }
      await notify.sendNotify($.name, message);
    } else {
      $.msg($.name, '', message);
    }
  } catch (e) {
    $.log(`\n\n----- ${$.name} ------\n${message}`);
  }
}


// prettier-ignore
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }
