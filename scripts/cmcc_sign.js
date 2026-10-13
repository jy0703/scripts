/**
 * 脚本名称：中国移动签到
 * 活动规则：中国移动「签到领流量/话费」活动(1021122301) 的 App 端 mark31 签到，每天一次；另有 AI豆任务(mark/task) 与秒杀抢券(markSeckill)；开关 cmcc_video 后追加「追剧领福利」页(1126082530) 的每日打卡 + 代币任务 + 周日抽奖；开关 cmcc_wed 后追加「周三充值日」(hlwyxhdhub/wedrecharge) 的做任务挣次数 + 抽拼图集话费券（每天做，攒碎片），cmcc_wed_sk 再打场次秒杀(drawPrize，仅北京时间周三开火)
 * 脚本说明：支持多账号，支持 NE / Node.js 环境。账号参数（App 票据/省市编码等）由本脚本 GetCookie 抓取后存入 cmcc_data
 * 环境变量：cmcc_data / cmcc_claim(默认开，填 false 才关) / cmcc_task / cmcc_seckill / cmcc_video / cmcc_wed / cmcc_wed_sk / cmcc_wed_sk_at / cmcc_task_skip_days；cmcc_task_fail 为脚本自动维护的任务黑名单
 * 更新时间：2026-10-12 新增周三充值日(hlwyxhdhub wedrecharge)：任务代做 + 抽拼图 + 集齐领取 + 场次秒杀，开关 cmcc_wed / cmcc_wed_sk；AI豆任务同步上游：握手会话整轮复用、taskToken 任务直接握手、外部合作区跳过、status=1 遗留补领、公众号类即弃、停留与间隔提速；连签奖励改为只要开了就查一遍代领（不再要求当天由脚本签到），展示改用响应里的 prizeName/prizeValue

------------------ Surge 配置 ------------------

[Script]
中国移动获取Cookie = type=http-request,pattern=^https?:\/\/wx\.10086\.cn\/qwhdsso\/appTokenLogin,requires-body=1,max-size=0,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sign.js,script-update-interval=0

中国移动签到 = type=cron,cronexp="0 1 * * *",wake-system=1,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sign.js,script-update-interval=0

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
$.is_debug = getEnv('cmcc_debug', 'is_debug') || 'false';  // 调试模式(打印每次请求/响应含头，boxjs 开关 cmcc_debug)
$.userInfo = getEnv('cmcc_data') || '';  // 获取账号
$.userArr = $.toObj($.userInfo) || [];  // 用户信息
$.Messages = [];

// 业务常量 (照 py/抓包搬运)
const BASE = 'https://wx.10086.cn';
const SSO_LOGIN = BASE + '/qwhdsso/login';
const API_MARK = BASE + '/qwhdhub/api/mark';
const ACTIVITY_ID = getEnv('cmcc_activity_id') || '1021122301';
const CHANNEL_ID = getEnv('cmcc_channel_id') || 'P00000109876';
const CLAIM_AWARD = getEnv('cmcc_claim') !== 'false';  // 累计/连签奖励代领：默认开（达标后服务端不自动发放，一直挂着），显式填 false 才不领
const RUN_TASKS = getEnv('cmcc_task') === 'true';   // 签到页 AI豆任务(小程序端 mark/task 体系)
const SECKILL = getEnv('cmcc_seckill') === 'true';  // 签到有礼秒杀抢券(同活动 1021122301)
const TASK_API = API_MARK + '/task';
// 周三充值日活动页：既是该活动自己的入口，也是开放任务握手入口（上游 8d3e280 把两者统一到这个地址，落 HLWHD_SESSION_TOKEN）
const WED_ENTRY = BASE + '/hlwyxhdhub/act-wedrecharge/1024101716?pageId=1849008675699650560&channelId=P00000093619';
// taskInfo 下发 taskToken 的任务、以及 finishTask 提示"特殊处理"时，到该 hub 换会话做 openFinish 握手
const OPEN_TASK_ENTRY = WED_ENTRY;
const OPEN_TASK_API = BASE + '/hlwyxhdhub/api/open/_pub/task';
// 追剧领福利(diy-client 活动页)：打卡 + 代币任务 + 抽奖，与签到页同一 SSO 通道但要按自己的活动页换票
const RUN_VIDEO = getEnv('cmcc_video') === 'true';
const VIDEO_ENTRY = BASE + '/qwhdhub/diy-client/1126082530?A_C_CODE=10hep1ZhkL&channelId=P00000119581';
const VIDEO_SIGN_API = BASE + '/qwhdhub/api/diyVideoDayRedesign/sign';
const DIY_TASK_API = BASE + '/qwhdhub/diyTask';
const DIY_LOTTERY_API = BASE + '/qwhdhub/diyLottery';
// 该活动的任务与抽奖共用同一个 componentId：任务 earnOpportunity 加的就是抽奖次数
const VIDEO_COMPONENT = '4EC96l0-9btuobajC9Yu';
const VIDEO_DRAW_WEEKDAY = 0;  // 抽奖开放日(北京时间周日)：实测非周日回 FAILED「抽奖时间为周日，请确认~」，且次数过期作废
// 周三充值日(hlwyxhdhub/wedrecharge)：拼图抽奖主流程 + 场次秒杀，同一 SSO 通道但要按该活动页换票
const RUN_WED = getEnv('cmcc_wed') === 'true';
const WED_SECKILL = getEnv('cmcc_wed_sk') === 'true';
const WED_API = BASE + '/hlwyxhdhub/api/wedrecharge';
const WED_TIERS = { dp1: '95折话费券', dp2: '9折话费券', dp3: '8折话费券' };
// 集齐后 receiveNew 的 round 与拼图序号不同源（取自前端映射表）
const WED_RECEIVE = { 1: 'r6', 2: 'r5', 3: 'r4' };
const WED_RECEIVE_LABEL = { r6: '95折话费券', r5: '9折话费券', r4: '8折话费券' };
// 需真人/真实消费的只报状态不代做；dlhd 进页即由服务端登记
const WED_SKIP = { yqyh: '需邀请真实用户助力', czhf: '需真实充值满10元', llym: '需在 App 内浏览签到页', dlhd: '进页自动完成' };
const WED_MAX_DRAWS = 30;     // 单次执行最多抽这么多发
const WED_DAY = 3;            // 场次秒杀只在北京时间周三打（任务/拼图每天都做）
// 周三场次秒杀参数（照 py 默认值）
const WSK_AT = getEnv('cmcc_wed_sk_at') || '08:00:00';
const WSK_LEAD = 400;         // 提前开火(ms)
const WSK_INTERVAL = 350;     // 连发间隔(ms)
const WSK_MAX_ATTEMPTS = 120;
const WSK_MAX_WAIT = 300000;  // 距开场超过该时长就不干等，本次跳过(ms)
const WSK_STOP = { '160002': '无库存' };
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
            // 重新抓包不该把当天"已签到"标记清掉，否则同日会再签一次
            'signDay': old.signDay || '',
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

// 任务: 建会话 → App 端签到 → (可选)连签奖励/AI豆任务/追剧领福利/周三充值日 → (可选)抢券
// 当天签到完成后(user.signDay)，再次执行本脚本只跑抢券(签到页秒杀/周三场次秒杀)，不再签到/领奖/任务/追剧/拼图
// 结果边产生边 $.log（say），通知内容仍攒在 lines 里最后一起推送
async function doSign(user) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
    const today = $.time('yyyyMMdd');
    try {
        if (user.signDay === today) {
            if (!SECKILL && !WED_SECKILL) {
                say(`今日签到已完成，本次无抢券任务`);
            } else {
                if (SECKILL) lines.push(...await doSeckill(await exchangeSession(user)));
                if (WED_SECKILL) lines.push(...await doWedSeckill(user));
            }
        } else {
            const { ctx, statusData } = await openCtx(user);
            let acc = (statusData.userinfo || {}).accumulateTimes || '?';
            const signedToday = (statusData.markstatus || []).some(d => d.date === today && d.status === '1');
            $.log(`当前累计签到 ${acc} 天，App 端今日${signedToday ? '已签' : '未签'}`);

            if (signedToday) {
                say(markLine('App 端', false, `累计 ${acc} 天`));
            } else {
                const result = await doMark(ctx, today);
                const code = result && result.code, respMsg = (result && result.msg) || '', status = (result && result.status) || '';
                $.log(`domark 响应: code=${code} status=${status} msg=${respMsg}`);
                // HAVE_MARKED 是服务端幂等保护（重复签到返回该码），视为已签成功
                if (code === 'SUCCESS' || respMsg.includes('已签') || status === 'HAVE_MARKED') {
                    const prize = prizeText((result.data || {}).markPrize);
                    try {
                        acc = ((await queryMarkstatus(ctx)).userinfo || {}).accumulateTimes || acc;
                    } catch (e) { }
                    say(status === 'HAVE_MARKED'
                        ? markLine('App 端', false, `累计 ${acc} 天`, '', '服务端幂等')
                        : markLine('App 端', true, `累计 ${acc} 天`, prize,
                            !prize && status === 'PRIZE_NO_CONFIG' ? '今日无单日奖品(累计/连签奖励见下方领奖结果)' : ''));
                } else {
                    throw new Error(`App 端签到失败: ${code} / ${status} / ${respMsg}`);
                }
            }

            // 签到成功/已签即算当天闭环，抢券与任务失败下次执行仍会重试
            user.signDay = today;
            saveUsers();

            // 达标奖励不会随签到自动发放（App 是打开签到页弹窗时领），所以只要开了开关就查一遍：
            // 不能加 !signedToday 条件——当天已在 App 里签过、脚本没替它签的情形，正是奖励滞留不发放的那种
            if (CLAIM_AWARD) {
                try {
                    const latest = await queryMarkstatus(ctx);
                    if (!(latest.taskAwardChance || []).length) $.log('[领奖] 当前无可领取的累计/连签奖励');
                    lines.push(...await claimTaskAwards(ctx, latest));
                } catch (e) {
                    say(`[领奖] 尝试失败: ${e.message || e}`);
                }
            }

            if (RUN_TASKS) {
                try {
                    lines.push(...await doMarkTasks(ctx, user));
                } catch (e) {
                    say(`[任务] 失败: ${e.message || e}`);
                }
            }

            // 追剧领福利是独立活动页，自己换票；放在秒杀之前，免得被抢券的等待挤掉
            if (RUN_VIDEO) {
                try {
                    lines.push(...await doVideoAct(user));
                } catch (e) {
                    say(`[追剧] 失败: ${e.message || e}`);
                }
            }

            // 周三充值日（hlwyxhdhub 的拼图抽奖）同样是独立活动页，自己换票
            if (RUN_WED) {
                try {
                    lines.push(...await doWedAct(user));
                } catch (e) {
                    say(`[周三] 失败: ${e.message || e}`);
                }
            }

            if (WED_SECKILL) {
                try {
                    lines.push(...await doWedSeckill(user));
                } catch (e) {
                    say(`[周三·秒杀] 失败: ${e.message || e}`);
                }
            }

            if (SECKILL) {
                try {
                    lines.push(...await doSeckill(ctx));
                } catch (e) {
                    say(`[秒杀] 失败: ${e.message || e}`);
                }
            }
        }
    } catch (e) {
        say(`❌ ${e.message || e}`);
    }
    $.messages = $.messages.concat(lines);
}

// 建会话并查签到状态；首次若是会话问题，重建后再试一次
async function openCtx(user) {
    let ctx = await exchangeSession(user);
    for (let attempt = 1; ; attempt++) {
        try {
            return { ctx, statusData: await queryMarkstatus(ctx) };
        } catch (e) {
            if (attempt === 2) throw e;
            $.log(`会话异常(${e.message})，重建后重试`);
            ctx = await exchangeSession(user);
        }
    }
}

// 走 SSO 换取活动会话（QWHD_SESSION_TOKEN 落在 jar 里），返回 { jar, ua, referer }
// 凭证策略（py 实测结论）：jwt 是账号级长期凭证，appTokenLogin 里 jwtToken 优先于 token，
// 故优先用缓存 jwt 免票据续期，App 票据仅在 jwt 缺失/失效时作引导兜底。
async function exchangeSession(user, entryUrl) {
    const jar = {};
    const ua = user.userAgent || USER_AGENT;
    const actUrl = entryUrl || `${BASE}/qwhdhub/qwhdmark/${ACTIVITY_ID}?channelId=${CHANNEL_ID}`;

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

// 领取 taskAwardChance 里的累计/连签奖励（同步上游 7c2dcdb：热门奖品可能回 PRIZE_NO_STOCK，属正常）
// 门槛达标后服务端不会自动发放，只把它放进 taskAwardChance；领成功后条目即从清单消失，天然幂等
async function claimTaskAwards(ctx, statusData) {
    // 任务ID -> 奖品名（可领清单条目自身 prize 为 null，只能去另外两个池子反查）
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
    const say = t => { results.push(t); $.log(t); };
    for (const task of statusData.taskAwardChance || []) {
        const tid = task.id;
        if (!tid) continue;
        const bits = [];
        if (task.taskType === 'accumulate' && task.num) bits.push(`累计${task.num}签`);
        if (names[tid]) bits.push(names[tid]);
        const label = `任务${tid}` + (bits.length ? `（${bits.join('·')}）` : '');
        const resp = await Request({ url: `${API_MARK}/mark31/taskAward/${tid}`, method: 'post', headers: apiHeaders(ctx), body: {}, _timeout: 30000 });
        const d = (resp && resp.data) || {};
        // 成功时奖品名在响应 data 里（清单条目本身不带名字）；status 为空时回落到 code
        if (d.prizeName) {
            const unit = { FLOW: 'MB', FEE: '元' }[d.prizeCategory] || '';
            const amount = d.prizeValue ? `${d.prizeValue}${unit}` : '';
            say(`[领奖] ${label} 领到: ${d.prizeName}${amount ? `（${amount}）` : ''}`);
        } else {
            say(`[领奖] ${label}: ${(resp && (resp.status || resp.code)) || '?'} ${(resp && resp.msg) || ''}`);
        }
        await $.wait(randomInt(1000, 2000));
    }
    return results;
}

// AI豆任务失败黑名单：按账号记 taskId，连续 TASK_FAIL_MAX 次领不到奖就不再发请求，
// 记录满 TASK_FAIL_DAYS 天自动遗忘（任务条件可能已变）后重新尝试；一旦领奖成功立即清除。
const TASK_FAIL_KEY = 'cmcc_task_fail';
const TASK_FAIL_MAX = 2;
const TASK_FAIL_DAYS = Number(getEnv('cmcc_task_skip_days')) || 7;

function readTaskFails(user) {
    const store = $.toObj(getEnv(TASK_FAIL_KEY), {}) || {};
    const mine = store[user.userCheckId] || {};
    const expire = Number($.time('yyyyMMdd', Date.now() - TASK_FAIL_DAYS * 86400000));
    for (const tid of Object.keys(mine)) if (Number((mine[tid] || {}).d) < expire) delete mine[tid];
    return mine;
}

function writeTaskFails(user, fails) {
    const store = $.toObj(getEnv(TASK_FAIL_KEY), {}) || {};
    store[user.userCheckId] = fails;
    $.setdata($.toStr(store), TASK_FAIL_KEY);
}

// 签到页 AI豆任务（与签到页同一套 mark/task 接口，会话通用）
// 通知里只留成功项与一行汇总，逐条结果实时 $.log
// 同步上游 8d3e280：外部合作区整区不做；上次遗留的"已完成待领奖"先补领；
// hlwyxhdhub 握手会话整轮复用（换票最贵，逐任务换会被限频）；任务间隔降到 0.2~0.6s
async function doMarkTasks(ctx, user) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
    const t0 = Date.now();
    const tl = await Request({ url: `${TASK_API}/taskList`, method: 'post', headers: apiHeaders(ctx), body: {}, _timeout: 30000 });
    if (!tl || tl.code !== 'SUCCESS') throw new Error(`taskList 失败: ${tl && tl.code} ${tl && tl.msg}`);
    const tasks = (tl.data || {}).tasks || [];
    const outside = t => t.taskClasifiName === '外部合作区';
    const todo = tasks.filter(t => t.status === 0 && t.taskId && !outside(t));
    const ext = tasks.filter(t => t.status === 0 && t.taskId && outside(t));
    const fails = readTaskFails(user);
    const openCache = {};
    let done = 0, beans = 0, rejected = 0, errored = 0;

    // status=1 是"已完成待领奖"（上次握手中断或没来得及领），补领即可
    for (const t of tasks.filter(x => x.status === 1 && x.taskId)) {
        const label = t.taskName || t.taskId;
        const r = await taskAward(ctx, t.taskId);
        if (r.ok) {
            done++; beans += r.num;
            delete fails[t.taskId];
            $.log(`[任务] 补领 ${label}: ✅ ${r.num} AI豆`);
        } else {
            $.log(`[任务] 补领 ${label}: ⚠️ ${r.code} ${r.msg}`);
        }
        await $.wait(randomInt(200, 500));
    }

    const runnable = [], blocked = [];
    for (const t of todo) {
        (fails[t.taskId] && fails[t.taskId].c >= TASK_FAIL_MAX ? blocked : runnable).push(t);
    }
    $.log(`AI豆任务共 ${tasks.length} 个，待办 ${todo.length} 个(另有外部合作区 ${ext.length} 个不做)，黑名单跳过 ${blocked.length} 个，本次执行 ${runnable.length} 个`);
    if (!runnable.length) {
        if (blocked.length) $.log(`[任务] 待办全部在黑名单中，${TASK_FAIL_DAYS} 天内不再尝试`);
        if (done) say(`[任务] 补领 ${done} 个 +${beans} AI豆，耗时 ${elapsedSec(t0)}s`);
        writeTaskFails(user, fails);
        return lines;
    }

    for (const t of runnable) {
        const label = `${t.taskName || t.taskId}${t.awardNum ? `(+${t.awardNum}AI豆)` : ''}`;
        try {
            const r = await finishOneTask(ctx, t, user, openCache);
            if (r.ok) {
                done++; beans += r.num;
                delete fails[t.taskId];
                say(`[任务] ${label}: ✅ 已领 ${r.num} AI豆`);
            } else {
                rejected++;
                const f = fails[t.taskId] || { c: 0 };
                f.c += 1;
                f.d = $.time('yyyyMMdd');
                fails[t.taskId] = f;
                $.log(`[任务] ${label}: ⚠️ 未完成: ${r.code} ${r.msg}`);
            }
        } catch (e) {
            errored++;
            $.log(`[任务] ${label}: ❌ ${e.message || e}`);
        }
        await $.wait(randomInt(200, 600));
    }
    writeTaskFails(user, fails);

    const quiet = rejected ? `条件不足 ${rejected} 个` : '';
    if (quiet) $.log(`[任务] ${quiet}（逐条见上方日志，连续 ${TASK_FAIL_MAX} 次后不再尝试）`);
    say(`[任务] 完成 ${done} 个 +${beans} AI豆，耗时 ${elapsedSec(t0)}s${quiet ? `；条件不足 ${rejected} 个已折叠` : ''}${errored ? `；异常 ${errored} 个` : ''}${blocked.length ? `；黑名单已过滤 ${blocked.length} 个(${TASK_FAIL_DAYS} 天后重试)` : ''}`);
    return lines;
}

function elapsedSec(t0) {
    return ((Date.now() - t0) / 1000).toFixed(0);
}

// 单个任务：taskInfo → (开放平台握手 | finishTask 阶梯) → getTaskAward，只有完成才去领奖
// 顺序照上游 8d3e280：taskInfo 带 taskToken 的视频/浏览类握手即完成；其余先直接上报，
// 失败才到访目标页(停留 scanTime，封顶 15s)并带该页 Referer 重试；提示"特殊处理"再握手
// taskType/scanTime 只取 taskInfo —— taskList 里的 taskType 是另一套枚举，混用会被拒
async function finishOneTask(ctx, task, user, cache) {
    const tid = String(task.taskId);
    const info = await Request({ url: `${TASK_API}/taskInfo`, method: 'post', headers: apiHeaders(ctx), body: { taskId: tid }, _timeout: 30000 });
    const d = (info && info.data) || {};
    const taskType = String(d.taskType || '');
    const scan = Number(d.scanTime || 0);
    const ju = String(task.jumpUrl || '');
    const finish = ref => Request({
        url: `${TASK_API}/finishTask`, method: 'post',
        headers: ref ? Object.assign(apiHeaders(ctx), { referer: ref }) : apiHeaders(ctx),
        body: { taskId: tid, taskType }, _timeout: 30000,
    });

    // ① 开放平台任务：主站直接给 cToken 就在主站 openFinish；给 taskToken 就跨到 hlwyxhdhub 握手
    if (d.cToken) {
        const o = await Request({ url: `${API_MARK}/_pub/task/openFinish`, method: 'post', headers: apiHeaders(ctx), body: { cToken: d.cToken }, _timeout: 30000 });
        if (o && o.code === 'SUCCESS') return await taskAward(ctx, tid);
    } else if (d.taskToken) {
        if (await openHubHandshake(user, cache, String(d.taskToken), scan)) return await taskAward(ctx, tid);
    }

    // 浏览类(taskType=2)到访即完成，不上报（前置到访已在上一步省掉，交由领奖判定）
    if (taskType === '2') return await taskAward(ctx, tid);

    // ② finishTask 阶梯
    let fin = await finish();
    let code = (fin && fin.code) || 'NO_RESP', msg = (fin && fin.msg) || '';
    // 需真实关注公众号，代做不了，立即放弃不浪费重试
    if (code !== 'SUCCESS' && /公众号/.test(msg)) return { ok: false, code, msg: '需真实关注公众号' };
    if (code !== 'SUCCESS' && /^https:\/\//i.test(ju)) {
        await Request({ url: ju, headers: baseHeaders(ctx.jar, ctx.ua), _respType: 'all', _timeout: 20000 });
        if (scan) await $.wait((Math.min(scan, 15) + 1) * 1000);
        fin = await finish(ju);
        code = (fin && fin.code) || 'NO_RESP'; msg = (fin && fin.msg) || '';
    }
    // "特殊处理"兜底：jumpUrl 自带 taskToken 时先在 hlwyxhdhub 握手，成功再带目标页 Referer 重试
    if (code !== 'SUCCESS' && /特殊处理|openFinish/.test(msg) && /taskToken=/i.test(ju)) {
        const jt = (/taskToken=([^&]+)/i.exec(ju) || [])[1];
        if (await openHubHandshake(user, cache, jt, scan)) {
            fin = await finish(ju);
            code = (fin && fin.code) || 'NO_RESP'; msg = (fin && fin.msg) || '';
        }
    }
    if (code !== 'SUCCESS') return { ok: false, code, msg };
    return await taskAward(ctx, tid);
}

// 领奖：AI豆实际到手数以响应 awardNum 为准
async function taskAward(ctx, tid) {
    const aw = await Request({ url: `${TASK_API}/getTaskAward`, method: 'post', headers: apiHeaders(ctx), body: { taskId: String(tid) }, _timeout: 30000 });
    if (aw && aw.code === 'SUCCESS') return { ok: true, num: Number((aw.data || {}).awardNum) || 0 };
    return { ok: false, code: (aw && aw.code) || 'NO_RESP', msg: (aw && aw.msg) || '' };
}

// hlwyxhdhub 开放平台握手（参考 yupaiLy/cmcc-auto-checkin 实测链路）：
// getOneTaskInfo 取 cToken → 停留 scanTime → openFinish；成功后由调用方回主站领奖
async function openHubHandshake(user, cache, jt, scan) {
    if (!jt) return false;
    let octx = null;
    try {
        octx = await openHubSession(user, cache);
    } catch (e) {
        $.log(`[握手] 换票失败: ${e.message || e}`);
        return false;
    }
    const info = await Request({ url: `${OPEN_TASK_API}/getOneTaskInfo`, method: 'post', headers: apiHeaders(octx), body: { jtToken: jt }, _timeout: 30000 });
    const d = (info && info.data) || {};
    if (!d.cToken) {
        $.log(`[握手] getOneTaskInfo 未回 cToken: ${info && info.code} ${info && info.msg || ''}`);
        return false;
    }
    await $.wait((Number(d.scanTime || scan || 0) + 1) * 1000);
    const fin = await Request({ url: `${OPEN_TASK_API}/openFinish`, method: 'post', headers: apiHeaders(octx), body: { cToken: d.cToken }, _timeout: 30000 });
    $.log(`[握手] hlwyxhdhub openFinish: ${fin && fin.code} ${fin && fin.msg || ''}`);
    return !!(fin && fin.code === 'SUCCESS');
}

// 握手会话整轮复用（cache 传同一个对象）：换一次票要跑完整 SSO 链，逐任务换既慢又容易当日被限频；
// 换票失败退避重试一次。jwt 是账号级凭证，跨 hub 换票不消耗 App 票据
async function openHubSession(user, cache) {
    if (cache.ctx) return cache.ctx;
    let last = null;
    for (const w of [0, 3000]) {
        if (w) await $.wait(w);
        try {
            cache.ctx = await exchangeSession(user, OPEN_TASK_ENTRY);
            $.log('[握手] hlwyxhdhub 会话已建立，本轮复用');
            return cache.ctx;
        } catch (e) {
            last = e;
        }
    }
    throw last;
}

// ---------- 追剧领福利（diy-client 1126082530，参考 yupaiLy/cmcc-auto-checkin 的 cmcc_extra.py）----------

// 独立活动：换该活动页会话 → 每日打卡 → diyTask 任务(挣抽奖次数) → 抽奖
// 返回结果行，由 main() 拼进本账号通知
async function doVideoAct(user) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
    try {
        const ctx = await exchangeSession(user, VIDEO_ENTRY);
        say(`[追剧] ${await videoSign(ctx)}`);
        lines.push(...await runDiyTasks(ctx));
        lines.push(...await runDiyLottery(ctx));
    } catch (e) {
        say(`[追剧] 失败: ${e.message || e}`);
    }
    return lines;
}

// 每日打卡：querySignStatus 判今天，doSign 与状态查询同为 GET 无 body
async function videoSign(ctx) {
    const st = ((await Request({ url: `${VIDEO_SIGN_API}/querySignStatus`, headers: apiHeaders(ctx), _timeout: 30000 })) || {}).data || {};
    if (st.todaySignFlag === '1') return `今日已打卡（连签 ${st.signDays || 0} 天）`;
    const r = await Request({ url: `${VIDEO_SIGN_API}/doSign`, headers: apiHeaders(ctx), _timeout: 30000 });
    const msg = (r && r.msg) || '';
    if (!r || (r.code !== 'SUCCESS' && !msg.includes('已签'))) {
        throw new Error(`打卡失败: ${r && r.code} ${msg}${hasSessionToken(ctx.jar) ? '' : '（环境未回传活动页 302 的 Set-Cookie，会话无法建立）'}`);
    }
    const rd = r.data || {};
    $.log(`[追剧] doSign data=${$.toStr(rd, '{}').slice(0, 200)}`);
    // doSign 不回连签天数，重查状态取准确值
    let days = '';
    try {
        const after = ((await Request({ url: `${VIDEO_SIGN_API}/querySignStatus`, headers: apiHeaders(ctx), _timeout: 30000 })) || {}).data || {};
        if (after.signDays != null) days = `（连签 ${after.signDays} 天）`;
    } catch (e) { }
    const prize = prizeText(rd.lotteryPrize || rd.prize);
    return `打卡成功${days}${prize ? `，获得: ${prize}` : ''}`;
}

// diyTask 代币任务：UNDO 任务 POST finish 即发奖（服务端不校验真实到访，browse/share 等类型通吃）
// 逐条只进日志，通知留一行汇总
async function runDiyTasks(ctx) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
    const resp = await Request({ url: `${DIY_TASK_API}/list/${VIDEO_COMPONENT}`, headers: apiHeaders(ctx), _timeout: 30000 });
    if (!resp || resp.code !== 'SUCCESS') throw new Error(`任务清单获取失败: ${resp && resp.code} ${resp && resp.msg}`);
    const tasks = resp.data || [];
    const todo = tasks.filter(t => t.taskStage === 'UNDO' && t.taskId);
    $.log(`[追剧·任务] 共 ${tasks.length} 个，待办 ${todo.length} 个`);
    if (!todo.length) return lines;

    let done = 0;
    for (const t of todo) {
        const fin = await Request({ url: `${DIY_TASK_API}/finish/${t.taskId}`, method: 'post', headers: apiHeaders(ctx), body: {}, _timeout: 30000 });
        // 复查清单：完成后任务可能直接移出列表，"消失"也算成功
        const chk = await Request({ url: `${DIY_TASK_API}/list/${VIDEO_COMPONENT}`, headers: apiHeaders(ctx), _timeout: 30000 });
        const cur = ((chk && chk.data) || []).find(x => x.taskId === t.taskId);
        const ok = !cur || cur.taskStage === 'DONE';
        $.log(`[追剧·任务] ${t.name || t.taskId}: ${ok ? '✅ 完成' : `⚠️ finish=${fin && fin.code} ${(fin && fin.msg) || ''}`}`);
        if (ok) done++;
        await $.wait(randomInt(1000, 2500));
    }
    say(`[追剧·任务] 待办 ${todo.length} 个，完成 ${done} 个`);
    return lines;
}

// diyLottery 抽奖：remain 是可用次数（1 次/抽，由任务挣得）。服务端仅周日开放消耗，
// 且次数过期作废 → 周日抽满(未中奖也继续)，其余日子只记日志不消耗
async function runDiyLottery(ctx) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
    const rem = await Request({ url: `${DIY_LOTTERY_API}/period/remain/${VIDEO_COMPONENT}`, method: 'post', headers: apiHeaders(ctx), _timeout: 30000 });
    if (!rem || rem.code !== 'SUCCESS') throw new Error(`抽奖余额查询失败: ${rem && rem.code} ${rem && rem.msg}`);
    const remain = Number((rem.data || {}).remain) || 0;
    if (!remain) { $.log('[追剧·抽奖] 可用次数 0，无需抽奖'); return lines; }
    if (beijingWeekday() !== VIDEO_DRAW_WEEKDAY) { $.log(`[追剧·抽奖] 有 ${remain} 次，未到开放日(周日)，本次不消耗`); return lines; }

    $.log(`[追剧·抽奖] 余额 ${remain} 次，开始消耗`);
    const prizes = [];
    let drawn = 0, aborted = '';
    for (let i = 0; i < remain; i++) {
        const r = await Request({ url: `${DIY_LOTTERY_API}/lotterySafely/${VIDEO_COMPONENT}`, headers: apiHeaders(ctx), _timeout: 30000 });
        drawn++;
        const won = r && r.code === 'SUCCESS' && (Array.isArray(r.data) ? r.data[0] : null);
        if (won) prizes.push(won.prizeName || '?');
        else if (r && (r.code === 'SUCCESS' || r.code === 'NOT_WON')) $.log(`[追剧·抽奖] 第${drawn}次 未中奖`);
        else { aborted = `${r && r.code} ${r && r.msg || ''}`; break; }
        await $.wait(randomInt(1200, 2800));
    }
    say(`[追剧·抽奖] 已抽 ${drawn}/${remain} 次${prizes.length ? `，中奖: ${prizes.join(' / ')}` : ''}${aborted ? `，中断于 ${aborted}` : ''}`);
    return lines;
}

// 北京时间星期（不依赖设备时区）：周日=0
function beijingWeekday() {
    return new Date(Date.now() + 8 * 3600000).getUTCDay();
}

// ---------- 周三充值日（hlwyxhdhub/wedrecharge，参考 yupaiLy/cmcc-auto-checkin 的 cmcc_wed.py）----------

// 该 hub 的成功码是字符串 "0"（区别于 qwhdhub 的 SUCCESS），非 0 一律按失败抛出
async function wedApi(ctx, path, payload) {
    const r = await Request({ url: `${WED_API}/${path}`, method: 'post', headers: apiHeaders(ctx), body: payload || {}, _timeout: 30000 });
    if (!r) throw new Error(`${path} 无响应${hasSessionToken(ctx.jar) ? '' : '（环境未回传活动页 302 的 Set-Cookie，会话无法建立）'}`);
    if (String(r.code) !== '0') throw new Error(`${path} 失败: ${r.code} ${r.msg || ''}`);
    return r.data == null ? {} : r.data;
}

// 主流程：进页登记(服务端顺带完成「每日登录」任务) → 代做任务挣次数 → 抽拼图 → 集齐即领
async function doWedAct(user) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
    try {
        const ctx = await exchangeSession(user, WED_ENTRY);
        await wedApi(ctx, 'queryActivityInfo');
        let st = await wedApi(ctx, 'queryPictureActInfo');
        const tasks = await wedApi(ctx, 'taskList');
        const list = Array.isArray(tasks) ? tasks : [];
        $.log(`[周三] 剩余抽奖次数 ${st.drawTimes || 0}，当前 ${wedTierName(st.activeIndex)}`);
        list.forEach(t => $.log(`[周三·任务] ${t.title || t.taskId}: status=${t.status} +${t.addDrawTimes}次 ${wedQuota(t)}${WED_SKIP[t.taskId] ? `，${WED_SKIP[t.taskId]}` : ''}`));
        lines.push(...await wedFinishTasks(ctx, list, user));
        lines.push(...await wedDraw(ctx));
        st = await wedApi(ctx, 'queryPictureActInfo');
        lines.push(...await wedReceive(ctx, st));
        say(`[周三] 剩余 ${st.drawTimes || 0} 次；${wedProgress(st).join(' / ')}`);
    } catch (e) {
        say(`[周三] 失败: ${e.message || e}`);
    }
    return lines;
}

// 任务代做（黑名单制：除邀请/充值/每日登录外全试，服务端新增任务无需维护清单）
// 三级自适应：① finishTask 直接上报 ② jt 握手完整链 ③ 到访目标页后再补一次上报
async function wedFinishTasks(ctx, tasks, user) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
    const todo = tasks.filter(t => t.taskId && !WED_SKIP[t.taskId] && t.status !== 2 && wedQuotaLeft(t) !== 0);
    if (!todo.length) { $.log('[周三·任务] 无可代做的任务'); return lines; }

    let done = 0, add = 0;
    const skipped = [];
    for (const t of todo) {
        const title = t.title || t.taskId;
        try {
            const r = await wedTryFinish(ctx, t, user);
            if (r.ok) { done++; add += r.add; $.log(`[周三·任务] ${title}: ✅ +${r.add} 次${r.via ? `（${r.via}）` : ''}`); }
            else { skipped.push(title); $.log(`[周三·任务] ${title}: ⚠️ ${r.why}`); }
        } catch (e) {
            skipped.push(title);
            $.log(`[周三·任务] ${title}: ❌ ${e.message || e}`);
        }
        await $.wait(randomInt(1000, 2000));
    }
    say(`[周三·任务] 完成 ${done}/${todo.length} 个，+${add} 次${skipped.length ? `；未过 ${skipped.length} 个` : ''}`);
    return lines;
}

async function wedTryFinish(ctx, task, user) {
    const tid = task.taskId, title = task.title || tid;
    const ju = String(task.jumpUrl || '');
    // ① 快路径：查询/浏览类任务直接上报即过
    try {
        const d = await wedFinishTask(ctx, tid);
        return { ok: true, add: Number(d.addDrawTimes) || 0 };
    } catch (e) {
        $.log(`[周三·任务] ${title} 直接上报未过(${e.message || e})，改走 jt 握手`);
    }

    // ② jt 握手：getJtToken 签发凭证 → 携凭证换目标页会话 → getOneTaskInfo 取 cToken → 停留 → openFinish
    let hsOk = false;
    try {
        const jtResp = await Request({ url: `${WED_API}/getJtToken`, method: 'post', headers: apiHeaders(ctx), body: { taskId: tid }, _timeout: 30000 });
        const jt = jtResp && jtResp.data;
        if (typeof jt === 'string' && jt) {
            hsOk = await wedHandshake(user, ju, jt);
            $.log(`[周三·任务] ${title} jt 握手${hsOk ? '完成' : '未通过'}`);
        }
    } catch (e) {
        $.log(`[周三·任务] ${title} jt 握手异常: ${e.message || e}`);
    }
    if (hsOk) {
        await $.wait(1000);
        try {
            const cur = (await wedApi(ctx, 'taskList') || []).find(x => x.taskId === tid) || {};
            if (cur.status === 2) return { ok: true, add: Number(cur.addDrawTimes) || 1, via: 'jt 握手' };
        } catch (e) { }
    }

    // ③ 握手可能已登记但状态延迟：到访目标页后再补一次上报
    if (/^https:\/\/wx\.10086\.cn\//i.test(ju)) {
        try { await Request({ url: ju, headers: baseHeaders(ctx.jar, ctx.ua), _respType: 'all', _timeout: 20000 }); } catch (e) { }
    }
    try {
        const d = await wedFinishTask(ctx, tid);
        return { ok: true, add: Number(d.addDrawTimes) || 0 };
    } catch (e) {
        return { ok: false, why: String(e.message || e) };
    }
}

// 单次上报；160030 是服务端网络抖动，退避重试
async function wedFinishTask(ctx, tid) {
    let last = null;
    for (const w of [0, 3000, 8000]) {
        if (w) await $.wait(w);
        try {
            return await wedApi(ctx, 'finishTask', { taskId: tid });
        } catch (e) {
            last = e;
            if (!/160030/.test(String(e.message || e))) throw e;
        }
    }
    throw last;
}

// 目标页会话必须是自己换的（签到页落 QWHD、充值日页落 HLWHD），否则 openFinish 回 FAILED
// 换票偶发限频，退避重试一次
async function wedHandshake(user, jump, jt) {
    if (!/^https:\/\//i.test(jump)) return false;
    const sep = jump.includes('?') ? '&' : '?';
    let octx = null;
    for (const w of [0, 3000]) {
        if (w) await $.wait(w);
        try {
            octx = await exchangeSession(user, `${jump}${sep}jtToken=${jt}`);
            break;
        } catch (e) {
            $.log(`[周三·握手] 目标页换票失败: ${e.message || e}`);
        }
    }
    if (!octx) return false;
    const info = await Request({ url: `${BASE}/hlwyxhdhub/api/open/_pub/task/getOneTaskInfo`, method: 'post', headers: apiHeaders(octx), body: { jtToken: jt }, _timeout: 30000 });
    const d = (info && info.data) || {};
    if (!d.cToken) {
        $.log(`[周三·握手] getOneTaskInfo 未回 cToken: ${info && info.code} ${info && info.msg || ''}`);
        return false;
    }
    await $.wait((Number(d.scanTime || 5) + 1) * 1000);
    const fin = await Request({ url: `${BASE}/hlwyxhdhub/api/open/_pub/task/openFinish`, method: 'post', headers: apiHeaders(octx), body: { cToken: d.cToken }, _timeout: 30000 });
    $.log(`[周三·握手] openFinish: ${fin && fin.code} ${fin && fin.msg || ''}`);
    return !!(fin && fin.code === 'SUCCESS');
}

// 抽光次数：每抽重查状态；次数用尽、当前拼图集齐(解锁下一档的机制未抓包确认，不浪费次数)或连续异常即停
async function wedDraw(ctx) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
    let drawn = 0, note = '';
    for (let i = 0; i < WED_MAX_DRAWS; i++) {
        const st = await wedApi(ctx, 'queryPictureActInfo');
        const times = Number(st.drawTimes || 0);
        if (times <= 0) break;
        const active = String(st.activeIndex || 1);
        if (wedComplete((st.pictureList || {})[active] || {})) { note = `拼图${active}已集齐但还剩 ${times} 次，暂存不用`; break; }
        let d;
        try {
            d = await wedApi(ctx, 'drawPicture', { round: `dp${active}` });
        } catch (e) {
            note = String(e.message || e);
            break;
        }
        drawn++;
        const p = d.prize || {};
        $.log(`[周三·抽奖] ${wedTierName(active)} 第${drawn}抽 → ${p.prizeName || p.prizeId || '?'}`);
        await $.wait(randomInt(1000, 2000));
    }
    if (drawn || note) say(`[周三·抽奖] 本次抽 ${drawn} 次${note ? `；${note}` : ''}`);
    return lines;
}

// 集齐的档位自动领取（话费券月底清零，默认代领）；"已领取"是正常状态不算失败
async function wedReceive(ctx, state) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
    const pics = state.pictureList || {};
    for (const idx of Object.keys(pics).sort((a, b) => Number(a) - Number(b))) {
        if (!wedComplete(pics[idx] || {})) continue;
        const rnd = WED_RECEIVE[Number(idx)];
        if (!rnd) continue;
        const label = WED_RECEIVE_LABEL[rnd] || rnd;
        const r = await Request({ url: `${WED_API}/receiveNew`, method: 'post', headers: apiHeaders(ctx), body: { round: rnd }, _timeout: 30000 });
        const msg = (r && r.msg) || '';
        if (r && String(r.code) === '0') {
            const prizes = ((r.data || {}).actPrizes) || [];
            const names = prizes.map(p => p.prizeName).filter(Boolean).join('、') || label;
            const sub = prizes.map(p => p.subTitle).filter(Boolean).join('、');
            say(`[周三·领取] ${label} 领取成功（${names}${sub ? `，${sub}` : ''}）`);
        } else if (msg.includes('已领取')) {
            $.log(`[周三·领取] ${label} 已领取过`);
        } else {
            say(`[周三·领取] ${label} 领取失败: ${msg || (r && r.code) || '无响应'}`);
        }
        await $.wait(randomInt(1000, 2000));
    }
    return lines;
}

// 周三场次秒杀：校时 → 等到 at(北京时间) → 连发 drawPrize 直到命中/无库存/打完预算
async function doWedSeckill(user) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
    if (beijingWeekday() !== WED_DAY) { $.log('[周三·秒杀] 今天(北京时间)不是周三，本次跳过'); return lines; }
    try {
        const ctx = await exchangeSession(user, WED_ENTRY);
        await wedApi(ctx, 'queryActivityInfo');
        const info = await wedApi(ctx, 'queryDrawPrizeInfo');
        const srvMs = Number(info.currentTime) || Date.now();
        const target = beijingAt(WSK_AT);
        $.log(`[周三·秒杀] 服务器时间 ${fmtCn(srvMs)}，本机偏差 ${(srvMs - Date.now()).toFixed(0)} ms，rdStatus=${info.rdStatus}`);
        $.log(`[周三·秒杀] 目标场次 ${WSK_AT}（北京时间 ${fmtCn(target)}），提前 ${WSK_LEAD}ms，间隔 ${WSK_INTERVAL}ms，预算 ${WSK_MAX_ATTEMPTS} 发`);

        const waitMs = target - WSK_LEAD - srvMs;
        if (waitMs > WSK_MAX_WAIT) {
            say(`[周三·秒杀] 距开场还有 ${(waitMs / 60000).toFixed(1)} 分钟，超过等待上限 ${WSK_MAX_WAIT / 60000} 分钟，本次跳过（定时请设在开场前 1~2 分钟）`);
            return lines;
        }
        // 等到点：每轮重新校时，防本机时钟漂移与会话过期
        let remainMs = waitMs;
        while (remainMs > 0) {
            await $.wait(Math.min(remainMs + WSK_LEAD, 480000));
            try {
                const now2 = Number((await wedApi(ctx, 'queryDrawPrizeInfo')).currentTime) || Date.now();
                remainMs = target - WSK_LEAD - now2;
                if (remainMs > 60000) $.log(`[周三·秒杀] 会话心跳 ok，距开场 ${(remainMs / 1000).toFixed(0)} 秒`);
            } catch (e) {
                $.log(`[周三·秒杀] 校时失败: ${e.message || e}`);
                remainMs -= 480000;
            }
        }

        let code = '', msg = '', fired = 0;
        for (let i = 1; i <= WSK_MAX_ATTEMPTS; i++) {
            fired = i;
            const t0 = Date.now();
            const r = await Request({ url: `${WED_API}/drawPrize`, method: 'post', headers: apiHeaders(ctx), body: {}, _timeout: 10000 });
            code = String(r ? r.code : 'NO_RESP');
            msg = (r && r.msg) || '';
            $.log(`[周三·秒杀] 第${i}发: code=${code} msg=${msg}`);
            if (code === '0') {
                const prizes = ((r.data || {}).actPrizes) || [];
                const got = prizes.map(p => [p.prizeName || p.shortName || '', p.subTitle ? `（${p.subTitle}）` : ''].join('')).filter(Boolean).join('、');
                say(`🎉 [周三·秒杀] 抢中${got ? `: ${got}` : ''}（第 ${i} 发）`);
                return lines;
            }
            if (WSK_STOP[code]) { say(`[周三·秒杀] 停止: ${WSK_STOP[code]}（第 ${i} 发）`); return lines; }
            const gap = WSK_INTERVAL - (Date.now() - t0);
            if (gap > 0) await $.wait(gap);
        }
        say(`[周三·秒杀] ${fired} 发打完未中，最后响应: ${code} ${msg}`);
    } catch (e) {
        say(`[周三·秒杀] 失败: ${e.message || e}`);
    }
    return lines;
}

// dpN 档位名
function wedTierName(idx) {
    const n = String(idx || 1);
    return `拼图${n}（${WED_TIERS['dp' + n] || 'dp' + n}）`;
}

// 碎片值是计数：无="0"，持有="1"，重复抽到会累加，按 >=1 判定持有
function wedComplete(pieces) {
    const vals = Object.values(pieces || {});
    return vals.length > 0 && vals.every(v => /^\d+$/.test(String(v)) && Number(v) >= 1);
}

function wedProgress(state) {
    const pics = (state || {}).pictureList || {};
    return Object.keys(pics).sort((a, b) => Number(a) - Number(b)).map(idx => {
        const pieces = pics[idx] || {};
        const nums = Object.values(pieces).map(v => /^\d+$/.test(String(v)) ? Number(v) : 0);
        const have = nums.filter(n => n >= 1).length;
        const dup = nums.filter(n => n > 1).reduce((s, n) => s + n - 1, 0);
        return `拼图${idx} ${have}/${nums.length}${have === nums.length && nums.length ? '✓已集齐' : ''}${dup ? `（重复x${dup}）` : ''}`;
    });
}

// 月度配额：requireTimes 由服务端下发，用尽就不空发请求
function wedQuota(t) {
    const req = Number(t.requireTimes) || 0;
    return req > 0 ? `，月度${t.completedTimes || 0}/${req}` : '';
}

function wedQuotaLeft(t) {
    const req = Number(t.requireTimes) || 0;
    if (req > 0) return Math.max(0, req - (Number(t.completedTimes) || 0));
    return null;
}

// 北京时间 HH:MM:SS 对应的时间戳；已过 1 小时以上算明天（照 py 的处理）
function beijingAt(hms) {
    const parts = String(hms || '08:00:00').split(':').map(Number);
    const bj = new Date(Date.now() + 8 * 3600000);
    let t = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate(), parts[0] || 0, parts[1] || 0, parts[2] || 0) - 8 * 3600000;
    if (t < Date.now() - 3600000) t += 86400000;
    return t;
}

// 签到结果统一格式: <端> <状态>（<天数>）[，获得: X][，备注]
function markLine(who, ok, days, prize, note) {
    return `${who} ${ok ? '签到成功' : '今日已签'}${days ? `（${days}）` : ''}${prize ? `，获得: ${prize}` : ''}${note ? `，${note}` : ''}`;
}

// 秒杀抢券: 校时 → 场次 → 资格(未签补签) → 等到开抢 → 循环 redeem
async function doSeckill(ctx) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
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
        say('[秒杀] 当日未签到且补签失败，无法参与秒杀');
        return lines;
    }
    if (!picked.active) {
        const waitMs = startSrv - srvMs - SK_LEAD;
        if (waitMs > SK_MAX_WAIT) {
            say(`[秒杀] 距开抢还有 ${(waitMs / 60000).toFixed(1)} 分钟，超过等待上限 ${SK_MAX_WAIT / 60000} 分钟，本次跳过（定时请设在开抢前 1~2 分钟）`);
            return lines;
        }
        await waitUntil(Date.now() + waitMs, ctx);
    }

    const fired = await fireRedeem(ctx, zone, endSrv, offsetMs);
    if (fired.reason === 'SUCCESS') {
        say(`🎉 [秒杀] 抢到 ${prizeName}（场次 ${fmtCn(startSrv)}），请去 App「我的奖品」核销`);
    } else {
        const reason = SK_STOP[fired.reason] || fired.reason;
        say(`[秒杀] 未抢到: ${reason}｜${prizeName} 场次 ${fmtCn(startSrv)}`);
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

// 奖品描述：优先奖品名，没名称才用 面额+单位
function prizeText(p) {
    if (!p) return '';
    return p.name || p.prizeName || (p.prizeValue ? `${p.prizeValue}${p.prizeCategory === 'FLOW' ? 'MB' : '元'}` : '');
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
