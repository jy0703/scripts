/**
 * 脚本名称：AgentRouter 签到
 * 活动规则：agentrouter.org 每日完成一次账号密码登录即签到，登录时发放当日额度
 * 脚本说明：POST /api/user/login 提交邮箱+密码（服务端下发 session cookie，密码固定不过期，
 *          基本一劳永逸；响应 data.checked_in=true 即当日已签到，且 data 直接带 quota 余额，
 *          无需额外查询）。登录成功后再查 /api/log/self/（需带 New-API-User: <uid> 头）
 *          端到端核验是否真的落了「签到成功」日志（type=4），避免「登录成功但签到未真正触发」。
 *          会话 cookie 由脚本自收自回（NE 环境无 cookie jar）。支持多账号。
 *          支持 Node.js / Quantumult X / Loon / Surge。
 * 环境变量：agentrouter_account   邮箱#密码，多账号以 & 或换行分隔，例：a@x.com#pwdA&b@x.com#pwdB
 *          agentrouter_base_url  可选，默认 https://agentrouter.org（备用域名 ps.air-outer.com）
 *          agentrouter_debug     调试模式
 * 更新时间：2026-11-12

------------------ Surge 配置 ------------------

[Script]
AgentRouter签到 = type=cron,cronexp="0 9 * * *",wake-system=1,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/agentrouter_sign.js,script-update-interval=0

------------------- Loon 配置 -------------------

[Script]
cron "0 9 * * *" script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/agentrouter_sign.js, timeout=600, tag=AgentRouter签到

--------------- Quantumult X 配置 ---------------

[task_local]
0 9 * * * https://raw.githubusercontent.com/jy0703/scripts/main/scripts/agentrouter_sign.js, tag=AgentRouter签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/agentrouter.png, enabled=true

 */

const $ = new Env('AgentRouter');
$.is_debug = getEnv('agentrouter_debug', 'is_debug') || 'false';  // 调试模式
$.Messages = [];

// ---- 业务常量 (照 py 源码逐一搬运) ----
const APP_NAME = 'AgentRouter';
const ACCOUNT_KEY = 'agentrouter_account';
const BASE_URL = (getEnv('agentrouter_base_url') || 'https://agentrouter.org').replace(/\/+$/, '');
const LOGIN_PATH = '/api/user/login';
const SELF_LOG_PATH = '/api/log/self/';
const CHECKIN_LOG_TYPE = 4;  // 每日签到日志的 type 字段值
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

// 主函数
async function main() {
    const accounts = parseAccounts(getEnv(ACCOUNT_KEY));
    if (!accounts.length) throw new Error(`未配置账号：请填写 ${ACCOUNT_KEY}（邮箱#密码，多账号以 & 或换行分隔）❌`);

    let ok = 0, fail = 0;
    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        $.log(`\n----- 账号 [${i + 1}/${accounts.length}] ${mask(acc.email)} 开始执行 -----\n`);
        $.messages = [];
        try {
            $.messages.push(await loginAccount(acc));
            ok++;
        } catch (e) {
            fail++;
            $.messages.push(`❌ ${e.message || e}`);
        }
        $.messages.splice(0, 0, `🔹 账号${i + 1} [${mask(acc.email)}]`);
        $.Messages = $.Messages.concat($.messages);
        if (i < accounts.length - 1) await $.wait(2000 + Math.floor(Math.random() * 3000));
    }
    $.Messages.push(`\n📊 ${APP_NAME}: 成功 ${ok} / 失败 ${fail}`);
    $.log(`\n----- 所有账号执行完成 -----\n`);
}

// 账号密码登录即签到；checked_in=true 时再做日志端到端核验
async function loginAccount(acc) {
    const jar = {};
    const resp = await Request({
        url: `${BASE_URL}${LOGIN_PATH}`,
        method: 'post',
        body: { username: acc.email, password: acc.password },
        headers: { 'user-agent': UA, accept: 'application/json, text/plain, */*', referer: `${BASE_URL}/login`, origin: BASE_URL },
        _respType: 'all', _timeout: 20000,
    });
    if (!resp) throw new Error('登录请求异常: 无响应');
    const ctype = String((resp.headers && (resp.headers['content-type'] || resp.headers['Content-Type'])) || '');
    if (ctype.includes('text/html')) throw new Error('登录接口返回 HTML(可能被 WAF 拦截或路径变化)');
    const j = $.toObj(resp.body, null);
    if (!j) throw new Error(`登录响应非 JSON: ${String(resp.body || '').slice(0, 120)}`);
    if (!j.success) throw new Error(`登录失败: ${j.message || String(resp.body || '').slice(0, 120)}`);
    takeCookies(jar, resp.headers);

    const data = j.data || {};
    const who = data.username || data.display_name || acc.email;
    const quota = extractQuota(data);
    const quotaStr = quota === null || quota === undefined ? '未知' : `${quota}`;

    if (!data.checked_in) {
        $.log(`[${acc.name}] ✅ ${who} 登录成功，额度: ${quotaStr}，但 checked_in=false(可能今日额度已发或接口变化)`);
        return `✅ ${acc.name}(${who})：登录成功，但 checked_in=false(可能今日额度已发或接口变化) | 额度 ${quotaStr}`;
    }

    // 端到端核验: /api/log/self 里确有「签到成功」日志才报「日志已确认」
    const [level, detail] = await verifyCheckin(jar, data.id);
    const msg = (level === 'new' || level === 'today')
        ? `签到成功，日志已确认（${detail}）`
        : `登录成功且服务端返回已签到，但日志未确认: ${detail}`;
    $.log(`[${acc.name}] ✅ ${who} ${msg}，额度: ${quotaStr}`);
    return `✅ ${acc.name}(${who})：${msg} | 额度 ${quotaStr}`;
}

// 查询 /api/log/self/ 确认签到日志，返回 [level, detail]
// level: "new" 本次运行刚生成(300 秒内) / "today" 近 1 天内有(多半是今日更早时已完成) /
//        "none" 找不到任何签到日志或日志过旧 / "error" 日志接口异常(不影响登录结论)
async function verifyCheckin(jar, uid, slackNew = 300, windowDays = 1) {
    if (!uid) return ['error', '缺少 uid, 跳过日志核验'];
    try {
        const resp = await Request({
            url: `${BASE_URL}${SELF_LOG_PATH}?p=1&page_size=20`,
            headers: withCookie(jar, {
                'user-agent': UA, accept: 'application/json, text/plain, */*',
                referer: `${BASE_URL}/console/log`, 'new-api-user': String(uid),
            }),
            _timeout: 20000,
        });
        if (!resp || typeof resp !== 'object') return ['error', `日志接口返回异常: ${String(resp).slice(0, 80)}`];
        const items = (resp.data && resp.data.items) || [];
        const now = Math.floor(Date.now() / 1000);
        let newestTs = null;
        for (const it of items) {
            const ts = it.created_at;
            if ((String(it.content || '').includes('签到成功') || it.type === CHECKIN_LOG_TYPE)
                && typeof ts === 'number' && (newestTs === null || ts > newestTs)) newestTs = ts;
        }
        if (newestTs === null) return ['none', '日志中未找到任何签到记录'];
        const ago = now - newestTs;
        const agoStr = ago < 60 ? `${ago} 秒前`
            : ago < 3600 ? `${Math.floor(ago / 60)} 分钟前`
            : ago < 86400 ? `${Math.floor(ago / 3600)} 小时前`
            : `${Math.floor(ago / 86400)} 天前`;
        if (newestTs >= now - slackNew) return ['new', agoStr];
        if (newestTs >= now - windowDays * 86400) return ['today', `近 ${windowDays} 天内有签到记录（${agoStr}），本次未新增`];
        return ['none', `最近一条签到日志较旧（${agoStr}）`];
    } catch (e) {
        return ['error', `日志查询异常: ${e.message || e}`];
    }
}

// 从登录响应 data 中提取余额字段 (照 py extract_quota)
function extractQuota(data) {
    if (data && typeof data === 'object') {
        for (const k of ['quota', 'remainder_quota', 'balance']) if (k in data) return data[k];
    }
    return null;
}

// ---------- 工具函数 ----------

// 账号变量: 邮箱#密码，多账号以 & 或换行分隔 (邮箱不含 #, 按首个 # 切分)
function parseAccounts(raw) {
    const list = [];
    String(raw || '').split(/[&\n]+/).forEach(group => {
        const g = group.trim();
        if (!g) return;
        const i = g.indexOf('#');
        if (i < 0) { $.log(`⚠️ 账号格式错误（缺少#分隔的密码），已跳过: ${mask(g)}`); return; }
        const email = g.slice(0, i).trim(), password = g.slice(i + 1).trim();
        if (!email || !password) { $.log(`⚠️ 账号格式错误（邮箱或密码为空），已跳过: ${mask(g)}`); return; }
        list.push({ name: '默认账号', email, password });
    });
    return list;
}

function mask(email) {
    const s = String(email || '');
    const at = s.indexOf('@');
    if (at < 0) return s.length > 7 ? `${s.slice(0, 3)}****${s.slice(-4)}` : `${s.slice(0, 1)}****`;
    return `${s.slice(0, Math.min(3, at))}****@${s.slice(at + 1)}`;
}

// jar 空时不下发空 Cookie 头，让环境自身的 cookie 管理生效
function withCookie(jar, headers) {
    const h = Object.assign({}, headers);
    const ck = cookieHeader(jar);
    if (ck) h.Cookie = ck;
    return h;
}

// 收集响应里的 Set-Cookie 到 jar（数组与逗号拼接串两种形态）
function takeCookies(jar, headers) {
    const raw = headers && (headers['set-cookie'] || headers['Set-Cookie']);
    if (!raw) return;
    for (const item of Array.isArray(raw) ? raw : [raw]) {
        for (const part of String(item).split(/,(?=\s*[A-Za-z0-9_.-]+=)/)) {
            const kv = /^\s*([A-Za-z0-9_.-]+)=([^;]*)/.exec(part);
            if (kv) jar[kv[1]] = kv[2].trim();
        }
    }
}

function cookieHeader(jar) {
    return Object.keys(jar || {}).map(k => `${k}=${jar[k]}`).join('; ');
}

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

// 脚本执行入口
!(async () => {
    await main();
})()
    .catch((e) => $.Messages.push(e.message || e) && $.logErr(e))
    .finally(async () => {
        await sendMsg($.Messages.join('\n').trimStart().trimEnd());
        $.isNode() || $.done();  // Node(呆呆面板) 下不调 done
    });

function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }
