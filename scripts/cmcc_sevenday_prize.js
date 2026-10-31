/**
 * 脚本名称：移动七日夺宝
 * 活动规则：中国移动 App「每日登录活动」H5 —— 七日打卡分百万（连续打卡领奖）+ 天天来夺宝（每天 1 次，打卡获得）
 * 脚本说明：全自动、本地零加密（加密与换票全在取凭证网关里）：换 User-Token 先用 cmcc_data 里的大网 uid
 *            （cmcc_sign 换票时顺手写入，不顶号），换不到才回落到重放「中国移动签到」抓的 autoLogin 传参（会顶号）
 * 环境变量：cmcc_autologin_data(由 cmcc_sign 抓) / cmcc_sevenday_prize_cfg(本脚本抓) / @tools.address / @tools.token / cmcc_sevenday_prize_phone(兜底手机号) / cmcc_sevenday_prize_debug
 * 更新时间：2026-10-31

------------------ Surge 配置 ------------------

[Script]
移动七日夺宝 = type=cron,cronexp="5 8 * * *",wake-system=1,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sevenday_prize.js,script-update-interval=0
移动抓活动参数 = type=http-request,pattern=^https?:\/\/dev\.coc\.10086\.cn\/coc\/(web6\/dailyLoginEvent(?!\/assets)|activities\/prize\/(drawDayNum|consecutiveClockInQuery)),requires-body=1,max-size=0,timeout=60,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sevenday_prize.js,script-update-interval=0
移动抓七日金额 = type=http-response,pattern=^https?:\/\/dev\.coc\.10086\.cn\/coc\/web6\/dailyLoginEvent\/assets\/index-,requires-body=1,max-size=2097152,timeout=60,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sevenday_prize.js,script-update-interval=0

[MITM]
hostname = dev.coc.10086.cn

------------------- Loon 配置 -------------------

[Script]
cron "5 8 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sevenday_prize.js, timeout=600, tag=移动七日夺宝
http-request ^https?:\/\/dev\.coc\.10086\.cn\/coc\/(web6\/dailyLoginEvent(?!\/assets)|activities\/prize\/(drawDayNum|consecutiveClockInQuery)) script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sevenday_prize.js,requires-body=true,timeout=60,tag=移动抓活动参数
http-response ^https?:\/\/dev\.coc\.10086\.cn\/coc\/web6\/dailyLoginEvent\/assets\/index- script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sevenday_prize.js,requires-body=true,timeout=60,tag=移动抓七日金额

[Mitm]
hostname = dev.coc.10086.cn

--------------- Quantumult X 配置 ---------------

[rewrite_local]
^https?:\/\/dev\.coc\.10086\.cn\/coc\/(web6\/dailyLoginEvent(?!\/assets)|activities\/prize\/(drawDayNum|consecutiveClockInQuery)) url script-request-body https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sevenday_prize.js
^https?:\/\/dev\.coc\.10086\.cn\/coc\/web6\/dailyLoginEvent\/assets\/index- url script-response-body https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sevenday_prize.js

[task_local]
"5 8 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sevenday_prize.js, tag=移动七日夺宝, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/cmcc.png, enabled=true

[MITM]
hostname = dev.coc.10086.cn
 */

const $ = new Env('移动七日夺宝');
$.is_debug = isOn(getEnv('cmcc_sevenday_prize_debug', 'is_debug'));
$.Messages = [];

const COC = 'https://dev.coc.10086.cn';
// 活动参数：内置默认值够跑当期活动，抓一次活动页会写进 cmcc_sevenday_prize_cfg 覆盖（活动改期不用改代码）
const DEFAULT_CFG = {
    drawActivityId: '2110928691993350144',    // 天天来夺宝（每日抽奖）
    clockInActivityId: '2110926553960751104', // 七日打卡分百万（连续打卡）
    touchCode: 'P00000005743',                // 页面 channelId
    pageId: '2090341662452445184',
    clockInRewards: ['1.0', '0.6', '0.5', '0.5', '0.6', '0.7', '1.1'], // 七日金额表只在页面包里，接口不回
    clockInTotal: '5',                        // 集满后的话费券面额
};
const CFG_KEY = 'cmcc_sevenday_prize_cfg';
const UA_H5 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/wkwebview';
const AUTOLOGIN_KEY = 'cmcc_autologin_data';
// 取凭证网关：与 cmcc_sign 共用同一份配置
const TOOLS_API = (getEnv('TOOLS_API', '@tools.address') || '').replace(/\/+$/, '');
const TOOLS_API_TOKEN = getEnv('TOOLS_API_TOKEN', '@tools.token') || '';

let cfg = Object.assign({}, DEFAULT_CFG);
const pageUrl = () => `${COC}/coc/web6/dailyLoginEvent/index?pageId=${cfg.pageId}&channelId=${cfg.touchCode}`;

// 只认白名单字段、且形状对得上，手填/抓错都不会把请求拼坏
function isCfgVal(key, val) {
    if (key === 'clockInRewards') return Array.isArray(val) && val.length > 0 && val.length <= 31 && val.every((x) => /^\d+(\.\d+)?$/.test(String(x)));
    if (key === 'clockInTotal') return typeof val === 'string' && /^\d+(\.\d+)?$/.test(val.trim());
    return typeof val === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(val.trim());
}

function pickCfg() {
    const out = {};
    for (const k of Object.keys(DEFAULT_CFG)) out[k] = cfg[k];
    return out;
}

function loadCfg() {
    const raw = getEnv(CFG_KEY) || '';
    const src = (typeof raw === 'string' ? $.toObj(raw, null) : raw) || {};
    for (const k of Object.keys(DEFAULT_CFG)) {
        if (!isCfgVal(k, src[k])) continue;
        cfg[k] = k === 'clockInRewards' ? src[k].map(String) : String(src[k]).trim();
    }
    cfg.capturedAt = String(src.capturedAt || '');
    return cfg;
}

// ---------- coc 接口 ----------
function apiHeaders(token, extra) {
    const h = {
        'content-type': 'application/json',
        accept: 'application/json, text/plain, */*',
        origin: COC,
        referer: pageUrl(),
        'user-agent': UA_H5,
    };
    const t = token || ($.user && $.user.token);
    if (t) h.Cookie = `User-Token=${t}`;
    return Object.assign(h, extra || {});
}

async function cocPost(path, body, extraHeaders) {
    const res = await Request({
        url: COC + path, method: 'POST', headers: apiHeaders(null, extraHeaders),
        body: JSON.stringify(body), _respType: 'all', _timeout: 20000,
    });
    if (!res) throw new Error(`${path} 无响应`);
    let out = null;
    try { out = $.toObj(res.body, null); } catch (e) { }
    if (!out) throw new Error(`${path} 非 JSON 响应（HTTP ${res.status || res.statusCode}）`);
    if ($.is_debug) $.log(`[${path}] HTTP ${res.status || res.statusCode} ${String(res.body).slice(0, 200)}`);
    return out;
}

async function gatewayTools(path, body) {
    if (!TOOLS_API) throw new Error('未填 @tools.address（boxjs「取凭证网关(tools)」分区）');
    if (!TOOLS_API_TOKEN) throw new Error('填了 @tools.address 但没填 @tools.token');
    return await Request({
        url: `${TOOLS_API}${path}`, method: 'post',
        headers: { 'content-type': 'application/json', 'x-token': TOOLS_API_TOKEN },
        body, _timeout: 30000,
    });
}

// cmcc_data 里找「中国移动签到」换票时存下的大网 uid：有它就只走 loginCheck，不重放 autoLogin（不顶号、不惹风控）
function pickSessionUid() {
    const arr = $.toObj($.getdata('cmcc_data'), []) || [];
    const hits = (Array.isArray(arr) ? arr : []).filter((u) => u && u.sessionUid);
    if (!hits.length) return null;
    if (hits.length > 1) $.log(`[凭证] cmcc_data 里有 ${hits.length} 个带大网 uid 的账号，先用第一个`);
    const u = hits[0];
    let phone = '';
    try { const p = BigInt('0x' + String(u.userCheckId)).toString(); if (/^1\d{10}$/.test(p)) phone = p; } catch (e) { }
    return { sessionUid: String(u.sessionUid), phone };
}

// 换 User-Token：先用 cmcc_data 里的大网 uid（不顶号），换不到（没有/过期/被拒）才重放 autoLogin
async function fetchUserToken(autologin) {
    const u = pickSessionUid();
    if (u) {
        let why = '';
        try {
            const t = await gatewayTools('/api/cmcc/usertoken', { sessionUid: u.sessionUid, cfg: pickCfg() });
            if (t && t.userToken) {
                if (!t.phone) t.phone = u.phone;
                $.log(`[凭证] 用 cmcc_data 的大网 uid 换到 User-Token（${String(t.userToken).length} 字符，没重放 autoLogin）`);
                return t;
            }
            why = String((t && (t.error || t.message)) || '响应为空').slice(0, 90);
        } catch (e) { why = String(e.message || e).slice(0, 90); }
        $.log(`[凭证] ⚠️ 大网 uid 没换出 User-Token（${why}），回落到 autoLogin 重放`);
    }
    if (!autologin || !autologin.url || !autologin.body) {
        throw new Error(u ? '大网 uid 换不到、又没有 cmcc_autologin_data 可重放：在「中国移动签到」插件开「捕获 autoLogin」进一次 App' : `既没有 cmcc_data 里的大网 uid，也没有 ${AUTOLOGIN_KEY}：先在签到插件开「捕获 autoLogin」抓一次传参`);
    }
    const body = Object.assign({}, autologin, { cfg: pickCfg() });
    let r = null, why = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            r = await gatewayTools('/api/cmcc/usertoken', body);
        } catch (e) {
            r = null;
            why = String(e.message || e);
        }
        if (r && r.userToken) { $.log('[凭证] 用 autoLogin 重放换到 User-Token（本次会顶掉 App 当前登录）'); return r; }
        why = why || String((r && (r.error || r.message)) || '响应为空');
        // 风控要求验证（2141xx）、或网关还没有这个路由（跑的是旧进程），都不必再试——重试用只会加重风控
        if (/2141\d\d/.test(why) || /接口不存在|404/.test(why)) break;
        if (attempt < 3) await $.wait(1000 * attempt);
    }
    if (why.includes('214103')) throw new Error(`${why} —— 短时间换票太频繁被风控拦住，要人脸识别：去 App 里过一次人脸（或等几小时），这期间别再重跑本脚本`);
    if (why.includes('214100')) throw new Error(`${why} —— App 侧风控要求验证：开着抓取，在 App 里过一遍验证/重新登录再跑`);
    if (/接口不存在|404/.test(why)) throw new Error('网关还没有 /api/cmcc/usertoken，重启取凭证网关后再跑');
    throw new Error(`换 User-Token 失败：${why}`);
}

// 手机号：换票返回的号码优先，其次 cmcc_sevenday_prize_phone，最后从 cmcc_data 的 userCheckId 还原
function phoneOfUser() {
    const direct = String(getEnv('cmcc_sevenday_prize_phone') || '').replace(/\D/g, '');
    if (/^1\d{10}$/.test(direct)) return direct;
    if ($.user && /^1\d{10}$/.test(String($.user.phone || ''))) return $.user.phone;
    const arr = $.toObj($.getdata('cmcc_data'), []) || [];
    for (const u of Array.isArray(arr) ? arr : []) {
        if (u && u.userCheckId) {
            try { const p = BigInt('0x' + String(u.userCheckId)).toString(); if (/^1\d{10}$/.test(p)) return p; } catch (e) { }
        }
    }
    return '';
}

function clockInAmount(days) {
    return cfg.clockInRewards.slice(0, Math.max(0, Math.min(Number(days) || 0, cfg.clockInRewards.length)))
        .reduce((sum, x) => sum + Number(x), 0).toFixed(1);
}

// 打卡密文由网关的 wasm 出：wasm 的 g_dt() 要自己发一次 POST /coc/wasmrc/gDT 取设备令牌（请求得带 User-Token），
// 手机脚本环境里没有 fetch、那个字段就是空的，服务端只回「参数不合法/领取失败」，所以整段 wasm 放网关 worker 里跑
async function clockInToday() {
    const phone = phoneOfUser();
    if (!phone) throw new Error('拿不到手机号：boxjs 填 cmcc_sevenday_prize_phone，或让 cmcc_data 里有该账号');
    const c = await gatewayTools('/api/cmcc/clockin', {
        activityId: cfg.clockInActivityId, account: phone, pageId: cfg.pageId, touchCode: cfg.touchCode,
        userToken: $.user && $.user.token,
    });
    if (!c || !c.cocEnContent || !c.cocAurora) throw new Error(`网关没出打卡密文：${(c && (c.error || c.message)) || '响应为空'}`);
    return cocPost('/coc/activities/prize/clockIn', { cocEnContent: c.cocEnContent }, { 'coc-aurora': c.cocAurora, 'coc-en-version': c.cocEnVersion });
}

// 单个账号：打卡 + 抽奖
async function runAccount(account) {
    const say = (t) => { $.messages.push(t); $.log(t); };

    // ① 换票
    try {
        const t = await fetchUserToken(account.autologin);
        account.token = t.userToken;
        account.phone = String(t.phone || '');
        const tail = String(t.phone || '').slice(-4) || String(t.maskedMobile || '').slice(-4);
        account.userName = tail ? `尾号 ${tail}` : '未命名';
    } catch (e) { say(`❌ 换票: ${e.message || e}`); return; }

    // ② 打卡：必须先打卡再查次数，否则漏掉今天这次抽奖
    const ci = await cocPost('/coc/activities/prize/consecutiveClockInQuery', { activityId: cfg.clockInActivityId });
    const ciData = (ci.code === '0' && ci.data) || {};
    const days = ciData.clockInDateList || [];
    const checkedToday = days.includes($.time('yyyyMMdd'));
    const allDone = String(ciData.taskCompleted) === '0';       // '0' = 七天已集满（与页面同判据）
    $.log(`[七日打卡] 进度 ${days.length}/${cfg.clockInRewards.length} 天 · 已累计 ${clockInAmount(days.length)} 元 · ${checkedToday ? '今天已打' : '今天未打'}${allDone ? ' · 已集满' : ''}`);
    if (!checkedToday) {
        try {
            const r = await clockInToday();
            if (String(r.code) === '0') {
                const got = days.length + (checkedToday ? 0 : 1);
                say(`✅ 七日打卡完成：进度 ${got}/${cfg.clockInRewards.length} 天 · 累计 ${clockInAmount(got)} 元${(r.data || {}).prizeCode ? ` · 券码 ${(r.data || {}).prizeCode}` : ''}`);
                if (got >= cfg.clockInRewards.length) say(`✅ 已集满 ${cfg.clockInRewards.length} 天，可领 ${cfg.clockInTotal} 元话费券`);
            } else say(`❌ 打卡: ${r.code} ${r.message || ''}`);
        } catch (e) {
            say(`❌ 打卡: ${String(e.message || e).slice(0, 80)}`);
        }
    } else if (days.length >= cfg.clockInRewards.length) {
        say(`✅ 七日打卡已满 ${cfg.clockInRewards.length} 天：累计 ${clockInAmount(days.length)} 元，可领 ${cfg.clockInTotal} 元话费券`);
    }

    // ③ 今日次数：只看 dayRemainNum，本月/总剩余是累计值，与当天无关
    let left = 0;
    {
        const st = await cocPost('/coc/activities/prize/drawDayNum', { activityId: cfg.drawActivityId });
        if (st.code === '40') { say('❌ User-Token 被拒（code=40）：重抓一次 autoLogin 再跑'); return; }
        if (String(st.code) !== '0') { say(`❌ 查次数: ${st.code} ${st.message || ''}`); return; }
        left = Number((st.data || {}).dayRemainNum || 0);
        $.log(left <= 0 ? '[夺宝] 今日可抽 0 次，不抽奖' : `[夺宝] 今日可抽 ${left} 次`);
    }

    // ④ 抽奖：次数全看服务端给的 dayRemainNum
    let n = 0;
    const drew = [];
    while (left > 0) {
        n++;
        const r = await cocPost('/coc/activities/prize/templatePrize', { activityId: cfg.drawActivityId, touchCode: cfg.touchCode });
        if (String(r.code) !== '0') { say(`❌ 抽奖: ${r.code === '40' ? 'User-Token 失效' : (r.message || r.code)}`); break; }
        const pr = r.data || {};
        drew.push(pr);
        $.log(`[夺宝] 第 ${n} 次：prizeId=${pr.prizeId} code=${pr.prizeCode}`);
        left--;
        await $.wait(1200);
    }
    if (drew.length) {
        // 抽奖接口只回 prizeId/prizeCode，奖品名要查订单列表；"感谢参与"(skuType 99) 就是未中奖
        const or = await cocPost('/coc/activities/prize/activityOrderList', { activityId: cfg.drawActivityId });
        const orders = (or.code === '0' && (or.data || {}).activityOrderDTO) || [];
        for (const d of drew) {
            const o = orders.find((x) => String(x.prizeId) === String(d.prizeId));
            if (!o) { say(`⚠️ 夺宝: 已抽奖，奖品名待确认（prizeId ${d.prizeId}）`); continue; }
            const name = String(o.skuName || d.skuName || '').trim();
            if (!name || name.includes('感谢参与') || name.includes('谢谢参与') || Number(o.skuType) === 99) say('✅ 夺宝: 未中奖');
            else say(`🎉 夺宝中奖：${name}${d.prizeCode ? `（券码 ${d.prizeCode}）` : ''}`);
        }
        const after = await cocPost('/coc/activities/prize/drawDayNum', { activityId: cfg.drawActivityId });
        if (after.code === '0') $.log(`[夺宝] 抽完今日剩 ${(after.data || {}).dayRemainNum} 次`);
    }
}

// 抓活动参数：页面 URL 给 pageId/channelId，两个查询接口给 activityId，活动包体给七日金额表
function GetCfg() {
    try {
        const req = $request || {};
        const url = String(req.url || '');
        let patch = null;
        const query = (name) => {
            const m = new RegExp('[?&]' + name + '=([^&#]+)').exec(url);
            return m ? decodeURIComponent(m[1]) : '';
        };
        if (/\/coc\/activities\/prize\/drawDayNum/.test(url)) patch = { drawActivityId: bodyId(req) };
        else if (/consecutiveClockInQuery/.test(url)) patch = { clockInActivityId: bodyId(req) };
        else if (/\/coc\/web6\/dailyLoginEvent\/assets\/index-/.test(url)) patch = rewardsOf(String((typeof $response !== 'undefined' && $response.body) || ''));
        else if (/\/coc\/web6\/dailyLoginEvent\//.test(url)) patch = { pageId: query('pageId'), touchCode: query('channelId') };
        if (patch) saveCfg(patch);
    } catch (e) {
        $.log('❌ 活动参数获取失败'), $.log(e);
    }
}

function bodyId(req) {
    const b = typeof req.body === 'string' ? $.toObj(req.body, null) : req.body;
    return (b && b.activityId) || '';
}

// 页面包里的形态：rewards:Object.freeze(["1.0",...].map(...)),total:5
function rewardsOf(text) {
    const m = /rewards:Object\.freeze\(\[((?:"[\d.]+"\s*,?\s*)+)\]/.exec(text);
    if (!m) return null;
    const list = (m[1].match(/"[\d.]+"/g) || []).map((x) => x.replace(/"/g, ''));
    const out = {};
    if (list.length) {
        out.clockInRewards = list;
        const t = /total:(\d+)/.exec(text.slice(m.index, m.index + 400));
        if (t) out.clockInTotal = t[1];
    }
    return Object.keys(out).length ? out : null;
}

// 只在真的不同时动手：与已存值相同不动，抓回的就是内置默认值也不动（否则定时任务自己的请求会把这份参数"抓"回来）；
// 反过来，若 App 已经回到默认值而这里还压着旧覆盖，就把那一项撤掉，免得一直用错期的参数跑
function saveCfg(patch) {
    const cur = $.toObj($.getdata(CFG_KEY) || '', {}) || {};
    const valid = {};
    for (const [k, v] of Object.entries(patch || {})) {
        if (!isCfgVal(k, v)) continue;
        valid[k] = k === 'clockInRewards' ? v.map(String) : String(v).trim();
    }
    if (!Object.keys(valid).length) return;            // 这条请求里没有可用参数
    const ackKey = CFG_KEY + '_ack';
    const upd = [], rst = [];
    for (const [k, val] of Object.entries(valid)) {
        if (JSON.stringify(cur[k]) === JSON.stringify(val)) continue;                  // 与已存值相同
        if (JSON.stringify(DEFAULT_CFG[k]) === JSON.stringify(val)) {
            if (cur[k] === undefined) continue;                                        // 本来就走默认值
            delete cur[k];
            rst.push(k);
            continue;
        }
        cur[k] = val;
        upd.push(k);
    }
    let msg = '';
    if (upd.length || rst.length) {
        const parts = [];
        if (upd.length) parts.push('更新 ' + upd.join('/'));
        if (rst.length) parts.push('回落默认 ' + rst.join('/'));
        msg = '🎉已抓到活动参数：' + parts.join(' · ');
        cur.capturedAt = new Date().toISOString();
        $.setdata($.toStr(cur), CFG_KEY);
    } else if ($.getdata(ackKey) !== JSON.stringify(valid)) {
        msg = '✅已抓到活动参数（与内置默认值一致，不用写入）：' + Object.keys(valid).join('/');   // 一组值只确认一次
    }
    if (!msg) return;
    $.setdata(JSON.stringify(valid), ackKey);
    $.Messages.push(msg);
    $.log(msg);
}

// 主函数：一个 autoLogin 信封 = 一个账号
async function main() {
    loadCfg();
    let autologin = getEnv(AUTOLOGIN_KEY) || '';
    if (typeof autologin === 'string') autologin = $.toObj(autologin, null);
    const okAuto = !!(autologin && autologin.url && autologin.body);
    if (!okAuto && !pickSessionUid()) {
        throw new Error(`既没有 cmcc_data 里的大网 uid，也没有 ${AUTOLOGIN_KEY}：在「中国移动签到」插件开「捕获 autoLogin」进一次 App 抓传参 ❌`);
    }
    const age = (okAuto && autologin.capturedAt) ? `（autoLogin 抓于 ${((Date.now() - Date.parse(autologin.capturedAt)) / 86400000).toFixed(1)} 天前）` : '';
    $.log(`\n🌀 开始执行${age}\n`);
    if (cfg.capturedAt) $.log(`[活动参数] 抓于 ${((Date.now() - Date.parse(cfg.capturedAt)) / 86400000).toFixed(1)} 天前 · 抽奖 ${cfg.drawActivityId} · 打卡 ${cfg.clockInActivityId}`);
    $.messages = [];
    $.user = { autologin };
    try {
        await runAccount($.user);
    } catch (e) {
        $.messages.push(`❌ 异常: ${String(e.message || e).slice(0, 100)}`);
        $.logErr(e);
    }
    $.Messages = [`🔹 账号 移动七日夺宝: ${$.user.userName || '未命名'}`].concat($.messages);
}

// ---------- 工具函数 ----------

function isOn(v) { return v === true || v === 'true' || v === 1 || v === '1'; }

function getEnv(...keys) {
    for (let key of keys) {
        var value = $.isNode() ? process.env[key] || process.env[key.toUpperCase()] || process.env[key.toLowerCase()] || $.getdata(key) : $.getdata(key);
        if (value) return value;
    }
}

function debug(content, title = 'debug') {
    let start = `\n----- ${title} -----\n`;
    let end = `\n----- ${$.time('HH:mm:ss')} -----\n`;
    if ($.is_debug) {
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
                // 去掉本封装自用的键，got/Loon 对未知选项会报错
                const opts = Object.assign({}, options);
                delete opts._respType; delete opts._timeout; delete opts._method; delete opts._authorization;
                $[_method.toLowerCase()](opts, (error, response, data) => {
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

// 脚本执行入口：$request 存在 → 抓活动参数，否则 → 定时任务
!(async () => {
    if (typeof $request !== 'undefined') GetCfg();
    else await main();
})()
    .catch((e) => $.Messages.push(e.message || e) && $.logErr(e))
    .finally(async () => {
        await sendMsg($.Messages.join('\n').trimStart().trimEnd());
        $.done();
    });

function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }
