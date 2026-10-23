/**
 * 脚本名称：中国移动签到
 * 活动：签到(mark31) 每日一次；可选 AI豆任务(mark/task)、签到页秒杀(markSeckill)、追剧领福利(1126082530)、
 *      AI豆苗养成记、AI豆兑换话费券、周三充值日(wedrecharge，含场次秒杀)，开关见环境变量
 * 环境：NE / Node.js，多账号；账号参数(App 票据/省市)由本脚本 GetCookie 抓取后存入 cmcc_data
 * 环境变量：cmcc_data / cmcc_claim(默认开) / cmcc_task / cmcc_seckill / cmcc_sk_min(默认 11:00) / cmcc_video /
 *          cmcc_seed / cmcc_seed_channel / cmcc_gold(默认关，会真扣 AI 豆) / cmcc_wed / cmcc_wed_sk /
 *          cmcc_wed_sk_at(留空=听服务端场次) / cmcc_task_skip_days / cmcc_debug；cmcc_task_fail 自动维护


------------------ Surge 配置 ------------------

[Script]
中国移动获取Cookie = type=http-request,pattern=^https?:\/\/wx\.10086\.cn\/qwhdsso\/appTokenLogin,requires-body=1,max-size=0,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sign.js,script-update-interval=0
中国移动抓autoLogin传参 = type=http-request,pattern=^https?:\/\/client\.app\.coc\.10086\.cn\/.*uamrandcodelogin\/autoLogin,requires-body=1,max-size=0,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sign.js,script-update-interval=0

中国移动签到 = type=cron,cronexp="0 1 * * *",wake-system=1,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sign.js,script-update-interval=0

[MITM]
hostname = wx.10086.cn, client.app.coc.10086.cn

------------------- Loon 配置 -------------------

[Script]
http-request ^https?:\/\/wx\.10086\.cn\/qwhdsso\/appTokenLogin script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sign.js,requires-body=true,timeout=600,tag=中国移动获取Cookie
http-request ^https?:\/\/client\.app\.coc\.10086\.cn\/.*uamrandcodelogin\/autoLogin script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sign.js,requires-body=true,timeout=600,tag=中国移动抓autoLogin传参

cron "0 1 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sign.js, timeout=600, tag=中国移动签到

[MITM]
hostname = wx.10086.cn, client.app.coc.10086.cn

--------------- Quantumult X 配置 ---------------

[rewrite_local]
^https?:\/\/wx\.10086\.cn\/qwhdsso\/appTokenLogin url script-request-body https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sign.js
^https?:\/\/client\.app\.coc\.10086\.cn\/.*uamrandcodelogin\/autoLogin url script-request-body https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sign.js

[task_local]
"0 1 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cmcc_sign.js, tag=中国移动签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/cmcc.png, enabled=true

[MITM]
hostname = wx.10086.cn, client.app.coc.10086.cn

 */

const $ = new Env('中国移动');
$.is_debug = getEnv('cmcc_debug', 'is_debug') || 'false';  // 调试模式(打印每次请求/响应含头，boxjs 开关 cmcc_debug)
$.userInfo = getEnv('cmcc_data') || '';  // 获取账号
$.userArr = $.toObj($.userInfo) || [];  // 用户信息
$.Messages = [];

// 业务常量
const BASE = 'https://wx.10086.cn';
const SSO_LOGIN = BASE + '/qwhdsso/login';
const API_MARK = BASE + '/qwhdhub/api/mark';
const ACTIVITY_ID = getEnv('cmcc_activity_id') || '1021122301';
const CHANNEL_ID = getEnv('cmcc_channel_id') || 'P00000109876';
// 可选：把"取大网票据(App ck)"外包给 tools 服务（/api/cmcc/refresh 做 autoLogin 重放）。
// 地址与 token 都取公共分区 @tools.address / @tools.token；留空=纯用本地抓包票据，服务对所有 /api/* 都查 token。
const TOOLS_API = (getEnv('TOOLS_API', '@tools.address') || '').replace(/\/+$/, '');
const TOOLS_API_TOKEN = getEnv('TOOLS_API_TOKEN', '@tools.token') || '';
const CLAIM_AWARD = getEnv('cmcc_claim') !== 'false';  // 累计/连签奖励代领：默认开（达标后服务端不自动发放，一直挂着），显式填 false 才不领
const RUN_TASKS = getEnv('cmcc_task') === 'true';   // 签到页 AI豆任务(小程序端 mark/task 体系)
const SECKILL = getEnv('cmcc_seckill') === 'true';  // 签到有礼秒杀抢券(同活动 1021122301)
const TASK_API = API_MARK + '/task';
// 周三充值日的活动页，同时是开放任务握手入口（落 HLWHD_SESSION_TOKEN）
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
const VIDEO_DRAW_WEEKDAY = 0;  // 抽奖只在北京时间周日开放（非周日回 FAILED，次数会过期作废）
// 视频站 cmlive 与 qwhdhub 是两套会话：QWHD → getYDRZToken → cmpassLoginByCmToken 换视频站 JWT；sourceId 必须 017027
const VIDEO_TASK_API = BASE + '/qwhdhub/api/diyVideoDayRedesign/task';
const CMLIVE_BASE = 'https://v.cmcc-cs.cn/cmlive/api';
const CMLIVE_SOURCE_ID = '017027';
const CMLIVE_REFERER = 'https://v.cmcc-cs.cn/cmlive/live/feed?id=102518&cmliveChannelId=203&belongChannelId=203&secondChannel=spr&openSelfResearch=1&tagId=157&jtCode=1';
// AI豆苗养成记（activityId 17692，dev.coc.10086.cn 独立域）：凭证= cmcc_data 的 token，每次现签短效 phone 头
const RUN_SEED = getEnv('cmcc_seed') === 'true';
const SEED_BASE = 'https://dev.coc.10086.cn/coc3/coc3-market-activity';
const SEED_LOGIN_API = 'https://dev.coc.10086.cn/coc3/gr/login/ssoRights';
const SEED_PAGE_URL = 'https://dev.coc.10086.cn/coc3/canvas/rightsmarket-h5-canvas/online/2026dmycj?pageRecorded=true';
const SEED_PAGE_KEY = '2026dmycj';
const SEED_ACTIVITY_ID = 17692;
const SEED_TASK_LIST_ID = 55;
const SEED_SIGN_TASK_ID = 3115;
const SEED_CHANNEL = getEnv('cmcc_seed_channel') || 'P00000011939';
const SEED_WTAC = 'P00000008211_';
// 任务类型：1 浏览/直播；2 分享；3 订购；4/5 领取/关注；6 邀请 —— 3/6 需要真实操作，直接跳过
const SEED_SKIP_TYPES = { 3: '需真实办理/订购', 6: '需真实好友助力' };
const SEED_STATE_KEY = 'cmcc_seed_state';
// 签到专属 AI豆兑换话费券（qwhdhub 同一会话）：兑换会真扣 AI 豆、每商品每期限兑一次，默认关
const RUN_GOLD = getEnv('cmcc_gold') === 'true';
const GOLD_API = BASE + '/qwhdhub/api/mark/task';
const GOLD_TIERS = ['5元话费券', '2元话费券', '1.5元话费券', '1元话费券'];
const GOLD_MIN_STOCK = 100;   // 前端同款判定：剩余 <=100 视为已抢光
const GOLD_MAX_ROUNDS = 8;    // 单商品每期限兑一次，轮次上限只作兜底
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
// 场次秒杀参数；cmcc_wed_sk_at 留空=按 rec_login 下发的 seckillTime 自动选最近未开始场次
const WSK_AT_CFG = getEnv('cmcc_wed_sk_at') || '';
const WSK_LEAD = 400;         // 提前开火(ms)
const WSK_INTERVAL = 350;     // 连发间隔(ms)
const WSK_MAX_ATTEMPTS = 200;
const WSK_MAX_WAIT = 300000;  // 距开场超过该时长就不干等，本次跳过(ms)
const WSK_STOP = { '160002': '无库存' };
// 秒杀抢券参数
const SK_API = API_MARK + '/markSeckill';
const SK_INTERVAL = 350;      // 重试间隔(ms)
const SK_LEAD = 400;          // 提前开火(ms)，抵消网络延迟
const SK_MAX_ATTEMPTS = 200;  // 单场最大尝试次数
const SK_MAX_WAIT = 300000;   // 距开抢超过该时长就不再干等(ms)，本次跳过
// 每天的秒杀下限（北京时间）：触发时刻早于它整块不执行；开抢时刻早于它的场次也不抢。cmcc_sk_min 可改，填 00:00 则不受限
const SK_MIN_OPEN_RAW = getEnv('cmcc_sk_min') || '11:00';
const SK_MIN_OPEN = hmToMinutes(SK_MIN_OPEN_RAW);
// 触达即终态的 redeem status：不再浪费请求
const SK_STOP = {
    PRIZE_NO_STOCK: '券已抢完',
    PRIZE_LIMIT_DAY: '当日中奖次数已用完',
    PRIZE_LIMIT_MONTH: '当月中奖次数已用完',
    PRIZE_RESTRIC_LIMIT: '活动期间中奖次数已达上限',
    WORK_ORDER_RESTRIC_LIMIT: '工单受限（多为"已领取过，限领一次"）',
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
            // 重新抓包不该把当天"已签到"标记清掉，否则同日会再签一次；抢中记录同理，否则当天会重复打
            'signDay': old.signDay || '',
            'skWinDay': old.skWinDay || '',
            'skWinPrize': old.skWinPrize || '',
            'wedSkDay': old.wedSkDay || '',
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

// autoLogin 传参（密文 body + ua + x-qen）存进 cmcc_autologin_data，票据过期时交给 @tools.address 的 /api/cmcc/refresh 现换新票
function GetAutoLogin() {
    try {
        const req = $request || {};
        const body = req.body || '';
        if (!body) return;
        const h = ObjectKeys2LowerCase(req.headers || {});
        const autologin = { url: req.url, ua: h['user-agent'] || '', x_qen: h['x-qen'] || '14', body: String(body) };
        const old = $.getdata('cmcc_autologin_data');
        if (old && $.toObj(old, {}) && $.toObj(old, {}).body === autologin.body) return;      // 同一个值不重复提醒
        autologin.capturedAt = new Date().toISOString();
        $.setdata($.toStr(autologin), 'cmcc_autologin_data');
        $.Messages.push('🎉已抓到 autoLogin 传参');
        $.log('🎉已抓到 autoLogin 传参');
    } catch (e) {
        $.log('❌ autoLogin 传参获取失败'), $.log(e);
    }
}

// 任务: 建会话 → App 端签到 → (可选)连签奖励/AI豆任务/追剧领福利/周三充值日 → (可选)抢券
// 当天签到完成后(user.signDay)，再次执行本脚本只跑抢券(签到页秒杀/周三场次秒杀)，不再签到/领奖/任务/追剧/拼图；本周已抢中的账号连抢券请求也不发
// 结果边产生边 $.log（say），通知内容仍攒在 lines 里最后一起推送
async function doSign(user) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
    const today = $.time('yyyyMMdd');
    try {
        if (user.signDay === today) {
            // 抢券前先过门控（本周已抢中 / 触发时刻未到）：不在窗口内连换票都不做，避免签到重跑白跑一条 SSO 链
            const alreadyWon = SECKILL && skWeekDone(user, Date.now());
            const dailySk = SECKILL && !alreadyWon && skWindowOpen();
            const wedSk = WED_SECKILL && beijingWeekday() === WED_DAY && user.wedSkDay !== today;
            const wedSkDone = WED_SECKILL && beijingWeekday() === WED_DAY && user.wedSkDay === today;
            if (!dailySk && !wedSk) {
                say(`今日签到已完成，本次无抢券任务`);
                if (alreadyWon) $.log(`[秒杀] 本周已于 ${user.skWinDay.slice(4, 6)}-${user.skWinDay.slice(6, 8)} 抢到${user.skWinPrize ? `「${user.skWinPrize}」` : ''}，本周不再参与`);
                else if (SECKILL && !skWindowOpen()) $.log(`[秒杀] 触发时刻未到 ${SK_MIN_OPEN_RAW}，本次不执行`);
                if (wedSkDone) $.log('[周三·秒杀] 今天已执行过，本次不再打');
                else if (WED_SECKILL && beijingWeekday() !== WED_DAY) $.log('[周三·秒杀] 今天(北京时间)不是周三，本次跳过');
            } else {
                if (dailySk) lines.push(...await doSeckill(await exchangeSession(user), user));
                if (wedSk) lines.push(...await doWedSeckill(user));
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

            // AI豆苗养成记走 dev.coc.10086.cn 独立域+独立凭证(ticket 现签 phone 头)，与主站会话无关
            if (RUN_SEED) {
                try {
                    lines.push(...await runSeed(user));
                } catch (e) {
                    say(`[豆苗] 失败: ${e.message || e}`);
                }
            }

            // AI豆兑换话费券复用签到会话：空跑只写日志，兑到/失败才进通知
            if (RUN_GOLD) {
                try {
                    lines.push(...await runGold(ctx, user));
                } catch (e) {
                    say(`[AI豆兑换] 失败: ${e.message || e}`);
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
                    lines.push(...await doSeckill(ctx, user));
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

async function refreshAppTokenFromApi(user) {
    if (!TOOLS_API) return false;
    const tag = `[票据 ${phoneTail(user)}]`;
    if (!TOOLS_API_TOKEN) { $.log(`${tag} 配了 @tools.address 但没填 @tools.token，服务端所有 /api/* 都要带 token，已跳过刷新`); return false; }
    let autologin = getEnv('cmcc_autologin_data') || '';
    if (typeof autologin === 'string') autologin = $.toObj(autologin, null);
    if (!autologin || !autologin.url || !autologin.body) { $.log(`${tag} 没有 cmcc_autologin_data(开着「捕获 autoLogin」进一次 App 即可)，无法刷新票据`); return false; }
    const t0 = Date.now();
    $.log(`${tag} 向 ${TOOLS_API} 要新票据（抓于 ${(autologin.capturedAt || '未知').slice(0, 16).replace('T', ' ')}，密文 body ${(String(autologin.body) || '').length} 字符）`);
    try {
        const r = await Request({
            url: `${TOOLS_API}/api/cmcc/refresh`, method: 'post',
            headers: { 'content-type': 'application/json', 'x-token': TOOLS_API_TOKEN },
            body: autologin, _timeout: 30000,
        });
        if (!r || r.error || !r.token) { $.log(`${tag} 刷新失败（${Date.now() - t0}ms）：${(r && r.error) || '服务端没回 token'}`); return false; }
        if (r.userCheckId && user.userCheckId && r.userCheckId !== user.userCheckId) {
            $.log(`${tag} 服务端回的票据属于 ${phoneTail({ userCheckId: r.userCheckId })}，与当前账号不符，已跳过`);
            return false;
        }
        user.token = r.token;
        if (r.provinceCode && !user.provinceCode) user.provinceCode = r.provinceCode;
        if (r.cityCode && !user.cityCode) user.cityCode = r.cityCode;
        saveUsers();
        $.log(`${tag} 已换新票据（${Date.now() - t0}ms，${String(r.token).length} 字符，末4位 ${String(r.token).slice(-4)}，手机号 ${maskMobile(r.phone)}${r.provinceCode ? `，省市 ${r.provinceCode}/${r.cityCode || ''}` : ''}）`);
        return true;
    } catch (e) {
        $.log(`${tag} 请求异常（${Date.now() - t0}ms）：${e.message || e}`);
        return false;
    }
}

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

    // ② 首选 jwt + App 票据同发（App 的真实形态）；没有票据时才退化成单发 jwt（多半会被拒，见上）
    let resp = null;
    if (user.jwt) {
        resp = await Request({ url: loginUrl, method: 'post', headers: baseHeaders(jar, ua), body: Object.assign({}, baseBody, { jwtToken: user.jwt, token: user.token || '' }), _timeout: 30000 });
        if (resp && resp.code === 'SUCCESS') {
            $.log(`jwt 续期成功（${user.token ? 'jwt + App 票据同发' : '仅 jwt，未带票据'}，凭证链已 ${((Date.now() - (user.jwt_first || Date.now())) / 86400000).toFixed(1)} 天）`);
        } else {
            $.log(`jwt 续期失败(${resp && resp.code} ${resp && resp.msg})，回落 App 票据引导`);
            resp = null;
        }
    }

    // ③ 回落：只用 App 票据引导登录（jwt 缺失或同发被拒）
    if (!resp) {
        if (!user.token) { $.log(`[票据 ${phoneTail(user)}] 本地没有 App 票据，先向网关换一张`); await refreshAppTokenFromApi(user); }
        if (!user.token) throw new Error(user.jwt ? '同发被拒且没有 App 票据可引导：打开 App 进一次签到页重新抓包' : 'App 票据(token)为空，请重新抓包更新凭证');
        resp = await Request({ url: loginUrl, method: 'post', headers: baseHeaders(jar, ua), body: Object.assign({}, baseBody, { jwtToken: null, token: user.token }), _timeout: 30000 });
        if (!resp || resp.code !== 'SUCCESS') {
            // 票据可能已过期/被顶：配了 @tools 就刷新后重试一次
            if (TOOLS_API) $.log(`[票据 ${phoneTail(user)}] appTokenLogin 被拒(${resp && resp.code} ${resp && resp.msg})，刷新票据后重试`);
            if (TOOLS_API && await refreshAppTokenFromApi(user)) {
                resp = await Request({ url: loginUrl, method: 'post', headers: baseHeaders(jar, ua), body: Object.assign({}, baseBody, { jwtToken: null, token: user.token }), _timeout: 30000 });
            }
            if (!resp || resp.code !== 'SUCCESS') {
                throw new Error(`appTokenLogin 失败: ${resp && resp.code} ${resp && resp.msg} —— 通常是 App 票据过期，请打开 App 签到页重新抓包`);
            }
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

// 领取 taskAwardChance 里的累计/连签奖励（热门奖品可能回 PRIZE_NO_STOCK，属正常）
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


async function doMarkTasks(ctx, user) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
    const t0 = Date.now();
    const tl = await Request({ url: `${TASK_API}/taskList`, method: 'post', headers: apiHeaders(ctx), body: {}, _timeout: 30000 });
    if (!tl || tl.code !== 'SUCCESS') throw new Error(`taskList 失败: ${tl && tl.code} ${tl && tl.msg}`);
    const tasks = (tl.data || {}).tasks || [];
    const outside = t => t.taskClasifiName === '外部合作区';
    // 邀好友/助力类：要真实好友点开助力才算达标（whoCanAssist=1、totalTimes=3），补领也只会回
    // "分享任务发奖失败"，和外部合作区一样常驻跳过，不进黑名单也不发请求
    const invite = t => String(t.whoCanAssist) === '1' || /邀(请)?好友|助力/.test(t.taskName || '');
    const skip = t => outside(t) || invite(t);
    const todo = tasks.filter(t => t.status === 0 && t.taskId && !skip(t));
    const ext = tasks.filter(t => t.status === 0 && t.taskId && outside(t)).length;
    const inv = tasks.filter(t => t.taskId && invite(t) && !outside(t)).length;
    const fails = readTaskFails(user);
    const openCache = {};
    let done = 0, beans = 0, rejected = 0, errored = 0;

    // status=1 是"已完成待领奖"（上次握手中断或没来得及领），补领即可
    for (const t of tasks.filter(x => x.status === 1 && x.taskId && !skip(x))) {
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
    $.log(`AI豆任务共 ${tasks.length} 个，待办 ${todo.length} 个(另有外部合作区 ${ext} 个、邀请助力 ${inv} 个不做)，黑名单跳过 ${blocked.length} 个，本次执行 ${runnable.length} 个`);
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

// hlwyxhdhub 开放平台握手：
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

// ---------- 追剧领福利（diy-client 1126082530）----------

// 独立活动：换该活动页会话 → 每日打卡 → diyTask 任务(挣抽奖次数) → 视频日任务(挣抽奖次数) → 抽奖
// 返回结果行，由 main() 拼进本账号通知
async function doVideoAct(user) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
    try {
        const ctx = await exchangeSession(user, VIDEO_ENTRY);
        say(`[追剧] ${await videoSign(ctx)}`);
        lines.push(...await runDiyTasks(ctx));
        lines.push(...await runVideoDay(ctx));
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

// 该活动抽奖次数余额（任务与视频任务挣的都是它）；查不到返回 null，只用于前后对比
async function lotteryRemain(ctx) {
    const r = await Request({ url: `${DIY_LOTTERY_API}/period/remain/${VIDEO_COMPONENT}`, method: 'post', headers: apiHeaders(ctx), _timeout: 30000 });
    if (!r || r.code !== 'SUCCESS') return null;
    return Number((r.data || {}).remain) || 0;
}

// 视频站头：cmlive 与 qwhdhub 是两套会话，这里绝不带主站 Cookie，只带视频站自己的 JWT
function cmliveHeaders(referer, jwt) {
    const h = {
        accept: 'application/json, text/plain, */*',
        origin: 'https://v.cmcc-cs.cn',
        referer: referer,
        'x-requested-with': 'XMLHttpRequest',
        'user-agent': USER_AGENT,
        'accept-language': 'zh-CN,zh-Hans;q=0.9',
    };
    if (jwt) h.authorization = jwt;
    return h;
}

// QWHD 会话 → getYDRZToken 票据 → cmpassLoginByCmToken 换视频站 JWT（全自动，无需抓包凭证）
async function openCmliveSession(ctx) {
    const r = await Request({ url: `${BASE}/qwhdhub/user/getYDRZToken?targetSourceId=${CMLIVE_SOURCE_ID}`, headers: apiHeaders(ctx), _timeout: 30000 });
    const ydrz = r && r.data;
    if (!ydrz || typeof ydrz !== 'string') { $.log(`[追剧·视频] YDRZ 取票为空(code=${r && r.code} ${(r && r.msg) || ''})，sourceId=${CMLIVE_SOURCE_ID}`); return ''; }
    const l = await Request({ url: `${CMLIVE_BASE}/user/auth/cmpassLoginByCmToken`, method: 'post', headers: cmliveHeaders(CMLIVE_REFERER, ''), body: { cmpassToken: ydrz }, _timeout: 30000 });
    const jwt = l && typeof l.object === 'string' ? l.object : '';
    if (!l || String(l.rtnCode) !== '0' || !jwt) { $.log(`[追剧·视频] 视频站登录被拒: ${l && l.rtnCode} ${(l && l.rtnMsg) || ''}`); return ''; }
    $.log('[追剧·视频] 视频站 JWT 已换取（cmpassLoginByCmToken）');
    return jwt;
}

async function cmliveGet(jwt, path, params, referer) {
    const q = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
    try {
        return (await Request({ url: `${CMLIVE_BASE}${path}?${q}`, headers: cmliveHeaders(referer, jwt), _timeout: 30000 })) || {};
    } catch (e) {
        return { rtnCode: 'NETWORK_ERROR', rtnMsg: String((e && e.message) || e) };
    }
}

// 从清单里筛今日可做的视频任务：周日会下发「视频周日1/2」两个独立任务(各 maxPerDay=1)，
// 其余时间 1 个；按 taskStage/todayRemain/earnOpportunity 自适应，不写死任务 ID
function videoTasks(data) {
    const todo = ((data || {}).undoTodayTaskList || []).filter(t => t.taskStage === 'UNDO'
        && Number(t.todayRemain || 0) > 0 && Number(t.earnOpportunity || 0) > 0);
    let video = todo.filter(t => /视频/.test(`${t.name || ''}${t.description || ''}`) || /cmlive/.test(String(t.url || '')));
    if (!video.length && todo.length === 1) video = todo;   // 服务端改名后只剩一个待办，按视频任务处理
    return video;
}

async function queryVideoTaskList(ctx) {
    return await Request({ url: `${VIDEO_TASK_API}/queryDiyVideoTask`, headers: apiHeaders(ctx), _timeout: 30000 });
}

// 单个视频任务：登记浏览入口 → getFiveMinuteTaskInfo 取 cToken → fiveMinuteTaskFinish 上报
// 拿到 cToken 即可上报，不必等前端 300s 倒计时
async function completeVideoTask(ctx, jwt, task) {
    const name = task.name || '看精彩视频';
    let jt = String(task.param || '');
    if (!/^QWHD_/.test(jt) && task.taskId) jt = 'QWHD_' + task.taskId;
    if (!jt) return { ok: false, msg: `${name} 缺少 jtToken` };

    const turl = String(task.url || '');
    if (turl) {
        const target = turl.startsWith('/') ? BASE + turl : turl;
        try {
            assertSafeUrl(target);
            await Request({ url: target, headers: apiHeaders(ctx), _respType: 'all', followRedirect: false, _timeout: 30000 });
        } catch (e) { $.log(`[追剧·视频] startBrowse 失败（不阻断）: ${(e && e.message) || e}`); }
    }

    const ref = CMLIVE_REFERER + '&jtToken=' + encodeURIComponent(jt);
    const info = await cmliveGet(jwt, '/advert/lottery/getFiveMinuteTaskInfo', { token: jt }, ref);
    const obj = info.object || {};
    const d = obj.data || {};
    if (String(info.rtnCode) !== '0' || obj.code !== 'SUCCESS' || !Object.keys(d).length)
        return { ok: false, msg: `${name} 领取失败: ${info.rtnCode} ${obj.msg || info.rtnMsg || ''}` };
    const status = String(d.status || '');
    // status=0 表示服务端已记完成（上次跑过或 App 里做过），不再重复上报
    if (status === '0') return { ok: true, already: true, msg: `${name} 已完成（${d.finishDesc || '奖励已发放'}）` };
    if (status !== '1') return { ok: false, msg: `${name} 状态异常（status=${status || '空'}）` };
    const ctoken = d.cToken || '';
    if (!ctoken) return { ok: false, msg: `${name} 未下发 cToken` };

    const fin = await cmliveGet(jwt, '/advert/lottery/fiveMinuteTaskFinish', { token: ctoken }, ref);
    const fobj = fin.object || {};
    if (String(fin.rtnCode) !== '0' || !fobj.data) return { ok: false, msg: `${name} 上报失败: ${fin.rtnCode} ${fobj.msg || fin.rtnMsg || ''}` };
    return { ok: true, msg: `${name} 完成` };
}

// 视频日任务：每完成一个 +1 抽奖机会（每周上限 8 次，周日可做 2 次）
// 每轮重新拉清单（完成一个才放出下一个），最多 5 轮防异常循环
async function runVideoDay(ctx) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
    const first = await queryVideoTaskList(ctx);
    if (!first || first.code !== 'SUCCESS') { $.log(`[追剧·视频] 清单获取失败: ${first && first.code} ${first && first.msg || ''}`); return lines; }
    if (!videoTasks(first.data).length) { $.log('[追剧·视频] 今日已完成（或已到上限）'); return lines; }

    const jwt = await openCmliveSession(ctx);
    if (!jwt) { say('[追剧·视频] 失败：视频站登录未成功'); return lines; }

    const before = await lotteryRemain(ctx);
    const results = [];
    let done = 0;
    for (let round = 0; round < 5; round++) {
        const r = await queryVideoTaskList(ctx);
        if (!r || r.code !== 'SUCCESS') { results.push(`清单刷新失败: ${r && r.msg}`); break; }
        const list = videoTasks(r.data);
        if (!list.length) break;
        const one = await completeVideoTask(ctx, jwt, list[0]);
        results.push((one.ok ? '✓ ' : '✗ ') + one.msg);
        if (!one.ok || one.already) break;   // 已完成的直接收工，不白耗轮次
        done++;
        await $.wait(randomInt(900, 1600));
    }
    const after = await lotteryRemain(ctx);
    const add = (before != null && after != null && after > before) ? `（抽奖次数 ${before}→${after}）` : '';
    if (done) say(`[追剧·视频] 完成 ${done} 次${add}`);
    $.log(`[追剧·视频] 明细: ${results.join('；') || '今日已完成'}`);
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

// 北京时间「当天的第几分钟」，用于按时刻筛场次
function beijingMinuteOfDay(ms) {
    const d = new Date(ms + 8 * 3600000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
}

// 北京时间日期 yyyyMMdd，用于记抢中那期的日期
function beijingDate(ms) {
    const d = new Date(ms + 8 * 3600000), p = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}

// 该时刻所在「周」的键(周一的 yyyyMMdd，北京时间)——秒杀的期是按周算的，一周内多场只算一期
function beijingWeekKey(ms) {
    const d = new Date(ms + 8 * 3600000);
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    const p = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}

function weekKeyOfYmd(ymd) {
    if (!/^\d{8}$/.test(String(ymd || ''))) return '';
    return beijingWeekKey(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)), 4, 0, 0));
}

// 抢中的那一周还没过完 → 本周其余场次都不打
function skWeekDone(user, ms) {
    const w = weekKeyOfYmd(user.skWinDay);
    return !!w && w === beijingWeekKey(ms);
}

function hmToMinutes(s) {
    const p = String(s).split(':');
    return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0);
}

// 每天的秒杀是否该执行：触发时刻（北京时间）不早于 cmcc_sk_min
function skWindowOpen() {
    return beijingMinuteOfDay(Date.now()) >= SK_MIN_OPEN;
}

// ---------- AI豆苗养成记（dev.coc.10086.cn）----------

// 该域只认请求头 phone，绝不带主站 Cookie；channelCode/wtAc 是活动侧固定标识
function seedHeaders(cred) {
    return {
        'user-agent': USER_AGENT,
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json;charset=utf-8',
        origin: 'https://dev.coc.10086.cn',
        referer: SEED_PAGE_URL,
        phone: cred,
        'accept-language': 'zh-CN,zh-Hans;q=0.9',
    };
}

// 统一 POST；网关偶发非 JSON 或网络抖动按失败结构返回，不抛异常（网络错误重试一次）
async function seedPost(cred, path, body) {
    for (const retry of [0, 1000]) {
        try {
            const r = await Request({ url: `${SEED_BASE}${path}`, method: 'post', headers: seedHeaders(cred), body: body || {}, _timeout: 30000 });
            if (r) return r;
            return { resultCode: 'NO_RESP', msg: '响应非 JSON' };
        } catch (e) {
            if (!retry) { await $.wait(1000); continue; }
            return { resultCode: 'NETWORK_ERROR', msg: String((e && e.message) || e) };
        }
    }
    return { resultCode: 'NETWORK_ERROR', msg: 'unreachable' };
}

// 凭证身份：只记长度与尾 4 位，不存明文，用于检测 coc3_phone 被更换
function seedCredSig(cred) { return `${String(cred).length}:${String(cred).slice(-4)}`; }

function seedUuid() {
    const h = n => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    return `${h(8)}-${h(4)}-4${h(3)}-8${h(3)}-${h(12)}`;
}

// 任务跳转 URL 里的目标页短路径：.../online/yidongaini?x → yidongaini
function seedTargetKey(task) {
    return (/\/online\/([^/?#]+)/.exec(String(task.unfinishRedirectUrl || '')) || [])[1] || '';
}

function seedAge(sec) {
    sec = Math.max(0, Math.floor(sec));
    if (sec < 60) return '不到 1 分钟';
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) return `${d} 天 ${h} 小时`;
    if (h) return `${h} 小时 ${m} 分钟`;
    return `${m} 分钟`;
}

// 本地状态 + accumulateCount 双重判断；count 已 >0 时只记录不重复签（避免打断连签）
async function seedSign(cred, state, today) {
    const info = await seedPost(cred, '/cmpp-manage/task/getTaskSignInfo', { taskId: SEED_SIGN_TASK_ID, needQyCredits: 1, needLimit: 0 });
    if (info.resultCode !== 0) return `签到信息获取失败: ${info.resultCode} ${info.msg || ''}`;
    const count = Number(((info.data || {}).accumulateCount) || 0);
    if (state.signDate === today) return '今日已签到（本地记录），跳过';
    if (state.signCount != null && count > Number(state.signCount)) {
        state.signDate = today; state.signCount = count;
        return '今日已签到（签到天数已增加），跳过';
    }
    if (state.signCount == null && count > 0) {
        state.signDate = today; state.signCount = count;
        return '检测到已有签到记录，今日不重复签到';
    }
    const body = { taskId: SEED_SIGN_TASK_ID, channelCode: SEED_CHANNEL, needLimit: 0 };
    if (SEED_WTAC) { body.wtAc = SEED_WTAC; body.wtAcId = seedUuid(); }
    const resp = await seedPost(cred, '/cmpp-manage/task/accumulateSign', body);
    const awards = resp.data;
    if (resp.resultCode === 0 && Array.isArray(awards) && awards.length) {
        state.signDate = today; state.signCount = count + 1;
        return `签到成功：${awards.map(a => a.awardName || '奖励').join('、')}`;
    }
    const msg = String(resp.msg || '');
    if (resp.resultCode === 500 || resp.resultCode === 502 || /已签|重复/.test(msg)) {
        state.signDate = today; state.signCount = count;
        return `今日已签到（${msg || resp.resultCode}），跳过`;
    }
    return `签到失败: ${resp.resultCode} ${msg}`;
}

// 可代做任务：type 2 走 share，其余走 visit(目标页)；上报被接受即算完成，最后统一复查
async function seedTasks(cred) {
    const r = await seedPost(cred, '/cmpp-manage/task/getGrowthTaskList', { taskListId: SEED_TASK_LIST_ID });
    if (r.resultCode !== 0) return { lines: [`任务清单获取失败: ${r.resultCode} ${r.msg || ''}`], done: 0 };
    const todo = (r.data || []).filter(t => t.isFinish === 0);
    const lines = [];
    const accepted = [];
    let done = 0;
    const doIt = t => t.taskType === 2
        ? seedPost(cred, '/cmpp-manage/task/share', { channelCode: SEED_CHANNEL, visitUrl: SEED_PAGE_KEY, taskId: t.taskId })
        : seedPost(cred, '/cmpp-manage/task/visit', { channelCode: SEED_CHANNEL, visitUrl: seedTargetKey(t), taskId: t.taskId });

    for (const t of todo) {
        const title = t.taskMainTitle || `任务${t.taskId}`;
        const ttype = t.taskType;
        if (SEED_SKIP_TYPES[ttype]) { $.log(`[豆苗·任务] ${title}: ${SEED_SKIP_TYPES[ttype]}，跳过`); continue; }
        if (![1, 2, 4, 5].includes(ttype)) { $.log(`[豆苗·任务] ${title}: 类型 ${ttype}，跳过`); continue; }
        if (ttype !== 2 && !seedTargetKey(t)) { $.log(`[豆苗·任务] ${title}: 缺少目标页，跳过`); continue; }

        let resp = await doIt(t);
        if (typeof resp.data === 'string' && /频繁/.test(resp.data)) {   // 限频退避重试一次
            await $.wait(5000);
            resp = await doIt(t);
        }
        if (resp.resultCode !== 0) lines.push(`✗ ${title}：${resp.msg || resp.resultCode}`);
        else if (resp.data === null || resp.data === undefined || resp.data === true) { lines.push(`✓ ${title} 已上报`); accepted.push(t.taskId); done++; }
        else lines.push(`· ${title}：${resp.data}`);
        $.log(`[豆苗·任务] ${title} → ${lines[lines.length - 1]}`);
        await $.wait(randomInt(800, 1500));
    }
    if (accepted.length) {
        await $.wait(2000);
        const chk = await seedPost(cred, '/cmpp-manage/task/getGrowthTaskList', { taskListId: SEED_TASK_LIST_ID });
        if (chk.resultCode === 0) {
            const still = (chk.data || []).filter(t => accepted.includes(t.taskId) && t.isFinish !== 1).length;
            if (still) lines.push(`· 复查：${still} 个任务状态待刷新`);
        }
    }
    if (!lines.length) lines.push('任务已全部完成');
    return { lines, done };
}

// 待领阳光值气泡：home 里的 unreceivedCreditsVOList 逐条 claim
async function seedClaim(cred) {
    const r = await seedPost(cred, '/api/activity/slgCredits/getSlgCreditsHomePage', { activityId: SEED_ACTIVITY_ID });
    if (r.resultCode !== 0) return { lines: [`待领阳光值获取失败: ${r.resultCode} ${r.msg || ''}`], got: 0 };
    const records = (r.data || {}).unreceivedCreditsVOList || [];
    if (!records.length) return { lines: ['待领阳光值：无'], got: 0 };
    const lines = [];
    let got = 0;
    for (const rec of records) {
        const resp = await seedPost(cred, '/api/activity/slgCredits/getGrowthBubble', {
            activityId: SEED_ACTIVITY_ID, creditsRecordId: rec.recordId, referer: SEED_PAGE_KEY, channelNo: SEED_CHANNEL,
        });
        const name = rec.showName || '阳光值', num = Number(rec.showNum || 0);
        if (resp.resultCode === 0) { lines.push(`✓ 领取 ${name} +${num}`); got += num; }
        else lines.push(`✗ 领取 ${name} 失败: ${resp.msg || resp.resultCode}`);
        $.log(`[豆苗·领取] ${lines[lines.length - 1]}`);
        await $.wait(500);
    }
    return { lines, got };
}

// ticket = App 大网 SSO 的整串会话 Cookie，与 cmcc_data 的 token 同值，不另设抓取入口
async function seedTicketSign(user) {
    const ticket = user.token || '';
    if (!ticket) return { token: '', ticket: '', err: '无 App 票据(token)' };
    const r = await Request({
        url: `${SEED_LOGIN_API}/userLoginV2`, method: 'post',
        headers: {
            accept: 'application/json, text/plain, */*',
            'content-type': 'application/json;charset=utf-8',
            origin: 'https://dev.coc.10086.cn',
            referer: SEED_PAGE_URL,
            'user-agent': user.userAgent || USER_AGENT,
            'accept-language': 'zh-CN,zh-Hans;q=0.9',
        },
        body: { ticket, ticketType: 11, businessType: 'RIGHTS_MARKET', wxoaType: '', m1: '', m2: '', s1: '', s2: '', from: '', jsid: ticket },
        _timeout: 30000,
    });
    const d = (r && r.data) || {};
    if (!r || String(r.code) !== '0' || !d.token) return { token: '', ticket: '', err: `${r && r.code} ${String((r && r.message) || '').slice(0, 18)}` };
    $.log(`[豆苗·凭证] App 票据现签 phone 成功（${d.mobileMask || '手机号已掩码'}，province ${d.provinceCode || '?'}）`);
    return { token: d.token, ticket };
}

// 主流程：用 ticket 现签 phone → 探活 → 签到 → 任务 → 领取 → 余额前后对比
// ticket 只在 App 登录后几小时内可用（放几小时即 40006，App 重登会轮换），签不出就提示重抓，不缓存 phone
async function runSeed(user) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
    const signed = await seedTicketSign(user);
    const cred = signed.token;
    if (!cred) { say(`[豆苗] ticket 签不出 phone(${signed.err})，本次跳过——ticket 只在 App 刚登录后几小时内有效，开着获取Cookie在 App 里点任意一页重抓`); return lines; }

    const all = $.toObj($.getdata(SEED_STATE_KEY), {}) || {};
    const k = user.userCheckId || user.userName || 'default';
    const state = all[k] || {};
    const nowSec = Date.now() / 1000;
    // 计时按"服役的 ticket"记（token 每次现签，长度/尾号都跟着 ticket 走）
    const tracked = signed.ticket || cred;
    const sig = seedCredSig(tracked);
    let ageSec = 0, isNew = false;
    if (state.credSig !== sig) { Object.assign(state, { credSig: sig, credFirst: nowSec, lastOk: null }); isNew = true; }
    else ageSec = Math.max(0, nowSec - Number(state.credFirst || nowSec));

    // 探活：queryGrowthValue 回 -516 或 msg 含「登录」即凭证失效（ticket 没有续期接口，只能重抓）
    const chkResp = await seedPost(cred, '/api/activity/slgCredits/queryGrowthValue', { activityId: SEED_ACTIVITY_ID });
    const chkMsg = String(chkResp.msg || '');
    const dead = () => chkResp.resultCode === -516 || /登录/.test(chkMsg);
    if (dead()) {
        const extra = state.lastOk ? `，上次成功 ${seedAge(nowSec - Number(state.lastOk))} 前` : '';
        say(`[豆苗] ticket 已失效（${chkMsg || '登录已失效'}，已服役 ${seedAge(ageSec)}${extra}）——它撑不过几小时，开着获取Cookie在 App 里点任意一页重抓`);
        return lines;
    }
    state.lastOk = nowSec;
    const growthBefore = chkResp.resultCode === 0 ? Number(((chkResp.data || {}).growthValue)) : null;
    $.log(`[豆苗·凭证] ticket 已服役 ${seedAge(ageSec)}（token 每次现签）${isNew ? '，首次使用从本次计时' : ''}`);

    const today = $.time('yyyy-MM-dd');
    const signLine = await seedSign(cred, state, today);
    const taskRes = await seedTasks(cred);
    const claimRes = await seedClaim(cred);
    const afterResp = await seedPost(cred, '/api/activity/slgCredits/queryGrowthValue', { activityId: SEED_ACTIVITY_ID });
    const growthAfter = afterResp.resultCode === 0 ? Number(((afterResp.data || {}).growthValue)) : null;
    const lagged = claimRes.got && growthBefore != null && growthAfter != null && growthAfter < growthBefore + claimRes.got;

    taskRes.lines.forEach(l => $.log(`[豆苗·任务] ${l}`));
    all[k] = state;
    $.setdata($.toStr(all, '{}'), SEED_STATE_KEY);
    say(`[豆苗] 签到${signLine.slice(0, 24)}｜任务完成 ${taskRes.done} 个｜领取 ${claimRes.got} 阳光值｜余额 ${growthBefore ?? '?'}→${growthAfter ?? '?'}${lagged ? '（入账延迟，以活动页为准）' : ''}`);
    return lines;
}

// ---------- 签到专属 AI豆兑换话费券（qwhdhub/api/mark/task）----------

// 话费券每日限量、先到先得；AI豆 1:1 抵扣。只兑话费券，按面额从高到低顶格，
// 0.5 元档与「充值加赠券」一律不兑；单商品每期限兑一次（兑过 status=USED），重复运行幂等。
async function goldApi(ctx, path, payload) {
    const r = await Request({ url: `${GOLD_API}/${path}`, method: 'post', headers: apiHeaders(ctx), body: payload || {}, _timeout: 30000 });
    if (!r) throw new Error(`${path} 无响应`);
    return r;
}

// 余额（currentFee 即可兑 AI 豆数）+ 商品列表
async function goldState(ctx) {
    const resp = await goldApi(ctx, 'getExchangeList', { channel: 'app' });
    if (String(resp.code) !== 'SUCCESS') throw new Error(`getExchangeList 失败: ${resp.code} ${resp.msg || ''}`);
    const data = resp.data || {};
    const prizes = Array.isArray(data.prizes) ? data.prizes : [];
    const num = v => { const n = Number(v || 0); return isFinite(n) ? n : 0; };
    return { balance: num(data.currentFee), data, prizes, num };
}

// 按面额顺序取第一个在架、库存充足、豆够的档位；skipIds 是本次已经碰过壁的档
function goldPick(prizes, balance, skipIds) {
    const byName = {};
    prizes.forEach(p => { byName[p.name] = p; });
    for (const name of GOLD_TIERS) {
        const p = byName[name];
        if (!p || p.status !== 'WITHOUT' || skipIds.has(p.id)) continue;   // USED 已兑过 / IN_QUEUE 发货中 / 下架
        if (Number(p.stock || 0) <= GOLD_MIN_STOCK) continue;               // 前端同款判定：余量 <=100 视为已抢光
        if (Number(p.cost || 0) > balance) continue;
        return p;
    }
    return null;
}

async function runGold(ctx, user) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
    let st;
    try {
        st = await goldState(ctx);
    } catch (e) {
        // 会话过期就重建一次再试（换票最贵，正常情况复用主流程已建立的会话）
        $.log(`[AI豆兑换] 首次取列表失败(${e.message || e})，重建会话重试`);
        ctx = await exchangeSession(user);
        st = await goldState(ctx);
    }
    const { balance, data, prizes, num } = st;
    $.log(`[AI豆兑换] 余额 ${balance} 豆（累计 ${num(data.totalFee)}、已兑 ${num(data.exchangeFee)}）`);
    GOLD_TIERS.forEach(name => {
        const p = prizes.find(x => x.name === name);
        if (!p) return;
        const stock = Number(p.stock || 0);
        let state = { WITHOUT: '可兑', USED: '已兑过' }[p.status] || p.status || '?';
        if (p.status === 'WITHOUT' && stock <= GOLD_MIN_STOCK) state = '已抢光';
        $.log(`[AI豆兑换] 档位 ${name} ${Number(p.cost || 0)}豆 库存 ${stock}（${state}）`);
    });

    const got = [], bad = [];
    // 碰过壁的档本次不再重试（列表每轮重取，只改本地对象挡不住）
    const skipIds = new Set();
    for (let round = 0; round < GOLD_MAX_ROUNDS; round++) {
        const cur = await goldState(ctx);
        const target = goldPick(cur.prizes, cur.balance, skipIds);
        if (!target) break;
        const stock = await goldApi(ctx, 'checkStock', { prizeId: target.id });
        const left = (stock.data || {}).stock;
        if (typeof left !== 'number' || left <= GOLD_MIN_STOCK) {
            $.log(`[AI豆兑换] ${target.name} 库存不足(${left})，看下一档`);
            skipIds.add(target.id);
            continue;
        }
        const resp = await goldApi(ctx, 'exchange', { prizeId: target.id });
        if (String(resp.code) === 'SUCCESS') {
            got.push(target.name);
            say(`🎉 [AI豆兑换] ${target.name} 成功（${Number(target.cost)} 豆），去 App「我的奖品」核销`);
            await $.wait(1000);
            continue;
        }
        // FAILED 时 data 是错误码：1 内部员工不在范围；2/3 今日已抢光
        const reason = { 1: '内部员工不在兑换范围', 2: '今日已抢光', 3: '今日已抢光' }[resp.data] || `未知错误码 ${resp.data}`;
        bad.push(target.name);
        skipIds.add(target.id);
        say(`[AI豆兑换] ${target.name} 失败：${reason}`);
        if (resp.data === 1) break;
    }
    if (!got.length && !bad.length) $.log('[AI豆兑换] 本次无可兑档位（AI豆不足/已兑过/已抢光）');
    return lines;
}

// ---------- 周三充值日（hlwyxhdhub/wedrecharge）----------

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

// 周三场次秒杀：当天只打一次 → 校时 → 等到 at(北京时间) → 连发 drawPrize 直到命中/无库存/打完预算
async function doWedSeckill(user) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
    if (beijingWeekday() !== WED_DAY) { $.log('[周三·秒杀] 今天(北京时间)不是周三，本次跳过'); return lines; }
    // 本周三已经打过（无论中没中）就不再重复：一周就这一场，再打只会白耗会话与库存
    if (user.wedSkDay === $.time('yyyyMMdd')) { $.log('[周三·秒杀] 今天已执行过，本次不再打'); return lines; }
    let fired = 0;
    try {
        let ctx = await exchangeSession(user, WED_ENTRY);
        await wedApi(ctx, 'queryActivityInfo');
        // 会话保活：HLWHD Cookie 只有 30 分钟，等待期间重建一次，开火前再强制重建
        const fresh = async () => {
            ctx = await exchangeSession(user, WED_ENTRY);
            await wedApi(ctx, 'queryActivityInfo');
        };
        const info = await wedApi(ctx, 'queryDrawPrizeInfo');
        let srvMs = Number(info.currentTime) || Date.now();
        $.log(`[周三·秒杀] 服务器时间 ${fmtCn(srvMs)}，本机偏差 ${(srvMs - Date.now()).toFixed(0)} ms，rdStatus=${info.rdStatus || '?'}`);

        // 场次小时由服务端 rec_login 的 seckillTime 下发；未下发时不采信前端兜底的 [8,12,18]，按 App 显示只取 08:00
        let skHours = null, sessNote = '';
        try {
            const rec = (await Request({ url: `${WED_API}/_pub/rec_login`, headers: apiHeaders(ctx), _timeout: 15000 })) || {};
            const d = rec.data || {};
            if (Array.isArray(d.seckillTime) && d.seckillTime.length) { skHours = d.seckillTime.map(Number); sessNote = '服务端下发'; }
            else sessNote = '服务端未下发，按 App 显示取 08:00';
            const nfos = d.Seckillnfos || [];
            if (nfos.length) $.log('[周三·秒杀] 奖品: ' + nfos.map(p => `${p.name || ''}${p.subTitle ? `（${p.subTitle}）` : ''}`).join('；'));
        } catch (e) { $.log(`[周三·秒杀] rec_login 获取失败: ${(e && e.message) || e}`); }
        skHours = (skHours || [8]).sort((a, b) => a - b);
        $.log(`[周三·秒杀] 共 ${skHours.length} 个场次（${sessNote}）: ` + skHours.map(h => `${pad2(h)}:00`).join(' / '));

        // 目标场次：cmcc_wed_sk_at 优先，否则取最近一个未开始的。
        // 这里按"今天这一场"算，不做 beijingAt 的顺延（顺延会把已过的 08:00 说明天的，导致今日已结束判不出来）
        const dayAt = hms => {
            const p = String(hms).split(':').map(Number);
            const d = new Date(srvMs + 8 * 3600000);
            return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), p[0] || 0, p[1] || 0, p[2] || 0) - 8 * 3600000;
        };
        let target, src;
        if (WSK_AT_CFG) { target = dayAt(WSK_AT_CFG); src = `配置 ${WSK_AT_CFG}`; }
        else {
            const future = skHours.filter(h => dayAt(`${pad2(h)}:00:00`) >= srvMs);
            if (!future.length) { say('[周三·秒杀] 今日场次已全部结束，明日再跑（或配置 cmcc_wed_sk_at 指定场次）'); return lines; }
            target = dayAt(`${pad2(future[0])}:00:00`); src = `场次 ${pad2(future[0])}:00`;
        }
        $.log(`[周三·秒杀] 选定目标 ${fmtCn(target)}（${src}），提前 ${WSK_LEAD}ms，间隔 ${WSK_INTERVAL}ms，预算 ${WSK_MAX_ATTEMPTS} 发`);

        const waitMs = target - WSK_LEAD - srvMs;
        if (waitMs > WSK_MAX_WAIT) {
            say(`[周三·秒杀] 距开场还有 ${(waitMs / 60000).toFixed(1)} 分钟，超过等待上限 ${WSK_MAX_WAIT / 60000} 分钟，本次跳过（定时请设在开场前 1~2 分钟）`);
            return lines;
        }
        // 等到点：>150s 分段校时（校时失败即重建会话），150s~30s 之间强制重建一次，≤30s 贴等
        let deadline = Date.now() + Math.max(0, waitMs), refreshed = false;
        while (true) {
            const remain = deadline - Date.now();
            if (remain <= 0) break;
            if (refreshed && remain > 30) { await $.wait(Math.min(remain - 30, 20000)); continue; }
            if (remain > 150000) {
                await $.wait(Math.min(30000, remain - 150000));
                try {
                    const now2 = Number((await wedApi(ctx, 'queryDrawPrizeInfo')).currentTime) || Date.now();
                    deadline = Date.now() + Math.max(0, target - WSK_LEAD - now2);
                    if (deadline - Date.now() > 60000) $.log(`[周三·秒杀] 会话心跳 ok，距开火 ${((deadline - Date.now()) / 1000).toFixed(0)} 秒`);
                } catch (e) {
                    $.log(`[周三·秒杀] 校时失败，重建会话: ${(e && e.message) || e}`);
                    try { await fresh(); } catch (e2) { $.log(`[周三·秒杀] 重建会话失败: ${(e2 && e2.message) || e2}`); }
                }
                continue;
            }
            if (!refreshed && remain > 30) {
                $.log('[周三·秒杀] 开火前刷新会话（HLWHD Cookie 30 分钟滑动过期）');
                try { await fresh(); } catch (e) { $.log(`[周三·秒杀] 开火前刷新失败: ${(e && e.message) || e}`); }
                refreshed = true;
                continue;
            }
            await $.wait(Math.min(200, remain));
        }

        let code = '', msg = '';
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
    } finally {
        // 只要真发出过 drawPrize 就算"本周三打过"，之后当天不再打；换票/校时就挂了的不记，留当天重试的机会
        if (fired) { user.wedSkDay = $.time('yyyyMMdd'); saveUsers(); }
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

// 签到结果统一格式: <端> <状态>（<天数>）[，获得: X][，备注]
function markLine(who, ok, days, prize, note) {
    return `${who} ${ok ? '签到成功' : '今日已签'}${days ? `（${days}）` : ''}${prize ? `，获得: ${prize}` : ''}${note ? `，${note}` : ''}`;
}

// 秒杀抢券: 本周已中/触发时刻门控 → 校时 → 场次 → 本周已中(精判) → 资格(未签补签) → 等到开抢 → 循环 redeem
async function doSeckill(ctx, user) {
    const lines = [];
    const say = t => { lines.push(t); $.log(t); };
    // 期按周算：本周已抢中过就整块收工。先用"今天是否属于抢中那一周"便宜地拦掉同期重复运行，零请求；
    // 跨周边界还要在拿到 secConfig 后按场次开抢时间再判一次（见下）
    if (skWeekDone(user, Date.now())) {
        $.log(`[秒杀] 本周已于 ${user.skWinDay.slice(4, 6)}-${user.skWinDay.slice(6, 8)} 抢到${user.skWinPrize ? `「${user.skWinPrize}」` : ''}，本周不再参与`);
        return lines;
    }
    // 普通签到运行（凌晨/上午）不该碰秒杀：触发时刻早于 cmcc_sk_min 直接收工，一次请求都不发
    if (!skWindowOpen()) {
        $.log(`[秒杀] 触发时刻未到 ${SK_MIN_OPEN_RAW}，本次不执行（抢券请另开 11 点后的定时）`);
        return lines;
    }
    const srvMs = await serverNowMs(ctx);
    const offsetMs = srvMs - Date.now();
    $.log(`服务器时间 ${fmtCn(srvMs)}，本机时钟偏移 ${offsetMs >= 0 ? '+' : ''}${offsetMs.toFixed(0)} ms`);

    const cfgResp = await skPost(ctx, `${SK_API}/secConfig`);
    const zones = (((cfgResp || {}).data || {}).secKillData || {}).secKillZones || [];
    if (!zones.length) throw new Error('secConfig 未返回任何场次（活动未配置或已结束）');
    $.log(`共 ${zones.length} 个场次:`);
    zones.forEach(z => $.log(`  场次${z.id} ${fmtCn(z.startTime)} ~ ${fmtCn(z.endTime)}  ${(z.prize || {}).name} (prizeId=${(z.prize || {}).id})`));

    const picked = pickZone(zones, srvMs);
    if (!picked.zone) throw new Error('没有可参与的场次（全部已结束）');
    const zone = picked.zone, prizeName = (zone.prize || {}).name || `场次${zone.id}`;
    const startSrv = Number(zone.startTime), endSrv = Number(zone.endTime);
    const zoneDay = beijingDate(startSrv);
    $.log(`选定场次${zone.id}：${fmtCn(startSrv)} 开抢（${picked.active ? '进行中' : `距开始 ${((startSrv - srvMs) / 1000).toFixed(0)} 秒`}）`);
    // 早场默认不打：开抢时刻早于 cmcc_sk_min（默认 11:00）直接收工
    if (beijingMinuteOfDay(startSrv) < SK_MIN_OPEN) {
        $.log(`[秒杀] 场次${zone.id} ${fmtCn(startSrv)} 开抢，早于下限 ${SK_MIN_OPEN_RAW}，本次不抢`);
        return lines;
    }
    // 精判本周：跨周边界或活动把场次排期挪动时，"今天属于抢中那一周"这条快判可能不准，按场次开抢时间再拦一次
    if (skWeekDone(user, startSrv)) {
        $.log(`[秒杀] 场次${zone.id}(${fmtCn(startSrv)}) 所属周已于 ${user.skWinDay.slice(4, 6)}-${user.skWinDay.slice(6, 8)} 抢过，本周不再参与`);
        return lines;
    }

    const eligible = await ensureEligible(ctx);
    $.log(`秒杀资格（当日签到）: ${eligible ? '已具备' : '未获取！'}`);
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
    const rmsg = ((fired.resp || {}).msg) || '';
    if (fired.reason === 'SUCCESS') {
        user.skWinDay = zoneDay;
        user.skWinPrize = prizeName;
        saveUsers();
        say(`🎉 [秒杀] 抢到 ${prizeName}（场次 ${fmtCn(startSrv)}），请去 App「我的奖品」核销`);
    } else if (/已领取|限领/.test(rmsg)) {
        // 服务端自己说"这份奖你已经领过"（含在 App 里领的），状态名却叫 WORK_ORDER_RESTRIC_LIMIT；
        // 按同样口径记入本周标记，否则本周每天 12:00 都会再白打一场
        user.skWinDay = zoneDay;
        user.skWinPrize = prizeName;
        saveUsers();
        say(`[秒杀] ${rmsg}｜${prizeName}，已记入本周抢中，本周不再参与`);
    } else {
        const reason = rmsg || SK_STOP[fired.reason] || fired.reason;
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

function pad2(n) { return String(n).padStart(2, '0'); }

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
function maskMobile(v) {
    const s = String(v || '');
    return /^1\d{10}$/.test(s) ? `${s.slice(0, 3)}****${s.slice(-4)}` : (s || '未知');
}

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

// 脚本执行入口: $request 存在 → 抓取模式(按 URL 分流), 否则 → 定时任务模式
!(async () => {
    if (typeof $request !== `undefined`) {
        if (/uamrandcodelogin\/autoLogin/i.test($request.url || '')) GetAutoLogin();
        else GetCookie();
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
