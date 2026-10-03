/**
 * 脚本名称：蜜雪冰城签到
 * 活动规则：每日签到领雪王币 + 雪王铺活动访问 + 余额查询
 * 脚本说明：由 YYB-Go-Enhanced 的「蜜雪冰城_code版.py」改造。通过 code 服务(YYB Go)获取微信 code，
 *          code2Session + regByUnionid 两步登录换 token（RSA-SHA256 签名），token 本地缓存自动复用/刷新。
 *          支持 Node.js / Quantumult X / Loon / Surge / Stash 环境（纯 JS RSA 签名，无外部依赖）。
 * 配置说明：boxjs 订阅「Code Server」分组中填写「获取小程序code」配置项(@wxCode.*):
 *          - @wxCode.open    开启code模式(true)
 *          - @wxCode.address 服务器地址, 如 http://192.168.2.5:8000
 *          - @wxCode.ref     账号ID/UIN/openid, 多个以英文逗号隔开
 *          - @wxCode.app_id  小程序 app_id(留空默认蜜雪 wx7696c66d2245d107)
 *          - @wxCode.token   接口鉴权 token (请求头 Authorization: Bearer <token>)
 *          Node 环境变量同名可用: WX_CODE_ADDRESS / WX_CODE_REF / WX_CODE_APP_ID / WX_CODE_TOKEN
 *          兜底: MXBC_TOKEN 直填抓包 Access-Token(多账号换行或&分割)，配置后不走 code 服务
 * 更新时间：2026-10-03

------------------ Surge 配置 ------------------

[Script]
蜜雪冰城签到 = type=cron,cronexp="0 8 * * *",script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/mxbc_sign.js,wake-system=1

------------------- Loon 配置 -------------------

[Script]
cron "0 8 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/mxbc_sign.js, timeout=600, tag=蜜雪冰城签到

--------------- Quantumult X 配置 ---------------

[task_local]
"0 8 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/mxbc_sign.js, tag=蜜雪冰城签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/mxbc.png, enabled=true

 */

const $ = new Env('蜜雪冰城');
$.is_debug = getEnv('is_debug') || 'false';  // 调试模式
$.Messages = [];

const APPID = 'wx7696c66d2245d107';            // 蜜雪小程序 appid (code 服务用)
const APP_ID = 'd82be6bbc1da11eb9dd000163e122ecb';  // 蜜雪业务 appId (签名用)
const BASE_URL = 'https://mxsa.mxbc.net';
const API_BASE = `${BASE_URL}/api`;
const CODE2SESSION_URL = `${API_BASE}/v1/app/code2Session`;
const REG_BY_UNIONID_URL = `${API_BASE}/v1/app/regByUnionid`;
const CUSTOMER_INFO_URL = `${API_BASE}/v1/customer/info`;
const SIGNIN_URL = `${API_BASE}/v1/customer/signin`;
const DUIBA_LOGIN_URL = `${API_BASE}/v1/duiba/getLoginUrl`;
const CACHE_KEY = 'MXBC_TOKEN_CACHE';

const PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQCtypUdHZJKlQ9L
L6lIJSphnhqjke7HclgWuWDRWvzov30du235cCm13mqJ3zziqLCwstdQkuXo9sOP
Ih94t6nzBHTuqYA1whrUnQrKfv9X4/h3QVkzwT+xWflE+KubJZoe+daLKkDeZjVW
nUku8ov0E5vwADACfntEhAwiSZUALX9UgNDTPbj5ESeII+VztZ/KOFsRHMTfDb1G
IR/dAc1mL5uYbh0h2Fa/fxRPgf7eJOeWGiygesl3CWj0Ue13qwX9PcG7klJXfToI
576MY+A7027a0aZ49QhKnysMGhTdtFCksYG0lwPz3bIR16NvlxNLKanc2h+ILTFQ
bMW/Y3DRAgMBAAECggEBAJGTfX6rE6zX2bzASsu9HhgxKN1VU6/L70/xrtEPp4SL
SpHKO9/S/Y1zpsigr86pQYBx/nxm4KFZewx9p+El7/06AX0djOD7HCB2/+AJq3iC
5NF4cvEwclrsJCqLJqxKPiSuYPGnzji9YvaPwArMb0Ff36KVdaHRMw58kfFys5Y2
HvDqh4x+sgMUS7kSEQT4YDzCDPlAoEFgF9rlXnh0UVS6pZtvq3cR7pR4A9hvDgX9
wU6zn1dGdy4MEXIpckuZkhwbqDLmfoHHeJc5RIjRP7WIRh2CodjetgPFE+SV7Sdj
ECmvYJbet4YLg+Qil0OKR9s9S1BbObgcbC9WxUcrTgECgYEA/Yj8BDfxcsPK5ebE
9N2teBFUJuDcHEuM1xp4/tFisoFH90JZJMkVbO19rddAMmdYLTGivWTyPVsM1+9s
tq/NwsFJWHRUiMK7dttGiXuZry+xvq/SAZoitgI8tXdDXMw7368vatr0g6m7ucBK
jZWxSHjK9/KVquVr7BoXFm+YxaECgYEAr3sgVNbr5ovx17YriTqe1FLTLMD5gPrz
ugJj7nypDYY59hLlkrA/TtWbfzE+vfrN3oRIz5OMi9iFk3KXFVJMjGg+M5eO9Y8m
14e791/q1jUuuUH4mc6HttNRNh7TdLg/OGKivE+56LEyFPir45zw/dqwQM3jiwIz
yPz/+bzmfTECgYATxrOhwJtc0FjrReznDMOTMgbWYYPJ0TrTLIVzmvGP6vWqG8rI
S8cYEA5VmQyw4c7G97AyBcW/c3K1BT/9oAj0wA7wj2JoqIfm5YPDBZkfSSEcNqqy
5Ur/13zUytC+VE/3SrrwItQf0QWLn6wxDxQdCw8J+CokgnDAoehbH6lTAQKBgQCE
67T/zpR9279i8CBmIDszBVHkcoALzQtU+H6NpWvATM4WsRWoWUx7AJ56Z+joqtPK
G1WztkYdn/L+TyxWADLvn/6Nwd2N79MyKyScKtGNVFeCCJCwoJp4R/UaE5uErBNn
OH+gOJvPwHj5HavGC5kYENC1Jb+YCiEDu3CB0S6d4QKBgQDGYGEFMZYWqO6+LrfQ
ZNDBLCI2G4+UFP+8ZEuBKy5NkDVqXQhHRbqr9S/OkFu+kEjHLuYSpQsclh6XSDks
5x/hQJNQszLPJoxvGECvz5TN2lJhuyCupS50aGKGqTxKYtiPHpWa8jZyjmanMKnE
dOGyw/X4SFyodv8AEloqd81yGg==
-----END PRIVATE KEY-----`;


// 主函数
async function main() {
    $.codeServer = (getEnv('WX_CODE_ADDRESS', '@wxCode.address') || '').replace(/\/+$/, '');
    $.refStr = getEnv('WX_CODE_REF', '@wxCode.ref') || '';
    $.yybAppId = getEnv('WX_CODE_APP_ID', '@wxCode.app_id') || APPID;
    $.yybToken = getEnv('WX_CODE_TOKEN', '@wxCode.token') || '';

    const openRaw = getEnv('WX_CODE_OPEN', '@wxCode.open');
    const refs = $.refStr.split(/[,，\s\n]+/).filter(Boolean);
    const directTokens = (getEnv('MXBC_TOKEN') || '').split(/[&\n]/).map(s => s.trim()).filter(Boolean);

    if (openRaw && String(openRaw).toLowerCase() === 'false') {
        throw new Error('boxjs 中「开启code模式」未开启 ❌');
    }

    if (!refs.length && !directTokens.length) {
        throw new Error('未配置账号：请在 boxjs「获取小程序code」填写 ref，或配置 MXBC_TOKEN 直填 token ❌');
    }
    if (refs.length && !$.codeServer) {
        throw new Error('未配置 code 服务地址 @wxCode.address ❌');
    }

    for (let i = 0; i < refs.length; i++) {
        $.log(`\n----- 账号 [${i + 1}/${refs.length}] ref=${mask(refs[i])} 开始执行 -----\n`);
        $.messages = [];
        await runAccount(refs[i]);
        $.messages.splice(0, 0, `🍦 账号 ${i + 1} [${mask(refs[i])}]`);
        $.Messages = $.Messages.concat($.messages);
        if (i < refs.length - 1) await $.wait(2000);
    }

    for (let i = 0; i < directTokens.length; i++) {
        $.log(`\n----- 直填 Token [${i + 1}/${directTokens.length}] 开始执行 -----\n`);
        $.messages = [];
        await runTasks(directTokens[i], `Token${i + 1}`);
        $.messages.splice(0, 0, `🍦 账号 ${refs.length + i + 1} [直填Token]`);
        $.Messages = $.Messages.concat($.messages);
    }
}

// 单账号: 登录 + 任务
async function runAccount(ref) {
    await $.wait(1000 * (2 + Math.floor(Math.random() * 5)));  // 启动随机延迟
    const token = await loginWithCache(ref);
    if (!token) return;
    await runTasks(token, ref);
}

// 任务流程: 签到 / 雪王铺 / 余额
async function runTasks(token, name) {
    // 签到
    try {
        const signin = await apiGet(SIGNIN_URL, token);
        if (signin?.code === 0) {
            const d = signin.data || {};
            $.messages.push(`✅ 签到: 成功, 累计 ${d.ruleValueGrowth ?? '?'} 天, 本次 +${d.ruleValuePoint ?? '?'} 雪王币`);
        } else if (/已签到|重复/.test(String(signin?.msg || ''))) {
            $.messages.push(`📝 签到: 今日已签到`);
        } else {
            $.messages.push(`⚠️ 签到: ${signin?.msg || preview(signin, 300)}`);
        }
    } catch (e) {
        $.messages.push(`❌ 签到: ${e.message || e}`);
    }

    // 雪王铺活动
    try {
        const duiba = await apiGet(DUIBA_LOGIN_URL, token);
        const loginUrl = duiba?.code === 0 && duiba?.data?.loginUrl;
        if (loginUrl) {
            const actResp = await Request({
                url: loginUrl,
                headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X)mxsa_mxbc' },
                _respType: 'all', _timeout: 20000
            });
            const setCookieRaw = $.toStr(actResp?.headers?.['Set-Cookie'] || actResp?.headers?.['set-cookie'] || '');
            const keep = setCookieRaw.match(/(?:wdata4|w_ts|_ac|wdata3|dcustom)=[^;,"\\]+/g) || [];
            const origin = (loginUrl.match(/^https?:\/\/[^/]+/) || [''])[0];
            await $.wait(1000 * (2 + Math.floor(Math.random() * 3)));
            await Request({
                url: `${origin}/chome/index?from=login&spm=76177.1.1.1`,
                headers: {
                    'Cookie': keep.join('; '),
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X)mxsa_mxbc'
                }
            });
            $.messages.push(`✅ 雪王铺: 访问成功`);
        } else {
            $.messages.push(`⚠️ 雪王铺: 获取跳转链接失败 ${duiba?.msg || ''}`);
        }
    } catch (e) {
        $.messages.push(`❌ 雪王铺: ${e.message || e}`);
    }

    // 雪王币余额
    try {
        const info = await apiGet(CUSTOMER_INFO_URL, token);
        if (info?.code === 0) {
            $.messages.push(`💰 雪王币: ${info?.data?.customerPoint ?? 0}`);
        } else {
            $.messages.push(`⚠️ 余额: 查询失败 ${info?.msg || ''}`);
        }
    } catch (e) {
        $.messages.push(`❌ 余额: ${e.message || e}`);
    }
}

// 优先缓存 token(验活), 失效则 code 登录
async function loginWithCache(ref) {
    const cache = $.getjson(CACHE_KEY, {}) || {};
    const item = cache[ref];
    if (item?.token && item?.expireTime && Date.now() < item.expireTime - 3600 * 1000) {
        try {
            const info = await apiGet(CUSTOMER_INFO_URL, item.token);
            if (info?.code === 0) {
                $.log(`✅ [缓存] token 有效, 雪王币: ${info?.data?.customerPoint}`);
                return item.token;
            }
        } catch (e) { }
        $.log(`⚠️ [缓存] token 已失效, 重新登录`);
    }

    const code = await getWxCode(ref);
    if (!code) return null;

    const sess = await apiPost(CODE2SESSION_URL, '', { miniAppId: APPID, code });
    if (sess?.code !== 0 || !sess?.data?.openid) {
        $.messages.push(`❌ 登录: code2Session 失败 ${preview(sess, 200)}`);
        return null;
    }
    $.log(`✅ [登录] code2Session 成功`);

    const reg = await apiPost(REG_BY_UNIONID_URL, '', {
        code,
        openId: sess.data.openid,
        unionid: sess.data.unionid,
        third: 'wxmini',
        miniAppId: APPID
    });
    const token = extractToken(reg);
    if (!token) {
        $.messages.push(`❌ 登录: 未识别 token 字段 ${preview(reg, 200)}`);
        return null;
    }

    let expireTime = Date.now() + 24 * 3600 * 1000;
    const inner = (reg && reg.data) || {};
    const rawExpire = inner.expireTime || inner.expire_time || null;
    if (rawExpire) {
        expireTime = typeof rawExpire === 'number' ? rawExpire : (Date.parse(rawExpire) || expireTime);
    } else if (typeof inner.expiresIn === 'number' && inner.expiresIn > 0) {
        expireTime = Date.now() + inner.expiresIn * 1000;
    }
    cache[ref] = { token, expireTime, updateTime: new Date().toISOString() };
    $.setdata($.toStr(cache), CACHE_KEY);
    $.log(`✅ [登录] token 获取成功: ${mask(token)}`);
    return token;
}

// 调用 code 服务(YYB Go)获取微信 code
async function getWxCode(ref) {
    const options = {
        url: `${$.codeServer}/wxapp/getCode`,
        headers: { 'Content-Type': 'application/json' },
        body: { ref, app_id: $.yybAppId }
    };
    if ($.yybToken) options.headers['Authorization'] = `Bearer ${$.yybToken}`;
    const resp = await Request(options);
    if (!resp || resp.code !== 0) {
        $.messages.push(`❌ 授权: code 获取失败 ${preview(resp, 200)}`);
        return null;
    }
    const code = findCode(resp.data);
    if (!code) {
        $.messages.push(`❌ 授权: code 服务未返回 wx.login code ${preview(resp, 200)}`);
        return null;
    }
    $.log(`✅ [授权] code 获取成功: ${mask(code)}`);
    return code;
}

function findCode(v) {
    if (v && typeof v === 'object') {
        if (typeof v.code === 'string' && v.code && v.code !== 'null' && v.code !== 'invalid') return v.code;
        for (const k of Object.keys(v)) {
            const found = findCode(v[k]);
            if (found) return found;
        }
    }
    return null;
}

function extractToken(data) {
    if (!data || typeof data !== 'object') return null;
    const cands = [data.token, data.accessToken, data.access_token, data.jwt];
    if (data.data && typeof data.data === 'object') {
        cands.push(data.data.token, data.data.accessToken, data.data.access_token, data.data.jwt);
    }
    for (const c of cands) {
        if (c && c !== 'null') return String(c);
    }
    return null;
}

// ---------- 蜜雪业务请求 ----------

function commonHeaders(token) {
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36 MicroMessenger/7.0.4.501 NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF',
        'xweb_xhr': '1',
        'Access-Token': token || '',
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Referer': `https://servicewechat.com/${APPID}/59/page-frame.html`,
        'Accept-Language': 'en-us,en'
    };
}

async function apiGet(url, token, extraParams) {
    const params = signedParams(extraParams);
    const query = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
    return await Request({ url: `${url}?${query}`, headers: commonHeaders(token), _timeout: 30000 });
}

async function apiPost(url, token, payload) {
    return await Request({ url, headers: commonHeaders(token), body: getSignedBody(payload), _timeout: 30000 });
}

function ts13() { return String(Date.now()); }

// GET 签名参数: 仅 appId + t 参与拼串
function signedParams(extra) {
    const t = ts13();
    const params = { appId: APP_ID, t };
    if (extra) Object.assign(params, extra);
    params.sign = SHA256WithRSA(`appId=${APP_ID}&t=${t}`) || '';
    return params;
}

// POST 签名体: 键排序拼串
function getSignedBody(params) {
    const body = { ...(params || {}) };
    body.t = Date.now();
    body.appId = APP_ID;
    const content = Object.keys(body).sort()
        .filter(k => body[k] || body[k] === 0)
        .map(k => `${k}=${typeof body[k] === 'object' ? JSON.stringify(body[k]) : body[k]}`)
        .join('&');
    body.sign = SHA256WithRSA(content) || '';
    return body;
}

// ---------- 工具函数 ----------

function getEnv(...keys) {
    for (let key of keys) {
        var value = $.isNode() ? process.env[key] || process.env[key.toUpperCase()] || process.env[key.toLowerCase()] || $.getdata(key) : $.getdata(key);
        if (value) return value;
    }
}

function mask(value) {
    value = String(value || '');
    if (value.length <= 12) return value;
    return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function preview(data, limit = 800) {
    try { return ($.toStr(data) || String(data)).slice(0, limit); } catch (e) { return String(data).slice(0, limit); }
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

// ---------- 纯 JS RSA-SHA256 签名封装 ----------
function SHA256WithRSA(string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function BytesToBigInt(bytes) { let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); return n; } function BigIntToBytes(n, len) { const out = new Array(len).fill(0); for (let i = len - 1; i >= 0 && n > 0n; i--) { out[i] = Number(n & 0xffn); n >>= 8n; } return out; } function ModPow(base, exp, mod) { let r = 1n; base %= mod; while (exp > 0n) { if (exp & 1n) r = (r * base) % mod; base = (base * base) % mod; exp >>= 1n; } return r; } function DerRead(buf, off) { const tag = buf[off++]; let len = buf[off++]; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + i]; off += n; } return { tag, start: off, len }; } function DerChildren(buf, start, end) { const list = []; let off = start; while (off < end) { const t = DerRead(buf, off); list.push(t); off = t.start + t.len; } return list; } if (!SHA256WithRSA._key) { try { const der = Base64ToBytes(PRIVATE_KEY_PEM.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); let seqs = DerChildren(der, DerRead(der, 0).start, der.length); const inner = seqs.find(s => s.tag === 0x04); if (inner) { const seq2 = DerRead(der, inner.start); seqs = DerChildren(der, seq2.start, seq2.start + seq2.len); } const ints = seqs.filter(s => s.tag === 0x02); const n = BytesToBigInt(der.slice(ints[1].start, ints[1].start + ints[1].len)); const d = BytesToBigInt(der.slice(ints[3].start, ints[3].start + ints[3].len)); SHA256WithRSA._key = { n, d, k: (n.toString(16).length + 1) >> 1 }; } catch (e) { $.logErr('❌ [签名] 私钥解析失败: ' + (e.message || e)); return null; } } const key = SHA256WithRSA._key; try { const digestInfo = [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20, ...SHA256(Utf8Encode(string))]; const padded = [0x00, 0x01, ...new Array(key.k - digestInfo.length - 3).fill(0xff), 0x00, ...digestInfo]; const sig = ModPow(BytesToBigInt(padded), key.d, key.n); return BytesToBase64(BigIntToBytes(sig, key.k)).replace(/\//g, '_').replace(/\+/g, '-'); } catch (e) { $.logErr('❌ [签名] 签名异常: ' + (e.message || e)); return null; } }
