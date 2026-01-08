/**
 * 脚本名称：泉水签到 - 签到
 * 活动规则：每日签到获得积分奖励
 * 脚本说明：支持多账号，支持 NE / Node.js 环境。
 * 环境变量：QUANSHUI_TOKEN
 * 更新时间：2026-01-08 更新活动 Code

------------------ Surge 配置 ------------------

[MITM]
hostname = java-uapi.quanzhan888.com

[Script]
泉水签到获取Token = type=http-request,pattern=https:\/\/java-uapi\.quanzhan888\.com\/u\/user-center\/index,requires-body=1,max-size=0,binary-body-mode=0,timeout=30,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quanshui_sign.js,script-update-interval=0

泉水签到 = type=cron,cronexp="0 8 * * *",timeout=60,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quanshui_sign.js,script-update-interval=0

------------------- Loon 配置 -------------------

[MITM]
hostname = java-uapi.quanzhan888.com

[Script]
http-request https:\/\/java-uapi\.quanzhan888\.com\/u\/user-center\/index tag=泉水签到获取Token,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quanshui_sign.js,requires-body=1

cron "0 8 * * *" script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quanshui_sign.js,tag=泉水签到,enable=true

--------------- Quantumult X 配置 ---------------

[MITM]
hostname = java-uapi.quanzhan888.com

[rewrite_local]
https:\/\/java-uapi\.quanzhan888\.com\/u\/user-center\/index url script-request-header https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quanshui_sign.js

[task_local]
0 8 * * * https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quanshui_sign.js, tag=泉水签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/images/quanshui.png, enabled=true

------------------ Stash 配置 ------------------

cron:
  script:
    - name: 泉水签到
      cron: '0 8 * * *'
      timeout: 10

http:
  mitm:
    - "java-uapi.quanzhan888.com"
  script:
    - match: https:\/\/java-uapi\.quanzhan888\.com\/u\/user-center\/index
      name: 泉水签到获取Token
      type: request
      require-body: true

script-providers:
  泉水签到:
    url: https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quanshui_sign.js
    interval: 86400

 */

const $ = new Env('泉水签到');
$.is_debug = getEnv('is_debug') || 'false';  // 调试模式
$.userInfo = getEnv('QUANSHUI_TOKEN') || '';  // 获取账号
$.userArr = $.userInfo.split(/&|\n/).filter(t => t.trim());  // 用户信息
$.Messages = [];


// 主函数
async function main() {
  if ($.userArr.length) {
    $.log(`\n🌀 找到 ${$.userArr.length} 个 Token 变量`);

    // 遍历账号
    for (let i = 0; i < $.userArr.length; i++) {
      $.log(`\n----- 账号 [${i + 1}] 开始执行 -----\n`);

      // 初始化
      $.is_login = true;
      $.beforeMsgs = '';
      $.messages = [];
      $.token = $.userArr[i].trim();

      // 执行签到
      await doSign($.token);

      // 获取签到列表
      await getSignList($.token);

      // 获取用户信息
      await getUserInfo($.token);

      // 合并通知
      $.messages.splice(0, 0, $.beforeMsgs), $.Messages = $.Messages.concat($.messages);
    }
    $.log(`\n----- 所有账号执行完成 -----\n`);
  } else {
    throw new Error('未找到 QUANSHUI_TOKEN 变量 ❌');
  }
}

// 获取用户数据
function GetCookie() {
  try {
    let msg = '';
    debug($request.headers, "获取Header");
    
    // 从请求头中获取authorization
    const authHeader = $request.headers['authorization'] || $request.headers['Authorization'];
    
    if (authHeader) {
      // 使用 find() 方法找到与 authorization 匹配的 token，以新增/更新用户 token
      const tokenList = $.userInfo.split(/&|\n/).filter(t => t.trim());
      const tokenExists = tokenList.some(token => token.trim() === authHeader.trim());
      
      if (!tokenExists) {
        msg += `🆕 新增用户 Token: ${authHeader}`;
        tokenList.push(authHeader);
        // 写入数据持久化
        $.setdata(tokenList.join('&'), 'QUANSHUI_TOKEN');
      } else {
        msg += `✅ Token 已存在: ${authHeader}`;
      }
      
      $.Messages.push(msg), $.log(msg);
    } else {
      $.log("❌ 未找到 authorization header");
    }
  } catch (e) {
    $.log("❌ Token获取失败"), $.log(e);
  }
}

// 执行签到
async function doSign(token) {
  let msg = '';
  try {
    // 获取当前日期 YYYY-MM-DD 格式
    const today = new Date();
    const signDate = today.toISOString().split('T')[0];

    // 构造请求
    const options = {
      url: `https://java-uapi.quanzhan888.com/u/user-sign/do-sign?signDate=${signDate}`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12; M2007J22C Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.7444.173 Mobile Safari/537.36 XWEB/1420125 MMWEBSDK/20251006 MMWEBID/6699 MicroMessenger/8.0.66.2980(0x28004252) WeChat/arm64 Weixin NetType/4G Language/zh_CN ABI/arm64 MiniProgramEnv/android',
        'Content-Type': 'application/json',
        'version': '2.0.10',
        'charset': 'utf-8',
        'referer': 'https://servicewechat.com/wxcee27346cf362ba6/191/page-frame.html',
        'authorization': token
      }
    }

    // 发起请求
    const result = await Request(options);
    if (result?.code === 200 || result?.code === 0) {
      msg += `签到: ✅ ${result?.msg || result?.message || '签到成功'}`;
    } else if (result?.msg?.includes('已签到') || result?.message?.includes('已签到')) {
      msg += `签到: 📝 今日已签到`;
    } else {
      msg += `签到: ❌ ${result?.msg || result?.message || '签到失败'}`;
    }
  } catch (e) {
    msg += `签到: ❌ ${e.message}`;
    $.log(`❌ 签到失败: ${e.message}`);
  }
  $.messages.push(msg), $.log(msg);
}

// 获取签到列表
async function getSignList(token) {
  try {
    // 构造请求
    const options = {
      url: `https://java-uapi.quanzhan888.com/u/user-sign/list`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12; M2007J22C Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.7444.173 Mobile Safari/537.36 XWEB/1420125 MMWEBSDK/20251006 MMWEBID/6699 MicroMessenger/8.0.66.2980(0x28004252) WeChat/arm64 Weixin NetType/4G Language/zh_CN ABI/arm64 MiniProgramEnv/android',
        'Content-Type': 'application/json',
        'version': '2.0.10',
        'charset': 'utf-8',
        'referer': 'https://servicewechat.com/wxcee27346cf362ba6/191/page-frame.html',
        'authorization': token
      }
    }

    // 发起请求
    const result = await Request(options);
    if (result?.code === 200 || result?.code === 0) {
      if (result.data && result.data.sign_list && result.data.sign_list.length > 0) {
        // 获取今日签到奖励
        const todaySign = result.data.sign_list.find(s => s.day === new Date().getDate());
        if (todaySign && todaySign.prizeMoney !== undefined) {
          $.beforeMsgs = `\n今日奖励: ${todaySign.prizeMoney}元`;
        }
      }
    } else {
      $.log(`❌ 获取签到列表失败: ${$.toStr(result)}`);
    }
  } catch (e) {
    $.log(`❌ 获取签到列表失败: ${e.message}`);
  }
}

// 获取用户信息
async function getUserInfo(token) {
  try {
    // 构造请求
    const options = {
      url: `https://java-uapi.quanzhan888.com/u/user-center/index`,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12; M2007J22C Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.7444.173 Mobile Safari/537.36 XWEB/1420125 MMWEBSDK/20251006 MMWEBID/6699 MicroMessenger/8.0.66.2980(0x28004252) WeChat/arm64 Weixin NetType/4G Language/zh_CN ABI/arm64 MiniProgramEnv/android',
        'Content-Type': 'application/json',
        'version': '2.0.10',
        'charset': 'utf-8',
        'referer': 'https://servicewechat.com/wxcee27346cf362ba6/191/page-frame.html',
        'authorization': token
      }
    }

    // 发起请求
    const result = await Request(options);
    if (result?.code === 200 || result?.code === 0) {
      if (result.data) {
        const { total_balance, sign_total_prize, sign_month_num, points_num, coupon_num } = result.data;
        
        if ($.beforeMsgs) {
          $.beforeMsgs += '\n';
        } else {
          $.beforeMsgs = '';
        }
        
        $.beforeMsgs += `账户余额: ${total_balance || 0}元\n`;
        $.beforeMsgs += `签到累计: ${sign_total_prize || 0}元\n`;
        $.beforeMsgs += `本月签到: ${sign_month_num || 0}天\n`;
        
        if (points_num && points_num > 0) {
          $.beforeMsgs += `积分: ${points_num}\n`;
        }
        if (coupon_num && coupon_num > 0) {
          $.beforeMsgs += `优惠券: ${coupon_num}张\n`;
        }
      }
    } else {
      $.log(`❌ 查询用户信息失败: ${$.toStr(result)}`);
    }
  } catch (e) {
    $.log(`❌ 查询用户信息失败: ${e.message}`);
  }
}


// 脚本执行入口
!(async () => {
  if (typeof $request !== `undefined`) {
    GetCookie();
  } else {
    await main();  // 主函数
  }
})()
  .catch((e) => $.Messages.push(e.message || e) && $.logErr(e))
  .finally(async () => {
    await sendMsg($.Messages.join('\n').trimStart().trimEnd());  // 推送通知
    $.done();
  })


// 请求函数二次封装
async function Request(options) {
  try {
    options = options.url ? options : { url: options };
    const _method = options?._method || ('body' in options ? 'post' : 'get');
    const _respType = options?._respType || 'body';
    const _timeout = options?._timeout || 15000;
    const _http = [
      new Promise((_, reject) => setTimeout(() => reject(`❌ 请求超时： ${options['url']}`), _timeout)),
      new Promise((resolve, reject) => {
        debug(options, '[Request]');
        $[_method.toLowerCase()](options, (error, response, data) => {
          debug(response, '[response]');
          error && $.log($.toStr(error));
          if (_respType !== 'all') {
            resolve($.toObj(response?.[_respType], response?.[_respType]));
          } else {
            resolve(response);
          }
        })
      })
    ];
    return await Promise.race(_http);
  } catch (err) {
    $.logErr(err);
  }
}


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
    $.log(`\n\n----- ${$.name} -----\n${message}`);
  }
}


// 获取环境变量
function getEnv(...keys) {
  for (let key of keys) {
    var value = $.isNode() ? process.env[key] || process.env[key.toUpperCase()] || process.env[key.toLowerCase()] || $.getdata(key) : $.getdata(key);
    if (value) return value;
  }
}


/**
 * DEBUG
 * @param {*} content - 传入内容
 * @param {*} title - 标题
 */
function debug(content, title = "debug") {
  let start = `\n----- ${title} -----\n`;
  let end = `\n----- ${$.time('HH:mm:ss')} -----\n`;
  if ($.is_debug === 'true') {
    if (typeof content == "string") {
      $.log(start + content + end);
    } else if (typeof content == "object") {
      $.log(start + $.toStr(content) + end);
    }
  }
}

// prettier-ignore
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise((e, o) => { s.call(this, t, (t, s, r) => { t ? o(t) : e(s) }) }) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.logLevels = { debug: 0, info: 1, warn: 2, error: 3 }, this.logLevelPrefixs = { debug: "[DEBUG] ", info: "[INFO] ", warn: "[WARN] ", error: "[ERROR] " }, this.logLevel = "info", this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null, ...s) { try { return JSON.stringify(t, ...s) } catch { return e } } getjson(t, e) { let s = e; const o = this.getdata(t); if (o) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise(e => { this.get({ url: t }, (t, s, o) => e(o)) }) } runScript(t, e) { return new Promise(s => { let o = this.getdata("@chavy_boxjs_userCfgs.httpapi"); o = o ? o.replace(/\n/g, "").trim() : o; let r = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); r = r ? 1 * r : 20, r = e && e.timeout ? e.timeout : r; const [i, a] = o.split("@"), n = { url: `http://${a}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: r }, headers: { "X-Key": i, Accept: "*/*" }, timeout: r }; this.post(n, (t, e, o) => s(o)) }).catch(t => this.logErr(t)) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), o = !s && this.fs.existsSync(e); if (!s && !o) return {}; { const o = s ? t : e; try { return JSON.parse(this.fs.readFileSync(o)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), o = !s && this.fs.existsSync(e), r = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, r) : o ? this.fs.writeFileSync(e, r) : this.fs.writeFileSync(t, r) } } lodash_get(t, e, s) { const o = e.replace(/\[(\d+)\]/g, ".$1").split("."); let r = t; for (const t of o) if (r = Object(r)[t], void 0 === r) return s; return r } lodash_set(t, e, s) { return Object(t) !== t ? t : (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce((t, s, o) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[o + 1]) >> 0 == +e[o + 1] ? [] : {}, t)[e[e.length - 1]] = s, t) } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, o] = /^@(.*?)\.(.*?)$/.exec(t), r = s ? this.getval(s) : ""; if (r) try { const t = JSON.parse(r); e = t ? this.lodash_get(t, o, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, o, r] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(o), a = o ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(a); this.lodash_set(e, r, t), s = this.setval(JSON.stringify(e), o) } catch (e) { const i = {}; this.lodash_set(i, r, t), s = this.setval(JSON.stringify(i), o) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, (t, s, o) => { !t && s && (s.body = o, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, o) }); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then(t => { const { statusCode: s, statusCode: o, headers: r, body: i, bodyBytes: a } = t; e(null, { status: s, statusCode: o, headers: r, body: i, bodyBytes: a }, i, a) }, t => e(t && t.error || "UndefinedError")); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", (t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } }).then(t => { const { statusCode: o, statusCode: r, headers: i, rawBody: a } = t, n = s.decode(a, this.encoding); e(null, { status: o, statusCode: r, headers: i, rawBody: a, body: n }, n) }, t => { const { message: o, response: r } = t; e(o, r, r && s.decode(r.rawBody, this.encoding)) }) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, (t, s, o) => { !t && s && (s.body = o, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, o) }); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then(t => { const { statusCode: s, statusCode: o, headers: r, body: i, bodyBytes: a } = t; e(null, { status: s, statusCode: o, headers: r, body: i, bodyBytes: a }, i, a) }, t => e(t && t.error || "UndefinedError")); break; case "Node.js": let o = require("iconv-lite"); this.initGotEnv(t); const { url: r, ...i } = t; this.got[s](r, i).then(t => { const { statusCode: s, statusCode: r, headers: i, rawBody: a } = t, n = o.decode(a, this.encoding); e(null, { status: s, statusCode: r, headers: i, rawBody: a, body: n }, n) }, t => { const { message: s, response: r } = t; e(s, r, r && o.decode(r.rawBody, this.encoding)) }) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let o = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in o) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? o[e] : ("00" + o[e]).substr(("" + o[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let o = t[s]; null != o && "" !== o && ("object" == typeof o && (o = JSON.stringify(o)), e += `${s}=${o}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", o = "", r) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: { let e = t.url || t.openUrl || t["open-url"]; return { url: e } } case "Loon": { let e = t.openUrl || t.url || t["open-url"], s = t.mediaUrl || t["media-url"]; return { openUrl: e, mediaUrl: s } } case "Quantumult X": { let e = t["open-url"] || t.url || t.openUrl, s = t["media-url"] || t.mediaUrl, o = t["update-pasteboard"] || t.updatePasteboard; return { "open-url": e, "media-url": s, "update-pasteboard": o } } case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, o, i(r)); break; case "Quantumult X": $notify(e, s, o, i(r)); break; case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), o && t.push(o), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } debug(...t) { this.logLevels[this.logLevel] <= this.logLevels.debug && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.debug}${t.join(this.logSeparator)}`)) } info(...t) { this.logLevels[this.logLevel] <= this.logLevels.info && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.info}${t.join(this.logSeparator)}`)) } warn(...t) { this.logLevels[this.logLevel] <= this.logLevels.warn && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.warn}${t.join(this.logSeparator)}`)) } error(...t) { this.logLevels[this.logLevel] <= this.logLevels.error && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.error}${t.join(this.logSeparator)}`)) } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, e, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, e, void 0 !== t.message ? t.message : t, t.stack) } } wait(t) { return new Promise(e => setTimeout(e, t)) } done(t = {}) { const e = (new Date).getTime(), s = (e - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${s} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }
