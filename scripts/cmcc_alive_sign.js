/**
 * 脚本名称：中国移动票据保活
 * 作用：只做一件事 —— 拿 cmcc_data 里的 jwt + token 走一遍主厅 SSO 换票（appTokenLogin），
 *       把服务端换发的新 jwt 写回同一个变量；不签到、不做任务、不抢券、不进活动页。
 * 为什么要有：「AI豆苗养成记」每次运行都要用同一条 token 现签 phone 头（上游 d967d65 的 coc3_ticket 就是它），
 *       而实测 jwt 不能单独换票（只发 jwtToken 必回「APP登录状态已过期」），必须 jwt + token 同发；
 *       定时同发既保住 jwt 持续续期，也能在票据被 App 重新登录顶掉的第一时间报出来。
 * 通知：保活成功只写日志、不推送；失败推送一条（同一账号当天只提醒一次，因为定时是半小时一次）。
 * 环境变量：cmcc_data（与签到脚本共用，勿手填）/ cmcc_alive_act（选填：换票要落地的活动页 URL）/
 *          cmcc_activity_id、cmcc_channel_id（选填，与签到脚本一致，默认 1021122301 / P00000109876）/
 *          cmcc_alive_state（脚本自动维护的保活记录）/ cmcc_alive_debug（填 true 打请求详情）
 * 更新时间：2026-10-21 新建；定时改为每半小时一次(0,30 * * * *)；失败改为推送通知

------------------ Surge 配置 ------------------

[Script]
中国移动票据保活 = type=cron,cronexp="0,30 * * * *",wake-system=1,timeout=120,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_alive_sign.js,script-update-interval=0

------------------- Loon 配置 -------------------

[Script]
cron "0,30 * * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_alive_sign.js, timeout=120, tag=中国移动票据保活

--------------- Quantumult X 配置 ---------------

[task_local]
0,30 * * * * https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_alive_sign.js, tag=中国移动票据保活, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/cmcc.png, enabled=true
 */

const $ = new Env('中国移动票据保活');

const DATA_KEY = 'cmcc_data';
const STATE_KEY = 'cmcc_alive_state';
const BASE = 'https://wx.10086.cn';
const SSO_LOGIN = BASE + '/qwhdsso/login';
const ACTIVITY_ID = getEnv('cmcc_activity_id') || '1021122301';
const CHANNEL_ID = getEnv('cmcc_channel_id') || 'P00000109876';
// 换票需要一个 actUrl，默认用签到活动页（与签到脚本同一入口，不额外产生活动侧副作用）
const ACT_URL = getEnv('cmcc_alive_act') || `${BASE}/qwhdhub/qwhdmark/${ACTIVITY_ID}?channelId=${CHANNEL_ID}`;
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/wkwebview leadeon/12.5.2/CMCCIT';

// 单账号换票：SSO 中转页取一次性 sid → appTokenLogin（先 jwt+token 同发，被拒再只发票据引导）
async function renew(u) {
    const jar = {};
    const ua = u.userAgent || USER_AGENT;
    const page = await Request({ url: `${SSO_LOGIN}?dlwmh=true&actUrl=${encodeURIComponent(ACT_URL)}`, headers: baseHeaders(jar, ua), _respType: 'all', _timeout: 30000 });
    takeCookies(jar, page && page.headers);
    const sid = pickSid((page && page.body) || '');
    if (!sid) return { ok: false, err: 'SSO 页未返回 loginPath，入口可能已变更' };
    const loginUrl = `${BASE}/qwhdsso${sid}`;
    const baseBody = {
        provinceCode: u.provinceCode || '731',
        cityCode: u.cityCode || '0731',
        userCheckId: u.userCheckId,
        carrierOperator: u.carrierOperator || '002',
        appVersionCode: u.appVersionCode || '12.5.2',
        took: randomInt(120, 900),
    };
    let first = '';
    if (u.jwt) {
        const r = await Request({ url: loginUrl, method: 'post', headers: baseHeaders(jar, ua), body: Object.assign({}, baseBody, { jwtToken: u.jwt, token: u.token }), _timeout: 30000 });
        if (r && r.code === 'SUCCESS') return { ok: true, jwt: (r.data || {}).jwt || '', via: 'jwt + 票据同发' };
        first = `${r && r.code} ${(r && r.msg) || ''}`;
    }
    const r2 = await Request({ url: loginUrl, method: 'post', headers: baseHeaders(jar, ua), body: Object.assign({}, baseBody, { jwtToken: null, token: u.token }), _timeout: 30000 });
    if (r2 && r2.code === 'SUCCESS') return { ok: true, jwt: (r2.data || {}).jwt || '', via: '票据引导（jwt 已被拒：' + first + '）' };
    // 「APP登录状态已过期」= 这条大网会话已被 App 重新登录顶掉，只能重抓
    return { ok: false, err: `同发: ${first || '未试'}｜引导: ${r2 && r2.code} ${(r2 && r2.msg) || ''}`.trim() };
}

// loginPath='/qwhdsso/appTokenLogin?sid=…' 里取那段路径；不用正则以免转义在工具链里被吃掉
function pickSid(html) {
    const seg = String(html).split('loginPath');
    if (seg.length < 2) return '';
    const q1 = seg[1].indexOf("'");
    if (q1 < 0) return '';
    const q2 = seg[1].indexOf("'", q1 + 1);
    return q2 < 0 ? '' : seg[1].slice(q1 + 1, q2);
}

const dayText = ms => ((Date.now() - Number(ms)) / 86400000).toFixed(1);

!(async () => {
    const users = $.toObj(getEnv(DATA_KEY) || '', null);
    if (!Array.isArray(users) || !users.length) {
        // 与签到脚本共用同一个变量，没抓到就是没账号，直接收工不报错
        $.log('未找到 cmcc_data 变量（先用「中国移动」签到脚本抓一次包），本次退出');
        return;
    }
    const state = $.toObj($.getdata(STATE_KEY), {}) || {};
    const today = $.time('yyyyMMdd');
    const pushList = [];
    let dirty = false, ok = 0, bad = 0;
    for (let i = 0; i < users.length; i++) {
        const u = users[i], tag = u.userName || `账号${i + 1}`, k = u.userCheckId || tag;
        if (!u.token) { $.log(`⏭️ ${tag}: 没有 App 票据(token)，保活跳过——请在 App 里进一次签到页抓包`); continue; }
        const r = await renew(u);
        const st = state[k] || {};
        if (r.ok) {
            ok++;
            if (r.jwt && r.jwt !== u.jwt) { u.jwt = r.jwt; u.jwt_first = u.jwt_first || Date.now(); dirty = true; }
            state[k] = { lastOk: Date.now(), fails: 0, via: r.via };
            $.log(`✅ ${tag}: 票据有效，jwt 已续期（${r.via}${r.jwt ? '' : '，本次未回新 jwt'}；凭证链已 ${dayText(u.jwt_first || Date.now())} 天）`);
        } else {
            bad++;
            state[k] = { lastOk: st.lastOk || null, fails: (Number(st.fails) || 0) + 1, err: r.err, notifiedDay: st.notifiedDay || '' };
            $.log(`❌ ${tag}: 换票失败 ${r.err} —— 票据多半已被 App 重新登录顶掉，需重抓（上次成功 ${st.lastOk ? dayText(st.lastOk) + ' 天前' : '从未'}，已连续失败 ${state[k].fails} 次）`);
            if (state[k].notifiedDay !== today) {
                state[k].notifiedDay = today;
                pushList.push(`❌ ${tag}: 连续失败 ${state[k].fails} 次，上次成功 ${st.lastOk ? dayText(st.lastOk) + ' 天前' : '从未'}\n${r.err}`);
            }
        }
    }
    if (dirty) $.setdata($.toStr(users, '[]'), DATA_KEY);
    $.setdata($.toStr(state, '{}'), STATE_KEY);
    $.log(`保活完成：${ok} 个有效 / ${bad} 个失败，共 ${users.length} 个账号`);
    // 成功不推送；失败推送一条，同一账号当天只提醒一次（定时是半小时一次，不能每次都轰）
    if (pushList.length) $.msg('中国移动票据保活', `⚠️ ${bad} 个账号换票失败，需重抓 App 票据`, pushList.join('\n\n'));
})().catch(e => $.log('❗️保活异常: ' + ((e && e.message) || e))).finally(() => $.done());

function debug(content, title = 'debug') {
    let start = `\n----- ${title} -----\n`;
    let end = `\n----- ${$.time('HH:mm:ss')} -----\n`;
    if ($.is_debug === 'true') {
        if (typeof content == 'string') $.log(start + content + end);
        else if (typeof content == 'object') $.log(start + $.toStr(content) + end);
    }
}

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

function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }

function getEnv(...keys) {
    for (let key of keys) {
        var value = $.isNode() ? process.env[key] || process.env[key.toUpperCase()] || process.env[key.toLowerCase()] || $.getdata(key) : $.getdata(key);
        if (value) return value;
    }
}
function baseHeaders(jar, ua) {
    const h = {
        accept: '*/*',
        'content-type': 'application/json;charset=UTF-8',
        'user-agent': ua || USER_AGENT,
        'accept-language': 'zh-CN,zh-Hans;q=0.9',
    };
    // jar 空时不下发空 Cookie 头，让环境自身的 cookie 管理生效
    if (Object.keys(jar).length) h.Cookie = cookieHeader(jar);
    return h;
}
function takeCookies(jar, headers) {
    const raw = headers && (headers['set-cookie'] || headers['Set-Cookie']);
    if (!raw) return;
    for (const item of Array.isArray(raw) ? raw : [raw]) {
        // 多条 cookie 可能被拼成逗号分隔的字符串；日期里的逗号后面不跟 name=，故按此切分安全
        for (const part of String(item).split(/,(?=\s*[A-Za-z0-9_.-]+=)/)) {
            const kv = /^\s*([A-Za-z0-9_.-]+)=([^;]*)/.exec(part);
            if (kv) jar[kv[1]] = kv[2].trim();
        }
    }
}
function cookieHeader(jar) {
    return Object.keys(jar).map(k => `${k}=${jar[k]}`).join('; ');
}
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
