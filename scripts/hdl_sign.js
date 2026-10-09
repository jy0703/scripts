/**
 * 脚本名称：海底捞签到
 * 活动规则：海底捞会员小程序每日签到，奖励碎片/成长值/菜品
 * 脚本说明：code 服务(YYB Go)取微信 code → 海底捞 getId.json 换 openid/unionId →
 *          wechatLogin(openId+uid) 静默登录换 token（业务请求带 _haidilao_app_token 头），
 *          token 本地缓存自动复用/失效刷新。支持 Node.js / Quantumult X / Loon / Surge / Stash。
 * 配置说明：boxjs 订阅「Code Server」分组中填写「获取小程序code」配置项(@wxCode.*):
 *          - @wxCode.open    开启code模式(true)
 *          - @wxCode.address 服务器地址, 如 http://192.168.2.5:8000
 *          - @wxCode.token   接口鉴权 token (请求头 Authorization: Bearer <token>)
 *          账号 ref 配在本脚本的 boxjs 区域 HDL_REF 中, 多个以英文逗号隔开
 *          Node 环境变量同名可用: WX_CODE_ADDRESS / WX_CODE_TOKEN / HDL_REF
 *          HDL 变量为可选抓包兜底（同一序号上优先于 code 服务）：
 *          - openId&uid 或 wx#openId&uid  抓 wechatLogin 请求体所得
 *          - app#TOKEN 或 TOKEN           直接用现成 token
 *          多条以换行或 ; 分隔。
 * 更新时间：2026-10-05

------------------ Surge 配置 ------------------

[Script]
海底捞签到 = type=cron,cronexp="0 9 * * *",script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/hdl_sign.js,wake-system=1

------------------- Loon 配置 -------------------

[Script]
cron "0 9 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/hdl_sign.js, timeout=600, tag=海底捞签到

--------------- Quantumult X 配置 ---------------

[task_local]
"0 9 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/hdl_sign.js, tag=海底捞签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/hdl.png, enabled=true

 */

const $ = new Env('海底捞');
$.is_debug = getEnv('hdl_debug', 'is_debug') || 'false';  // 调试模式(boxjs 开关 hdl_debug)
$.Messages = [];

// ---- 业务常量 (照 py 源码搬运, 登录链路按 HAR 抓包补全) ----
const APPID = 'wx1ddeb67115f30d1a';
const BASE_URL = 'https://superapp-public.kiwa-tech.com';
const ID_URL = `${BASE_URL}/CaterWeixin/ws/external/getId.json`;
const LOGIN_URL = `${BASE_URL}/api/gateway/login/center/login/wechatLogin`;
const SIGN_URL = `${BASE_URL}/activity/wxapp/signin/signin`;
const FRAGMENT_URL = `${BASE_URL}/activity/wxapp/signin/queryFragment`;
const MEMBER_INFO_URL = `${BASE_URL}/activity/wxapp/applet/queryMemberCacheInfo`;
const CACHE_KEY = 'HDL_TOKEN_CACHE';   // 缓存键: 存 {key:{token,label,expireTime,updateTime}}

const USER_AGENT = 'MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf254032b) XWEB/13655';

// 主函数
async function main() {
    $.codeServer = (getEnv('WX_CODE_ADDRESS', '@wxCode.address') || '').replace(/\/+$/, '');
    $.yybToken = getEnv('WX_CODE_TOKEN', '@wxCode.token') || '';

    const refs = (getEnv('HDL_REF') || '').split(/[,，\s\n]+/).filter(Boolean);
    const hdl = parseHdlEnv(getEnv('HDL'));
    const total = Math.max(refs.length, hdl.length);
    if (!total) throw new Error('未配置账号：填写 HDL_REF（code 服务账号 ref），或 HDL 抓包凭证 openId&uid ❌');

    // 同一序号上 HDL 抓包凭证优先于 code 服务
    $.accounts = [];
    for (let i = 0; i < total; i++) {
        $.accounts.push({ key: refs[i] || accountKey(hdl[i]), ref: refs[i] || '', hdl: hdl[i] || null });
    }

    for (let i = 0; i < $.accounts.length; i++) {
        const acc = $.accounts[i];
        $.log(`\n----- 账号 [${i + 1}/${$.accounts.length}] ${acc.key} 开始执行 -----\n`);
        $.messages = [];
        await runAccount(acc);
        $.messages.splice(0, 0, `🍲 账号 ${i + 1} [${$.refLabel || acc.key}]`);
        $.Messages = $.Messages.concat($.messages);
        if (i < $.accounts.length - 1) await $.wait(2000);
    }
}

// 缓存键取 openId 或 token 首尾, 避免 HDL 列表增删后账号错位
function accountKey(acc) {
    return acc.type === 'wx' ? acc.openId : `${acc.token.slice(0, 8)}_${acc.token.slice(-8)}`;
}

// 单账号: 登录 + 签到 + 碎片 + 会员信息
async function runAccount(acc) {
    await $.wait(1000 * (2 + Math.floor(Math.random() * 5)));  // 启动随机延迟
    const account = await loginWithCache(acc);
    if (!account) return;

    // 每日签到
    const sign = await apiPost(SIGN_URL, account.token, { signinSource: 'MiniApp' });
    if (isOk(sign)) {
        const list = (sign.data && sign.data.signinQueryDetailList) || [];
        $.messages.push(`✅ 签到: 获得 ${rewardText(list[0]) || '奖励'}`);
        if (list[1]) $.log(`📅 [签到] 明日签到奖励: ${rewardText(list[1])}`);
    } else {
        const msg = sign?.msg || sign?.error || $.toStr(sign);
        $.messages.push(/(已签到|重复)/.test(String(msg)) ? `⚠️ 签到: ${msg}` : `❌ 签到: ${msg}`);
    }

    // 碎片余额
    const frag = await apiPost(FRAGMENT_URL, account.token);
    if (isOk(frag)) {
        const d = frag.data || {};
        $.messages.push(`🧧 碎片: ${nv(d.total)}（${nv(d.expireDate)} 过期）`);
    } else {
        $.log(`⚠️ [碎片] 查询失败: ${$.toStr(frag)}`);
    }

    // 会员信息
    const member = await apiPost(MEMBER_INFO_URL, account.token, { type: 1 });
    if (isOk(member)) {
        const d = member.data || {};
        if (d.customerName) $.refLabel = d.customerName;
        $.messages.push(`👤 会员: 捞币 ${nv(d.coinNum)}，捞龄 ${nv(d.memberAge)} 年，成长值 ${nv(d.growthValue)}`);
    } else {
        $.log(`⚠️ [会员] 信息获取失败: ${$.toStr(member)}`);
    }
}

// 优先缓存 token(验活), 失效则重新登录
async function loginWithCache(acc) {
    const cache = $.getjson(CACHE_KEY, {}) || {};
    const item = cache[acc.key];
    if (item?.token && item?.expireTime && Date.now() < item.expireTime - 3600 * 1000) {
        if (isOk(await apiPost(MEMBER_INFO_URL, item.token, { type: 1 }))) {
            $.refLabel = item.label || '';
            $.log(`✅ [缓存] token 有效`);
            return item;
        }
        $.log(`⚠️ [缓存] token 已失效, 重新登录`);
    }
    const account = await loginFlow(acc);
    if (!account) return null;
    cache[acc.key] = { ...account, label: $.refLabel || '', expireTime: Date.now() + 24 * 3600 * 1000, updateTime: new Date().toISOString() };
    $.setdata($.toStr(cache), CACHE_KEY);
    return account;
}

// HDL 抓包凭证优先, 否则 code → getId.json 换 openid/unionId → wechatLogin
async function loginFlow(acc) {
    if (acc.hdl) {
        if (acc.hdl.type === 'app') {
            $.log(`🔑 [登录] 使用 HDL 抓包 token: ${mask(acc.hdl.token)}`);
            return { token: acc.hdl.token };
        }
        const token = await loginByOpenid(acc.hdl.openId, acc.hdl.uid);
        return token ? { token } : null;
    }

    if (!$.codeServer) {
        $.messages.push('❌ 登录: 未配置 code 服务地址 @wxCode.address');
        return null;
    }
    const code = await getWxCode(acc.ref);
    if (!code) return null;

    const ids = await getIdByCode(code);
    if (!ids) return null;
    $.log(`✅ [授权] 海底捞 openid: ${ids.openId}, unionId: ${ids.uid}`);

    const token = await loginByOpenid(ids.openId, ids.uid);
    return token ? { token } : null;
}

// 调用 code 服务(YYB Go)获取微信 code; data.account 备注存入 $.refLabel
async function getWxCode(ref) {
    const options = {
        url: `${$.codeServer}/wxapp/getCode`,
        headers: { 'Content-Type': 'application/json' },
        body: { ref, app_id: APPID }
    };
    if ($.yybToken) options.headers['Authorization'] = `Bearer ${$.yybToken}`;
    const resp = await Request(options);
    if (!resp || resp.code !== 0 || !resp?.data?.result?.code) {
        $.messages.push(`❌ 授权: code 获取失败 ${$.toStr(resp)}`);
        return null;
    }
    $.refLabel = resp.data.account?.remark || resp.data.account?.nickname || resp.data.account?.alias || $.refLabel || '';
    $.log(`✅ [授权] code 获取成功: ${resp.data.result.code}`);
    return String(resp.data.result.code);
}

// code → 海底捞侧 openid / unionId; unionId 即 wechatLogin 的 uid 字段
async function getIdByCode(code) {
    const headers = bizHeaders();
    delete headers['Content-Type'];
    const resp = await Request({
        url: ID_URL,
        headers,
        body: `code=${encodeURIComponent(code)}`,
        _timeout: 30000
    });
    if (!resp?.success || !resp?.value?.openid || !resp?.value?.unionid) {
        $.messages.push(`❌ 授权: getId.json 未返回 openid/unionId ${$.toStr(resp)}`);
        return null;
    }
    return { openId: resp.value.openid, uid: resp.value.unionid };
}

// openId+uid 静默登录（需带全套小程序请求头, 否则服务端回 -50005 参数异常）
async function loginByOpenid(openId, uid) {
    $.log('🔐 [登录] openId+uid 静默登录');
    const resp = await Request({
        url: LOGIN_URL,
        headers: bizHeaders(),
        body: { type: 1, country: 'CN', codeType: 1, business: '登录', terminal: '会员小程序', openId, uid },
        _timeout: 30000
    });
    const token = extractToken(resp);
    if (!token) {
        $.messages.push(`❌ 登录: openId+uid 登录失败 ${$.toStr(resp)}`);
        return null;
    }
    $.log(`✅ [登录] token 获取成功: ${mask(token)}`);
    return token;
}

// ---------- 海底捞业务请求 ----------

function bizHeaders(token) {
    const h = {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'accept-language': 'zh-CN,zh;q=0.9',
        'platformname': 'wechat',
        'appid': '15',
        'appname': 'HDLMember',
        'appversion': '3.257.0',
        'xweb_xhr': '1',
        'Referer': `https://servicewechat.com/${APPID}/236/page-frame.html`
    };
    if (token) h['_haidilao_app_token'] = token;
    return h;
}

async function apiPost(url, token, payload) {
    return await Request({ url, headers: bizHeaders(token), body: payload || {}, _timeout: 30000 });
}

function isOk(resp) {
    return !!(resp && resp.success === true);
}

// 登录响应里 token 字段位置不固定, 逐层找
function extractToken(data) {
    if (!data || typeof data !== 'object') return '';
    const candidates = [data.token, data.accessToken, data.access_token];
    if (data.data && typeof data.data === 'object') {
        candidates.push(data.data.token, data.data.accessToken, data.data.access_token);
    }
    for (const item of candidates) {
        if (item && item !== 'null') return String(item);
    }
    return '';
}

// 签到奖励文案: 碎片/成长值/菜品
function rewardText(detail) {
    if (!detail) return '';
    const parts = [];
    if (detail.fragment) parts.push(`碎片${detail.fragment}`);
    if (detail.growthSeries) parts.push(`成长值${detail.growthSeries}`);
    if (detail.dishes) parts.push(`菜品${detail.dishes}`);
    return parts.join('、');
}

// 解析 HDL 抓包兜底: openId&uid / wx#openId&uid / app#TOKEN / TOKEN, 多条以换行或 ; 分隔
function parseHdlEnv(raw) {
    const accounts = [];
    for (const item of String(raw || '').split(/[\n;,，；]+/).map(s => s.trim()).filter(Boolean)) {
        const parts = item.split('#');
        if (parts[0] === 'app' && parts.length >= 2) {
            accounts.push({ type: 'app', token: parts.slice(1).join('#').trim() });
        } else if (item.includes('&')) {
            const sub = item.replace(/^wx#/, '').split('&');
            accounts.push({ type: 'wx', openId: sub[0].trim(), uid: sub[1] ? sub[1].trim() : '' });
        } else {
            accounts.push({ type: 'app', token: item });
        }
    }
    return accounts;
}

function mask(value) {
    value = String(value || '');
    if (value.length <= 12) return value;
    return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function nv(value) {
    return value === null || value === undefined ? '-' : value;
}

// ---------- 工具函数 ----------

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
    .catch((e) => { $.logErr(e); $.Messages.push(`❌ ${e.message || e}`); })
    .finally(async () => {
        await sendMsg($.Messages.join('\n'));
        $.done();
    });

function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }
