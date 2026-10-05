/**
 * 脚本名称：中国移动签到
 * 活动规则：中国移动「签到领流量/话费」活动(1021122301) 有两套互相独立的签到：App 端 mark31 与小程序端 mark/do/mark，各自一天一次；另有 AI豆任务(mark/task) 与秒杀抢券(markSeckill)
 * 脚本说明：支持多账号，支持 NE / Node.js 环境。账号参数（App 票据/省市编码等）由本脚本 GetCookie 抓取后存入 cmcc_data
 * 环境变量：cmcc_data
 * 更新时间：2026-10-05 合并秒杀抢券(cmcc_seckill 开关)

------------------ Surge 配置 ------------------

[Script]
中国移动获取Cookie= type=http-request ^https?:\/\/wx\.10086\.cn\/qwhdsso\/appTokenLogin, requires-body=1, max-size=0, timeout=600, script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sign.js, script-update-interval=0

中国移动签到= type=cron cronexp="0 1 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sign.js, timeout=600, script-update-interval=0

[MITM]
hostname = wx.10086.cn

------------------- Loon 配置 -------------------

[Script]
http-request ^https?:\/\/wx\.10086\.cn\/qwhdsso\/appTokenLogin script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sign.js,requires-body=true,timeout=600,tag=中国移动获取Cookie

cron "0 1 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sign.js, timeout=600, tag=中国移动签到

[MITM]
hostname = wx.10086.cn

--------------- Quantumult X 配置 ---------------

[rewrite_local]
^https?:\/\/wx\.10086\.cn\/qwhdsso\/appTokenLogin url script-request-body https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sign.js

[task_local]
"0 1 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sign.js, tag=中国移动签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/cmcc.png, enabled=true

[MITM]
hostname = wx.10086.cn

 */

const $ = new Env('中国移动');
$.is_debug = getEnv('is_debug') || 'false';  // 调试模式
$.userInfo = getEnv('cmcc_data') || '';  // 获取账号
$.userArr = $.toObj($.userInfo) || [];  // 用户信息
$.Messages = [];

// 业务常量 (照 py/抓包搬运)
const BASE = 'https://wx.10086.cn';
const SSO_LOGIN = BASE + '/qwhdsso/login';
const API_MARK = BASE + '/qwhdhub/api/mark';
const ACTIVITY_ID = getEnv('cmcc_activity_id') || '1021122301';
const CHANNEL_ID = getEnv('cmcc_channel_id') || 'P00000109876';
const CLAIM_AWARD = getEnv('cmcc_claim') === 'true';
const RUN_TASKS = getEnv('cmcc_task') === 'true';   // 签到页 AI豆任务(小程序端 mark/task 体系)
const SECKILL = getEnv('cmcc_seckill') === 'true';  // 签到有礼秒杀抢券(同活动 1021122301)
const TASK_API = API_MARK + '/task';
// 秒杀抢券参数 (照 py 默认值)
const SK_API = API_MARK + '/markSeckill';
const SK_INTERVAL = 350;      // 重试间隔(ms)
const SK_LEAD = 400;          // 提前开火(ms)，抵消网络延迟
const SK_MAX_ATTEMPTS = 120;  // 单场最大尝试次数
const SK_MAX_WAIT = 300000;   // 距开抢超过该时长就不再干等(ms)，本次跳过
// 触达即终态的 redeem status：不再浪费请求
const SK_STOP = {
    PRIZE_NO_STOCK: '券已抢完',
    PRIZE_LIMIT_DAY: '当日中奖次数已用完',
    PRIZE_LIMIT_MONTH: '当月中奖次数已用完',
    PRIZE_RESTRIC_LIMIT: '活动期间中奖次数已达上限',
    WORK_ORDER_RESTRIC_LIMIT: '工单限流（黑名单/风控）',
};
// 与抓包完全一致的 App WebView UA（服务端校验 leadeon 标识）
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/wkwebview leadeon/12.5.2/CMCCIT';


// 主函数
async function main() {
    if ($.userArr.length) {
        $.log(`\n🌀 找到 ${$.userArr.length} 个账号变量`);

        for (let i = 0; i < $.userArr.length; i++) {
            $.log(`\n----- 账号 [${i + 1}/${$.userArr.length}] 开始执行 -----\n`);

            // 初始化
            $.is_login = true;
            $.beforeMsgs = '';
            $.messages = [];
            $.user = $.userArr[i];

            await doSign($.user);

            // 账号信息作为该账号通知的开头
            if ($.beforeMsgs) $.beforeMsgs += '\n';
            $.beforeMsgs += `🔹 账号 中国移动${i + 1}: 尾号 ${phoneTail($.user)}`;
            $.messages.splice(0, 0, $.beforeMsgs), $.Messages = $.Messages.concat($.messages);
        }
        $.log(`\n----- 所有账号执行完成 -----\n`);
    } else {
        throw new Error('未找到 cmcc_data 变量 ❌');
    }
}

// 获取Cookie数据 (rewrite 抓取入口, 与头部 http-request 正则配套)
function GetCookie() {
    try {
        if ($request && $request.method === 'OPTIONS') return;

        const body = $.toObj($request.body) || {};
        // App 票据与 userCheckId 缺一不可，其余字段有默认值
        if (!body.token || !body.userCheckId) throw new Error('获取Cookie错误，值为空');

        const ua = ObjectKeys2LowerCase($request.headers)['user-agent'] || '';
        const old = $.userArr.find(e => e.userCheckId === body.userCheckId) || {};
        const newData = {
            'userName': `尾号 ${phoneTail({ userCheckId: body.userCheckId })}`,
            'token': body.token,
            'userCheckId': body.userCheckId,
            'userAgent': ua,
            'provinceCode': body.provinceCode || '',
            'cityCode': body.cityCode || '',
            'carrierOperator': body.carrierOperator || '',
            'appVersionCode': body.appVersionCode || '',
            // App 端 localStorage 里的 jwt 比旧缓存新，缺失时保留旧值
            'jwt': body.jwtToken || old.jwt || '',
            'jwt_first': old.jwt_first || Date.now(),
        };

        const index = $.userArr.findIndex(e => e.userCheckId == newData.userCheckId);
        index !== -1 ? $.userArr[index] = newData : $.userArr.push(newData);
        $.setdata($.toStr($.userArr), 'cmcc_data');
        $.Messages.push('🎉获取Cookie成功!');
        $.log('🎉获取Cookie成功!');
    } catch (e) {
        $.log('❌ Cookie获取失败'), $.log(e);
    }
}

// 任务: 建会话 → 查状态 → 签到 → (可选)领连签奖励
async function doSign(user) {
    const lines = [];
    try {
        let ctx = await exchangeSession(user);
        let statusData = null;
        // 第一次失败若是会话问题，重建后再试一次
        for (let attempt = 1; ; attempt++) {
            try {
                statusData = await queryMarkstatus(ctx);
                break;
            } catch (e) {
                if (attempt === 2) throw e;
                $.log(`会话异常(${e.message})，重建后重试`);
                ctx = await exchangeSession(user);
            }
        }

        const today = $.time('yyyyMMdd');
        const userinfo = statusData.userinfo || {};
        let acc = userinfo.accumulateTimes || '?';
        const signedToday = (statusData.markstatus || []).some(d => d.date === today && d.status === '1');
        $.log(`当前累计签到 ${acc} 天，今日${signedToday ? '已签' : '未签'}`);

        if (signedToday) {
            // App 端已签则跳过 App 签到与连签领奖；小程序端/任务/抢兑各自判状态照常执行
            lines.push(`App 端今日已签（累计 ${acc} 天）`);
        } else {
            const result = await doMark(ctx, today);
            const code = result && result.code, respMsg = (result && result.msg) || '', status = (result && result.status) || '';
            $.log(`domark 响应: code=${code} status=${status} msg=${respMsg}`);
            // HAVE_MARKED 是服务端幂等保护（重复签到返回该码），视为已签成功
            if (code === 'SUCCESS' || respMsg.includes('已签') || status === 'HAVE_MARKED') {
                const prize = parsePrize(result);
                try {
                    acc = ((await queryMarkstatus(ctx)).userinfo || {}).accumulateTimes || acc;
                } catch (e) { }
                if (status === 'HAVE_MARKED') {
                    lines.push(`今日已签到过（服务端幂等），累计 ${acc} 天`);
                } else {
                    lines.push(`签到成功！累计 ${acc} 天`);
                    if (prize) lines.push(`获得奖品: ${prize}`);
                    else if (status === 'PRIZE_NO_CONFIG') lines.push(`今日无单日奖品（奖励按累计签到门槛发放）`);
                }
            } else {
                throw new Error(`签到失败: ${code} / ${status} / ${respMsg}`);
            }
        }

        try {
            lines.push(await doMiniMark(ctx));
        } catch (e) {
            lines.push(`[小程序] 失败: ${e.message || e}`);
        }

        if (CLAIM_AWARD && !signedToday) {
            try {
                const latest = await queryMarkstatus(ctx);
                if (!(latest.taskAwardChance || []).length) $.log('[领奖] 当前无可领取的连签任务');
                lines.push(...await claimTaskAwards(ctx, latest));
            } catch (e) {
                lines.push(`[领奖] 尝试失败: ${e.message || e}`);
            }
        }

        if (RUN_TASKS) {
            try {
                lines.push(...await doMarkTasks(ctx));
            } catch (e) {
                lines.push(`[任务] 失败: ${e.message || e}`);
            }
        }

        if (SECKILL) {
            try {
                lines.push(...await doSeckill(ctx));
            } catch (e) {
                lines.push(`[秒杀] 失败: ${e.message || e}`);
            }
        }
    } catch (e) {
        lines.push(`❌ ${e.message || e}`);
    }
    lines.forEach(l => $.log(l));
    $.messages = $.messages.concat(lines);
}

// 走 SSO 换取活动会话（QWHD_SESSION_TOKEN 落在 jar 里），返回 { jar, ua, referer }
// 凭证策略（py 实测结论）：jwt 是账号级长期凭证，appTokenLogin 里 jwtToken 优先于 token，
// 故优先用缓存 jwt 免票据续期，App 票据仅在 jwt 缺失/失效时作引导兜底。
async function exchangeSession(user) {
    const jar = {};
    const ua = user.userAgent || USER_AGENT;
    const actUrl = `${BASE}/qwhdhub/qwhdmark/${ACTIVITY_ID}?channelId=${CHANNEL_ID}`;

    // ① 登录中转页，提取一次性 sid
    const page = await Request({ url: `${SSO_LOGIN}?dlwmh=true&actUrl=${encodeURIComponent(actUrl)}`, headers: baseHeaders(jar, ua), _respType: 'all', _timeout: 30000 });
    takeCookies(jar, page && page.headers);
    const sid = /loginPath\s*=\s*'([^']+)'/.exec((page && page.body) || '');
    if (!sid) throw new Error('登录页未返回 sid，SSO 入口可能已变更');
    const loginUrl = `${BASE}/qwhdsso${sid[1]}`;

    const baseBody = {
        provinceCode: user.provinceCode || '731',
        cityCode: user.cityCode || '0731',
        userCheckId: user.userCheckId,
        carrierOperator: user.carrierOperator || '002',
        appVersionCode: user.appVersionCode || '12.5.2',
        took: randomInt(120, 900),
    };

    // ② 优先用缓存 jwt 免票据续期
    let resp = null;
    if (user.jwt) {
        resp = await Request({ url: loginUrl, method: 'post', headers: baseHeaders(jar, ua), body: Object.assign({}, baseBody, { jwtToken: user.jwt, token: '' }), _timeout: 30000 });
        if (resp && resp.code === 'SUCCESS') {
            $.log(`jwt 续期成功（未使用 app_token，凭证链已 ${((Date.now() - (user.jwt_first || Date.now())) / 86400000).toFixed(1)} 天）`);
        } else {
            $.log(`jwt 续期失败(${resp && resp.msg})，回落 appTokenLogin 引导`);
            resp = null;
        }
    }

    // ③ 回落：App 票据引导登录（首次配置或 jwt 失效后）
    if (!resp) {
        if (!user.token) throw new Error('App 票据(token)为空，请重新抓包更新凭证');
        resp = await Request({ url: loginUrl, method: 'post', headers: baseHeaders(jar, ua), body: Object.assign({}, baseBody, { jwtToken: null, token: user.token }), _timeout: 30000 });
        if (!resp || resp.code !== 'SUCCESS') {
            // App 票据失效是脚本唯一的"需要人工介入"场景
            throw new Error(`appTokenLogin 失败: ${resp && resp.code} ${resp && resp.msg} —— 通常是 App 票据过期，请打开 App 签到页重新抓包`);
        }
    }

    const data = resp.data || {};
    if (data.jwt) {
        user.jwt = data.jwt;
        user.jwt_first = user.jwt_first || Date.now();
        saveUsers();
    }

    // ④ 访问带 token 的活动页，服务器以 302 + Set-Cookie 下发活动会话令牌
    // 跳转地址来自服务端响应，限定在主站内；不跟随重定向，否则 302 上的 Set-Cookie 会被吞掉
    assertSafeUrl(data.url);
    const act = await Request({ url: data.url, headers: Object.assign(baseHeaders(jar, ua), { referer: actUrl }), _respType: 'all', followRedirect: false, _timeout: 30000 });
    takeCookies(jar, act && act.headers);
    if (act && act.statusCode >= 400) throw new Error(`活动页访问失败: HTTP ${act.statusCode}`);
    // 不同 hub 落不同令牌名（qwhdhub → QWHD_SESSION_TOKEN，hlwyxhdhub → HLWHD_SESSION_TOKEN），同一 jwt 跨 hub 通用，故按后缀匹配
    if (!hasSessionToken(jar)) {
        // 部分环境不遵守"不跟随重定向"，302 上的 Set-Cookie 会被吞掉；此时交给 markstatus 判活
        const sc = (act && act.headers && (act.headers['set-cookie'] || act.headers['Set-Cookie'])) || '-';
        $.log(`未取得会话令牌: HTTP ${act && act.statusCode} cookies=[${Object.keys(jar).join(',')}] set-cookie=${$.toStr(sc, String(sc))}`.slice(0, 300));
    }

    return { jar, ua, referer: data.url };
}

async function queryMarkstatus(ctx) {
    const resp = await Request({ url: `${API_MARK}/mark31/markstatus`, method: 'post', headers: apiHeaders(ctx), body: {}, _timeout: 30000 });
    if (!resp || resp.code !== 'SUCCESS') {
        throw new Error(`markstatus 失败: ${resp && resp.code} ${resp && resp.msg}${hasSessionToken(ctx.jar) ? '' : '（环境未回传活动页 302 的 Set-Cookie，会话无法建立）'}`);
    }
    return resp.data || {};
}

async function doMark(ctx, date) {
    return await Request({ url: `${API_MARK}/mark31/domark`, method: 'post', headers: apiHeaders(ctx), body: { date }, _timeout: 30000 });
}

// 尝试领取 taskAwardChance 里的连签奖励（热门奖品库存紧张，领不到属正常）
async function claimTaskAwards(ctx, statusData) {
    // 任务ID -> 奖品名（taskAwardChance / accumulateTaskInfo / myTaskInfo 三池取首个非空名称）
    const names = {};
    const pools = [statusData.taskAwardChance || [], statusData.accumulateTaskInfo || [], statusData.myTaskInfo || []];
    for (const pool of pools) {
        for (const t of pool) {
            const tid = t.id;
            if (!tid || names[tid]) continue;
            const name = (t.prize && t.prize.name) || t.lotteryText || t.prizeAlertText || '';
            if (name) names[tid] = name;
        }
    }

    const results = [];
    for (const task of statusData.taskAwardChance || []) {
        const tid = task.id;
        if (!tid) continue;
        const resp = await Request({ url: `${API_MARK}/mark31/taskAward/${tid}`, method: 'post', headers: apiHeaders(ctx), body: {}, _timeout: 30000 });
        // status 为 None 时回落到 code（实测领奖成功响应 status 可能为空）
        const statusText = (resp && (resp.status || resp.code)) || '?';
        const label = `任务${tid}` + (names[tid] ? `（${names[tid]}）` : '');
        // 实际到账内容以响应为准（活动配置里的奖品名只是预告，可能已换档）
        const d = (resp && resp.data) || {};
        const awardName = d.prizeName || (d.prize || {}).name || d.name || '';
        const award = [awardName, d.awardNum ? `×${d.awardNum}` : ''].filter(v => v).join(' ');
        results.push(`[领奖] ${label}: ${statusText} ${(resp && resp.msg) || ''}${award ? ` → 实发 ${award}` : ''}`);
        await $.wait(randomInt(1000, 2000));
    }
    return results;
}

// 签到页 AI豆任务（小程序端同一套 mark/task 接口，会话通用）
async function doMarkTasks(ctx) {
    const lines = [];
    const tl = await Request({ url: `${TASK_API}/taskList`, method: 'post', headers: apiHeaders(ctx), body: {}, _timeout: 30000 });
    if (!tl || tl.code !== 'SUCCESS') throw new Error(`taskList 失败: ${tl && tl.code} ${tl && tl.msg}`);
    const tasks = (tl.data || {}).tasks || [];
    const todo = tasks.filter(t => t.status === 0 && t.taskId);
    $.log(`AI豆任务共 ${tasks.length} 个，待办 ${todo.length} 个`);
    if (!todo.length) return lines;

    for (const t of todo) {
        const label = `${t.taskName || t.taskId}${t.awardNum ? `(+${t.awardNum}AI豆)` : ''}`;
        try {
            lines.push(`[任务] ${label}: ${await finishOneTask(ctx, t)}`);
        } catch (e) {
            lines.push(`[任务] ${label}: ❌ ${e.message || e}`);
        }
        await $.wait(randomInt(800, 1800));
    }
    return lines;
}

// 单个任务：taskInfo → 到访目标页并停留 scanTime → (cToken?openFinish : 非浏览类 finishTask) → getTaskAward
// 三种完成形态按抓包还原：浏览类(taskType=2)到访即完成；跳转类(taskType=5)回 cToken 走 openFinish；其余走 finishTask
async function finishOneTask(ctx, task) {
    const tid = String(task.taskId);
    const info = await Request({ url: `${TASK_API}/taskInfo`, method: 'post', headers: apiHeaders(ctx), body: { taskId: tid }, _timeout: 30000 });
    const d = (info && info.data) || {};
    const taskType = String(d.taskType || task.taskType || '');
    const scan = Number(d.scanTime || 0);
    const ju = String(task.jumpUrl || '');

    if (/^https:\/\//i.test(ju)) {
        await Request({ url: ju, headers: baseHeaders(ctx.jar, ctx.ua), _respType: 'all', _timeout: 20000 });
        if (scan) await $.wait((scan + 1) * 1000);
    }

    if (d.cToken) {
        await Request({ url: `${API_MARK}/_pub/task/openFinish`, method: 'post', headers: apiHeaders(ctx), body: { cToken: d.cToken }, _timeout: 30000 });
    } else if (taskType !== '2') {
        // 前端拼的 sign/random 服务端不校验，只发 taskId/taskType 即可
        let fin = await Request({ url: `${TASK_API}/finishTask`, method: 'post', headers: apiHeaders(ctx), body: { taskId: tid, taskType }, _timeout: 30000 });
        // 服务端按 Referer 校验到访页：默认 referer 被拒时带目标页 referer 重试一次
        if (fin && fin.code !== 'SUCCESS' && /未达到/.test(fin.msg || '') && ju.startsWith('https://')) {
            fin = await Request({ url: `${TASK_API}/finishTask`, method: 'post', headers: Object.assign(apiHeaders(ctx), { referer: ju }), body: { taskId: tid, taskType }, _timeout: 30000 });
        }
    }

    const aw = await Request({ url: `${TASK_API}/getTaskAward`, method: 'post', headers: apiHeaders(ctx), body: { taskId: tid }, _timeout: 30000 });
    if (aw && aw.code === 'SUCCESS') return `✅ 已领 ${((aw.data || {}).awardNum) || '?'} AI豆`;
    return `⚠️ 未完成: ${aw && aw.code} ${aw && aw.msg}`;
}

// 小程序端签到（mark/do/mark）：与 App 端 mark31 是两套独立计数，各自一天一次
// 状态一律以 do/mark 的返回为准(TODAY_MARKED=今日已签)；prizeInfo 只用于展示本期天数，
// 它对 App 渠道会话可能不返回数据，取不到就省略，不参与判定。
async function doMiniMark(ctx) {
    const result = await Request({ url: `${API_MARK}/do/mark`, method: 'post', headers: apiHeaders(ctx), body: {}, _timeout: 30000 });
    if (!result) throw new Error('小程序端签到无响应');
    const code = result.code, status = result.status || '', msg = result.msg || '';
    $.log(`mark/do/mark 响应: code=${code} status=${status} msg=${msg}`);
    if (code !== 'SUCCESS' && status !== 'TODAY_MARKED' && status !== 'HAVE_MARKED' && !/已签/.test(msg)) {
        throw new Error(`小程序端签到失败: ${code} / ${status} / ${msg}`);
    }
    const d = result.data || {};
    const prize = d.prizeName || (d.prizeValue ? `${d.prizeValue}${d.prizeCategory === 'FLOW' ? 'MB' : '元'}` : '');
    const period = await miniPeriod(ctx);
    return `${code === 'SUCCESS' ? '小程序端签到成功' : '小程序端今日已签'}${period ? `（${period}）` : ''}${prize ? `，获得: ${prize}` : ''}`;
}

// 小程序端本期/本月已签天数：prizeInfo 的计数字段优先；
// App 渠道会话下它回 null，回落到 markInfo 的本月签到记录条数
async function miniPeriod(ctx) {
    const resp = await Request({ url: `${API_MARK}/info/prizeInfo`, method: 'post', headers: apiHeaders(ctx), body: {}, _timeout: 30000 });
    const d = (resp && resp.data) || {};
    if (d.markedTimes != null && d.totalMarkTimes != null) return `本期 ${d.markedTimes}/${d.totalMarkTimes} 天`;

    const rec = await Request({ url: `${API_MARK}/info/markInfo`, method: 'post', headers: apiHeaders(ctx), body: {}, _timeout: 30000 });
    const list = rec && rec.data;
    if (!Array.isArray(list)) {
        $.log(`prizeInfo(markedTimes=${d.markedTimes}) 与 markInfo(code=${rec && rec.code}) 均未给出本期天数`);
        return '';
    }
    const month = $.time('yyyyMM');
    return `本月已签 ${list.filter(x => String(x.month) === month).length} 天`;
}

// 秒杀抢券: 校时 → 场次 → 资格(未签补签) → 等到开抢 → 循环 redeem
async function doSeckill(ctx) {
    const lines = [];
    const srvMs = await serverNowMs(ctx);
    const offsetMs = srvMs - Date.now();
    $.log(`服务器时间 ${fmtCn(srvMs)}，本机时钟偏移 ${offsetMs >= 0 ? '+' : ''}${offsetMs.toFixed(0)} ms`);

    const cfgResp = await skPost(ctx, `${SK_API}/secConfig`);
    const zones = (((cfgResp || {}).data || {}).secKillData || {}).secKillZones || [];
    if (!zones.length) throw new Error('secConfig 未返回任何场次（活动未配置或已结束）');
    $.log(`共 ${zones.length} 个场次:`);
    zones.forEach(z => $.log(`  场次${z.id} ${fmtCn(z.startTime)} ~ ${fmtCn(z.endTime)}  ${(z.prize || {}).name} (prizeId=${(z.prize || {}).id})`));

    const eligible = await ensureEligible(ctx);
    $.log(`秒杀资格（当日签到）: ${eligible ? '已具备' : '未获取！'}`);

    const picked = pickZone(zones, srvMs);
    if (!picked.zone) throw new Error('没有可参与的场次（全部已结束）');
    const zone = picked.zone, prizeName = (zone.prize || {}).name || `场次${zone.id}`;
    const startSrv = Number(zone.startTime), endSrv = Number(zone.endTime);
    $.log(`选定场次${zone.id}：${fmtCn(startSrv)} 开抢（${picked.active ? '进行中' : `距开始 ${((startSrv - srvMs) / 1000).toFixed(0)} 秒`}）`);

    if (!eligible) {
        return lines.concat('[秒杀] 当日未签到且补签失败，无法参与秒杀');
    }
    if (!picked.active) {
        const waitMs = startSrv - srvMs - SK_LEAD;
        if (waitMs > SK_MAX_WAIT) {
            return lines.concat(`[秒杀] 距开抢还有 ${(waitMs / 60000).toFixed(1)} 分钟，超过等待上限 ${SK_MAX_WAIT / 60000} 分钟，本次跳过（定时请设在开抢前 1~2 分钟）`);
        }
        await waitUntil(Date.now() + waitMs, ctx);
    }

    const fired = await fireRedeem(ctx, zone, endSrv, offsetMs);
    if (fired.reason === 'SUCCESS') {
        lines.push(`🎉 [秒杀] 抢到 ${prizeName}（场次 ${fmtCn(startSrv)}），请去 App「我的奖品」核销`);
    } else {
        const reason = SK_STOP[fired.reason] || fired.reason;
        lines.push(`[秒杀] 未抢到: ${reason}｜${prizeName} 场次 ${fmtCn(startSrv)}`);
    }
    return lines;
}

// 服务器当前毫秒时间；sysTime 格式变化时回落到响应的 Date 头（秒级精度）
async function serverNowMs(ctx) {
    const resp = await Request({ url: `${SK_API}/sysTime`, method: 'post', headers: apiHeaders(ctx), body: {}, _respType: 'all', _timeout: 10000 });
    const body = $.toObj(resp && resp.body, {}) || {};
    const ms = Number((body.data || {}).sysTime);
    if (ms) return ms;
    $.log(`sysTime 响应格式变化: ${$.toStr(body, '{}').slice(0, 200)}`);
    const date = resp && resp.headers && (resp.headers.date || resp.headers.Date);
    const parsed = date ? Date.parse(date) : NaN;
    return isNaN(parsed) ? Date.now() : parsed;
}

// 选出当前进行中或下一场即将开始的场次
function pickZone(zones, nowMs) {
    for (const z of zones) {
        if (Number(z.startTime) <= nowMs && nowMs <= Number(z.endTime)) return { zone: z, active: true };
    }
    const upcoming = zones.filter(z => Number(z.startTime) > nowMs).sort((a, b) => Number(a.startTime) - Number(b.startTime));
    return { zone: upcoming[0] || null, active: false };
}

// 秒杀资格 = 完成当日签到；未签则先走同活动的 domark 补签
async function ensureEligible(ctx) {
    if (await todayMarkStatus(ctx) === 'marked') return true;
    $.log('今日未签到，先补签获取秒杀资格...');
    try {
        const r = await doMark(ctx, $.time('yyyyMMdd'));
        $.log(`补签响应: code=${r && r.code} status=${r && r.status} msg=${(r && r.msg) || ''}`);
    } catch (e) {
        $.log(`补签请求失败: ${e.message || e}`);
    }
    return (await todayMarkStatus(ctx)) === 'marked';
}

async function todayMarkStatus(ctx) {
    const resp = await skPost(ctx, `${SK_API}/todayMarkStatus`);
    return ((resp || {}).data || {}).markStatus || '';
}

// 睡到 target(本地毫秒)；长等时定期发请求保活会话（会话 cookie 滑动 30 分钟）
async function waitUntil(targetMs, ctx) {
    while (true) {
        const remain = targetMs - Date.now();
        if (remain <= 0) return;
        await $.wait(Math.min(remain, 480000));
        if (targetMs - Date.now() > 60000) {
            try {
                await todayMarkStatus(ctx);
                $.log(`会话心跳 ok，距开抢还有 ${((targetMs - Date.now()) / 60000).toFixed(1)} 分钟`);
            } catch (e) {
                $.log(`会话心跳失败: ${e.message || e}`);
            }
        }
    }
}

// 开抢主循环，返回 { resp, reason }
async function fireRedeem(ctx, zone, deadlineSrvMs, offsetMs) {
    const payload = { secId: String(zone.id), prizeId: String((zone.prize || {}).id) };
    $.log(`开始抢购: ${(zone.prize || {}).name} (secId=${payload.secId} prizeId=${payload.prizeId})`);

    for (let attempt = 1; attempt <= SK_MAX_ATTEMPTS; attempt++) {
        if (Date.now() + offsetMs > deadlineSrvMs) return { resp: null, reason: '场次窗口已结束' };
        const resp = await skPost(ctx, `${SK_API}/redeem`, payload);
        if (!resp) {
            await $.wait(SK_INTERVAL);
            continue;
        }
        const code = resp.code, status = resp.status;
        $.log(`第${attempt}发: code=${code} status=${status} msg=${resp.msg || ''}`);
        if (code === 'SUCCESS') return { resp, reason: 'SUCCESS' };
        if (SK_STOP[status]) return { resp, reason: status };
        // NOT_TIME_IN（提前量打早了）与其他未知错误：密集重试直到开抢/窗口结束
        await $.wait(status === 'NOT_TIME_IN' ? 50 : SK_INTERVAL);
    }
    return { resp: null, reason: `连续 ${SK_MAX_ATTEMPTS} 发未中` };
}

// 秒杀接口统一走签到会话的头，超时收紧到 10s 以便快速重试
function skPost(ctx, url, payload) {
    return Request({ url, method: 'post', headers: apiHeaders(ctx), body: payload || {}, _timeout: 10000 });
}

// 毫秒时间戳 → 北京时间 MM-DD HH:mm:ss（不依赖设备时区）
function fmtCn(ms) {
    const d = new Date(Number(ms) + 8 * 3600000);
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

// 从 domark 响应里提取奖品描述
function parsePrize(markResult) {
    const prize = (markResult && markResult.data) && markResult.data.markPrize;
    if (!prize) return '';
    const parts = [prize.name || ''];
    if (prize.prizeValue) parts.push(`${prize.prizeValue}${prize.prizeCategory === 'FLOW' ? 'MB' : '元'}`);
    return parts.filter(p => p).join(' ');
}

// 手机号十六进制(userCheckId) -> 尾号
function phoneTail(user) {
    try {
        return String(Number('0x' + user.userCheckId)).slice(-4);
    } catch (e) {
        return '????';
    }
}

function saveUsers() {
    $.setdata($.toStr($.userArr), 'cmcc_data');
}

// 活动 API 的固定头（抓包还原，缺一可能被拦）
function apiHeaders(ctx) {
    return Object.assign(baseHeaders(ctx.jar, ctx.ua), {
        origin: BASE,
        referer: ctx.referer,
        'login-check': '1',
        'x-requested-with': 'XMLHttpRequest',
    });
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

// 会话令牌名按后缀匹配（不同 hub 前缀不同）
function hasSessionToken(jar) {
    return Object.keys(jar).some(k => /SESSION_TOKEN$/i.test(k));
}

// 动态 URL 出网前的边界校验：仅允许 https 且主机为签到主站
function assertSafeUrl(url) {
    const host = (/^https:\/\/([^/?#]+)/i.exec(url || '') || [])[1];
    if (!host || host.toLowerCase() !== 'wx.10086.cn') throw new Error(`跳转地址异常，已拒绝访问: ${url}`);
}

// ---------- 工具函数 ----------

// key 转小写 (抓包头大小写不定)
function ObjectKeys2LowerCase(obj = {}) { return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v])); }

// 收集响应里的 Set-Cookie 到 jar
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

// prettier-ignore
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }
