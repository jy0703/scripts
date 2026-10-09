/**
 * 脚本名称：慢慢买签到
 * 活动规则：每日签到领积分与金币，幸运日可开启幸运礼盒
 * 脚本说明：支持多账号，支持 NE / Node.js 环境。签到接口只认 username + 应用级 token，账号由响应侧抓取（首页 index_json.ashx 返回的 u_name）写入 manmanbuy_data（形如 [{"username":"wx_xxxx","nickName":"昵称"}]，昵称仅用于通知显示），也可在 manmanbuy_users 里直接填用户名
 * 环境变量：manmanbuy_data、manmanbuy_users、manmanbuy_token(可选，token 轮换时覆盖)、manmanbuy_debug
 * 更新时间：2026-10-09

------------------ Surge 配置 ------------------

[Script]
慢慢买获取Cookie = type=http-response,pattern=^https?:\/\/apapia\.manmanbuy\.com\/index_json\.ashx,requires-body=1,max-size=0,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/manmanbuy_sign.js,script-update-interval=0

慢慢买签到 = type=cron,cronexp="0 1 * * *",wake-system=1,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/manmanbuy_sign.js,timeout=600,script-update-interval=0

[MITM]
hostname = apapia.manmanbuy.com

------------------- Loon 配置 -------------------

[Script]
http-response ^https?:\/\/apapia\.manmanbuy\.com\/index_json\.ashx script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/manmanbuy_sign.js, requires-body=true, timeout=600, tag=慢慢买获取Cookie

cron "0 1 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/manmanbuy_sign.js, timeout=600, tag=慢慢买签到

[MITM]
hostname = apapia.manmanbuy.com

--------------- Quantumult X 配置 ---------------

[rewrite_local]
^https?:\/\/apapia\.manmanbuy\.com\/index_json\.ashx url script-response-body https://raw.githubusercontent.com/jy0703/scripts/main/scripts/manmanbuy_sign.js

[task_local]
"0 1 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/manmanbuy_sign.js, tag=慢慢买签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/manmanbuy.png, enabled=true

[MITM]
hostname = apapia.manmanbuy.com

 */

const $ = new Env('慢慢买');
$.is_debug = getEnv('manmanbuy_debug', 'is_debug') || 'false';  // 调试模式(boxjs 开关 manmanbuy_debug)
$.userInfo = getEnv('manmanbuy_data') || '';  // 获取账号
// 存储格式为 [{"username":"wx_xxxx","nickName":"昵称"}]，nickName 仅用于通知显示
$.userArr = parseUsers($.userInfo);
$.Messages = [];

// 把 manmanbuy_data 解析成内部账号对象数组
function parseUsers(raw) {
    const list = $.toObj(raw, null);
    if (!Array.isArray(list)) return [];
    const out = [];
    list.forEach(e => {
        const name = String((e && e.username) || '').trim();
        const nick = String((e && e.nickName) || '').trim();
        if (name && !out.some(u => normName(u.username) === normName(name))) {
            out.push(nick ? { username: name, nickName: nick } : { username: name });
        }
    });
    return out;
}

// 业务常量 (照签到页 activity_check_in H5 抓包搬运)
const API_HOST = 'https://basic-ucenter.manmanbuy.com';
// 请求侧抓取: APP 内 H5 走原生注入时请求里没有 username, 主要靠下面的响应侧抓取
const REQ_CAPTURE_REGEX = /^https?:\/\/(basic\-ucenter\.manmanbuy\.com|apph5\.manmanbuy\.com\/taolijin\/logserver\.aspx)/;
// 响应侧抓取: 首页 index_json.ashx 的返回体里带 "u_name":"wx_xxxx"，那才是签到接口要的 username
const RESP_CAPTURE_REGEX = /^https?:\/\/apapia\.manmanbuy\.com\/index_json\.ashx/;
// 应用级 token: 签到页 H5 的 web 调试分支里硬编码的常量, 服务端按它放行 (账号靠 username 区分)
const APP_TOKEN = 'mmb188';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 - mmbWebBrowse - ios';
const DATA_KEY = 'manmanbuy_data';
const USERS_KEY = 'manmanbuy_users';
const TOKEN_KEY = 'manmanbuy_token';


// 主函数
async function main() {
    // manmanbuy_users 里手填的用户名并入账号列表（与抓包数据按用户名去重）
    (getEnv(USERS_KEY) || '').split(/[,，;；\s]+/).filter(Boolean).forEach(name => {
        if (!$.userArr.some(e => normName(e.username) === normName(name))) $.userArr.push({ username: name });
    });

    if ($.userArr.length) {
        $.log(`\n🌀 找到 ${$.userArr.length} 个账号`);

        for (let i = 0; i < $.userArr.length; i++) {
            $.log(`\n----- 账号 [${i + 1}/${$.userArr.length}] 开始执行 -----\n`);

            // 初始化
            $.is_login = true;
            $.beforeMsgs = '';
            $.messages = [];
            $.user = $.userArr[i];

            try {
                await runAccount($.user);
            } catch (e) {
                $.log(`❌ ${e.message || e}`);
                $.messages.push(`❌ 签到: ${e.message || e}`);
            }

            // 账号信息作为该账号通知的开头（昵称优先）
            if ($.beforeMsgs) $.beforeMsgs += '\n';
            $.beforeMsgs += `🔹 账号${i + 1}: ${$.user.nickName || $.user.username || '未知'}`;
            $.messages.splice(0, 0, $.beforeMsgs), $.Messages = $.Messages.concat($.messages);
        }
        $.log(`\n----- 所有账号执行完成 -----\n`);
    } else {
        throw new Error('未找到 manmanbuy_data 变量 ❌');
    }
}

// 单账号流程：查状态 → 未签到则签到 → 幸运礼盒 → 汇总
async function runAccount(user) {
    if (!user.username) throw new Error('账号缺少 username，请重新抓包或在 manmanbuy_users 填写');

    let info = await api('/user/sign/info', user);
    $.log(`[慢慢买] 积分 ${info.points} | 金币 ${info.coin} | 补签卡 ${info.cardCount} | 今日已签到 ${info.signByToday ? '是' : '否'}`);

    if (info.signByToday) {
        $.messages.push('📝 签到: 今日已签到');
    } else {
        const signDate = await getTodaySignDate(user);
        let res;
        try {
            res = await api('/user/sign', user, { signDate, isReSign: false });
        } catch (e) {
            // 5000 您当天已经签到 = 状态已被手机端消耗掉，按已签到处理
            if (/已经签到|已签到/.test(e.msg || '')) {
                $.messages.push('📝 签到: 今日已签到');
                res = null;
            } else throw e;
        }
        if (res) {
            const point = res && res.point;
            $.messages.push(`✅ 签到: 成功${point ? `，获得 ${point} 积分` : ''}${res && res.description ? `（${res.description}）` : ''}`);
            $.log(`✅ 签到返回: ${$.toStr(res)}`);
            info = await api('/user/sign/info', user);
        }
    }

    // 幸运礼盒：luckBox 回 true 才开，失败不影响签到结果
    try {
        if (await api('/user/sign/luckBox', user) === true) {
            const open = await api('/user/sign/openLuckBox', user);
            $.messages.push(`🎁 ${open.title || '幸运礼盒'} ${open.point ? `+${open.point} 积分` : '已开启'}`);
            $.log(`🎁 幸运礼盒返回: ${$.toStr(open)}`);
        }
    } catch (e) {
        $.log(`❌ 幸运礼盒: ${e.message || e}`);
    }

    $.messages.push(`📊 积分 ${info.points} | 金币 ${info.coin}${info.exchangePrice ? `（≈${info.exchangePrice} 元）` : ''}${info.cardCount ? ` | 补签卡 ${info.cardCount}` : ''}`);
}

// 取今日格子日期（服务端为准），日历失效时退回本地日期
async function getTodaySignDate(user) {
    const list = await api('/user/sign/calendar', user);
    const today = Array.isArray(list) && list.find(e => e && e.isToday);
    return (today && today.signDate) || `${$.time('yyyy-MM-dd')} 00:00:00`;
}

// 获取账号数据 (rewrite 抓取入口: 响应侧从 index_json.ashx 的 u_name 取, 请求侧作兜底)
// 抓不到属于正常不匹配(未登录/别的接口/响应体被压缩)，只记日志不推送，避免刷屏
function GetCookie() {
    try {
        const isResp = typeof $response !== 'undefined';
        const url = ($request && $request.url) || '';
        if ($request && $request.method === 'OPTIONS') return;

        if (isResp) {
            if (!RESP_CAPTURE_REGEX.test(url)) return;
            const body = respBodyText();
            const acc = findInBody(body);
            if (!acc) {
                // 同一个 index_json.ashx 靠 action 区分，只有 getuserinfo 那条带账号
                const action = ((($request && $request.body) || '').match(/(?:^|&)action=([^&]*)/) || [])[1] || '?';
                debug(`未命中 action=${action}，响应 ${body.length} 字节: ${body.slice(0, 80) || '(空)'}`, '抓取');
                return;
            }
            saveAccount(acc.username, acc.nickName);
        } else {
            if (!url || !REQ_CAPTURE_REGEX.test(url)) return;
            const params = pickParams($request);
            if (!params.username) {
                debug(`请求未带 username: ${url.split('?')[0]} (APP 走原生注入时不带，靠响应侧抓取)`, '抓取');
                return;
            }
            saveAccount(params.username);
        }
    } catch (e) {
        $.log('❌ Cookie获取异常'), $.log(e);
    }
}

function respBodyText() {
    const b = $response && $response.body;
    if (typeof b === 'string') return b;
    if (b && typeof b === 'object') return $.toStr(b) || '';
    return '';
}

// 从响应体里取账号: u_name/userName 作用户名, 同一条里的 nickName 作显示昵称
function findInBody(text) {
    if (!text) return null;
    const flat = text.indexOf('\\u') !== -1 ? text.replace(/\\(["\\])/g, '$1') : text;
    for (const t of [text, flat]) {
        for (const k of NAME_KEYS) {
            const m = t.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]{2,60})"'));
            if (!m) continue;
            const v = safeDecode(m[1]).trim();
            if (!isUserName(v)) continue;
            const n = t.match(/"nickName"\s*:\s*"([^"]{1,30})"/);
            return { username: v, nickName: n ? String(n[1]).trim() : '' };
        }
    }
    return null;
}

// 用户名形态: 慢慢买是 wx_xxxxxxxx / 手机号 / 字母数字下划线，排除纯中文昵称等误取
function isUserName(v) {
    return !!v && /^[A-Za-z0-9_\-\+@.]{2,60}$/.test(v);
}

// 写入账号数组：数据有变化就推送（新账号 / 昵称新增或改动），完全没变化才静默
function saveAccount(username, nickName) {
    username = String(username).trim();
    nickName = String(nickName || '').trim();
    if (!isUserName(username)) {
        debug(`忽略可疑用户名: ${username}`, '抓取');
        return;
    }
    const exist = $.userArr.find(e => normName(e.username) === normName(username));
    if (exist) {
        if (nickName && exist.nickName !== nickName) {
            exist.nickName = nickName;
            persistUsers();
            $.Messages.push(`🎉慢慢买昵称已更新: ${username} → ${nickName}`);
            $.log(`慢慢买账号 ${username} 昵称已更新: ${nickName}`);
        } else {
            $.log(`慢慢买账号 ${username} 已存在且无变化，不重复写入`);
        }
        return;
    }
    $.userArr.push(nickName ? { username, nickName } : { username });
    persistUsers();
    $.Messages.push(`🎉获取慢慢买账号成功: ${nickName || username}`);
    $.log(`🎉获取慢慢买账号成功: ${username}${nickName ? ` (${nickName})` : ''}`);
}

// 落盘只保留 username 与可选的 nickName
function persistUsers() {
    $.setdata($.toStr($.userArr.map(e => e.nickName ? { username: e.username, nickName: e.nickName } : { username: e.username })), DATA_KEY);
}

function normName(v) {
    return String(v || '').trim().toLowerCase();
}

// 账号参数候选字段名 (H5 用 username, 客户端 appInfo 里叫 u_name)
const NAME_KEYS = ['username', 'u_name', 'userName', 'uname', 'user_name'];

// 从 url query / form body / json body / 请求头 / cookie 里找账号参数
function pickParams(req) {
    const out = {};
    const header = ObjectKeys2LowerCase(req.headers || {});
    const texts = [(req.url.split('?')[1] || ''), (typeof req.body === 'string' ? req.body : $.toStr(req.body || ''))];
    NAME_KEYS.forEach(k => { if (header[k]) texts.push(`${k}=${header[k]}`); });
    if (header.cookie) texts.push(header.cookie);

    ['username', 'token', 'c_mmbDevId'].forEach((key, idx) => {
        const keys = idx === 0 ? NAME_KEYS : [key];
        for (const t of texts) {
            if (!t) continue;
            for (const k of keys) {
                const hit = t.match(new RegExp('(?:^|[&;?]\\s*)' + k + '=([^&;]+)')) || t.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]*)"'));
                if (hit) { const v = safeDecode(hit[1]).trim(); if (v && v.length > 1) { out[key] = v; return; } }
            }
        }
    });
    return out;
}

function safeDecode(v) {
    try { return decodeURIComponent(String(v).replace(/\+/g, ' ')); } catch (e) { return v; }
}

// ---------- 工具函数 ----------

// 接口统一 POST form-urlencoded，成功码 2000，数据在 result
async function api(path, user, extra = {}) {
    // token 用签到页 H5 里的应用级常量，账号只靠 username 区分；抓包里的 token 是一次性随机数，不能复用
    const body = { username: user.username, token: getEnv(TOKEN_KEY) || APP_TOKEN };
    Object.assign(body, extra);

    const resp = await Request({
        url: API_HOST + path,
        method: 'post',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
            'Accept': 'application/json, text/plain, */*',
            'Origin': 'https://apapia-config.manmanbuy.com',
            'Referer': 'https://apapia-config.manmanbuy.com/h5/activity_check_in.html',
            'User-Agent': UA
        },
        body: formBody(body),
        _timeout: 30000
    });

    if (!resp || resp.code !== 2000) {
        const err = new Error(`${(resp && resp.msg) || '接口响应不合法'}(code:${resp && resp.code}) ${path}`);
        err.code = resp && resp.code;
        err.msg = (resp && resp.msg) || '';
        throw err;
    }
    return resp.result !== undefined ? resp.result : resp.data;
}

function formBody(obj) {
    return Object.keys(obj)
        .filter(k => obj[k] !== undefined && obj[k] !== null)
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(obj[k])}`)
        .join('&');
}

// key 转小写 (抓包头大小写不定)
function ObjectKeys2LowerCase(obj = {}) { return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v])); }

function getEnv(...keys) {
    for (let key of keys) {
        var value = $.isNode() ? process.env[key] || process.env[key.toUpperCase()] || process.env[key.toLowerCase()] || $.getdata(key) : $.getdata(key);
        if (value) return value;
    }
}

function debug(content, title = 'debug') {
    let start = `\n----- ${title} -----\n`;
    let end = `\n----- ${$.time('HH:mm:ss')} -----\n`;
    if ($.is_debug === 'true') {
        if (typeof content == 'string') $.log(start + content + end);
        else if (typeof content == 'object') $.log(start + $.toStr(content) + end);
    }
}

// 请求函数二次封装
async function Request(options) {
    try {
        options = options.url ? options : { url: options };
        const _method = options?._method || options?.method || ('body' in options ? 'post' : 'get');
        const _respType = options?._respType || 'body';
        const _timeout = options?._timeout || 15000;

        if ((_method.toLowerCase() === 'post' || _method.toLowerCase() === 'put') && options.body && typeof options.body === 'object') {
            options.body = JSON.stringify(options.body);
            options.headers = options.headers || {};
            if (!options.headers['Content-Type'] && !options.headers['content-type']) {
                options.headers['Content-Type'] = 'application/json';
            }
        }

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
                });
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

// 脚本执行入口: $request 存在 → 抓取模式, 否则 → 定时任务模式
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
    });

function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }
