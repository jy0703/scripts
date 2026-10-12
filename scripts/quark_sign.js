/**
 * 脚本名称：夸克网盘签到
 * 活动规则：夸克网盘每日签到领空间容量，连签达目标有额外奖励
 * 脚本说明：支持多账号，支持 NE / Node.js 环境。抓一次包取 kps_wg 并本地解密出 service_ticket/uid/nickname，之后每次运行由脚本自己现算 vcode/sign_wg，不再依赖抓到的旧签名
 * 环境变量：quark_data、quark_users、quark_debug
 * 更新时间：2026-10-12

------------------ Surge 配置 ------------------

[Script]
夸克网盘获取Cookie = type=http-request,pattern=^https?:\/\/drive\-m\.quark\.cn\/1\/clouddrive\/,requires-body=0,max-size=0,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quark_sign.js,script-update-interval=0

夸克网盘签到 = type=cron,cronexp="0 9 * * *",wake-system=1,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quark_sign.js,timeout=600,script-update-interval=0

[MITM]
hostname = drive-m.quark.cn

------------------- Loon 配置 -------------------

[Script]
http-request ^https?:\/\/drive\-m\.quark\.cn\/1\/clouddrive\/ script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quark_sign.js, requires-body=false, timeout=600, tag=夸克网盘获取Cookie

cron "0 9 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quark_sign.js, timeout=600, tag=夸克网盘签到

[MITM]
hostname = drive-m.quark.cn

--------------- Quantumult X 配置 ---------------

[rewrite_local]
^https?:\/\/drive\-m\.quark\.cn\/1\/clouddrive\/ url script-request-header https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quark_sign.js

[task_local]
"0 9 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quark_sign.js, tag=夸克网盘签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/quark.png, enabled=true

[MITM]
hostname = drive-m.quark.cn

 */

const $ = new Env('夸克网盘');
$.is_debug = getEnv('quark_debug', 'is_debug') || 'false';  // 调试模式
$.Messages = [];

// 业务常量 (链路照 com.quark.browser 10.18.6.1161 反编译 + Frida 对拍还原)
const APP_NAME = '夸克网盘';
const DATA_KEY = 'quark_data';
const USERS_KEY = 'quark_users';
const INFO_URL = 'https://drive-m.quark.cn/1/clouddrive/capacity/growth/info';
const SIGN_URL = 'https://drive-m.quark.cn/1/clouddrive/capacity/growth/sign';
// 抓取正则（与 lpx / sgmodule / 头部注释四处一致）
const CAPTURE_REGEX = /^https?:\/\/drive\-m\.quark\.cn\/1\/clouddrive\//;
// 无线保镖(WSG)静态数据加密：AES-128-CBC，IV 与密钥同值，密文前再拼 2 字节大端 keyNo
// 只认线上 keyNo 4：DEV 构建与开发者项 clouddrive_env=test 会切到 1/2，那种包抓来的 ticket 线上也不认，故直接拒收
const WSG_KEY_NO = 4;
const WSG_KEY = '5ee3f2734745f737';


// 主函数
async function main() {
    const accounts = loadAccounts();
    if (!accounts.length) throw new Error(`未配置账号：开启抓取后打开夸克 App 网盘签到页写入 ${DATA_KEY}，或在 ${USERS_KEY} 粘贴抓包 URL / kps_wg（多个以换行或 && 分隔）❌`);
    $.log(`\n🌀 找到 ${accounts.length} 个夸克账号`);

    let ok = 0, fail = 0;
    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        $.log(`\n----- 账号 [${i + 1}/${accounts.length}] 开始执行 -----\n`);
        $.messages = [];
        try {
            await runAccount(acc);
            ok++;
        } catch (e) {
            fail++;
            $.log(`❌ ${e.message || e}`);
            $.messages.push(`❌ ${e.message || e}`);
        }
        $.Messages = $.Messages.concat([`🔹 ${APP_NAME} ${acc.user || acc.nick || '未命名'}${acc.vip ? ` [${acc.vip}]` : ''}`, ...$.messages]);
        if (i < accounts.length - 1) await $.wait(2000);
    }
    $.log(`\n----- 所有账号执行完成 -----\n`);
    $.Messages.push(`\n📊 ${APP_NAME}: 成功 ${ok} / 失败 ${fail}`);
}

// 单账号：现算凭证 → 查状态 → 未签到则签到（POST 网络失败先复查再判定）
async function runAccount(acc) {
    if (!acc.st || !acc.uid) throw new Error(`账号缺少 service_ticket/uid，请重新抓取（kps_wg 解不出明文时也要重抓）`);
    const vcode = String(Date.now());
    const kps = buildKps(acc.st, acc.uid, acc.nick);
    const sign = buildSign(vcode, acc.st, acc.uid, acc.nick);

    const info = await growthInfo({ kps, sign, vcode }, '查询签到状态');
    acc.vip = info['88VIP'] ? '88VIP' : '普通用户';
    const capSign = info.cap_sign;
    if (!capSign || typeof capSign !== 'object') throw new Error('成长信息中缺少 cap_sign 字段');

    const total = convertBytes(info.total_capacity || 0);
    const signed = convertBytes((info.cap_composition || {}).sign_reward || 0);
    $.log(`💾 网盘总容量：${total}，签到累计容量：${signed}`);
    $.messages.push(`💾 网盘总容量：${total}，签到累计容量：${signed}`);

    const progress = capSign.sign_progress === undefined ? '?' : capSign.sign_progress;
    const target = capSign.sign_target === undefined ? '?' : capSign.sign_target;

    if (capSign.sign_daily) {
        push(`✅ 今日已签到 +${convertBytes(capSign.sign_daily_reward || 0)}，连签进度（${progress}/${target}）`);
        return;
    }

    let line;
    try {
        line = `✅ 签到成功 +${convertBytes(await growthSign({ kps, sign, vcode }))}，连签进度（${typeof progress === 'number' ? progress + 1 : '?'}/${target}）`;
    } catch (e) {
        if (!/网络失败/.test(e.message || '')) throw e;
        $.log('⚠️ POST 结果不确定，重新查询签到状态');
        const verified = (await growthInfo({ kps, sign, vcode }, '复查签到状态')).cap_sign;
        if (!verified || !verified.sign_daily) throw new Error('未确认签到成功，等待定时补签');
        line = `✅ 复查确认今日已签到 +${convertBytes(verified.sign_daily_reward || 0)}，连签进度（${progress}/${target}）`;
    }
    push(line);
}

function push(line) { $.log(line); $.messages.push(line); }

// ---------- 无线保镖(WSG) 本地生成 ----------

function wsgEncrypt(str) {
    const ct = Crypt('aes-cbc', str, WSG_KEY, WSG_KEY);
    const keyNoHex = ('000' + WSG_KEY_NO.toString(16)).slice(-4);
    return Crypt('hex-to-base64', keyNoHex + Crypt('base64-to-hex', ct));
}

function wsgDecrypt(b64) {
    const hex = Crypt('base64-to-hex', b64);
    const keyNo = parseInt(hex.slice(0, 4), 16);
    if (keyNo !== WSG_KEY_NO) throw new Error(`只支持线上 keyNo=${WSG_KEY_NO}，抓到的是 keyNo=${keyNo}（DEV 包或 clouddrive_env=test），请用正式版夸克重抓`);
    return Crypt('aes-cbc-dec-iv', Crypt('hex-to-base64', hex.slice(4)), WSG_KEY, WSG_KEY);
}

function buildKps(st, uid, nick) {
    return wsgEncrypt(`token=${st}&uid=${uid}&nickname=${nick}`);
}

// 签名原文 = vcode 前 5 位 + st + uid + nickname + vcode 末位，先取大写 MD5 再整体加密
function buildSign(vcode, st, uid, nick) {
    const pre = vcode.substring(0, 5) + st + uid + nick + vcode.substring(vcode.length - 1);
    const md5 = Crypt('md5', pre).toUpperCase();
    debug(`签名原文: ${pre}\n签名摘要: ${md5}`, 'WSG');
    return wsgEncrypt(md5);
}

// 从 kps_wg 解出账号三要素
function parseKps(kpsWg) {
    let plain = '', why = '';
    try { plain = wsgDecrypt(kpsWg); } catch (e) { why = e.message || String(e); }
    if (!plain || plain.indexOf('token=') !== 0) throw new Error(`kps_wg 解密失败${why ? '（' + why + '）' : ''}，夸克可能改版换密钥，请重新抓取: ${kpsWg.slice(0, 12)}…`);
    const uidMark = '&uid=', nickMark = '&nickname=';
    const i = plain.indexOf(uidMark), j = plain.indexOf(nickMark);
    if (i < 0 || j < 0) throw new Error('kps_wg 明文缺少 uid/nickname 字段，请重新抓取');
    return { st: plain.slice(6, i), uid: plain.slice(i + uidMark.length, j), nick: plain.slice(j + nickMark.length) };
}

// ---------- 接口 ----------

async function growthInfo(cred, stage) {
    const payload = await requestJson('get', buildUrl(INFO_URL, cred), stage);
    if (!payload.data || typeof payload.data !== 'object') throw new Error(apiError(payload, '获取成长信息失败'));
    return payload.data;
}

async function growthSign(cred) {
    const payload = await requestJson('post', buildUrl(SIGN_URL, cred), '提交签到', { sign_cyclic: true });
    if (!payload.data || payload.data.sign_daily_reward === undefined) throw new Error(apiError(payload, '签到失败'));
    return payload.data.sign_daily_reward;
}

async function requestJson(method, url, stage, body) {
    const attempts = method === 'get' ? 3 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        const resp = await Request({
            url,
            method,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G981B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 Quark/10.18.6.1161',
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body,
            _respType: 'all',
            _timeout: 20000
        });
        const status = Number(resp && (resp.statusCode || resp.status)) || 0;
        const payload = resp && $.toObj(resp.body, null);
        if (status === 200) {
            if (payload && typeof payload === 'object') return payload;
            throw new Error(`${stage}返回格式异常`);
        }

        // 500 + code 15000「inner error」是凭证/参数错误的确定性响应，重试没有意义；只有拿不到报文时才退避重试
        if (payload && payload.code !== undefined) {
            const detail = payload.code === 15000 ? '通用错误(code=15000)，凭证已失效或参数不完整' : apiError(payload, `code=${payload.code}`);
            throw new Error(`${stage}失败（HTTP ${status}）：${detail}`);
        }
        if (attempt < attempts && (!status || [429, 502, 503, 504].includes(status))) {
            $.log(`⚠️ ${stage}第 ${attempt}/${attempts} 次失败：${status || '网络异常'}`);
            await $.wait(Math.round(2 ** (attempt - 1) * 1000 + Math.random() * 1000));
            continue;
        }
        throw new Error(status ? `${stage}请求失败（HTTP ${status}）` : `${stage}网络失败`);
    }
    throw new Error(`${stage}重试耗尽`);
}

function apiError(payload, fallback) {
    const message = payload.message || payload.msg;
    if (message) return String(message);
    if (payload.code !== undefined && payload.code !== null) return `${fallback}（code=${payload.code}）`;
    return fallback;
}

function buildUrl(host, cred) {
    const params = { pr: 'ucpro', fr: 'android', kps: cred.kps, sign: cred.sign, vcode: cred.vcode };
    return host + '?' + Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
}

function convertBytes(value) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    let size = Number(value) || 0, i = 0;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(2)} ${units[i]}`;
}

// ---------- 抓取与账号装载 ----------

function GetCookie() {
    try {
        const url = ($request && $request.url) || '';
        if ($request && $request.method === 'OPTIONS') return;
        if (!url || !CAPTURE_REGEX.test(url)) return;

        const q = queryParams(url);
        const kpsWg = q.kps_wg || q.kps;
        if (!kpsWg) return;

        const acc = parseKps(kpsWg);
        const exist = $.userArr.find(e => e.uid === acc.uid);
        if (exist) {
            if (exist.st === acc.st && exist.nick === acc.nick) {
                $.log('夸克账号已存在且凭证无变化，不重复写入');
                return;
            }
            Object.assign(exist, acc);
            persistAccounts();
            $.Messages.push(`🎉夸克账号已更新: ${acc.nick || acc.uid}`);
            $.log(`🎉夸克账号已更新: ${acc.uid} (${acc.nick})`);
            return;
        }
        $.userArr.push(acc);
        persistAccounts();
        $.Messages.push(`🎉获取夸克账号成功: ${acc.nick || acc.uid}`);
        $.log(`🎉获取夸克账号成功: ${acc.uid} (${acc.nick})`);
    } catch (e) {
        $.log('❌ Cookie获取失败'), $.log(e);
    }
}

function persistAccounts() {
    $.setdata($.toStr($.userArr.map(e => {
        const item = { st: e.st, uid: e.uid, nick: e.nick };
        if (e.user) item.user = e.user;
        return item;
    })), DATA_KEY);
}

// 账号来源：quark_data(抓取写入的 st/uid/nick) + quark_users(手填抓包 URL 或裸 kps_wg)
function loadAccounts() {
    const out = [];
    const push = acc => {
        if (!acc || !acc.st || !acc.uid) return;
        if (!out.some(e => e.uid === acc.uid)) out.push(acc);
    };

    const list = $.toObj(getEnv(DATA_KEY) || '', null);
    if (Array.isArray(list)) list.forEach(e => {
        if (!e || typeof e !== 'object') return;
        push({ st: e.st, uid: String(e.uid || ''), nick: e.nick || '', user: e.user || '' });
    });

    (getEnv(USERS_KEY) || '').split(/\r?\n|&&/).forEach(entry => {
        entry = entry.trim();
        if (!entry) return;
        let user = '', kps = '';
        if (entry.indexOf('=') === -1) { kps = entry; }
        else {
            const fields = {};
            entry.split(';').forEach(part => {
                part = part.trim();
                if (!part || part.indexOf('=') === -1) return;
                const i = part.indexOf('=');
                fields[part.slice(0, i).trim()] = part.slice(i + 1).trim();
            });
            user = fields.user || '';
            kps = fields.kps_wg || fields.kps || (fields.url ? queryParams(fields.url).kps_wg || queryParams(fields.url).kps : '');
        }
        if (!kps) return;
        try {
            const acc = parseKps(kps);
            acc.user = user;
            push(acc);
        } catch (e) {
            $.log(`❌ 跳过一条无效账号配置：${e.message || e}`);
        }
    });
    return out;
}

// 只按百分号解码，保留字面量 +（夸克凭证里 + 是有效字符，转成空格会让参数失效）
function queryParams(url) {
    const query = {};
    (String(url || '').split('?')[1] || '').split('&').forEach(part => {
        if (!part) return;
        const i = part.indexOf('=');
        const key = safeUnquote(i === -1 ? part : part.slice(0, i));
        if (query[key] === undefined) query[key] = i === -1 ? '' : safeUnquote(part.slice(i + 1));
    });
    return query;
}

function safeUnquote(value) {
    try { return decodeURIComponent(String(value)); } catch (e) { return String(value); }
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

// 脚本执行入口: $request 存在 → 抓取模式, 否则 → 定时任务模式
!(async () => {
    if (typeof $request !== `undefined`) {
        const saved = $.toObj(getEnv(DATA_KEY) || '', null);
        $.userArr = Array.isArray(saved) ? saved : [];
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

function Crypt(type, a, b, c) { function MD5(string) { function RotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); } function AddUnsigned(lX, lY) { var lX4, lY4, lX8, lY8, lResult; lX8 = (lX & 0x80000000); lY8 = (lY & 0x80000000); lX4 = (lX & 0x40000000); lY4 = (lY & 0x40000000); lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF); if (lX4 & lY4) { return (lResult ^ 0x80000000 ^ lX8 ^ lY8); } if (lX4 | lY4) { if (lResult & 0x40000000) { return (lResult ^ 0xC0000000 ^ lX8 ^ lY8); } else { return (lResult ^ 0x40000000 ^ lX8 ^ lY8); } } else { return (lResult ^ lX8 ^ lY8); } } function F(x, y, z) { return (x & y) | ((~x) & z); } function G(x, y, z) { return (x & z) | (y & (~z)); } function H(x, y, z) { return (x ^ y ^ z); } function I(x, y, z) { return (y ^ (x | (~z))); } function FF(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function GG(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function HH(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function II(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function ConvertToWordArray(string) { var lWordCount; var lMessageLength = string.length; var lNumberOfWords_temp1 = lMessageLength + 8; var lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64; var lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16; var lWordArray = Array(lNumberOfWords - 1); var lBytePosition = 0; var lByteCount = 0; while (lByteCount < lMessageLength) { lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8; lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition)); lByteCount++; } lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8; lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition); lWordArray[lNumberOfWords - 2] = lMessageLength << 3; lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29; return lWordArray; }; function WordToHex(lValue) { var WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount; for (lCount = 0; lCount <= 3; lCount++) { lByte = (lValue >>> (lCount * 8)) & 255; WordToHexValue_temp = "0" + lByte.toString(16); WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2); } return WordToHexValue; }; function Utf8Encode(string) { string = string.replace(/\r\n/g, "\n"); var utftext = ""; for (var n = 0; n < string.length; n++) { var c = string.charCodeAt(n); if (c < 128) { utftext += String.fromCharCode(c); } else if ((c > 127) && (c < 2048)) { utftext += String.fromCharCode((c >> 6) | 192); utftext += String.fromCharCode((c & 63) | 128); } else { utftext += String.fromCharCode((c >> 12) | 224); utftext += String.fromCharCode(((c >> 6) & 63) | 128); utftext += String.fromCharCode((c & 63) | 128); } } return utftext; }; var x = Array(); var k, AA, BB, CC, DD, a, b, c, d; var S11 = 7, S12 = 12, S13 = 17, S14 = 22; var S21 = 5, S22 = 9, S23 = 14, S24 = 20; var S31 = 4, S32 = 11, S33 = 16, S34 = 23; var S41 = 6, S42 = 10, S43 = 15, S44 = 21; string = Utf8Encode(string); x = ConvertToWordArray(string); a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476; for (k = 0; k < x.length; k += 16) { AA = a; BB = b; CC = c; DD = d; a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478); d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756); c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB); b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE); a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF); d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A); c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613); b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501); a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8); d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF); c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1); b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE); a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122); d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193); c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E); b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821); a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562); d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340); c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51); b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA); a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D); d = GG(d, a, b, c, x[k + 10], S22, 0x2441453); c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681); b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8); a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6); d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6); c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87); b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED); a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905); d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8); c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9); b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A); a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942); d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681); c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122); b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C); a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44); d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9); c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60); b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70); a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6); d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA); c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085); b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05); a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039); d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5); c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8); b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665); a = II(a, b, c, d, x[k + 0], S41, 0xF4292244); d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97); c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7); b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039); a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3); d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92); c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D); b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1); a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F); d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0); c = II(c, d, a, b, x[k + 6], S43, 0xA3014314); b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1); a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82); d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235); c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB); b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391); a = AddUnsigned(a, AA); b = AddUnsigned(b, BB); c = AddUnsigned(c, CC); d = AddUnsigned(d, DD); } var temp = WordToHex(a) + WordToHex(b) + WordToHex(c) + WordToHex(d); return temp.toLowerCase(); } function _rsa(pem, string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function BytesToBigInt(bytes) { let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); return n; } function BigIntToBytes(n, len) { const out = new Array(len).fill(0); for (let i = len - 1; i >= 0 && n > 0n; i--) { out[i] = Number(n & 0xffn); n >>= 8n; } return out; } function ModPow(base, exp, mod) { let r = 1n; base %= mod; while (exp > 0n) { if (exp & 1n) r = (r * base) % mod; base = (base * base) % mod; exp >>= 1n; } return r; } function DerRead(buf, off) { const tag = buf[off++]; let len = buf[off++]; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + i]; off += n; } return { tag, start: off, len }; } function DerChildren(buf, start, end) { const list = []; let off = start; while (off < end) { const t = DerRead(buf, off); list.push(t); off = t.start + t.len; } return list; } if (!_rsa._k || _rsa._kp !== pem) { try { const der = Base64ToBytes(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); let seqs = DerChildren(der, DerRead(der, 0).start, der.length); const inner = seqs.find(s => s.tag === 0x04); if (inner) { const seq2 = DerRead(der, inner.start); seqs = DerChildren(der, seq2.start, seq2.start + seq2.len); } const ints = seqs.filter(s => s.tag === 0x02); const n = BytesToBigInt(der.slice(ints[1].start, ints[1].start + ints[1].len)); const d = BytesToBigInt(der.slice(ints[3].start, ints[3].start + ints[3].len)); _rsa._k = { n, d, k: (n.toString(16).length + 1) >> 1 }; _rsa._kp = pem; } catch (e) { $.logErr('❌ [签名] 私钥解析失败: ' + (e.message || e)); return null; } } const key = _rsa._k; try { const digestInfo = [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20, ...SHA256(Utf8Encode(string))]; const padded = [0x00, 0x01, ...new Array(key.k - digestInfo.length - 3).fill(0xff), 0x00, ...digestInfo]; const sig = ModPow(BytesToBigInt(padded), key.d, key.n); return BytesToBase64(BigIntToBytes(sig, key.k)).replace(/\//g, '_').replace(/\+/g, '-'); } catch (e) { $.logErr('❌ [签名] 签名异常: ' + (e.message || e)); return null; } } function _rsaenc(b64Pub, string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function BytesToBigInt(bytes) { let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); return n; } function BigIntToBytes(n, len) { const out = new Array(len).fill(0); for (let i = len - 1; i >= 0 && n > 0n; i--) { out[i] = Number(n & 0xffn); n >>= 8n; } return out; } function ModPow(base, exp, mod) { let r = 1n; base %= mod; while (exp > 0n) { if (exp & 1n) r = (r * base) % mod; base = (base * base) % mod; exp >>= 1n; } return r; } function DerRead(buf, off) { const tag = buf[off++]; let len = buf[off++]; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + i]; off += n; } return { tag, start: off, len }; } function DerChildren(buf, start, end) { const list = []; let off = start; while (off < end) { const t = DerRead(buf, off); list.push(t); off = t.start + t.len; } return list; } if (!_rsaenc._k || _rsaenc._kp !== b64Pub) { try { let der = Base64ToBytes(String(b64Pub).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); if (der.length > 5 && der.slice(0, 5).map(b => String.fromCharCode(b)).join('') === '-----') { der = Base64ToBytes(der.map(b => String.fromCharCode(b)).join('').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); } const outer = DerRead(der, 0); const bitStr = DerChildren(der, outer.start, outer.start + outer.len).find(s => s.tag === 0x03); let ints; if (bitStr) { const seq = DerRead(der, bitStr.start + 1); ints = DerChildren(der, seq.start, seq.start + seq.len).filter(s => s.tag === 0x02); } else { ints = DerChildren(der, outer.start, outer.start + outer.len).filter(s => s.tag === 0x02); if (ints.length < 2) throw new Error('公钥解析失败(支持 SPKI/PKCS#1)'); } const n = BytesToBigInt(der.slice(ints[0].start, ints[0].start + ints[0].len)); const e = BytesToBigInt(der.slice(ints[1].start, ints[1].start + ints[1].len)); _rsaenc._k = { n, e, k: (n.toString(16).length + 1) >> 1 }; _rsaenc._kp = b64Pub; } catch (err) { $.logErr('❌ [加密] 公钥解析失败: ' + (err.message || err)); return null; } } const key = _rsaenc._k; try { const msg = Utf8Encode(string); const psLen = key.k - msg.length - 3; if (psLen < 8) { $.logErr('❌ [加密] 明文超出 RSA 长度上限'); return null; } const ps = new Array(psLen); for (let i = 0; i < psLen; i++) ps[i] = 1 + Math.floor(Math.random() * 255); const padded = [0x00, 0x02, ...ps, 0x00, ...msg]; return BytesToBase64(BigIntToBytes(ModPow(BytesToBigInt(padded), key.e, key.n), key.k)); } catch (err) { $.logErr('❌ [加密] RSA 加密异常: ' + (err.message || err)); return null; } } function _hmac(b64Key, msg) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } let key = Utf8Encode(b64Key); if (key.length > 64) key = SHA256(key); while (key.length < 64) key.push(0); const inner = SHA256(key.map(b => b ^ 0x36).concat(Utf8Encode(msg))); const outer = SHA256(key.map(b => b ^ 0x5c).concat(inner)); return outer.map(b => b.toString(16).padStart(2, '0')).join(''); } function _aes(plain, keyStr, ivStr, ecb, ivp) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } const SBOX = (function () { function gmul(a, b) { let p = 0; for (let i = 0; i < 8; i++) { if ((b >> i) & 1) p ^= a; a = ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; } return p; } const sbox = new Array(256); for (let x = 0; x < 256; x++) { let inv = 0; if (x !== 0) { inv = 1; while (gmul(inv, x) !== 1) inv++; } const r = (v, n) => ((v << n) | (v >> (8 - n))) & 0xff; sbox[x] = (inv ^ r(inv, 1) ^ r(inv, 2) ^ r(inv, 3) ^ r(inv, 4) ^ 0x63) & 0xff; } return sbox; })(); function expandKey(key) { const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]; const Nk = key.length >> 2, Nr = Nk + 6, tw = 4 * (Nr + 1); const w = []; for (let i = 0; i < Nk; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]); for (let i = Nk; i < tw; i++) { let t = w[i - 1].slice(); if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]].map(b => SBOX[b]); t[0] ^= RCON[i / Nk - 1]; } else if (Nk > 6 && i % Nk === 4) t = t.map(b => SBOX[b]); w.push([w[i - Nk][0] ^ t[0], w[i - Nk][1] ^ t[1], w[i - Nk][2] ^ t[2], w[i - Nk][3] ^ t[3]]); } const rk = []; for (let round = 0; round <= Nr; round++) { const blk = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) blk[4 * c + r] = w[4 * round + c][r]; rk.push(blk); } return { rk: rk, Nr: Nr }; } function encryptBlock(input, rk, Nr) { let s = input.slice(); const addRK = (round) => { for (let i = 0; i < 16; i++) s[i] ^= rk[round][i]; }; const xtime = (a) => ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; addRK(0); for (let round = 1; round <= Nr; round++) { for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]]; const t = s.slice(); for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) t[4 * c + r] = s[4 * ((c + r) % 4) + r]; s = t; if (round < Nr) { for (let c = 0; c < 4; c++) { const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3]; s[4 * c] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3; s[4 * c + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3; s[4 * c + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3); s[4 * c + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3); } } addRK(round); } return s; } const data = Utf8Encode(plain); const padLen = 16 - (data.length % 16); for (let i = 0; i < padLen; i++) data.push(padLen); const ks = expandKey(Utf8Encode(keyStr)); let prev = ecb ? null : Utf8Encode(ivStr).slice(0, 16); const out = ivp ? prev.slice() : []; for (let off = 0; off < data.length; off += 16) { const blk = new Array(16); for (let i = 0; i < 16; i++) blk[i] = data[off + i] ^ (ecb ? 0 : prev[i]); prev = encryptBlock(blk, ks.rk, ks.Nr); out.push(...prev); } return BytesToBase64(out); } function _aesdec(cipher, keyStr, ecb, hexIn, ivStr) { function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function HexToBytes(h) { const s = String(h).replace(/[^0-9a-fA-F]/g, ''); const bytes = []; for (let i = 0; i + 1 < s.length; i += 2) bytes.push(parseInt(s.substr(i, 2), 16)); if (s.length % 2) bytes.push(parseInt(s.slice(-1), 16)); return bytes; } function BytesToUtf8(bytes) { let s = ''; for (let i = 0; i < bytes.length;) { const b = bytes[i]; if (b < 128) { s += String.fromCharCode(b); i += 1; } else if (b >= 240 && i + 3 < bytes.length) { const cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); const v = cp - 0x10000; s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)); i += 4; } else if (b >= 224 && i + 2 < bytes.length) { s += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3; } else if (b >= 192 && i + 1 < bytes.length) { s += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2; } else { s += String.fromCharCode(b); i += 1; } } return s; } const SBOX = (function () { function gmul(a, b) { let p = 0; for (let i = 0; i < 8; i++) { if ((b >> i) & 1) p ^= a; a = ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; } return p; } const sbox = new Array(256); for (let x = 0; x < 256; x++) { let inv = 0; if (x !== 0) { inv = 1; while (gmul(inv, x) !== 1) inv++; } const r = (v, n) => ((v << n) | (v >> (8 - n))) & 0xff; sbox[x] = (inv ^ r(inv, 1) ^ r(inv, 2) ^ r(inv, 3) ^ r(inv, 4) ^ 0x63) & 0xff; } return sbox; })(); const INV_SBOX = (function () { const inv = new Array(256); for (let i = 0; i < 256; i++) inv[SBOX[i]] = i; return inv; })(); function expandKey(key) { const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]; const Nk = key.length >> 2, Nr = Nk + 6, tw = 4 * (Nr + 1); const w = []; for (let i = 0; i < Nk; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]); for (let i = Nk; i < tw; i++) { let t = w[i - 1].slice(); if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]].map(b => SBOX[b]); t[0] ^= RCON[i / Nk - 1]; } else if (Nk > 6 && i % Nk === 4) t = t.map(b => SBOX[b]); w.push([w[i - Nk][0] ^ t[0], w[i - Nk][1] ^ t[1], w[i - Nk][2] ^ t[2], w[i - Nk][3] ^ t[3]]); } const rk = []; for (let round = 0; round <= Nr; round++) { const blk = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) blk[4 * c + r] = w[4 * round + c][r]; rk.push(blk); } return { rk: rk, Nr: Nr }; } function decryptBlock(input, rk, Nr) { let s = input.slice(); const addRK = (round) => { for (let i = 0; i < 16; i++) s[i] ^= rk[round][i]; }; const xtime = (a) => ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; const mul = (a, b) => { let p = 0; for (let i = 0; i < 8; i++) { if ((b >> i) & 1) p ^= a; a = xtime(a); } return p; }; const irows = () => { const t = s.slice(); for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) t[4 * c + r] = s[4 * (((c - r) % 4 + 4) % 4) + r]; s = t; }; addRK(Nr); for (let round = Nr - 1; round >= 1; round--) { irows(); for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]; addRK(round); for (let c = 0; c < 4; c++) { const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3]; s[4 * c] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9); s[4 * c + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13); s[4 * c + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11); s[4 * c + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14); } } irows(); for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]; addRK(0); return s; } const raw = hexIn ? HexToBytes(cipher) : Base64ToBytes(cipher); if (!raw.length || raw.length % 16) return ''; const ks = expandKey(function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; }(keyStr)); let prev = null, start = 0; if (!ecb) { if (ivStr) { prev = _u8(ivStr).slice(0, 16); while (prev.length < 16) prev.push(0); start = 0; } else { prev = raw.slice(0, 16); start = 16; } } const out = []; for (let off = start; off < raw.length; off += 16) { const blk = raw.slice(off, off + 16); const dec = decryptBlock(blk, ks.rk, ks.Nr); const plainBlk = ecb ? dec : dec.map((b, i) => b ^ prev[i]); out.push(...plainBlk); if (!ecb) prev = blk; } const padLen = out[out.length - 1]; if (padLen >= 1 && padLen <= 16 && out.length >= padLen) { let ok = true; for (let i = 0; i < padLen; i++) if (out[out.length - 1 - i] !== padLen) ok = false; if (ok) out.length -= padLen; } return BytesToUtf8(out); } function _sha256hex(string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } return SHA256(Utf8Encode(string)).map(b => b.toString(16).padStart(2, '0')).join(''); } function _b64(str) { const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const u = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) u.push(c); else if (c < 2048) u.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); u.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else u.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } let out = ''; for (let i = 0; i < u.length; i += 3) { const b0 = u[i], b1 = u[i + 1], b2 = u[i + 2]; out += B[b0 >> 2]; out += b1 === undefined ? B[(b0 & 3) << 4] + '==' : b2 === undefined ? B[((b0 & 3) << 4) | (b1 >> 4)] + B[(b1 & 15) << 2] + '=' : B[((b0 & 3) << 4) | (b1 >> 4)] + B[((b1 & 15) << 2) | (b2 >> 6)] + B[b2 & 63]; } return out; } function _b64d(b64) { const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CH[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } let s = ''; for (let i = 0; i < bytes.length;) { const b = bytes[i]; if (b < 128) { s += String.fromCharCode(b); i += 1; } else if (b >= 240 && i + 3 < bytes.length) { const cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); const v = cp - 0x10000; s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)); i += 4; } else if (b >= 224 && i + 2 < bytes.length) { s += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3; } else if (b >= 192 && i + 1 < bytes.length) { s += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2; } else { s += String.fromCharCode(b); i += 1; } } return s; }function _des(data, keyStr) { const IP = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7]; const FP = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25]; const PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4]; const PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32]; const EX = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1]; const PP = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25]; const SB = [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13,15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9,10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12,7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14,2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3,12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13,4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12,13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11]; const SH = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]; function permute(bits, table) { const out = []; for (let i = 0; i < table.length; i++) out.push(bits[table[i] - 1]); return out; } function toBits(bytes) { const bits = []; for (let i = 0; i < bytes.length; i++) { for (let j = 7; j >= 0; j--) bits.push((bytes[i] >> j) & 1); } return bits; } function fromBits(bits) { const out = []; for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let b = 0; b < 8; b++) v = (v << 1) | bits[i + b]; out.push(v); } return out; } function utf8(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function toBase64(bytes) { const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CH[b0 >> 2]; s += b1 === undefined ? CH[(b0 & 3) << 4] + '==' : b2 === undefined ? CH[((b0 & 3) << 4) | (b1 >> 4)] + CH[(b1 & 15) << 2] + '=' : CH[((b0 & 3) << 4) | (b1 >> 4)] + CH[((b1 & 15) << 2) | (b2 >> 6)] + CH[b2 & 63]; } return s; } function subkeys(keyBytes) { const pc = permute(toBits(keyBytes), PC1); const C = pc.slice(0, 28); const D = pc.slice(28, 56); const keys = []; for (let r = 0; r < 16; r++) { for (let s = 0; s < SH[r]; s++) { C.push(C.shift()); D.push(D.shift()); } keys.push(permute(C.concat(D), PC2)); } return keys; } function encryptBlock(bytes8, keys) { const bits = permute(toBits(bytes8), IP); let L = bits.slice(0, 32); let R = bits.slice(32, 64); for (let r = 0; r < 16; r++) { const x = permute(R, EX).map((b, i) => b ^ keys[r][i]); const sres = []; for (let i = 0; i < 8; i++) { const e6 = x.slice(i * 6, i * 6 + 6); const row = (e6[0] << 1) | e6[5]; const col = (e6[1] << 3) | (e6[2] << 2) | (e6[3] << 1) | e6[4]; const v = SB[i * 64 + row * 16 + col]; for (let b = 3; b >= 0; b--) sres.push((v >> b) & 1); } const f = permute(sres, PP); const next = L.map((b, i) => b ^ f[i]); L = R; R = next; } return fromBits(permute(R.concat(L), FP)); } const keys = subkeys(utf8(String(keyStr)).slice(0, 8)); const bytes = utf8(String(data)); const pad = 8 - (bytes.length % 8); for (let i = 0; i < pad; i++) bytes.push(pad); const ct = []; for (let i = 0; i < bytes.length; i += 8) ct.push.apply(ct, encryptBlock(bytes.slice(i, i + 8), keys)); return toBase64(ct); } function _u8(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function _b64ToBytes(b64) { const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CH[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function _bytesToB64(bytes) { const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CH[b0 >> 2]; s += b1 === undefined ? CH[(b0 & 3) << 4] + '==' : b2 === undefined ? CH[((b0 & 3) << 4) | (b1 >> 4)] + CH[(b1 & 15) << 2] + '=' : CH[((b0 & 3) << 4) | (b1 >> 4)] + CH[((b1 & 15) << 2) | (b2 >> 6)] + CH[b2 & 63]; } return s; } switch (type) { case 'sha256': return _sha256hex(a); case 'md5': return MD5(a); case 'rsa-sha256': return _rsa(a, b); case 'rsa-enc-pkcs1': return _rsaenc(a, b); case 'hmac-sha256': return _hmac(a, b); case 'aes-cbc': return _aes(a, b, c); case 'aes-ecb': return _aes(a, b, null, true); case 'aes-cbc-ivp': return _aes(a, b, c, false, 2); case 'aes-cbc-dec-iv': return _aesdec(a, b, false, false, c); case 'base64-to-hex': return _b64ToBytes(a).map(x => ('0' + x.toString(16)).slice(-2)).join(''); case 'hex-to-base64': { const _hx = String(a).replace(/[^0-9a-fA-F]/g, ''); const _bs = []; for (let i = 0; i + 1 < _hx.length; i += 2) _bs.push(parseInt(_hx.substr(i, 2), 16)); return _bytesToB64(_bs); } case 'aes-cbc-dec': return _aesdec(a, b, false); case 'aes-ecb-dec': return _aesdec(a, b, true); case 'aes-ecb-dec-hex': return _aesdec(a, b, true, true); case 'base64-encode': return _b64(String(a)); case 'base64-decode': return _b64d(a); case 'des-ecb': return _des(a, b); default: return null; } }
