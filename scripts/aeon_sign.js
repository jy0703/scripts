/**
 * 脚本名称：永旺签到
 * 活动规则：永旺小程序每日签到得积分（活动期内每天 1 次，连续签到另有阶段奖励），并查询会员卡等级/积分与本月到期积分
 * 脚本说明：通过 code 服务(YYB Go)获取微信 code，
 *          silentWechatMiniLogin 用 code 静默登录换 x-http-token（有效期约 28 天，按接口 tokenExpire 缓存复用），
 *          token 失效自动重新取 code 登录并重跑任务。支持 Node.js / Quantumult X / Loon / Surge / Stash。
 * 配置说明：boxjs 订阅「Code Server」分组中填写「获取小程序code」配置项(@wxCode.*):
 *          - @wxCode.open    开启code模式(true)
 *          - @wxCode.address 服务器地址, 如 http://192.168.2.5:8000
 *          - @wxCode.token   接口鉴权 token (请求头 Authorization: Bearer <token>)
 *          账号 ref 配在本脚本的 boxjs 区域 aeon_ref 中, 多个以英文逗号隔开
 *          Node 环境变量同名可用: WX_CODE_ADDRESS / WX_CODE_TOKEN / AEON_REF
 *          注意: 登录是按 code 里的微信身份静默进行的, ref 对应的微信必须已绑定永旺会员, 否则会静默注册出一个新会员
 * 环境变量：aeon_ref（账号 ref）、aeon_cache（脚本自动维护）、aeon_store（可选, 登录响应缺 storeCode 时的兜底商场编码）
 * 更新时间：2026-10-07

------------------ Surge 配置 ------------------

[Script]
永旺签到 = type=cron,cronexp="10 8 * * *",wake-system=1,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aeon_sign.js,script-update-interval=0

------------------- Loon 配置 -------------------

[Script]
cron "10 8 * * *" script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aeon_sign.js,timeout=600,tag=永旺签到,enable=true

--------------- Quantumult X 配置 ---------------

[task_local]
10 8 * * * https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aeon_sign.js, tag=永旺签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/aeon.png, enabled=true

 */

const $ = new Env('永旺签到');
$.is_debug = getEnv('is_debug') || 'false';  // 调试模式
$.Messages = [];

// ---- 业务常量 (照抓包搬运) ----
const APPID = 'wx55996449c48dd8c7';                       // 永旺小程序
const LOGIN_URL = 'https://api.aeonbuy.com/api/access-auth-api/auth/third/silentWechatMiniLogin';
const MAPI = 'https://mapi.aeonbuy.com';                  // 商城接口
const H5 = 'https://m.aeonbuy.com';                       // 会员卡接口
const CARD_APP_ID = 'wxbb1ffcc3c65f030f';                 // 会员卡 appId
const CACHE_KEY = 'aeon_cache';   // 缓存键: 存 {ref:{token,storeCode,mobile,nickname,label,expireTime,updateTime}}
const TOKEN_INVALID = 102050010;  // 授权已失效

// 主函数
async function main() {
    $.codeServer = (getEnv('WX_CODE_ADDRESS', '@wxCode.address') || '').replace(/\/+$/, '');
    $.yybToken = getEnv('WX_CODE_TOKEN', '@wxCode.token') || '';

    const openRaw = getEnv('WX_CODE_OPEN', '@wxCode.open');
    const refs = (getEnv('aeon_ref') || '').split(/[,，\s\n]+/).filter(Boolean);

    if (openRaw && String(openRaw).toLowerCase() === 'false') throw new Error('boxjs 中「开启code模式」未开启 ❌');
    if (!refs.length) throw new Error('未配置账号：请在 boxjs「永旺签到」填写 aeon_ref ❌');
    if (!$.codeServer) throw new Error('未配置 code 服务地址 @wxCode.address ❌');

    for (let i = 0; i < refs.length; i++) {
        $.log(`\n----- 账号 [${i + 1}/${refs.length}] ref=${refs[i]} 开始执行 -----\n`);
        $.messages = [];
        $.notify = false;
        $.refLabel = '';
        await runAccount(refs[i]);

        // 有实际动作的账号才写进通知
        if ($.notify) {
            $.messages.unshift(`🔹 永旺 ${$.refLabel || $.nickname || hideSensitiveData($.mobile, 3, 4)} [${$.storeCode}]`);
            $.Messages = $.Messages.concat($.messages);
        }
        if (i < refs.length - 1) await $.wait(2000);
    }

    if ($.Messages.length && refs.length > 1) $.Messages.unshift(`📊 共 ${refs.length} 个账号，本次签到成功 ${$.okCount || 0} 个\n`);
}

// 单账号: 取 token(缓存优先) + 任务, token 失效则重新登录后重跑一次
async function runAccount(ref) {
    await $.wait(1000 * (2 + Math.floor(Math.random() * 5)));  // 启动随机延迟

    let account = await loginWithCache(ref);
    if (!account) return;

    $.expired = false;
    await runTasks(account);

    if ($.expired) {
        $.log(`⚠️ [登录] token 已失效, 重新取 code 登录`);
        account = await loginFlow(ref);
        if (!account) return;
        $.expired = false;
        await runTasks(account);
        if ($.expired) fail(`❌ 重新登录后仍提示未登录，请确认该 ref 的微信已绑定永旺会员`);
    }
}

// 优先复用缓存 token（按 tokenExpire 判定），否则走 code 登录
async function loginWithCache(ref) {
    const cache = $.getjson(CACHE_KEY, {}) || {};
    const item = cache[ref];
    if (item?.token && item?.expireTime && item.expireTime > Date.now() + 24 * 3600 * 1000) {
        $.refLabel = item.label || '';
        $.log(`✅ [缓存] 复用 token，剩余 ${Math.floor((item.expireTime - Date.now()) / 86400 / 1000)} 天`);
        return item;
    }
    return await loginFlow(ref);
}

// code → silentWechatMiniLogin → token + 会员信息
async function loginFlow(ref) {
    const code = await getWxCode(ref);
    if (!code) return null;

    const result = await Request({
        url: LOGIN_URL,
        headers: {
            'content-type': 'application/json',
            'x-http-channel': 'mp',
            'x-http-devicetype': 'iphone',
            'x-http-version': '2.3.71'
        },
        body: { wxCode: code }
    });

    const data = result?.data;
    if (result?.code !== 200 || !data?.token || !data?.mobile) {
        fail(`❌ 登录: 换取 token 失败 ${$.toStr(result)}`);
        return null;
    }

    const account = {
        mobile: data.mobile,
        token: data.token,
        memberId: data.memberId,
        nickname: data.nickname,
        storeCode: data.storeCode,
        corporationCode: data.corporationCode,
        expireTime: data.tokenExpire ? data.tokenExpire * 1000 : Date.now() + 28 * 86400 * 1000,
        label: $.refLabel || '',
        updateTime: new Date().toISOString()
    };

    const cache = $.getjson(CACHE_KEY, {}) || {};
    cache[ref] = account;
    $.setdata($.toStr(cache), CACHE_KEY);

    $.log(`✅ [登录] token 获取成功，有效期至 ${new Date(account.expireTime).toLocaleDateString('zh-CN')}`);
    return account;
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
        fail(`❌ 授权: code 获取失败 ${$.toStr(resp)}`);
        return null;
    }
    $.refLabel = resp.data.account?.remark || resp.data.account?.nickname || resp.data.account?.alias || $.refLabel || '';
    $.log(`✅ [授权] code 获取成功: ${resp.data.result.code}`);
    return String(resp.data.result.code);
}

// 任务: 活动 → 签到 → 本月记录 → 会员卡
async function runTasks(account) {
    $.account = account;
    $.mobile = account.mobile;
    $.nickname = account.nickname;
    $.storeCode = account.storeCode || getEnv('AEON_STORE', 'aeon_store') || '';

    if (!$.storeCode) return fail('❌ 登录响应缺少 storeCode，请配置 aeon_store 兜底');

    const act = await getSignInByStore();
    if ($.expired) return;
    if (act) await doSign(act);
    if ($.expired) return;

    await getMySignInDate();
    await queryMembers();
}

// 活动信息
async function getSignInByStore() {
    const result = await Request({
        url: `${MAPI}/api/app-api/marketing/signin/getSignInByStore`,
        headers: headers(),
        body: { storeCode: $.storeCode }
    });

    if (result?.code === TOKEN_INVALID) return tokenExpired();
    const data = result?.data;
    if (!data?.id) {
        $.log(`❌ 未获取到签到活动: ${$.toStr(result)}`);
        return null;
    }

    const today = beijingDate();
    if (today < data.startTime.slice(0, 10) || today > data.endTime.slice(0, 10)) {
        $.log(`⏸️ 活动 [${data.name}] 不在进行期 (${data.startTime} ~ ${data.endTime})`);
        return null;
    }
    $.log(`✅ 活动: ${data.name}，每日 ${data.daySignAward?.pointCount || '?'} 积分`);
    return data;
}

// 每日签到
async function doSign(act) {
    const result = await Request({
        url: `${MAPI}/api/app-api/marketing/signin/signIng`,
        headers: headers(),
        body: { storeCode: $.storeCode }
    });

    if (result?.code === TOKEN_INVALID) return tokenExpired();

    if (result?.code === 200 && result?.data?.successFlag) {
        $.okCount = ($.okCount || 0) + 1;
        success(`✅ 签到成功: +${result.data.daySignAward?.pointCount ?? act.daySignAward?.pointCount ?? '?'} 积分，连续 ${result.data.consecDay} 天`);
    } else if (result?.code === 0 && /已签/.test(result?.message || '')) {
        $.log(`⏸️ ${result.message}`);
    } else {
        fail(`❌ 签到失败: ${$.toStr(result)}`);
    }
}

// 本月签到记录
async function getMySignInDate() {
    const today = beijingDate();
    const result = await Request({
        url: `${MAPI}/api/app-api/marketing/signin/getMySignInDate`,
        headers: headers(),
        body: { startTime: `${today.slice(0, 7)}-01`, endTime: today, storeCode: $.storeCode }
    });

    if (result?.code === TOKEN_INVALID) return tokenExpired();
    const list = result?.data?.signInDayList || [];
    const msg = `🌀 本月已签到 ${list.length} 天，连续 ${result?.data?.conSecDay ?? 0} 天`;
    $.log(msg), $.notify && $.messages.push(msg);
}

// 查询会员卡
async function queryMembers() {
    const result = await Request({
        url: `${H5}/api/app-api/card/main/corporation/detail`,
        headers: { ...headers(), 'x-http-card-channel': '3' },
        body: { appId: CARD_APP_ID, corporationCode: '' }
    });

    if (result?.code === TOKEN_INVALID) return tokenExpired();
    if (!result?.data) return $.log(`❌ 查询会员失败: ${$.toStr(result)}`);

    const { levelName, totalPoint, totalPointOrAmount, invaildPointList } = result.data;
    let msg = `🌀 等级: ${levelName}，积分: ${totalPoint}，消费: ${totalPointOrAmount} 元`;
    const month = beijingDate().slice(0, 7);
    const invaild = (invaildPointList || []).filter(e => String(e.invaildDate || '').includes(month));
    if (invaild.length) msg += `，本月到期积分: ${invaild.map(e => e.totalPointStr).join('/')}`;
    $.log(msg), $.notify && $.messages.push(msg);
}

// token 失效: 交给 runAccount 触发重新登录
function tokenExpired() {
    if ($.expired) return null;
    $.expired = true;
    $.log(`⚠️ 接口回 ${TOKEN_INVALID}，当前 token 已失效`);
    return null;
}

// 进通知的行
function success(msg) { $.notify = true; $.log(msg), $.messages.push(msg); }
function fail(msg) { $.notify = true; $.log(msg), $.messages.push(msg); }

// 请求头 (基于抓包, 剔除 Host/Content-Length 等转发头)
function headers() {
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': H5,
        'Referer': `${H5}/`,
        'x-http-channel': 'mp',
        'x-http-token': $.account.token,
        'x-http-locale': 'zh-CN',
        'x-http-osversion': 'IOS 18.2',
        'x-http-version': '2.3.71',
        'x-http-browser': 'wechat',
        'x-http-devicetype': 'wechat',
        'x-http-network': 'wifi'
    };
}

// 北京时间 YYYY-MM-DD (活动起止日期按此格式比较)
function beijingDate() {
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// 手机号脱敏
function hideSensitiveData(str = '', before = 3, after = 4) {
    const s = String(str);
    return s.length <= before + after ? s : `${s.slice(0, before)}${'*'.repeat(s.length - before - after)}${s.slice(-after)}`;
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
