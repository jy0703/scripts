/**
 * 脚本名称：OPPO会员中心签到
 * 活动规则：OPPO 小程序会员每日积分签到，签到后复查会员积分
 * 脚本说明：code 服务(YYB Go)取微信 code → /user/pre/auth 换 sessionId/encryptedSession/openId →
 *          会员信息/签到入口 → 从签到 H5 页发现当期活动 id → cumulativeSignIn 签到，
 *          token 本地缓存自动复用/失效刷新。支持 Node.js / Quantumult X / Loon / Surge / Stash。
 * 配置说明：boxjs 订阅「Code Server」分组中填写「获取小程序code」配置项(@wxCode.*):
 *          - @wxCode.open    开启code模式(true)
 *          - @wxCode.address 服务器地址, 如 http://192.168.2.5:8000
 *          - @wxCode.token   接口鉴权 token (请求头 Authorization: Bearer <token>)
 *          账号 ref 配在本脚本的 boxjs 区域 oppo_ref 中, 多个以英文逗号隔开
 *          Node 环境变量同名可用: WX_CODE_ADDRESS / WX_CODE_TOKEN / oppo_ref
 * 更新时间：2026-10-25

------------------ Surge 配置 ------------------

[Script]
OPPO会员中心签到 = type=cron,cronexp="0 9 * * *",script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/oppo_sign.js,wake-system=1

------------------- Loon 配置 -------------------

[Script]
cron "0 9 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/oppo_sign.js, timeout=600, tag=OPPO会员中心签到

--------------- Quantumult X 配置 ---------------

[task_local]
"0 9 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/oppo_sign.js, tag=OPPO会员中心签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/oppo.png, enabled=true

 */

const $ = new Env('OPPO会员中心');
$.is_debug = getEnv('oppo_debug', 'is_debug') || 'false';  // 调试模式(boxjs 开关 oppo_debug)
$.Messages = [];

// ---- 业务常量 (照 py 源码搬运) ----
const APPID = 'wxe705c556754a1de2';
const MINI_API = 'https://omoapplet-api-cn.heytap.com';
const H5_API = 'https://hd.opposhop.cn';
const APP_VERSION = '361';
const BUSINESS = 1;
const CACHE_KEY = 'oppo_cache';   // 缓存键: 存 {ref:{sessionId,encryptedSession,openId,label,expireTime,updateTime}}
// 仅作回落: 2026-06 那期已过期; 当期 activityId 运行时从签到 H5 页发现
const FALLBACK_SIGN_ACTIVITY_ID = '2061050217641549824';
const FALLBACK_CREDITS_ADD_ACTION_ID = '1788913e6d9e4683b8b9ab0088733560';
const SIGN_PAGE = 'https://hd.opposhop.cn/bp/b371ce270f7509f0?nightModelEnable=true&utm_source=huiyuanwx&utm_medium=me_qiandao';
// 接口 gradeCode → OPPO 官方等级名(官方四档: 普卡/银卡/金卡/钻卡)
const GRADE_NAMES = { commoncard: '普卡会员' };

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) MicroMessenger/3.9.12 MiniProgramEnv/Windows WindowsWechat/WMPF';
// 抓 H5 页面用手机端微信 UA，跟小程序 web-view 里的环境一致
const H5_USER_AGENT = 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.30';

// 主函数
async function main() {
    $.codeServer = (getEnv('WX_CODE_ADDRESS', '@wxCode.address') || '').replace(/\/+$/, '');
    $.yybToken = getEnv('WX_CODE_TOKEN', '@wxCode.token') || '';

    const openRaw = getEnv('WX_CODE_OPEN', '@wxCode.open');
    const refs = (getEnv('oppo_ref') || '').split(/[,，\s\n]+/).filter(Boolean);

    if (openRaw && String(openRaw).toLowerCase() === 'false') throw new Error('boxjs 中「开启code模式」未开启 ❌');
    if (!refs.length) throw new Error('未配置账号：请在 boxjs「OPPO会员中心签到」填写 oppo_ref ❌');
    if (!$.codeServer) throw new Error('未配置 code 服务地址 @wxCode.address ❌');

    for (let i = 0; i < refs.length; i++) {
        $.log(`\n----- 账号 [${i + 1}/${refs.length}] ref=${refs[i]} 开始执行 -----\n`);
        $.messages = [];
        $.refLabel = '';
        await runAccount(refs[i]);
        $.messages.splice(0, 0, `🔹 账号 ${i + 1} [${$.refLabel || refs[i]}]`);
        $.Messages = $.Messages.concat($.messages);
        if (i < refs.length - 1) await $.wait(2000);
    }
}

// 单账号: 登录 + 会员信息 + 签到 + 复查积分
async function runAccount(ref) {
    await $.wait(1000 * (2 + Math.floor(Math.random() * 5)));  // 启动随机延迟
    const session = await loginWithCache(ref);
    if (!session) return;

    try {
        const member = await queryMember(session);
        if (!$.refLabel && member.userName && member.userName !== '未知') $.refLabel = member.userName;
        $.messages.push(`👤 会员: ${member.userName} / 等级 ${member.gradeName}`);

        await queryEntrance(session);

        const act = await discoverSignActivity();
        const activityId = act.activityId || FALLBACK_SIGN_ACTIVITY_ID;
        const actionId = act.actionId || FALLBACK_CREDITS_ADD_ACTION_ID;
        if (!act.activityId) $.log(`⚠️ [签到活动] 使用内置 activityId: ${activityId}（活动 id 按月轮换，若提示活动已结束属正常，等新一期）`);

        await signIn(session, activityId, actionId);

        const after = await queryMember(session);
        $.messages.push(`🪙 积分: ${after.pointAmount}`);
    } catch (e) {
        $.messages.push(`❌ 账号: ${e.message || e}`);
        $.logErr(e);
    }
}

// 优先缓存 token(会员信息验活), 失效则 code 登录
async function loginWithCache(ref) {
    const cache = $.getjson(CACHE_KEY, {}) || {};
    const item = cache[ref];
    if (item?.sessionId && item?.expireTime && Date.now() < item.expireTime - 3600 * 1000) {
        const session = toSession(item);
        if (await isTokenAlive(session)) {
            $.refLabel = item.label || '';
            $.log('✅ [缓存] token 有效');
            return session;
        }
        $.log('⚠️ [缓存] token 已失效, 重新登录');
    }

    const session = await loginFlow(ref);
    if (!session) return null;
    cache[ref] = {
        ...session,
        label: $.refLabel || '',
        expireTime: Date.now() + 24 * 3600 * 1000,
        updateTime: new Date().toISOString()
    };
    $.setdata($.toStr(cache), CACHE_KEY);
    return session;
}

function toSession(item) {
    return {
        sessionId: String(item.sessionId || ''),
        encryptedSession: String(item.encryptedSession || ''),
        openId: String(item.openId || '')
    };
}

// 轻量验活: /member/info 回 ret=1
async function isTokenAlive(session) {
    try {
        const resp = await miniRequest('GET', '/member/info', session, { params: { sessionId: session.sessionId } });
        return String(resp.ret) === '1';
    } catch (e) {
        $.log(`⚠️ [缓存] 验活异常: ${e.message || e}`);
        return false;
    }
}

// code → /user/pre/auth 换 sessionId/encryptedSession/openId
async function loginFlow(ref) {
    const code = await getWxCode(ref);
    if (!code) return null;

    $.log('🔐 [登录] 使用 code 换 token');
    const resp = await Request({
        url: `${MINI_API}/user/pre/auth`,
        headers: {
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/json',
            'Referer': frameReferer()
        },
        body: { code },
        _timeout: 30000
    });

    if (!resp || String(resp.ret) !== '1' || !resp?.data?.sessionId) {
        $.messages.push(`❌ 登录: code 换 token 失败 ${$.toStr(resp).slice(0, 300)}`);
        return null;
    }
    const session = toSession(resp.data);
    $.log(`✅ [登录] token 获取成功: ${mask(session.sessionId)}`);
    return session;
}

// 调用 code 服务(YYB Go)获取微信 code; data.account 备注存入 $.refLabel
async function getWxCode(ref) {
    const options = {
        url: `${$.codeServer}/wxapp/getCode`,
        headers: { 'Content-Type': 'application/json' },
        body: { ref, app_id: APPID }
    };
    if ($.yybToken) options.headers['Authorization'] = `Bearer ${$.yybToken}`;
    // code 服务偶发网络抖动：最多试 3 次（1s/2s 退避），都失败才报错
    let resp = null, errText = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            resp = await Request(options);
            if (resp && resp.code === 0 && resp?.data?.result?.code) {
                $.refLabel = resp.data.account?.remark || resp.data.account?.nickname || resp.data.account?.alias || $.refLabel || '';
                $.log(`✅ [授权] code 获取成功: ${resp.data.result.code}`);
                return String(resp.data.result.code);
            }
            errText = $.toStr(resp);
        } catch (e) {
            errText = (e && e.message) || String(e);
        }
        if (attempt < 3) {
            $.log(`⚠️ [授权] code 获取失败，${attempt}s 后重试（${attempt}/3）：${errText}`);
            await $.wait(1000 * attempt);
        }
    }
    $.messages.push(`❌ 授权: code 获取失败 ${errText}`);
    return null;
}

// 会员信息(积分/成长值/等级) + baseInfo(昵称/手机号)
async function queryMember(session) {
    const memberResp = await miniRequest('GET', '/member/info', session, { params: { sessionId: session.sessionId } });
    const member = memberResp.data || {};
    let base = {};
    try {
        const baseResp = await miniRequest('GET', '/member/baseInfo', session, { params: { sessionId: session.sessionId } });
        base = baseResp.data || {};
    } catch (e) {
        $.log(`⚠️ [会员] baseInfo 获取失败: ${e.message || e}`);
    }

    const userName = member.userName || base.userName || '未知';
    const phone = base.pnumber || '';
    const pointAmount = member.pointAmount ?? 0;
    const growthValue = member.growthValue ?? 0;
    const gradeCode = member.gradeCode || '';
    const gradeName = resolveGradeName(member);
    $.log(`👤 [会员] 用户: ${userName}，积分: ${pointAmount}，成长值: ${growthValue}，等级: ${gradeName}${gradeCode && gradeCode !== gradeName ? `(${gradeCode})` : ''}${phone ? `，手机号: ${phone}` : ''}`);
    return { member, userName, pointAmount, gradeCode, gradeName };
}

// 接口只回 gradeCode(如 commoncard), 展示转成 OPPO 官方等级名
function resolveGradeName(member) {
    const code = String(member.gradeCode || '');
    const name = member.gradeName || member.gradeDesc || member.levelName || member.memberGradeName;
    if (name) return String(name);
    return GRADE_NAMES[code] || code || '未知';
}

async function queryEntrance(session) {
    try {
        const resp = await miniRequest('GET', '/activity/signIn/entrance', session, { params: { sessionId: session.sessionId } });
        const data = resp.data || {};
        const started = data.signInIsStarted ? '已开启' : '未开启';
        const signDays = data.signInDays ?? '-';
        $.log(`🚪 [签到入口] ${started}，连续/累计天数: ${signDays}`);
    } catch (e) {
        $.log(`⚠️ [签到入口] 查询失败: ${e.message || e}`);
    }
}

// 从签到 H5 页发现当期活动 id（只读），失败返回空值回落内置 id
async function discoverSignActivity() {
    try {
        const html = await Request({
            url: SIGN_PAGE,
            headers: {
                'User-Agent': H5_USER_AGENT,
                'Accept': 'text/html,*/*',
                'Referer': SIGN_PAGE
            },
            _timeout: 30000
        });
        if (!html || typeof html !== 'string') {
            $.log('⚠️ [签到活动] 页面不可读，回落到内置 id');
            return {};
        }

        const anchor = /"type"\s*:\s*"SignIn"/.exec(html);
        if (!anchor) {
            $.log('⚠️ [签到活动] 页面里没有 SignIn 楼层（活动可能真的下线了），回落到内置 id');
            return {};
        }

        const segment = html.slice(anchor.index, anchor.index + 2000);
        const idMatch = /"activityInfo"\s*:\s*\{[^{}]*"activityId"\s*:\s*"(\d+)"/.exec(segment);
        const nameMatch = /"activityName"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(segment);
        const actionMatch = /"creditsAddActionId"\s*:\s*"([0-9a-f]{32})"/.exec(segment);
        if (!idMatch) {
            $.log('⚠️ [签到活动] SignIn 楼层里没有 activityId，回落到内置 id');
            return {};
        }

        const name = nameMatch ? nameMatch[1] : '';
        $.log(`✅ [签到活动] ${name || '未命名'} (activityId=${idMatch[1]})`);
        return { activityId: idMatch[1], actionId: actionMatch ? actionMatch[1] : null };
    } catch (e) {
        $.log(`⚠️ [签到活动] 发现失败: ${e.message || e}，回落到内置 id`);
        return {};
    }
}

// 签到详情: 取今日奖励与签到状态
async function querySignDetail(session, activityId, actionId) {
    const result = await h5Request('GET', '/api/cn/oapi/marketing/cumulativeSignIn/getSignInDetail', session, {
        params: {
            activityId,
            creditsAddActionId: actionId,
            business: BUSINESS
        }
    });
    const detail = result.data || {};
    const awards = Array.isArray(detail.baseAwards) ? detail.baseAwards : [];

    const today = $.time('yyyy-MM-dd');
    let award = awards.find(item => item && String(item.signTime || '').slice(0, 10) === today);
    if (!award) award = (awards[0] && typeof awards[0] === 'object') ? awards[0] : {};

    const signed = Number(award.status || 0) === 1;
    let awardDesc = String(award.awardValue ?? '-');
    if (award.awardType !== undefined && award.awardType !== null) awardDesc += awardTypeName(award.awardType);
    const signDayNum = detail.signInDayNum ?? 0;
    $.log(`📅 [签到详情] ${signed ? '今日已签' : '今日未签'}，已签天数: ${signDayNum}，今日奖励: ${awardDesc}`);
    return { detail, signed };
}

async function signIn(session, activityId, actionId) {
    const { signed } = await querySignDetail(session, activityId, actionId);
    if (signed) {
        $.messages.push('⚠️ 签到: 今日已签到');
        return '今日已签到';
    }

    const result = await h5Request('POST', '/api/cn/oapi/marketing/cumulativeSignIn/signIn', session, {
        payload: {
            activityId,
            captchaCode: '',
            creditsAddActionId: actionId,
            business: BUSINESS
        }
    });
    const data = result.data || {};
    if (data.receiveStatus === false) {
        const msg = data.receiveFailMsg || result.message || '未知原因';
        $.messages.push(`❌ 签到: ${msg}`);
        return `签到失败: ${msg}`;
    }

    let awardDesc = String(data.awardValue ?? '-');
    if (data.awardType !== undefined && data.awardType !== null) awardDesc += awardTypeName(data.awardType);
    $.messages.push(`✅ 签到: 获得 ${awardDesc}`);
    await querySignDetail(session, activityId, actionId);
    return `签到成功，获得 ${awardDesc}`;
}

function awardTypeName(awardType) {
    const mapping = { 0: '无奖励', 1: '积分', 2: '优惠券', 3: '抽奖机会' };
    const key = Number(awardType);
    return Object.prototype.hasOwnProperty.call(mapping, key) ? mapping[key] : `类型${awardType}`;
}

// ---------- OPPO 业务请求 ----------

function frameReferer() {
    return `https://servicewechat.com/${APPID}/${APP_VERSION}/page-frame.html`;
}

// 小程序 API 请求头（照源脚本 miniHeaders）
function miniHeaders(session) {
    return {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        's_channel': 'oppo',
        'source_type': '2',
        's_version': '010000',
        'spCallSource': 'oppohy',
        'Referer': frameReferer(),
        'sessionId': session.sessionId || '',
        'NEWOPPOSID': session.encryptedSession || '',
        'openid': session.openId || '',
        'sa_distinct_id': session.openId || '',
        'constToken': session.sessionId || ''
    };
}

// 签到 H5 活动页请求头（照源脚本 h5Headers）
function h5Headers(session) {
    const cookie = [
        `NEWOPPOSID=${pyQuote(session.encryptedSession || '')}`,
        `sessionId=${pyQuote(session.sessionId || '')}`,
        `openid=${pyQuote(session.openId || '')}`
    ].join('; ');
    return {
        'User-Agent': H5_USER_AGENT,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Origin': H5_API,
        'Referer': SIGN_PAGE,
        'sessionId': session.sessionId || '',
        'NEWOPPOSID': session.encryptedSession || '',
        'openid': session.openId || '',
        'sa_distinct_id': session.openId || '',
        'constToken': session.sessionId || '',
        'Cookie': cookie
    };
}

function miniRequest(method, path, session, { params, payload } = {}) {
    return apiRequest(method, `${MINI_API}${path}`, miniHeaders(session), path, params, payload, data => {
        const ret = data.ret;
        if (ret !== undefined && ret !== null && String(ret) !== '1') {
            throw new Error(`${path} 失败: ${data.errMsg || data.message || $.toStr(data).slice(0, 200)}`);
        }
    });
}

function h5Request(method, path, session, { params, payload } = {}) {
    return apiRequest(method, `${H5_API}${path}`, h5Headers(session), path, params, payload, data => {
        if (!(data.code === 200 || data.succeed === true)) {
            throw new Error(`${path} 失败: ${data.message || data.errorMessage || $.toStr(data).slice(0, 200)}`);
        }
    });
}

async function apiRequest(method, url, headers, path, params, payload, check) {
    const options = { url: `${url}${qs(params)}`, headers, _timeout: 30000 };
    if (method.toUpperCase() !== 'GET') options.body = payload || {};

    const data = await Request(options);
    if (!data || typeof data !== 'object') {
        throw new Error(`${path} 响应异常: ${String(data).slice(0, 300)}`);
    }
    check(data);
    return data;
}

function qs(params) {
    const keys = Object.keys(params || {}).filter(key => params[key] !== undefined && params[key] !== null && params[key] !== '');
    if (!keys.length) return '';
    return `?${keys.map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`).join('&')}`;
}

// py urllib.parse.quote 默认 safe='/', 这里保持一致
function pyQuote(value) {
    return encodeURIComponent(String(value)).replace(/%2F/g, '/');
}

function mask(value) {
    value = String(value || '');
    if (value.length <= 12) return value;
    return `${value.slice(0, 6)}...${value.slice(-6)}`;
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
