/**
 * 脚本名称：途虎养车签到
 * 活动规则：途虎养车小程序每日签到领积分
 * 脚本说明：通过 code 服务(YYB Go)获取微信 code，
 *          login/authSilentSign 用 code 换 userSession → getSignInInfo 查签到状态与积分 → dailyCheckIn/userCheckIn 提交签到，
 *          userSession 本地缓存自动复用/失效刷新。支持 Node.js / Quantumult X / Loon / Surge / Stash。
 * 配置说明：boxjs 订阅「Code Server」分组中填写「获取小程序code」配置项(@wxCode.*):
 *          - @wxCode.open    开启code模式(true)
 *          - @wxCode.address 服务器地址, 如 http://192.168.2.5:8000
 *          - @wxCode.token   接口鉴权 token (请求头 Authorization: Bearer <token>)
 *          账号 ref 配在本脚本的 boxjs 区域 THYC_REF 中, 多个以英文逗号隔开
 *          Node 环境变量同名可用: WX_CODE_ADDRESS / WX_CODE_TOKEN / THYC_REF
 * 更新时间：2026-10-04

------------------ Surge 配置 ------------------

[Script]
途虎养车签到 = type=cron,cronexp="24 8 * * *",script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/thyc_sign.js,wake-system=1

------------------- Loon 配置 -------------------

[Script]
cron "24 8 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/thyc_sign.js, timeout=600, tag=途虎养车签到

--------------- Quantumult X 配置 ---------------

[task_local]
"24 8 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/thyc_sign.js, tag=途虎养车签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/thyc.png, enabled=true

 */

const $ = new Env('途虎养车');
$.is_debug = getEnv('thyc_debug', 'is_debug') || 'false';  // 调试模式(boxjs 开关 thyc_debug)
$.Messages = [];

// ---- 业务常量 ----
const APPID = 'wx27d20205249c56a3';
const BASE_URL = 'https://cl-gateway.tuhu.cn';
const LOGIN_URL = `${BASE_URL}/cl-user-auth-login/login/authSilentSign`;
const SIGN_INFO_URL = `${BASE_URL}/cl-common-api/api/member/getSignInInfo`;
const SIGN_SUBMIT_URL = `${BASE_URL}/cl-common-api/api/dailyCheckIn/userCheckIn`;
const CACHE_KEY = 'THYC_SESSION_CACHE';  // 缓存: {ref:{token,nickName,label,expireTime,updateTime}}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf2541938) XWEB/19823';
const REFERER = `https://servicewechat.com/${APPID}/1319/page-frame.html`;


// 主函数
async function main() {
    $.codeServer = (getEnv('WX_CODE_ADDRESS', '@wxCode.address') || '').replace(/\/+$/, '');
    $.refStr = getEnv('THYC_REF') || '';
    $.yybToken = getEnv('WX_CODE_TOKEN', '@wxCode.token') || '';

    const openRaw = getEnv('WX_CODE_OPEN', '@wxCode.open');
    const refs = $.refStr.split(/[,，\s\n]+/).filter(Boolean);

    if (openRaw && String(openRaw).toLowerCase() === 'false') {
        throw new Error('boxjs 中「开启code模式」未开启 ❌');
    }
    if (!refs.length) {
        throw new Error('未配置账号：请在 boxjs「途虎养车签到」填写 THYC_REF ❌');
    }
    if (!$.codeServer) {
        throw new Error('未配置 code 服务地址 @wxCode.address ❌');
    }

    for (let i = 0; i < refs.length; i++) {
        $.log(`\n----- 账号 [${i + 1}/${refs.length}] ref=${refs[i]} 开始执行 -----\n`);
        $.messages = [];
        await runAccount(refs[i]);
        $.messages.splice(0, 0, `🚗 账号 ${i + 1} [${$.refLabel || refs[i]}]`);
        $.Messages = $.Messages.concat($.messages);
        if (i < refs.length - 1) await $.wait(2000);
    }
}

// 单账号: 登录 + 签到
async function runAccount(ref) {
    await $.wait(1000 * (2 + Math.floor(Math.random() * 5)));  // 启动随机延迟

    let account = await loginWithCache(ref);
    if (!account) return;

    let info = account.info || await getSignInInfo(account.token);

    // 缓存的 userSession 判活通过后仍可能失效, 强制重登一次
    if (!isRespOk(info) && account.cached) {
        $.log('🔁 [刷新] 缓存 userSession 已失效, 重新登录');
        clearCache(ref);
        account = await loginWithCache(ref);
        if (!account) return;
        info = account.info || await getSignInInfo(account.token);
    }

    if (!isRespOk(info)) {
        $.messages.push(`📊 签到状态: ❌ ${errMsg(info)}`);
        return;
    }

    const before = toInt(info.data.userIntegral);
    if ($.nickName) $.messages.push(`👤 昵称: ${$.nickName}`);

    if (info.data.signInStatus) {
        $.messages.push(`📝 签到: 今日已签到`);
        $.messages.push(`💰 当前积分: ${before}`);
        return;
    }

    $.log('📝 [签到] 未签到, 开始签到...');
    const submit = await Request({ url: SIGN_SUBMIT_URL, headers: commonHeaders(account.token), body: { channel: 'WXAPP' }, _timeout: 30000 });

    if (!isRespOk(submit)) {
        const m = errMsg(submit);
        if (!/已签到|重复/.test(m)) {
            $.messages.push(`📝 签到: ❌ ${m}`);
            return;
        }
        $.messages.push(`📝 签到: 今日已签到`);
        $.messages.push(`💰 当前积分: ${before}`);
        return;
    }

    const reward = toInt(submit.data.rewardIntegral);
    const days = toInt(submit.data.continuousDays);
    $.messages.push(`📝 签到: ✅ 签到成功 +${reward}积分，连续签到${days}天`);

    await $.wait(1000 + Math.floor(Math.random() * 2000));
    const after = await getSignInInfo(account.token);
    if (isRespOk(after)) {
        const afterPoint = toInt(after.data.userIntegral);
        const earned = reward || Math.max(afterPoint - before, 0);
        $.messages.push(`💰 积分: ${before} → ${afterPoint} (+${earned})`);
    } else {
        $.messages.push(`💰 积分: ${before} (+${reward})`);
    }
}

// 查询签到状态与积分
async function getSignInInfo(token) {
    return await Request({ url: SIGN_INFO_URL, headers: commonHeaders(token), body: { channel: 'WXAPP' }, _timeout: 30000 });
}

// 优先缓存 userSession(以签到状态查询验活), 失效则 code 登录
async function loginWithCache(ref) {
    const cache = $.getjson(CACHE_KEY, {}) || {};
    const item = cache[ref];
    if (item?.token && item?.expireTime && Date.now() < item.expireTime - 3600 * 1000) {
        const info = await getSignInInfo(item.token);
        if (isRespOk(info)) {
            $.refLabel = item.label || '';
            $.nickName = item.nickName || '';
            $.log('✅ [缓存] userSession 有效');
            return { token: item.token, nickName: $.nickName, cached: true, info };
        }
        $.log('⚠️ [缓存] userSession 已失效, 重新登录');
    }

    const account = await loginFlow(ref);
    if (!account) return null;

    cache[ref] = { ...account, label: $.refLabel || '', expireTime: Date.now() + 24 * 3600 * 1000, updateTime: new Date().toISOString() };
    $.setdata($.toStr(cache), CACHE_KEY);
    return { ...account, cached: false };
}

// 使缓存失效
function clearCache(ref) {
    const cache = $.getjson(CACHE_KEY, {}) || {};
    delete cache[ref];
    $.setdata($.toStr(cache), CACHE_KEY);
}

// code → userSession
async function loginFlow(ref) {
    const code = await getWxCode(ref);
    if (!code) return null;

    const resp = await Request({ url: LOGIN_URL, headers: commonHeaders(), body: { channel: 'WXAPP', code }, _timeout: 30000 });
    const token = resp?.data?.userSession || '';
    if (!isRespOk(resp) || !token) {
        $.messages.push(`❌ 登录: 未获取到 userSession ${$.toStr(resp)}`);
        return null;
    }
    $.nickName = resp.data.nickName || '微信用户';
    $.log(`✅ [登录] ${$.nickName} userSession: ${mask(token)}`);
    return { token, nickName: $.nickName };
}

// 调用 code 服务(YYB Go)获取微信 code; data.account 备注存入 $.refLabel
async function getWxCode(ref) {
    const options = {
        url: `${$.codeServer}/wxapp/getCode`,
        headers: { 'Content-Type': 'application/json' },
        body: { ref, app_id: APPID },
        _timeout: 30000
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

// ---------- 途虎业务请求头 ----------

function commonHeaders(userSession) {
    const h = {
        'Host': 'cl-gateway.tuhu.cn',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': USER_AGENT,
        'Referer': REFERER,
        'xweb_xhr': '1',
        'channel': 'wechat-miniprogram',
        'authType': 'oauth',
        'api_level': '2',
        'vehicleClass': 'CAR',
        'version': '7.62.8',
        'currentPage': 'memberMallPackage/pages/pointCenter/pointCenter',
        'distinct_id': '6a68cbca-ce9a-4b0e-8092-cc5a85cf9a85',
        'deviceId': `${Date.now()}-${randomInt(1000000, 9999999)}-0f6cb850fc64da-24853921`,
        'fingerprint': `sMPVY${Math.floor(Date.now() / 1000)}QPV2wLVhl8f`,
        'orion_biz_gps_latitude': '22.787150540279182',
        'orion_biz_gps_longitude': '108.27980328217664',
        'orion_biz_gps_province': '%E5%B9%BF%E8%A5%BF%E5%A3%AE%E6%97%8F%E8%87%AA%E6%B2%BB%E5%8C%BA',
        'orion_biz_gps_city': '%E5%8D%97%E5%AE%81%E5%B8%82',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty'
    };
    if (userSession) h['Authorization'] = `Bearer ${userSession}`;
    return h;
}

// ---------- 工具函数 ----------

function isRespOk(resp) {
    return [10000, '10000'].includes(resp?.code);
}

function errMsg(resp) {
    return String(resp?.message || resp?.msg || $.toStr(resp) || '请求失败');
}

function toInt(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function mask(value) {
    const s = String(value || '');
    return s.length <= 12 ? s : `${s.slice(0, 6)}...${s.slice(-6)}`;
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
    .catch((e) => { $.logErr(e); $.Messages.push(`❌ ${e.message || e}`); })
    .finally(async () => {
        await sendMsg($.Messages.join('\n'));
        $.done();
    });

function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }
