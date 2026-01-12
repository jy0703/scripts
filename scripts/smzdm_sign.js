/**
 * 脚本名称：什么值得买签到 - 签到
 * 活动规则：每日签到获得积分奖励，支持签到、转盘抽奖、每日任务等功能
 * 脚本说明：支持多账号，支持 NE / Node.js 环境，支持App端签到、转盘抽奖、每日任务等
 * 环境变量：SMZDM_COOKIE
 * 更新时间：2026-01-12

------------------ Surge 配置 ------------------

[MITM]
hostname = user-api.smzdm.com

[Script]
什么值得买获取Cookie = type=http-request,pattern=https:\/\/user-api\.smzdm\.com\/checkin,requires-body=1,max-size=0,binary-body-mode=0,timeout=30,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm_sign.js,script-update-interval=0

什么值得买签到 = type=cron,cronexp="0 8 * * *",timeout=60,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm_sign.js,script-update-interval=0

------------------- Loon 配置 -------------------

[MITM]
hostname = user-api.smzdm.com

[Script]
http-request https:\/\/user-api\.smzdm\.com\/checkin tag=什么值得买获取Cookie,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm_sign.js,requires-body=1

cron "0 8 * * *" script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm_sign.js,tag=什么值得买签到,enable=true

--------------- Quantumult X 配置 ---------------

[MITM]
hostname = user-api.smzdm.com

[rewrite_local]
https:\/\/user-api\.smzdm\.com\/checkin url script-request-header https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm_sign.js

[task_local]
0 8 * * * https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm_sign.js, tag=什么值得买签到, img-url=https://raw.githubusercontent.com/Orz-3/mini/master/Color/smzdm.png, enabled=true

------------------ Stash 配置 ------------------

cron:
  script:
    - name: 什么值得买签到
      cron: '0 8 * * *'
      timeout: 10

http:
  mitm:
    - "user-api.smzdm.com"
  script:
    - match: https:\/\/user-api\.smzdm\.com\/checkin
      name: 什么值得买获取Cookie
      type: request
      require-body: true

script-providers:
  什么值得买签到:
    url: https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm_sign.js
    interval: 86400

 */

const $ = new Env('什么值得买签到');
$.is_debug = getEnv('is_debug') || 'false';  // 调试模式
$.cookieInfo = getEnv('SMZDM_COOKIE') || '';  // 获取Cookie
$.cookieArr = $.cookieInfo.split(/&|\n/).filter(t => t.trim());  // Cookie数组
$.Messages = [];

// 主函数
async function main() {
    if ($.cookieArr.length) {
        $.log(`\n🌀 找到 ${$.cookieArr.length} 个 Cookie 变量`);

        // 遍历账号
        for (let i = 0; i < $.cookieArr.length; i++) {
            $.log(`\n----- 账号 [${i + 1}] 开始执行 -----\n`);

            // 初始化
            $.is_login = true;
            $.beforeMsgs = '';
            $.messages = [];
            $.cookie = $.cookieArr[i].trim();
            $.headers = {
                'Cookie': $.cookie,
                'User-Agent': getEnv('SMZDM_USER_AGENT_APP') || 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/smzdm_iphone_app/10.4.0/What_Worth_Buying'
            };

            // 执行签到
            await doSign();

            // 获取签到信息
            await getSignInfo();

            // 执行每日任务
            await doTasks();

            // 执行转盘抽奖
            await doLottery();

            // 获取用户信息
            await getUserInfo();

            // 合并通知
            $.messages.splice(0, 0, $.beforeMsgs), $.Messages = $.Messages.concat($.messages);
        }
        $.log(`\n----- 所有账号执行完成 -----\n`);
    } else {
        throw new Error('未找到 SMZDM_COOKIE 变量 ❌');
    }
}

// 获取Cookie
function GetCookie() {
    try {
        let msg = '';
        debug($request.headers, "获取Header");
        const cookie = $request.headers['Cookie'] || $request.headers['cookie'];
        
        if (cookie) {
            // 使用 find() 方法找到与 cookie 匹配的 token，以新增/更新用户 cookie
            const cookieList = $.cookieInfo.split(/&|\n/).filter(t => t.trim());
            const cookieExists = cookieList.some(token => token.trim() === cookie.trim());
            
            if (!cookieExists) {
                msg += `🆕 新增用户 Cookie: ${cookie}`;
                cookieList.push(cookie);
                // 写入数据持久化
                $.setdata(cookieList.join('&'), 'SMZDM_COOKIE');
            } else {
                return;
            }
            
            $.Messages.push(msg), $.log(msg);
        } else {
            $.log("❌ 未找到 Cookie");
        }
    } catch (e) {
        $.log("❌ Cookie获取失败"), $.log(e);
    }
}

// 执行签到
async function doSign() {
    let msg = '';
    try {
        // 构造请求
        const options = {
            url: `https://user-api.smzdm.com/checkin`,
            headers: $.headers
        }

        // 发起请求
        const result = await Request(options);
        if (result?.error_code === 0) {
            const data = result?.data || {};
            msg += `签到: ✅ ${data?.notice || '签到成功'}`;
            if (data?.gold > 0) msg += `, 金币: ${data?.gold}`;
            if (data?.point > 0) msg += `, 积分: ${data?.point}`;
        } else if (result?.error_code === 1) {
            msg += `签到: 📝 今日已签到`;
        } else {
            msg += `签到: ❌ ${result?.error_msg || '签到失败'}`;
        }
    } catch (e) {
        msg += `签到: ❌ ${e.message}`;
        $.log(`❌ 签到失败: ${e.message}`);
    }
    $.messages.push(msg), $.log(msg);
}

// 获取签到信息
async function getSignInfo() {
    try {
        // 构造请求
        const options = {
            url: `https://user-api.smzdm.com/checkin/info`,
            headers: $.headers
        }

        // 发起请求
        const result = await Request(options);
        if (result?.error_code === 0) {
            const data = result?.data || {};
            const checkin_num = data?.checkin_num || 0;
            const gold = data?.gold || 0;
            const point = data?.point || 0;
            
            if ($.beforeMsgs) {
                $.beforeMsgs += '\n';
            } else {
                $.beforeMsgs = '';
            }
            
            $.beforeMsgs += `累计签到: ${checkin_num}天\n`;
            $.beforeMsgs += `总金币: ${gold}\n`;
            $.beforeMsgs += `总积分: ${point}\n`;
        } else {
            $.log(`❌ 获取签到信息失败: ${$.toStr(result)}`);
        }
    } catch (e) {
        $.log(`❌ 获取签到信息失败: ${e.message}`);
    }
}

// 执行每日任务
async function doTasks() {
    try {
        // 获取任务列表
        const taskOptions = {
            url: `https://user-api.smzdm.com/task_list`,
            headers: $.headers
        };

        const taskResult = await Request(taskOptions);
        if (taskResult?.error_code === 0) {
            const tasks = taskResult?.data?.list || [];
            for (const task of tasks) {
                // 执行未完成的任务
                if (task?.task_going === 0 && task?.task_done === 0) {
                    // 浏览、点赞、收藏等任务
                    if (task?.task_name.includes('浏览') || task?.task_name.includes('点赞') || task?.task_name.includes('收藏')) {
                        const doTaskOptions = {
                            url: `https://user-api.smzdm.com/task_settlement`,
                            method: 'post',
                            headers: $.headers,
                            body: `task_id=${task?.task_id}&type=task`
                        };

                        const doTaskResult = await Request(doTaskOptions);
                        if (doTaskResult?.error_code === 0) {
                            $.log(`任务完成: ${task?.task_name}`);
                        } else {
                            $.log(`任务失败: ${task?.task_name} - ${doTaskResult?.error_msg}`);
                        }
                    }
                }
            }
        } else {
            $.log(`❌ 获取任务列表失败: ${taskResult?.error_msg}`);
        }
    } catch (e) {
        $.log(`❌ 执行任务失败: ${e.message}`);
    }
}

// 执行转盘抽奖
async function doLottery() {
    let msg = '';
    try {
        // 转盘抽奖请求
        const options = {
            url: `https://user-api.smzdm.com/lottery/draw`,
            method: 'post',
            headers: $.headers,
            body: 'type=free'
        }

        // 发起请求
        const result = await Request(options);
        if (result?.error_code === 0) {
            const data = result?.data || {};
            const item_name = data?.item_name || '';
            msg += `抽奖: ✅ 抽奖成功，获得 ${item_name}`;
        } else if (result?.error_code === 11) {
            msg += `抽奖: 📝 今日免费抽奖次数已用完`;
        } else {
            msg += `抽奖: ❌ ${result?.error_msg || '抽奖失败'}`;
        }
    } catch (e) {
        msg += `抽奖: ❌ ${e.message}`;
        $.log(`❌ 抽奖失败: ${e.message}`);
    }
    $.messages.push(msg), $.log(msg);
}

// 获取用户信息
async function getUserInfo() {
    try {
        // 构造请求
        const options = {
            url: `https://user-api.smzdm.com/account`,
            headers: $.headers
        }

        // 发起请求
        const result = await Request(options);
        if (result?.error_code === 0) {
            const data = result?.data || {};
            const nickname = data?.nickname || '未知用户';
            const gold = data?.gold || 0;
            const point = data?.point || 0;
            const rank = data?.rank || '未知等级';
            
            if ($.beforeMsgs) {
                $.beforeMsgs += '\n';
            }
            
            $.beforeMsgs += `用户名: ${nickname}\n`;
            $.beforeMsgs += `金币: ${gold}\n`;
            $.beforeMsgs += `积分: ${point}\n`;
            $.beforeMsgs += `等级: ${rank}\n`;
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
    const _method = options?._method || options?.method || ('body' in options ? 'post' : 'get');
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
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }