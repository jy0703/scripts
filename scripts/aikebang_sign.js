/**
 * 脚本名称：艾克帮签到 - 签到
 * 活动规则：每日签到获得积分奖励
 * 脚本说明：支持多账号，支持 NE / Node.js 环境。
 * 环境变量：AIKEBANG_TOKEN
 * 更新时间：2026-01-09 更新活动 Code

------------------ Surge 配置 ------------------

[MITM]
hostname = api.ikbang.cn

[Script]
艾克帮签到获取Token = type=http-request,pattern=https:\/\/api\.ikbang\.cn\/v2\/iclick-new\/usercenter\/getUserDetails,requires-body=1,max-size=0,binary-body-mode=0,timeout=30,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aikebang_sign.js,script-update-interval=0

艾克帮签到 = type=cron,cronexp="0 8 * * *",timeout=60,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aikebang_sign.js,script-update-interval=0

------------------- Loon 配置 -------------------

[MITM]
hostname = api.ikbang.cn

[Script]
http-request https:\/\/api\.ikbang\.cn\/v2\/iclick-new\/usercenter\/getUserDetails tag=艾克帮签到获取Token,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aikebang_sign.js,requires-body=1

cron "0 8 * * *" script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aikebang_sign.js,tag=艾克帮签到,enable=true

--------------- Quantumult X 配置 ---------------

[MITM]
hostname = api.ikbang.cn

[rewrite_local]
https:\/\/api\.ikbang\.cn\/v2\/iclick-new\/usercenter\/getUserDetails url script-request-header https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aikebang_sign.js

[task_local]
0 8 * * * https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aikebang_sign.js, tag=艾克帮签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/images/aikebang.png, enabled=true

------------------ Stash 配置 ------------------

cron:
  script:
    - name: 艾克帮签到
      cron: '0 8 * * *'
      timeout: 10

http:
  mitm:
    - "api.ikbang.cn"
  script:
    - match: https:\/\/api\.ikbang\.cn\/v2\/iclick-new\/usercenter\/getUserDetails
      name: 艾克帮签到获取Token
      type: request
      require-body: true

script-providers:
  艾克帮签到:
    url: https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aikebang_sign.js
    interval: 86400

 */

const $ = new Env('艾克帮签到');
$.is_debug = getEnv('is_debug') || 'false';  // 调试模式
$.userInfo = getEnv('AIKEBANG_TOKEN') || '';  // 获取账号
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

            // 获取签到信息
            await getSignInfo($.token);

            // 获取用户信息
            await getUserInfo($.token);

            // 合并通知
            $.messages.splice(0, 0, $.beforeMsgs), $.Messages = $.Messages.concat($.messages);
        }
        $.log(`\n----- 所有账号执行完成 -----\n`);
    } else {
        throw new Error('未找到 AIKEBANG_TOKEN 变量 ❌');
    }
}

// 获取用户数据
function GetCookie() {
    try {
        let msg = '';
        debug($request.headers, "获取Header");
        
        // 从请求头中获取token
        const tokenHeader = $request.headers['token'];
        
        if (tokenHeader) {
            // 使用 find() 方法找到与 token 匹配的 token，以新增/更新用户 token
            const tokenList = $.userInfo.split(/&|\n/).filter(t => t.trim());
            const tokenExists = tokenList.some(token => token.trim() === tokenHeader.trim());
            
            if (!tokenExists) {
                msg += `🆕 新增用户 Token: ${tokenHeader}`;
                tokenList.push(tokenHeader);
                // 写入数据持久化
                $.setdata(tokenList.join('&'), 'AIKEBANG_TOKEN');
            } else {
                msg += `✅ Token 已存在: ${tokenHeader}`;
            }
            
            $.Messages.push(msg), $.log(msg);
        } else {
            $.log("❌ 未找到 token header");
        }
    } catch (e) {
        $.log("❌ Token获取失败"), $.log(e);
    }
}

// 执行签到
async function doSign(token) {
    let msg = '';
    try {
        // 构造请求
        const options = {
            url: `https://api.ikbang.cn/v2/iclick-new/signIn/sign`,
            headers: getHeaders('/iclick-new/signIn/sign', token)
        }

        // 发起请求
        const result = await Request(options, 'POST');
        if (result?.code === 1) {
            const reward = result?.result || 0;
            msg += `签到: ✅ 签到成功，获得 ${reward} 积分`;
        } else if (result?.description?.includes('已经签到')) {
            msg += `签到: 📝 今日已签到`;
        } else {
            msg += `签到: ❌ ${result?.description || '签到失败'}`;
        }
    } catch (e) {
        msg += `签到: ❌ ${e.message}`;
        $.log(`❌ 签到失败: ${e.message}`);
    }
    $.messages.push(msg), $.log(msg);
}

// 获取签到信息
async function getSignInfo(token) {
    try {
        // 构造请求
        const options = {
            url: `https://api.ikbang.cn/v2/iclick-new/signIn/getSignInInfo`,
            headers: getHeaders('/iclick-new/signIn/getSignInInfo', token)
        }

        // 发起请求
        const result = await Request(options);
        if (result?.code === 1) {
            const signData = result?.result || {};
            const totalDay = signData?.totalSignInDay || 0;
            const totalScore = signData?.totalSignInScore || 0;
            const continuityDay = signData?.continuityDay || 0;
            
            if ($.beforeMsgs) {
                $.beforeMsgs += '\n';
            } else {
                $.beforeMsgs = '';
            }
            
            $.beforeMsgs += `累计签到: ${totalDay}天\n`;
            $.beforeMsgs += `累计获得: ${totalScore}积分\n`;
            $.beforeMsgs += `连续签到: ${continuityDay}天\n`;
        } else {
            $.log(`❌ 获取签到信息失败: ${$.toStr(result)}`);
        }
    } catch (e) {
        $.log(`❌ 获取签到信息失败: ${e.message}`);
    }
}

// 获取用户信息
async function getUserInfo(token) {
    try {
        // 构造请求
        const options = {
            url: `https://api.ikbang.cn/v2/iclick-new/usercenter/getUserDetails`,
            headers: getHeaders('/iclick-new/usercenter/getUserDetails', token)
        }

        // 发起请求
        const result = await Request(options);
        if (result?.code === 1) {
            const userData = result?.result || {};
            const totalPoints = userData?.totalPoints || '0';
            const userLevel = userData?.userLevelName || '未知';
            const userName = userData?.userName || '未知用户';
            
            if ($.beforeMsgs) {
                $.beforeMsgs += '\n';
            }
            
            $.beforeMsgs += `用户名: ${userName}\n`;
            $.beforeMsgs += `用户等级: ${userLevel}\n`;
            $.beforeMsgs += `当前积分: ${totalPoints}\n`;
        } else {
            $.log(`❌ 查询用户信息失败: ${$.toStr(result)}`);
        }
    } catch (e) {
        $.log(`❌ 查询用户信息失败: ${e.message}`);
    }
}

// 生成请求头
function getHeaders(url, token, params = null) {
    const timestamp = Date.now().toString();
    const ua = generateRandomUA();
    const sign = generateSign(url, timestamp, token, params);
    
    return {
        'Host': 'api.ikbang.cn',
        'Connection': 'keep-alive',
        'content-type': 'application/json',
        'Accept-Encoding': 'gzip,compress,br,deflate',
        'Referer': 'https://servicewechat.com/wx342d760f674b013b/124/page-frame.html',
        'User-Agent': ua,
        'token': token,
        'timestamp': timestamp,
        'sign': sign
    };
}

// 生成随机UA
function generateRandomUA() {
    const iosVersions = ["15_0", "15_1", "15_2", "15_3", "15_4", "15_5", "15_6", "16_0", "16_1", "16_2", "16_3", "16_4", "16_5", "17_0", "17_1", "17_2", "17_3", "17_4", "18_0", "18_1", "18_2", "18_3", "18_4"];
    const wechatVersions = ["8.0.32", "8.0.33", "8.0.34", "8.0.35", "8.0.36", "8.0.37", "8.0.38", "8.0.40", "8.0.41", "8.0.42", "8.0.43", "8.0.44", "8.0.45", "8.0.47", "8.0.48", "8.0.49", "8.0.50", "8.0.52", "8.0.53", "8.0.54", "8.0.55", "8.0.60", "8.0.62", "8.0.64"];
    
    const iosVer = iosVersions[Math.floor(Math.random() * iosVersions.length)];
    const wechatVer = wechatVersions[Math.floor(Math.random() * wechatVersions.length)];
    const wechatHex = (parseInt(wechatVer.replace(/\./g, '')) << 12).toString(16).padStart(8, '0');
    
    return `Mozilla/5.0 (iPhone; CPU iPhone OS ${iosVer} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/${wechatVer}(0x${wechatHex}) NetType/WIFI Language/zh_CN`;
}

// 生成签名
function generateSign(url, timestamp, token, params = null) {
    const appKey = "A749380BBD5A4D93B55B4BE245A42988";
    const appUrl = "https://api.ikbang.cn/v2";
    
    let signStr = appUrl + url + timestamp;
    if (params) {
        signStr += JSON.stringify(params);
    }
    signStr += appKey;
    if (token) {
        signStr += token;
    }
    
    // 使用MD5加密
    return CryptoJS.MD5(signStr).toString();
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
async function Request(options, method = 'GET') {
    try {
        options = options.url ? options : { url: options };
        const _method = options?._method || (method || ('body' in options ? 'post' : 'get'));
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
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `\${s}=\${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️\${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️\${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔\${this.name}, 结束! 🕛 \${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } }(t, e) }

// 引入CryptoJS库（用于MD5加密）
// 修复CryptoJS初始化问题
var CryptoJS = CryptoJS || (function() {
    // 原有的CryptoJS实现
    var h = Math;
    var s = {};
    var f = {}
        , g = f.lib = {}
        , m = function () { }
        , r = g.Base = {
            extend: function (a) {
                m.prototype = this;
                var b = new m;
                a && b.mixIn(a);
                b.hasOwnProperty("init") || (b.init = function () { b.$super.init.apply(this, arguments) });
                b.init.prototype = b;
                b.$super = this;
                return b
            },
            create: function (a) {
                var b = this.extend();
                b.init.prototype = b;
                a && b.mixIn(a);
                return b
            },
            init: function () { },
            mixIn: function (a) {
                for (var b in a) a.hasOwnProperty(b) && (this[b] = a[b]);
                a.hasOwnProperty("toString") && (this.toString = a.toString)
            },
            clone: function () {
                return this.init.prototype.extend(this)
            }
        }
        , q = g.WordArray = r.extend({
            init: function (a, b) {
                a = this.words = a || [];
                this.sigBytes = b != s ? b : 4 * a.length
            },
            toString: function (a) {
                return (a || k).stringify(this)
            },
            concat: function (a) {
                var b = this.words
                    , c = a.words
                    , d = this.sigBytes;
                a = a.sigBytes;
                this.clamp();
                if (d % 4) for (var e = 0; e < a; e++) b[d + e >>> 2] |= (c[e >>> 2] >>> 24 - e % 4 * 8 & 255) << 24 - (d + e) % 4 * 8;
                else if (65535 < c.length) for (e = 0; e < a; e += 4) b[d + e >>> 2] = c[e >>> 2];
                else b.push.apply(b, c);
                this.sigBytes += a;
                return this
            },
            clamp: function () {
                var a = this.words
                    , b = this.sigBytes;
                a[b >>> 2] &= 4294967295 << 32 - b % 4 * 8;
                a.length = h.ceil(b / 4)
            },
            clone: function () {
                var a = r.clone.call(this);
                a.words = this.words.slice(0);
                return a
            },
            random: function (a) {
                for (var b = [], c = 0; c < a; c += 4) b.push(4294967296 * h.random() | 0);
                return new q.init(b, a)
            }
        })
        , v = f.enc = {}
        , k = v.Hex = {
            stringify: function (a) {
                var b = a.words;
                a = a.sigBytes;
                for (var c = [], d = 0; d < a; d++) {
                    var e = b[d >>> 2] >>> 24 - d % 4 * 8 & 255;
                    c.push((e >>> 4).toString(16));
                    c.push((e & 15).toString(16))
                }
                return c.join("")
            },
            parse: function (a) {
                for (var b = a.length, c = [], d = 0; d < b; d += 2) c[d >>> 3] |= parseInt(a.substr(d, 2), 16) << 24 - d % 8 * 4;
                return new q.init(c, b / 2)
            }
        }
        , l = v.Latin1 = {
            stringify: function (a) {
                var b = a.words;
                a = a.sigBytes;
                for (var c = [], d = 0; d < a; d++) c.push(String.fromCharCode(b[d >>> 2] >>> 24 - d % 4 * 8 & 255));
                return c.join("")
            },
            parse: function (a) {
                for (var b = a.length, c = [], d = 0; d < b; d++) c[d >>> 2] |= (a.charCodeAt(d) & 255) << 24 - d % 4 * 8;
                return new q.init(c, b)
            }
        }
        , n = v.Utf8 = {
            stringify: function (a) {
                try {
                    return decodeURIComponent(escape(l.stringify(a)))
                } catch (b) {
                    throw Error("Malformed UTF-8 data")
                }
            },
            parse: function (a) {
                return l.parse(unescape(encodeURIComponent(a)))
            }
        }
        , j = g.BufferedBlockAlgorithm = r.extend({
            reset: function () {
                this._data = new q.init;
                this._nDataBytes = 0
            },
            _append: function (a) {
                "string" == typeof a && (a = n.parse(a));
                this._data.concat(a);
                this._nDataBytes += a.sigBytes
            },
            _process: function (a) {
                var b = this._data
                    , c = b.words
                    , d = b.sigBytes
                    , e = this.blockSize
                    , f = d / (4 * e)
                    , g = (f = a ? h.ceil(f) : h.max((f | 0) - this._minBufferSize, 0)) * e
                    , i = g * 4
                    , a = d - i;
                if (g) {
                    for (var j = 0; j < g; j += e) this._doProcessBlock(c, j);
                    j = c.splice(0, g);
                    b.sigBytes = a
                }
                return new q.init(j, i)
            },
            clone: function () {
                var a = r.clone.call(this);
                a._data = this._data.clone();
                return a
            },
            _minBufferSize: 0
        });
    g.Hasher = j.extend({
        cfg: r.extend(),
        init: function (a) {
            this.cfg = this.cfg.extend(a);
            this.reset()
        },
        reset: function () {
            j.reset.call(this);
            this._doReset()
        },
        update: function (a) {
            this._append(a);
            this._process();
            return this
        },
        finalize: function (a) {
            a && this._append(a);
            return this._doFinalize()
        },
        blockSize: 16,
        _createHelper: function (a) {
            return function (b, c) {
                return new a.init(c).finalize(b)
            }
        },
        _createHmacHelper: function (a) {
            return function (b, c) {
                return new t.HMAC.init(a, c).finalize(b)
            }
        }
    });
    var t = f.algo = {};

    for (var r = [], q = 0; 64 > q; q++) r[q] = 4294967296 * h.abs(h.sin(q + 1)) | 0;
    f = g.Hasher.extend({
        _doReset: function () {
            this._hash = new q.init([1732584193, 4023233417, 2562383102, 271733878])
        },
        _doProcessBlock: function (s, f) {
            for (var g = this._hash.words, m = g[0], q = g[1], v = g[2], t = g[3], j = 0; 16 > j; j++) {
                var u = f + j
                    , y = s[u];
                s[u] = (y << 8 | y >>> 24) & 16711935 | (y << 24 | y >>> 8) & 4278255360
            }
            for (var j = 0; 64 > j; j += 4) {
                var A = q & v | ~q & t
                    , B = q & t | v & ~t
                    , C = q ^ v ^ t
                    , D = v ^ (q | ~t)
                    , c = 0;
                16 > j ? (A = q & v | ~q & t, c = j) : 32 > j ? (B = q & t | v & ~t, c = 5 * j + 1) : 48 > j ? (C = q ^ v ^ t, c = 3 * j + 5) : (D = v ^ (q | ~t), c = 7 * j)
            }
            for (var j = 0; 64 > j; j += 4) {
                var a, b, c, d, e, f = m, g = q, h = v, i = t, k = r[j], l = s[f + (j % 16)], n = (g & h | ~g & i) + (f + k + l) | 0, o = (g << 5 | g >>> 27) + n | 0;
                n = (f & g | ~f & h) + (o + r[j + 1] + s[g + (j + 1) % 16]) | 0;
                d = (f << 5 | f >>> 27) + n | 0;
                n = (o & f | ~o & g) + (d + r[j + 2] + s[h + (j + 2) % 16]) | 0;
                c = (o << 5 | o >>> 27) + n | 0;
                n = (d & o | ~d & f) + (c + r[j + 3] + s[i + (j + 3) % 16]) | 0;
                b = (d << 5 | d >>> 27) + n | 0;
                m = (m + b) | 0;
                q = (q + c) | 0;
                v = (v + d) | 0;
                t = (t + o) | 0
            }
            g[0] = g[0] + m | 0;
            g[1] = g[1] + q | 0;
            g[2] = g[2] + v | 0;
            g[3] = g[3] + t | 0
        },
        _doFinalize: function () {
            var f = this._data
                , g = f.words
                , m = 8 * this._nDataBytes
                , r = 8 * f.sigBytes;
            g[r >>> 5] |= 128 << 24 - r % 32;
            g[(r + 64 >>> 9 << 4) + 14] = h.floor(m / 4294967296);
            g[(r + 64 >>> 9 << 4) + 15] = m;
            f.sigBytes = 4 * g.length;
            this._process();
            return this._hash
        },
        clone: function () {
            var f = g.Hasher.clone.call(this);
            f._hash = this._hash.clone();
            return f
        }
    });
    s.MD5 = g.MD5 = m._createHelper(f);
    s.HmacMD5 = g.HmacMD5 = m._createHmacHelper(f);
    
    return s;
})();
