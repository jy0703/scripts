/**
 * 脚本名称：柠季签到
 * 活动规则：柠季柠檬茶专门店(美团 CRM)小程序每日签到得积分，连签若干天额外送优惠券
 * 脚本说明：code 服务(YYB Go) /wxapp/getPhoneNumber 取微信手机号授权 code(64 位 hex) →
 *          美团 CRM member/login(verifyType=3, identificationAuthParseCode=1) 换 UNI-TOKEN(JWT,
 *          服务端只给 2 小时) → 查本月签到记录 → sign-in/participate 签到，
 *          token 缓存复用、失效自动重登。支持 Node.js / Quantumult X / Loon / Surge / Stash。
 *          活动接口(campaign/*)的 mtgsig 调自建签名服务生成(服务端跑美团 @mtfe/wx-jsguard 抽取库,
 *          仓库里不放该库), 地址填 @wxCode.mtgsig、鉴权复用 @wxCode.token; 留空或调用失败则不签名。
 *          member/login 与 queryMemberId 按小程序行为本来就不带 mtgsig。
 *          实测 poiId/poiType/tenantId/orgId 缺一会静默回"未签到"; 带被篡改的 mtgsig 会被网关 Forbidden。
 *          柠季会员按手机号认人，故取号走手机号授权而非 wx.login code。
 * 配置说明：boxjs 订阅「Code Server」分组中填写「获取小程序code」配置项(@wxCode.*):
 *          - @wxCode.open    开启code模式(true)
 *          - @wxCode.address 服务器地址, 如 http://192.168.2.5:8000
 *          - @wxCode.token   接口鉴权 token (请求头 Authorization: Bearer <token>)
 *          账号 ref 配在本脚本的 boxjs 区域 NJ_REF 中, 多个以英文逗号隔开
 *          Node 环境变量同名可用: WX_CODE_ADDRESS / WX_CODE_TOKEN / NJ_REF
 * 更新时间：2026-10-09

------------------ Surge 配置 ------------------

[Script]
柠季签到 = type=cron,cronexp="0 9 * * *",script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/nj_sign.js,wake-system=1

------------------- Loon 配置 -------------------

[Script]
cron "0 9 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/nj_sign.js, timeout=600, tag=柠季签到

--------------- Quantumult X 配置 ---------------

[task_local]
"0 9 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/nj_sign.js, tag=柠季签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/nj.png, enabled=true

 */

const $ = new Env('柠季');
$.is_debug = getEnv('nj_debug', 'is_debug') || 'false';  // 调试模式
$.Messages = [];

// ---- 业务常量 (照抓包搬运) ----
const APPID = 'wx177c513cc05c325d';                 // 柠季柠檬茶专门店
const BASE_URL = 'https://pos.meituan.com';
const TENANT_ID = '10159618';                       // 柠季租户, 同时是 cookie 名 UNI-TOKEN-<tenantId> 的一部分
const ORG_ID = '429605';
const POI_ID = '0';
const POI_TYPE = '1';
const CAMPAIGN_TYPE = '87';                         // 签到活动类型
const DEFAULT_CAMPAIGN_ID = '1010906116';           // 「26年会员3月起签到活动」, 有效期至 2026-12-31
const CACHE_KEY = 'NJ_TOKEN_CACHE';                 // 缓存键: 存 {ref:{token,cardId,memberId,label,expireTime,updateTime}}
const QUERY_SUFFIX = `?yodaReady=wx&csecappid=${APPID}&csecplatform=3&csecversionname=127.34.000&csecversion=1.4.0`;

const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.79(0x18004f26) NetType/WIFI Language/zh_CN';

// 主函数
async function main() {
    $.codeServer = (getEnv('WX_CODE_ADDRESS', '@wxCode.address') || '').replace(/\/+$/, '');
    $.yybToken = getEnv('WX_CODE_TOKEN', '@wxCode.token') || '';
    $.campaignId = getEnv('NJ_CAMPAIGN_ID') || DEFAULT_CAMPAIGN_ID;
    // 签名服务地址, 复用 @wxCode.token 做 Bearer 鉴权; 留空则全程不带 mtgsig(实测接口也放行)
    $.mtgsigApi = (getEnv('MTGSIG_API', '@wxCode.mtgsig') || '').replace(/\/+$/, '');

    const refs = (getEnv('NJ_REF') || '').split(/[,，\s\n]+/).filter(Boolean);
    if (!refs.length) throw new Error('未配置账号：请在 boxjs「柠季签到」填写 NJ_REF ❌');

    for (let i = 0; i < refs.length; i++) {
        $.log(`\n----- 账号 [${i + 1}/${refs.length}] ref=${refs[i]} 开始执行 -----\n`);
        $.messages = [];
        await runAccount(refs[i]);
        $.messages.splice(0, 0, `🍋 账号 ${i + 1} [${$.refLabel || refs[i]}]`);
        $.Messages = $.Messages.concat($.messages);
        if (i < refs.length - 1) await $.wait(2000);
    }
}

// 单账号: 登录 + 查签到记录 + 签到
async function runAccount(ref) {
    await $.wait(1000 * (2 + Math.floor(Math.random() * 5)));  // 启动随机延迟
    const account = await loginWithCache(ref);
    if (!account) return;
    await signIn(account);
}

// 优先缓存 token(验活), 失效则 code 登录
async function loginWithCache(ref) {
    const cache = $.getjson(CACHE_KEY, {}) || {};
    const item = cache[ref];
    if (item?.token && item?.expireTime && Date.now() < item.expireTime) {
        const alive = await Request({ url: `${BASE_URL}/api/v1/crm/frontend/customer/member/queryMemberId`, headers: crmHeaders(item) });
        if (alive?.code === 0 && alive.data) {
            $.refLabel = item.label || '';
            $.log(`✅ [缓存] token 有效, memberId: ${alive.data}`);
            return item;
        }
        $.log(`⚠️ [缓存] token 已失效: ${$.toStr(alive)}`);
    }
    const account = await loginFlow(ref);
    if (!account) return null;
    cache[ref] = { ...account, label: $.refLabel || '', expireTime: Date.now() + 100 * 60 * 1000, updateTime: new Date().toISOString() };
    $.setdata($.toStr(cache), CACHE_KEY);
    return account;
}

// code 服务手机号授权 code → member/login 换 UNI-TOKEN
async function loginFlow(ref) {
    if (!$.codeServer) {
        $.messages.push('❌ 登录: 未配置 code 服务地址 @wxCode.address');
        return null;
    }
    const verifyCode = await getPhoneAuthCode(ref);
    if (!verifyCode) return null;

    const resp = await Request({
        url: `${BASE_URL}/api/v1/adapters/crm/member/login`,
        headers: loginHeaders(),
        body: {
            appId: APPID,
            wxOpenId: '',
            verifyCode,
            verifyType: 3,
            sceneType: 10,
            loginExtraInfo: { identificationAuthParseCode: 1 },
        },
        _timeout: 30000,
    });
    const data = resp?.data;
    if (resp?.code !== 0 || !data?.token) {
        $.messages.push(`❌ 登录: ${resp?.message || $.toStr(resp)}`);
        return null;
    }
    $.log(`✅ [登录] memberId: ${data.memberId}, cardId: ${data.cardId}`);
    return { token: data.token, cardId: String(data.cardId || ''), memberId: String(data.memberId || '') };
}

// 调用 code 服务(YYB Go)取微信手机号授权 code; data.account 备注存入 $.refLabel
async function getPhoneAuthCode(ref) {
    const options = {
        url: `${$.codeServer}/wxapp/getPhoneNumber`,
        headers: { 'Content-Type': 'application/json' },
        body: { ref, app_id: APPID }
    };
    if ($.yybToken) options.headers['Authorization'] = `Bearer ${$.yybToken}`;
    const resp = await Request(options);
    const verifyCode = resp?.data?.result?.code;
    if (!resp || resp.code !== 0 || !verifyCode) {
        $.messages.push(`❌ 授权: 手机号 code 获取失败 ${$.toStr(resp)}`);
        return null;
    }
    $.refLabel = resp.data.account?.remark || resp.data.account?.nickname || resp.data.account?.alias || $.refLabel || '';
    $.log(`✅ [授权] 手机号 code 获取成功: ${verifyCode}`);
    return String(verifyCode);
}

// campaign/* 活动接口: 与小程序一致带 mtgsig(签名失败则不签名)
async function campaignPost(path, account, body) {
    const url = `${BASE_URL}${path}${QUERY_SUFFIX}`;
    const headers = crmHeaders(account);
    const sig = await mtgsigOf(url, headers, body);
    if (sig) headers['mtgsig'] = sig;
    return await Request({ url, headers, body });
}

// 查本月签到记录 + 签到
async function signIn(account) {
    const range = monthRange();
    const records = await campaignPost('/api/v1/crm/frontend/campaign/sign-in/records-and-incentives', account,
        { ...range, queryOnlySignInRecordInRange: false, campaignId: $.campaignId });
    if (records?.code !== 0) {
        $.messages.push(`❌ 签到: 查询签到记录失败 ${records?.msg || $.toStr(records)}`);
        return;
    }
    const monthDays = (records.signInRecordsInRange || []).length;
    const total = records.totalSignInRecords?.totalSignInCount;
    $.log(`📅 [签到] 累计签到 ${total ?? '-'} 天, 本月 ${monthDays} 天, 按钮: ${records.signInButtonContent}`);
    if (records.alreadySignedInToday) {
        $.messages.push(`⚠️ 签到: 今日已签到（本月 ${monthDays} 天）`);
        return;
    }

    const sign = await campaignPost('/api/v1/crm/frontend/campaign/sign-in/participate', account,
        { campaignId: $.campaignId, cardId: Number(account.cardId), couponDisplayScene: 44, styleVersion: 2 });
    if (sign?.code !== 0) {
        const msg = sign?.msg || $.toStr(sign);
        $.messages.push(/(已签到|重复)/.test(String(msg)) ? `⚠️ 签到: ${msg}` : `❌ 签到: ${msg}`);
        return;
    }
    const gained = [`+${sign.issuedPointAmount ?? 0} 积分`];
    if (sign.issuedCouponNum) gained.push(`优惠券 ${sign.issuedCouponNum} 张`);
    if (sign.issuedMedalNum) gained.push(`勋章 ${sign.issuedMedalNum} 枚`);
    const next = stripHtml(sign.nextStepIncentives?.nextStepIncentivesContentPrefix);
    $.messages.push(`✅ 签到: ${gained.join('、')}（本月 ${monthDays + 1} 天${next ? `，${next}` : ''}）`);
    const coupons = sign.issuedCouponDisplayInfos || sign.nextStepIncentives?.toIssueCouponInfos || [];
    for (const item of coupons) {
        const dd = item.displayData || {};
        const name = item.couponTemplate?.title || dd.name?.value || item.title || '';
        if (!name) continue;
        $.log(`🎁 [签到] 券: ${name}${dd.time?.value ? `，${dd.time.value}` : ''}`);
    }
}

// ---------- 柠季(美团 CRM)请求头 ----------

function baseHeaders() {
    return {
        'content-type': 'application/json',
        'User-Agent': USER_AGENT,
        'Referer': `https://servicewechat.com/${APPID}/283/page-frame.html`,
        'app-id': APPID,
        'X-appId': APPID,
        'tenantId': TENANT_ID,
        'orgId': ORG_ID,
        'poiId': POI_ID,
        'poiType': POI_TYPE,
        'versionCode': '6291000',
        'app-version': '6.29.10',
        'app-template': '2',
        'app-container': '1',
        'app-platform': '1',
    };
}

// 登录/协议接口: appCode 51
function loginHeaders() {
    return {
        ...baseHeaders(),
        'appCode': '51',
        'app-type': '1',
        'businessLine': '600',
        'restaurantViewId': '126269',
        'bizPath': 'pages/index/index',
    };
}

// 活动接口: appCode 50 + 会话凭证, X-token 为 `UNI-TOKEN-<tenantId>:<jwt>;`
function crmHeaders(account) {
    const h = {
        ...baseHeaders(),
        'appCode': '50',
        'M-APPKEY': 'wxmp_com.sankuai.rmsmenuorderfe.v2.wxapp',
        'X-Platform': '71',
        'X-WxappVersion': '5.43.02',
        'campaignId': $.campaignId,
        'campaignType': CAMPAIGN_TYPE,
        'X-token': `UNI-TOKEN-${TENANT_ID}:${account.token};`,
    };
    if (account.cardId) h['x-cardId'] = account.cardId;
    return h;
}

// ---------- mtgsig 签名(调自建签名服务, 拿不到就降级为不签名) ----------

// 只对 campaign/* 接口签名(与小程序行为一致: member/login 与 queryMemberId 都不带 mtgsig)
async function mtgsigOf(url, headers, data) {
    if ($.mtgsigDead || !$.mtgsigApi) return '';
    const resp = await Request({
        url: `${$.mtgsigApi}/sign`,
        headers: $.yybToken ? { Authorization: `Bearer ${$.yybToken}` } : {},
        body: { appid: APPID, url, method: 'POST', header: headers, data },
        _timeout: 10000,
    });
    const sig = resp?.data?.mtgsig;
    if (resp?.code !== 0 || !sig) {
        $.mtgsigDead = true;
        $.log(`⚠️ [mtgsig] 签名服务不可用, 本次运行不签名: ${resp?.msg || resp?.error || $.toStr(resp) || '无响应'}`);
        return '';
    }
    return sig;
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

// 北京时间的本月起止(签到记录按自然月查询)
function monthRange() {
    const bj = new Date(Date.now() + 8 * 3600 * 1000);
    const y = bj.getUTCFullYear(), m = bj.getUTCMonth();
    return {
        startTime: Date.UTC(y, m, 1) - 8 * 3600 * 1000,
        endTime: Date.UTC(y, m + 1, 1) - 8 * 3600 * 1000 - 1000,
    };
}

function stripHtml(text) {
    return String(text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
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
