/**
 * 脚本名称：酷我音乐签到
 * 活动规则：每日签到/打卡/听歌/宝箱/抽奖领金币，金币可在积分商城兑换会员
 * 脚本说明：账号由脚本内置登录页获取（手机号 + 图形码 + 短信），登录成功写入 kuwo_data；
 *          任务参数对齐酷我 App 11.3.8.0 内「赚钱」H5，
 *          跑签到/打卡/听歌/小说/收藏/宝箱/免费抽奖；广告、跳转第三方、邀请类任务脚本跳过
 *          登录页：开启插件后浏览器打开 http://360.com/kuwo（需 MITM 360.com），
 *          该地址只在插件开启时才由脚本返回页面，关闭后即透传
 * 配置说明：boxjs「酷我音乐签到」中：
 *          - kuwo_data     登录页自动写入 [{userid,sid}]，也可手填 userid@sid
 *          - kuwo_phone    登录页预填手机号；也是账号手机号，用于 AES 生成 mobile（多账号以登录页输入的为准）
 *          - kuwo_ocr      ocr.space 的 API Key，留空用演示 key（易被限流）
 *          - kuwo_device   可选 JSON，覆盖内置的 11.3.8.0 设备画像（devId/appUid/version/source/prod/apiversion/q36/verificationId）
 *          - kuwo_smid     默认 true：账号没有 verificationId 时，按数美 web fp 协议离线注册一个并写回 kuwo_data；
 *                          填 false 则不发这个请求，verificationId 留空（签到侧实测不校验它）
 *          - kuwo_notify   默认 false：只在 23 点那次运行汇总推送；true 则每次运行都推送
 *          - kuwo_exchange 默认 false：旧版 VIP 兑换接口，当前 H5 已改 taskExchange，仅保留开关
 *          - kuwo_debug    调试模式
 *          Node 环境变量同名可用
 * 更新时间：2026-10-28

------------------ Surge 配置 ------------------

[Script]
酷我音乐登录 = type=http-request,pattern=^https?:\/\/360\.com\/kuwo,requires-body=1,max-size=0,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/kuwo_sign.js,script-update-interval=0

酷我音乐签到 = type=cron,cronexp="15 7-23/1 * * *",wake-system=1,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/kuwo_sign.js,script-update-interval=0

[MITM]
hostname = 360.com

------------------- Loon 配置 -------------------

[Script]
http-request ^https?:\/\/360\.com\/kuwo script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/kuwo_sign.js,requires-body=true,timeout=600,tag=酷我音乐登录

cron "15 7-23/1 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/kuwo_sign.js, timeout=600, tag=酷我音乐签到

[MITM]
hostname = 360.com

--------------- Quantumult X 配置 ---------------

[rewrite_local]
^https?:\/\/360\.com\/kuwo url script-analyze-echo-response https://raw.githubusercontent.com/jy0703/scripts/main/scripts/kuwo_sign.js

[task_local]
"15 7-23/1 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/kuwo_sign.js, tag=酷我音乐签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/kuwo.png, enabled=true

[MITM]
hostname = 360.com

 */

const $ = new Env('酷我音乐');
$.is_debug = /^(true|1|yes|on)$/i.test(String(getEnv('kuwo_debug', 'is_debug') || ''));
$.notify = /^(true|1|yes|on)$/i.test(String(getEnv('kuwo_notify') || ''));
$.exchange = /^(true|1|yes|on)$/i.test(String(getEnv('kuwo_exchange') || ''));
$.smid_on = !/^(false|0|no|off)$/i.test(String(getEnv('kuwo_smid') || ''));   // 默认开，显式关掉才不注册
$.Messages = [];   // 通知正文：只放成功项
$.Subtitle = [];   // 通知副标题：登录失效等前置失败
$.replied = false;
$.loginMode = typeof $request !== 'undefined';

// ---- 业务常量 ----
const DATA_KEY = 'kuwo_data';
const STATS_KEY = 'kuwo_stats';
const LOGIN_PATH = '/kuwo';
const HOST_WWW = 'https://www.kuwo.cn';
const HOST_WAPI = 'https://wapi.kuwo.cn';
const HOST_INTEGRAL = 'https://integralapi.kuwo.cn';
const HOST_ACT = 'https://actapi.kuwo.cn';
const HOST_VIP = 'https://vip1.kuwo.cn';
const OCR_URL = 'https://api.ocr.space/parse/image';
const UA_WEB = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 酷我 11.3.8.0 安卓 App 内 H5 的设备画像，kuwo_device 可整段覆盖
const PROFILE = {
    ua: 'Mozilla/5.0 (Linux; Android 9; MI 9 Build/PQ3B.190801.08311801; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36/ kuwopage',
    devId: 'CkITVzpSWFFpXFBBW0ZECw==',
    appUid: '2961465961',
    version: '11.3.8.0',
    source: 'kwplayer_ar_11.3.8.0_40.apk',
    prod: 'kwplayer_ar_11.3.8.0',
    terminal: '1',
    platform: 'ar',
    apiversion: '43',
    adApiversion: '54',
    q36: 'fbd4176b22c12a2954ba434a10001011aa1c',
    // 数美 SMDEVICEID：App 每次会话都会变，不能硬编码；可用 kuwo_device 覆盖
    verificationId: ''
};
Object.assign(PROFILE, $.toObj(getEnv('kuwo_device') || '', {}) || {});

const H5_HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': PROFILE.ua,
    'Origin': 'https://h5app.kuwo.cn',
    'X-Requested-With': 'cn.kuwo.player',
    'Sec-Fetch-Site': 'same-site',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    'Referer': 'https://h5app.kuwo.cn/',
    'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7'
};
const CONVERT_SCORE = 150000;   // 兑换会员所需积分
const CONVERT_QUOTA = 13;
const MOBILE_KEY = 'ysiVkLJHHnvMWCHq';
const MOBILE_IV = 'ichYooX+Mb1gRetP';
const LAST_RUN_HOUR = 23;
const SCORE_PER_YUAN = 10000;
const HTTP_GAP = 200;   // 接口对短时高频很敏感，逐条限速

$.userArr = loadAccounts();
$.shouldNotify = $.notify || isLastRun();

// 主函数
async function main() {
    const accounts = loadAccounts();
    if (!accounts.length) {
        $.log('未找到 kuwo_data 变量，请先打开 http://360.com/kuwo 登录 ❌');
        if ($.shouldNotify) $.Subtitle.push('❌ 未找到 kuwo_data 变量，请先打开 http://360.com/kuwo 登录');
        return;
    }

    const stats = loadStats();
    stats.runCount++;
    $.log(`\n🌀 找到 ${accounts.length} 个账号`);
    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        $.log(`\n----- 账号 [${i + 1}/${accounts.length}] 开始执行 -----\n`);
        try {
            const r = await runAccount(acc, i + 1);
            const rec = stats.accounts[acc.userid] || (stats.accounts[acc.userid] = { name: '', goldEarned: 0, taskCount: 0 });
            rec.name = r.label;
            rec.goldEarned += r.gold;
            rec.taskCount += r.count;
            $.Messages.push(`🔹 酷我音乐 ${r.label}`, ...r.lines);
        } catch (e) {
            $.logErr(e);
            $.Subtitle.push(`❌ 账号${i + 1}: ${e.message || e}`);
        }
        if (i < accounts.length - 1) await $.wait(3000);
    }

    saveStats(stats);
    if (isLastRun()) $.Messages.push(renderSummary(stats));
}

// 单账号：任务列表 → 会员 → 兑换 → 签到 → 日常任务 → 宝箱 → 免费抽奖 → 复查积分
async function runAccount(acc, index) {
    if (!acc.userid || !acc.sid) throw new Error('账号缺少 userid/sid，请重新登录');
    const { userid, sid } = acc;
    const phone = String(acc.phone || getEnv('kuwo_phone') || '');
    const vId = await ensureSmid(acc);
    const nick = await getNickname(userid);
    const label = nick || `用户${index}`;
    const lines = [];
    const push = (text) => { lines.push(text); $.log(text); };

    $.log(`👤 ${label}`);
    const before = await fetchSignData(userid, sid, 0, Math.random());
    if (!before) throw new Error('获取任务列表失败');
    const beforeScore = Number(before.remainScore) || 0;
    push(`💰 积分: ${beforeScore} (¥${(beforeScore / SCORE_PER_YUAN).toFixed(2)})`);

    const vip = await getVip(userid, sid);
    if (vip && vip.expire) push(`🎟️ 会员到期: ${vip.text}`);
    else if (vip) push('🔴 未开通会员');

    let count = 0;

    if ($.exchange && beforeScore >= CONVERT_SCORE) {
        const r = await convert(userid, sid);
        if (r.ok) { count++; push(`✅ 兑换会员: ${r.desc}`); }
        else $.log(`    > 兑换会员: ${r.desc || '失败'}`);
    }

    if (before.isSign === false) {
        const r = await signToday(userid, sid, before, phone, vId);
        if (r.ok) { count++; push(`✅ 每日签到: ${r.desc}`); }
        else $.log(`    > 每日签到: ${r.desc || '失败'}`);
    }

    const tasks = await runDailyTasks(userid, sid, before.dataList, phone, vId);
    count += tasks.count;
    lines.push(...tasks.lines);

    const box = await claimBox(userid, sid);
    if (box.ok) { count++; push(`✅ 宝箱: ${box.desc}`); }
    else $.log(`    > 宝箱: ${box.desc || '未到领取时间'}`);

    const lot = await freeLottery(userid, sid);
    if (lot.ok) { count++; push(`✅ 免费抽奖: ${lot.desc}`); }
    else $.log(`    > 免费抽奖: ${lot.desc || '无可用次数'}`);

    const after = await fetchSignData(userid, sid, 1, Math.random());
    const afterScore = after ? Number(after.remainScore) || 0 : beforeScore;
    const gold = Math.max(0, afterScore - beforeScore);
    push(`💰 积分: ${afterScore} (¥${(afterScore / SCORE_PER_YUAN).toFixed(2)})`);
    push(`📈 本次: +${gold} 金币, 成功 ${count} 项`);
    return { label, lines, gold, count };
}

// ---------- 业务接口 ----------

// 昵称只按 uid 查，不能当登录态判断
async function getNickname(userid) {
    const o = await integralGet('/api/v1/online/sign/v1/music/userBase', { loginUid: userid });
    return o?.data?.nickname || '';
}

async function fetchSignData(userid, sid, refresh, t) {
    const o = await integralGet('/api/v1/online/sign/v1/earningSignIn/newUserSignList', {
        isShowLaBa: 1,
        loginUid: userid,
        loginSid: sid,
        devId: PROFILE.devId,
        jfencv: 'devId',
        appUid: PROFILE.appUid,
        version: PROFILE.version,
        source: PROFILE.source,
        terminal: PROFILE.terminal,
        platform: PROFILE.platform,
        prod: PROFILE.prod,
        t: t || Math.random(),
        apiVer: 3,
        function: 1,
        scoreInfo: '',
        apiv: 11,
        dynamicVer: PROFILE.apiversion,
        kver: 1,
        apiversion: PROFILE.apiversion,
        adApiversion: PROFILE.adApiversion,
        refresh: refresh,
        q36: PROFILE.q36
    });
    if (o.code !== 200 || !o.data) {
        const msg = o.msg || descOf(o) || `code=${o.code}`;
        $.log(`    > 获取任务列表失败: ${msg}`);
        return null;
    }
    return o.data;
}

// 今日签到：用 goldList 今日项提交 newDoListen
async function signToday(userid, sid, data, phone, vId) {
    const list = data.goldList || [];
    const idx = Math.max(0, Number(data.continueDays || 1) - 1);
    const gold = list[idx] || list.find(x => x && x.today) || {};
    return await doListen(userid, sid, {
        from: 'sign',
        taskId: gold.id || '',
        goldNum: gold.goldNum || 0,
        extraGoldNum: gold.extraGoldNum || 0,
        baseTaskGold: 0
    }, phone, vId);
}

// 日常任务：只跑可脚本化的项，广告/跳转类跳过
async function runDailyTasks(userid, sid, list, phone, vId) {
    const lines = [];
    let count = 0;
    const names = { clock: '打卡', novel: '每日小说', collect: '每日收藏', mobile: '每日听歌' };
    for (const item of list || []) {
        if (!item) continue;
        const type = String(item.taskType || '');
        if (type === 'listen') {
            // 只提交 status=3（听完可领）的时段；脚本不能真听歌，未达标就跳过
            const pending = (item.listenList || []).filter(sub => Number(sub.status) === 3);
            if (!pending.length) {
                $.log('    > 听歌任务: 未达到时长，需在 App 内实际听歌后才会出现可领项');
                continue;
            }
            for (const sub of pending) {
                const r = await doListen(userid, sid, {
                    from: 'listen',
                    taskId: '',
                    goldNum: sub.goldNum,
                    extraGoldNum: undefined,
                    listenTime: sub.time,
                    unit: sub.unit,
                    baseTaskGold: 0,
                    downloadAppReward: 0
                }, phone, vId);
                if (r.ok) {
                    count++;
                    lines.push(`✅ 听歌(${sub.time}${sub.unit}): ${r.desc}`);
                    $.log(`    > 听歌(${sub.time}${sub.unit}): ${r.desc}`);
                } else {
                    $.log(`    > 听歌(${sub.time}${sub.unit}): ${r.desc || '失败'}`);
                }
            }
            continue;
        }
        if (!names[type]) {
            if (['videoadver', 'shakeMoneyTree', 'friendshipCheckin', 'jumph5', 'notification', 'lottery', 'signlist'].includes(type)) {
                $.log(`    > ${type}: 需 App 内广告/跳转/人工操作，跳过`);
            }
            continue;
        }
        if (Number(item.status) !== 0) {
            $.log(`    > ${names[type]}: 已完成，跳过`);
            continue;
        }
        const r = await doListen(userid, sid, {
            from: type,
            taskId: item.id,
            goldNum: item.goldNum,
            extraGoldNum: item.extraGoldNum,
            baseTaskGold: item.baseTaskGold || 0,
            adverSpace: item.adverSpace || '',
            verifyStr: item.verify_str || '',
            adverId: item.adverId || '',
            token: item.token || '',
            surpriseType: item.surpriseType || ''
        }, phone, vId);
        if (r.ok) {
            count++;
            lines.push(`✅ ${names[type]}: ${r.desc}`);
            $.log(`    > ${names[type]}: ${r.desc}`);
        } else {
            $.log(`    > ${names[type]}: ${r.desc || '失败'}`);
        }
    }
    return { count, lines };
}

// newDoListen：字段与任务页提交的 opt 一致
async function doListen(userid, sid, task, phone, vId) {
    const o = await integralGet('/api/v1/online/sign/v1/earningSignIn/newDoListen', {
        apiversion: PROFILE.apiversion,
        adverSpace: task.adverSpace || '',
        verifyStr: task.verifyStr || '',
        loginUid: userid,
        loginSid: sid,
        appUid: PROFILE.appUid,
        terminal: 'ar',
        from: task.from || '',
        taskId: task.taskId || '',
        goldNum: task.goldNum,
        baseTaskGold: task.baseTaskGold || 0,
        adverId: task.adverId || '',
        token: task.token || '',
        extraGoldNum: task.extraGoldNum,
        clickExtraGoldNum: 0,
        secondRewardFlag: 0,
        yyzdSecondRewardFlag: 0,
        surpriseType: task.surpriseType || '',
        // 先 encodeURIComponent 一次，拼 query 时再编码一次 → 双重编码
        verificationId: vId ? encodeURIComponent(vId) : '',
        mobile: phone ? Crypt('aes-cbc', phone, MOBILE_KEY, MOBILE_IV) : '',
        listenTime: task.listenTime !== undefined ? task.listenTime : '',
        apiv: 10,
        unit: task.unit !== undefined ? task.unit : '',
        dynamicVer: PROFILE.apiversion,
        kver: 1,
        rewardType: 0,
        pFrom: '',
        downloadAppReward: task.downloadAppReward
    });
    const d = o.data || {};
    const desc = String(d.description || o.msg || '');
    const failed = ['未登录', '失败', '异常', '不达标', '稍后再试', '频繁'].some(w => desc.includes(w));
    const ok = o.code === 200 && !!o.data && !failed &&
        (Number(d.status) === 1 || Number(d.obtain) > 0 || desc === '今天已完成任务' || /恭喜获得|领取成功|兑换成功/.test(desc));
    return { ok, desc };
}

// 宝箱：newBoxList + newBoxFinish
async function claimBox(userid, sid) {
    const common = {
        loginUid: userid,
        loginSid: sid,
        devId: PROFILE.devId,
        jfencv: 'devId',
        appUid: PROFILE.appUid,
        version: PROFILE.version,
        source: PROFILE.source,
        terminal: PROFILE.terminal,
        platform: PROFILE.platform,
        prod: PROFILE.prod,
        t: Math.random(),
        apiv: 1
    };
    const list = await integralGet('/api/v1/online/sign/new/newBoxList', { position: 'task', ...common });
    const d = list.data || {};
    if (list.code !== 200 || Number(d.status) !== 1 || Number(d.goldNum) <= 0) {
        return { ok: false, desc: d.countdown ? `倒计时 ${d.countdown}s` : '' };
    }
    const finish = await integralGet('/api/v1/online/sign/new/newBoxFinish', {
        apiversion: PROFILE.apiversion,
        loginUid: userid,
        loginSid: sid,
        devId: PROFILE.devId,
        jfencv: 'devId',
        appUid: PROFILE.appUid,
        source: PROFILE.source,
        version: PROFILE.prod,
        dynamicVer: PROFILE.apiversion,
        kver: 1,
        verifyStr: '',
        adverSpace: '',
        r: Math.random(),
        action: 'new',
        time: '',
        goldNum: d.goldNum,
        baseTaskGold: 0,
        extraGoldnum: 0,
        clickExtraGoldNum: 0,
        yyzdSecondRewardFlag: 0,
        secondRewardFlag: 0,
        apiv: 6
    });
    const ok = finish.code === 200 && !!finish.data && Number(finish.data.obtain) > 0;
    return { ok, desc: ok ? `获得 ${finish.data.obtain}` : (descOf(finish) || '') };
}

// 免费模式抽奖在 actapi，先查次数再抽
async function freeLottery(userid, sid) {
    const info = await actapiGet('/api/v2/20006/freemode/getlotterys', {
        loginUid: userid,
        loginSid: sid,
        appUid: PROFILE.appUid,
        src: PROFILE.source,
        version: PROFILE.version,
        t: Math.random()
    });
    if (info.code !== 200 || !info.data) return { ok: false, desc: info.msg || descOf(info) };
    const d = info.data;
    // 剩余次数在 data.ulotterynums
    const n = Array.isArray(d) ? d.length : Number(d.ulotterynums ?? d.lotterynums ?? d.count ?? 0);
    debug({ url: 'getlotterys', data: d }, '抽奖');
    if (!(n > 0)) return { ok: false, desc: '无可用次数' };
    const o = await actapiGet('/api/v2/20006/freemode/getLucky', {
        loginUid: userid,
        loginSid: sid,
        appUid: PROFILE.appUid,
        t: Math.random()
    });
    const desc = o.data?.loterryname || o.data?.prizeName || o.data?.name || o.msg || '';
    return { ok: o.code === 200 && !!o.data, desc };
}

async function getVip(userid, sid) {
    try {
        const res = await Http({ url: `${HOST_VIP}/vip/v2/user/vip?op=ui&uid=${userid}&sid=${sid}&signver=new`, headers: H5_HEADERS });
        const o = jsonOf(res);
        if (o?.meta?.code !== 200) return null;
        const d = o.data || {};
        let t = Number(d.vipLuxuryExpire || d.vipmExpire || d.vipExpire || 0);
        if (!t) return { expire: false };
        if (t < 1e12) t *= 1000;
        const dt = new Date(t);
        return { expire: true, text: `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}` };
    } catch (e) {
        debug(e.message, 'vip');
        return null;
    }
}

// 旧兑换接口，默认关；现行接口已改 taskExchange/newExchangeList
async function convert(userid, sid) {
    const o = await integralGet('/api/v1/online/sign/getExchangeAward', {
        loginUid: userid,
        loginSid: sid,
        quotaId: CONVERT_QUOTA,
        exchangeType: 'vip'
    });
    const desc = descOf(o);
    return { ok: o.code === 200 && /成功/.test(desc), desc };
}

async function integralGet(path, params) {
    return await h5Get(`${HOST_INTEGRAL}${path}`, params, '积分接口');
}

async function actapiGet(path, params) {
    return await h5Get(`${HOST_ACT}${path}`, params, '活动接口');
}

async function h5Get(url, params = {}, title = '接口') {
    const query = Object.keys(params)
        .filter(k => params[k] !== undefined && params[k] !== null)
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
        .join('&');
    const full = query ? `${url}?${query}` : url;
    try {
        const res = await Http({ url: full, headers: H5_HEADERS });
        const o = jsonOf(res);
        debug({ url: full, status: res.status, body: o }, title);
        if (o && o.code === 200 && (o.data?.description === '用户未登录' || Number(o.data?.status) === 8001)) {
            throw new LoginError('登录态已失效，请打开 http://360.com/kuwo 重新登录');
        }
        return o;
    } catch (e) {
        if (e instanceof LoginError) throw e;
        $.log(`    > 请求失败: ${e.message || e}`);
        return { code: -1, msg: e.message || String(e) };
    }
}

// ---------- 数美 SMDEVICEID（verificationId）----------
// 赚钱 H5 的 verificationId 来自页面内联加载的数美 web fp SDK v3.0.0，值是注册接口下发的设备号；
// 这里按同一套协议离线注册一个，不加载 SDK。所有 DES/AES/RSA/MD5 走脚本里已有的 Crypt 分发器。
const SM_ORG = 'm7veziVVQLREESXRyV7G';
const SM_APPID = 'kuwo_tw';
const SM_PUBKEY = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCNNRLeXMGDsA2639qF7UfjHypm3wrPdj+QuEzM5Nfmi0AqFT7j5O/Rji78RhoFh4mNahI1yyX5+MY1PV3HITXjHEgWrPGjT+o6I7w4vT3dcyTJEAdToX5oppUAoRrkh9Yy0HllGArp2YH4hRYAqpVwfOYWVsUJUWrGOnyX/uL71wIDAQAB';
const SM_URL = 'https://fp-it.portal101.cn/deviceprofile/v4';
const SM_PAGE = 'https://h5app.kuwo.cn/apps/earning-sign/index.html';
const SM_AES_IV = '0102030405060708';
const SM_SALT = {
    bl: '6nprv5u4', xi: 'fosnye0h', tf: 'uuikiial', nv: 'ktq3h98y', cz: 'bp4e16vc',
    mx: 'holed4zr', pf: '7i0ulooq', uq: 'ozmby6ug',
    nm: 't05aq73a', rg: 'aj5ukhl0', dy: '3n5fm4fb', mh: '02n6f6c9',
    kt: 'v3ybya7s', xy: 'pi016hk4', iy: 'd5htj6gi', pz: 'dtx3qb8x'
};

function zeroRun(len, block) { const rem = len % block; return rem ? '\0'.repeat(block - rem) : ''; }

// Crypt 的 des-ecb / aes-cbc 是 PKCS7，数美要零填充：先补零到整块，再截掉 PKCS7 追加的那一块
function desZero(text, salt) {
    const padded = String(text) + zeroRun(String(text).length, 8);
    const hex = Crypt('base64-to-hex', Crypt('des-ecb', padded, salt)).slice(0, padded.length * 2);
    return Crypt('hex-to-base64', hex);
}
function aesZeroHex(text, key) {
    const padded = text + zeroRun(text.length, 16);
    return Crypt('base64-to-hex', Crypt('aes-cbc', padded, key, SM_AES_IV)).slice(0, padded.length * 2);
}

// 只写 gzip 的 stored 块（不压缩），产出合法 gzip 流，服务端 inflate 后与真机同形
let SM_CRC_T = null;
function gzipHex(str) {
    const src = unescape(encodeURIComponent(str));   // latin1 串，charCode 即 UTF-8 字节
    const out = [];
    const push = (...b) => { for (const x of b) out.push(x); };
    push(0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff);
    if (!src.length) push(0x01, 0x00, 0x00, 0xff, 0xff);
    for (let off = 0; off < src.length; off += 0xffff) {
        const chunk = src.slice(off, off + 0xffff);
        const n = chunk.length;
        const last = off + n >= src.length ? 1 : 0;
        push(last, n & 0xff, (n >> 8) & 0xff, (~n) & 0xff, ((~n) >> 8) & 0xff);
        for (let i = 0; i < n; i++) push(chunk.charCodeAt(i) & 0xff);
    }
    if (!SM_CRC_T) {
        SM_CRC_T = [];
        for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; SM_CRC_T[i] = c >>> 0; }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < src.length; i++) crc = SM_CRC_T[(crc ^ src.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    push(crc & 0xff, (crc >> 8) & 0xff, (crc >> 16) & 0xff, (crc >>> 24) & 0xff);
    const size = src.length >>> 0;
    push(size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff);
    return out.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

// uq 校验和：按 key 排序，数字先 *10000，值一律先 String() 再递归（嵌套对象因此变成 [object Object]）
function smFlatten(v) {
    if (v && Object.prototype.toString.call(v) === '[object Object]') {
        return Object.keys(v).sort().map(k => smFlatten(typeof v[k] === 'number' ? String(10000 * v[k]) : String(v[k]))).join('');
    }
    return v ? String(v) : '';
}

function smPayload(now) {
    const uid = uuid();
    const obj = {
        protocol: 281,
        bl: desZero(SM_ORG, SM_SALT.bl),
        xi: desZero(SM_APPID, SM_SALT.xi),
        tf: desZero('web', SM_SALT.tf),
        version: '3.0.0',
        nv: desZero('3.0.0', SM_SALT.nv),
        uk: '',
        cz: desZero('all', SM_SALT.cz),
        smid: '',
        mx: desZero('1.0.0', SM_SALT.mx),
        pf: desZero(String(8 + Math.floor(Math.random() * 40)), SM_SALT.pf),
        nm: desZero('Linux armv8l', SM_SALT.nm),
        rg: desZero(PROFILE.ua, SM_SALT.rg),
        dy: desZero(-480, SM_SALT.dy),
        mh: desZero(SM_PAGE, SM_SALT.mh),
        kt: desZero(uid, SM_SALT.kt),
        xy: desZero(String(now), SM_SALT.xy),
        iy: desZero(uuid(), SM_SALT.iy),
        pz: desZero(String(now + 1), SM_SALT.pz),
        ia: undefined,          // 真机恒为 undefined：JSON 会丢掉这个键，但 uq 拼接要算它
        gc: PROFILE.ua, uy: 'zh-CN', nf: 'Google Inc.', dx: 'Netscape', ub: 'Mozilla',
        ma: 8, ru: 8, pa: [], yd: '', sd: 'Asia/Shanghai',
        wd: 1, xj: 1, ex: 0, bk: 0, pd: 393, dt: 393, fn: 851, pw: 711, mm: [],
        documentExist: 1,
        bc: ['cookie', 'referrer', 'title', 'characterSet', 'compat', 'documentElement', 'body', 'head', 'createElement', 'createElementNS', 'getElementById', 'getElementsByName', 'getElementsByTagName', 'querySelector', 'querySelectorAll', 'addEventListener', 'removeEventListener', 'write'],
        kd: 'UTF-8', rz: new Date(now).toString(),
        yw: 1, fc: 0, zj: 0, ui: 0, ye: 0, qg: 0, zh: '', rj: 1, wn: -1, kq: 1, zd: 1,
        se: 0, sb: 0, bu: -1,
        ms: 'Google Inc. (Qualcomm) -&- OpenGL ES 3.0 V@0463.0',
        cw: 'Google Inc. (Qualcomm) (OpenGL ES 3.0 V@0463.0)',
        sw: '', ow: '', fa: 1, je: 0, pi: { red: '0' }, sn: {},
        dv: { maxTouchPoints: 5, touchEvent: false, touchStart: false },
        incognito: { getDirectoryExist: 0, getDirectoryIncognito: 0, maxTouchPointsExist: 1, indexedDBIncognito: 0, quotaExists: 1, quotaIncognito: 0, openDatabase: 0 },
        t: now, collectTime: 12 + Math.floor(Math.random() * 30)
    };
    obj.uq = desZero(Crypt('md5', smFlatten(obj)), SM_SALT.uq);
    return { obj, uid };
}

async function smRegister() {
    const now = Date.now();
    const { obj, uid } = smPayload(now);
    const b64 = Crypt('hex-to-base64', gzipHex(JSON.stringify(obj)));
    const priId = Crypt('md5', uid).slice(0, 16);
    const body = {
        appId: SM_APPID,
        organization: SM_ORG,
        ep: Crypt('rsa-enc-pkcs1', SM_PUBKEY, uid),
        data: aesZeroHex(b64, priId),
        os: 'web',
        encode: 5,
        compress: 2
    };
    const res = await Http({
        url: SM_URL, method: 'post',
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json;charset=utf-8',
            'Origin': 'https://h5app.kuwo.cn',
            'Referer': 'https://h5app.kuwo.cn/',
            'User-Agent': PROFILE.ua
        },
        body: JSON.stringify(body)
    });
    const o = jsonOf(res);
    debug({ status: res.status, code: o && o.code, requestId: o && o.requestId }, '数美注册');
    const dev = o && o.detail && o.detail.deviceId;
    return dev ? 'B' + dev : '';
}

// 账号上的 verificationId：已存 > kuwo_device 覆盖 > 现场注册一次并落盘
async function ensureSmid(acc) {
    if (acc.verificationId) return acc.verificationId;
    if (PROFILE.verificationId) return PROFILE.verificationId;
    if (!$.smid_on) return '';
    try {
        const id = await smRegister();
        if (!id) { $.log('    > 数美设备号: 注册未返回 deviceId，本次不带 verificationId'); return ''; }
        acc.verificationId = id;
        const arr = loadAccounts();
        const hit = arr.find(x => x.userid === acc.userid);
        if (hit) { hit.verificationId = id; $.setdata($.toStr(arr), DATA_KEY); }
        $.log(`    > 数美设备号: 已注册并写入 kuwo_data (${id.slice(0, 12)}…)`);
        return id;
    } catch (e) {
        $.log(`    > 数美设备号: ${e.message || e}，本次不带 verificationId`);
        return '';
    }
}

// ---------- 登录页（rewrite：360.com/kuwo） ----------

async function handleLoginRequest() {
    const url = $request?.url || '';
    if (!url.includes(LOGIN_PATH)) return passthrough();
    if (String($request?.method || 'GET').toUpperCase() === 'OPTIONS') return passthrough();
    try {
        if (url.includes('captcha')) return await handleCaptcha();
        if (url.includes('ocr')) return await handleOcr();
        if (url.includes('sms')) return await handleSms();
        if (url.includes('login')) return await handleLogin();
        return reply(null, renderPage());
    } catch (e) {
        $.logErr(e);
        return reply({ code: -1, msg: e.message || String(e) });
    }
}

// 第一步：拿 www.kuwo.cn 下发 Cookie，再用 Cookie 名/值现算 Secret 取图形码
async function handleCaptcha() {
    const home = await Http({ url: HOST_WWW, headers: { 'User-Agent': UA_WEB } });
    const cookies = getCookies(home.headers);
    const cookie = cookies.find(x => /Hm_Iuvt|kw_token/.test(x.name)) || cookies.find(x => x.value.length > 20) || cookies[0];
    if (!cookie?.value) return reply({ code: -1, msg: 'Step1: Cookie获取失败' });

    const res = await Http({
        url: `${HOST_WWW}/api/common/captcha/getcode?reqId=${uuid()}&httpsStatus=1`,
        headers: { 'Cookie': `${cookie.name}=${cookie.value}`, 'Secret': sec(cookie.value, cookie.name), 'Referer': HOST_WWW, 'User-Agent': UA_WEB }
    });
    const j = jsonOf(res);
    return reply({ code: j.code, msg: j.msg, data: { img: j.data?.img, token: j.data?.token, key: cookie.name, val: cookie.value } });
}

async function handleOcr() {
    const body = parseBody($request);
    let img = String(body.image || '');
    if (img.includes(',')) img = img.split(',')[1];
    if (!img) return reply({ code: -1, msg: '缺少图片' });

    const key = String(getEnv('kuwo_ocr') || 'helloworld');
    const res = await Http({
        url: OCR_URL,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `apikey=${encodeURIComponent(key)}&base64Image=${encodeURIComponent('data:image/jpeg;base64,' + img)}&language=eng&scale=true&OCREngine=2`
    });
    const j = jsonOf(res);
    const text = j?.ParsedResults?.[0]?.ParsedText;
    if (!text) return reply({ code: -1, msg: j?.ErrorMessage || 'OCR 识别失败' });
    return reply({ code: 200, text: String(text).replace(/[\r\n\s]/g, '') });
}

async function handleSms() {
    const body = parseBody($request);
    const res = await Http({
        url: `${HOST_WWW}/api/sms/mobileLoginCode?reqId=${uuid()}&httpsStatus=1`,
        headers: {
            'Cookie': `${body.cookieKey}=${body.cookieVal}`,
            'Secret': sec(body.cookieVal, body.cookieKey),
            'Content-Type': 'application/json',
            'Referer': HOST_WWW
        },
        body: JSON.stringify({ verifyCode: body.code, verifyCodeToken: body.token, mobile: body.mobile })
    });
    return reply(jsonOf(res));
}

async function handleLogin() {
    const body = parseBody($request);
    const loginBody = { mobile: body.mobile, verifyCode: body.verifyCode, smsCode: body.smsCode, tm: body.tm };
    const res = await Http({
        url: `${HOST_WAPI}/api/www/login/loginByMobile?reqId=${uuid()}&httpsStatus=1`,
        headers: {
            'Cookie': `${body.cookieKey}=${body.cookieVal}`,
            'Secret': sec(body.cookieVal, body.cookieKey),
            'Content-Type': 'application/json',
            'Referer': HOST_WWW,
            'User-Agent': UA_WEB
        },
        body: JSON.stringify(loginBody)
    });

    const text = String(res.body || '');
    if (text.trim().startsWith('<')) throw new Error('登录接口返回 HTML，请稍后重试');
    const j = jsonOf(res);
    const logs = [];

    if (j.code === 200 && j.data?.cookies) {
        const c = j.data.cookies;
        const account = { userid: String(c.userid || ''), sid: String(c.sid || c.websid || ''), phone: String(body.mobile || '') };
        if (!account.userid || !account.sid) throw new Error('登录成功但缺少 userid/sid');

        const existing = $.userArr.find(x => x.userid === account.userid);
        // 数美设备号在真机上是跨会话复用的，重新登录不重新注册
        if (existing && existing.verificationId) account.verificationId = existing.verificationId;
        const changed = !existing || existing.sid !== account.sid || (account.phone && existing.phone !== account.phone);
        if (changed) {
            $.userArr = $.userArr.filter(x => x.userid !== account.userid);
            $.userArr.push(account);
            $.setdata($.toStr($.userArr), DATA_KEY);
            logs.push(existing ? `🔄 ${account.userid} 会话已更新，已写入 kuwo_data` : `🎉 ${account.userid} 首次登录成功，已写入 kuwo_data`);
        } else {
            logs.push(`✅ ${account.userid} 会话未变化`);
        }

        logs.push('⏳ 正在执行今日任务...');
        try {
            const stats = loadStats();
            stats.runCount++;
            const r = await runAccount(account, 1);
            const rec = stats.accounts[account.userid] || (stats.accounts[account.userid] = { name: '', goldEarned: 0, taskCount: 0 });
            rec.name = r.label;
            rec.goldEarned += r.gold;
            rec.taskCount += r.count;
            saveStats(stats);
            logs.push(`👤 ${r.label}`, ...r.lines);
        } catch (e) {
            logs.push(`❌ ${e.message || e}`);
        }
    }

    return reply({ code: j.code, msg: j.msg, logs });
}

function renderPage() {
    const phone = String(getEnv('kuwo_phone') || '');
    const masked = phone ? maskPhone(phone) : '未预填手机号';
    const client = $.isQuanX() ? ['QuantumultX', '#0066cc'] : $.isLoon() ? ['Loon', '#ff6b6b'] : $.isSurge() ? ['Surge', '#00c4cc'] : ['未知', '#8e8e93'];

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>酷我音乐登录</title>
<style>
* { box-sizing: border-box; }
body { background: #f2f2f7; font-family: -apple-system, sans-serif; padding: 15px; margin: 0; }
.box { background: #fff; padding: 20px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
h3 { margin: 0 0 6px; color: #1c1c1e; font-size: 18px; }
p { font-size: 13px; color: #8e8e93; margin: 0 0 18px; }
.badge { display: inline-block; padding: 3px 10px; border-radius: 10px; font-size: 11px; font-weight: 600; color: #fff; background: ${client[1]}; margin-left: 8px; vertical-align: middle; }
input { display: block; width: 100%; padding: 12px; margin-bottom: 12px; border: 1px solid #d1d1d6; border-radius: 10px; font-size: 16px; background: #fcfcfc; }
.row { display: flex; gap: 10px; margin-bottom: 12px; align-items: center; }
.row input { flex: 1; width: 0; margin-bottom: 0; }
.cp { width: 110px; flex: none; height: 44px; background: #e5e5ea; border-radius: 10px; cursor: pointer; overflow: hidden; display: flex; align-items: center; justify-content: center; }
#ct { font-size: 12px; color: #666; text-align: center; }
img { width: 100%; height: 100%; object-fit: contain; display: none; background: #fff; }
button { width: 100%; padding: 14px; margin-top: 8px; border: none; border-radius: 12px; font-weight: 600; font-size: 16px; cursor: pointer; }
.btn-ocr { background: #e3f0ff; color: #007aff; margin-bottom: 4px; }
.btn-sms { background: #007aff; color: #fff; }
.btn-login { background: #34c759; color: #fff; }
#log { margin-top: 15px; font-size: 12px; color: #333; background: #f2f2f7; padding: 10px; border-radius: 8px; word-break: break-all; white-space: pre-wrap; min-height: 20px; }
</style>
</head>
<body>
<div class="box">
    <h3>酷我音乐<span class="badge">${client[0]}</span></h3>
    <p>${masked}</p>
    <input id="p" value="${escapeHtml(phone)}" type="tel" placeholder="请输入手机号">
    <div class="row">
        <input id="c" placeholder="图形验证码" autocomplete="off">
        <div class="cp" id="btn_cap"><span id="ct">点击加载图片</span><img id="ci"></div>
    </div>
    <button class="btn-ocr" id="btn_ocr">OCR 识别</button>
    <button class="btn-sms" id="btn_sms">获取短信验证码</button>
    <div id="s2" style="display:none; border-top:1px dashed #d1d1d6; margin-top:18px; padding-top:18px;">
        <input id="s" type="tel" placeholder="输入短信验证码">
        <button class="btn-login" id="btn_login">登录并执行任务</button>
    </div>
    <div id="log">等待初始化...</div>
</div>
<script>
(function(){
    var D = { t: '', k: '', v: '', tm: '' };
    var logEl = document.getElementById('log');
    function L(text) { logEl.innerText = '>> ' + text + '\\n' + logEl.innerText; }
    function val(id) { return document.getElementById(id).value.trim(); }
    async function post(path, data) {
        var r = await fetch('${LOGIN_PATH}/' + path, { method: 'POST', body: JSON.stringify(data) });
        return await r.json();
    }
    async function loadCaptcha() {
        var ct = document.getElementById('ct'), ci = document.getElementById('ci');
        ci.style.display = 'none'; ct.style.display = 'flex'; ct.innerText = '加载中...';
        try {
            var r = await fetch('${LOGIN_PATH}/captcha?t=' + Date.now());
            var j = await r.json();
            if (j.code == 200 && j.data) {
                D.t = j.data.token; D.k = j.data.key; D.v = j.data.val;
                var src = j.data.img || '';
                if (src.indexOf('data:image') !== 0) src = 'data:image/png;base64,' + src;
                ci.src = src;
                ci.onload = function() { ci.style.display = 'block'; ct.style.display = 'none'; L('图片加载成功'); };
                ci.onerror = function() { ct.innerText = '图片损坏'; L('Base64 数据错误'); };
            } else {
                ct.innerText = '失败(点我)';
                L('获取图形码失败: ' + (j.msg || '未知'));
            }
        } catch (e) {
            ct.innerText = '重试';
            L('网络请求失败: ' + e);
        }
    }
    async function doOcr() {
        var b = document.getElementById('btn_ocr'), ci = document.getElementById('ci');
        b.innerText = '识别中...';
        try {
            if (!ci.src || ci.style.display === 'none') throw new Error('请先加载图片');
            var raw = ci.src.split(',')[1];
            var j = await post('ocr', { image: raw });
            if (j.code == 200 && j.text) { document.getElementById('c').value = j.text; b.innerText = '识别成功'; }
            else { b.innerText = '识别失败'; L('OCR 失败: ' + (j.msg || '未知')); }
        } catch (e) {
            b.innerText = 'OCR 识别';
            alert(e.message || e);
        }
    }
    async function doSms() {
        var p = val('p'), c = val('c');
        if (!p || !c) return alert('请补全手机号和图形验证码');
        var b = document.getElementById('btn_sms');
        b.innerText = '发送中...'; b.disabled = true;
        try {
            var j = await post('sms', { mobile: p, code: c, token: D.t, cookieKey: D.k, cookieVal: D.v });
            if (j.code == 200) {
                D.tm = j.data.tm;
                document.getElementById('s2').style.display = 'block';
                b.innerText = '已发送';
                L('短信发送成功');
            } else {
                b.innerText = '重试'; b.disabled = false;
                L('短信错误: ' + (j.msg || '未知'));
            }
        } catch (e) {
            b.innerText = '重试'; b.disabled = false;
            L('请求异常: ' + e);
        }
    }
    async function doLogin() {
        var s = val('s');
        if (!s) return alert('请输入短信验证码');
        var b = document.getElementById('btn_login');
        b.innerText = '登录中...'; b.disabled = true;
        try {
            var r = await fetch('${LOGIN_PATH}/login', { method: 'POST', body: JSON.stringify({
                mobile: val('p'), verifyCode: val('c'), smsCode: s, tm: D.tm, cookieKey: D.k, cookieVal: D.v
            }) });
            var txt = await r.text();
            var j;
            try { j = JSON.parse(txt); } catch (e) { b.innerText = '解析失败'; L('响应解析失败: ' + txt.substring(0, 120)); return; }
            if (j.code == 200) {
                L('登录成功');
                (j.logs || []).forEach(function(line) { L(line); });
                b.innerText = '登录成功';
            } else {
                b.innerText = '登录失败'; b.disabled = false;
                L('错误: ' + (j.msg || '未知'));
            }
        } catch (e) {
            b.innerText = '重试'; b.disabled = false;
            L('请求异常: ' + e);
        }
    }
    window.addEventListener('load', function() {
        logEl.innerText = '✅ 页面就绪';
        document.getElementById('btn_cap').addEventListener('click', loadCaptcha);
        document.getElementById('btn_ocr').addEventListener('click', doOcr);
        document.getElementById('btn_sms').addEventListener('click', doSms);
        document.getElementById('btn_login').addEventListener('click', doLogin);
    });
})();
</script>
</body>
</html>`;
}

// ---------- 存储 ----------

function loadAccounts() {
    const raw = getEnv(DATA_KEY) || '';
    if (!raw) return [];
    const parsed = $.toObj(raw);
    if (Array.isArray(parsed)) return parsed.map(normalizeAccount).filter(Boolean);
    if (parsed && typeof parsed === 'object') return [normalizeAccount(parsed)].filter(Boolean);
    return String(raw).split(/[&\n]+/).map(normalizeAccount).filter(Boolean);
}

function normalizeAccount(item) {
    if (!item) return null;
    if (typeof item === 'string') {
        const [userid, sid] = item.trim().split('@');
        return userid && sid ? { userid, sid, phone: '' } : null;
    }
    const userid = item.userid != null ? String(item.userid) : '';
    const sid = item.sid != null ? String(item.sid) : (item.websid != null ? String(item.websid) : '');
    const phone = item.phone != null ? String(item.phone) : '';
    const verificationId = item.verificationId != null ? String(item.verificationId) : '';
    return userid && sid ? { userid, sid, phone, verificationId } : null;
}

function loadStats() {
    const today = localDate();
    let stats = $.toObj($.getdata(STATS_KEY) || '') || {};
    if (stats.date !== today || !stats.accounts) stats = { date: today, runCount: 0, accounts: {} };
    return stats;
}

function saveStats(stats) {
    $.setdata($.toStr(stats), STATS_KEY);
}

function renderSummary(stats) {
    const lines = [`📊 今日汇总 (${stats.date})`, `🔄 运行次数: ${stats.runCount}`, '───────────'];
    let total = 0;
    for (const userid in stats.accounts) {
        const acc = stats.accounts[userid];
        lines.push(`👤 ${acc.name || userid}`, `   💰 获得: ${acc.goldEarned} 金币`, `   ✅ 任务: ${acc.taskCount} 次`);
        total += acc.goldEarned;
    }
    lines.push('───────────', `💎 总计获得: ${total} 金币`);
    return lines.join('\n');
}

// ---------- 工具函数 ----------

function descOf(o) {
    return String(o?.data?.description ?? o?.msg ?? '');
}

function jsonOf(res) {
    const body = res?.body;
    if (body && typeof body === 'object') return body;
    return $.toObj(String(body || ''), {}) || {};
}

function Http(options) {
    if (HTTP_GAP) return $.wait(HTTP_GAP).then(() => sendHttp(options));
    return sendHttp(options);
}

function sendHttp(options) {
    const timeout = options._timeout || 20000;
    const opts = { ...options };
    if ($.isNode()) {
        opts.throwHttpErrors = false;   // 与 NE 一致：4xx/5xx 也把响应体交给业务层
        opts.retry = 0;                 // 429 不自动重试
    }
    delete opts._timeout;
    const method = String(opts.method || (opts.body != null ? 'post' : 'get')).toLowerCase();
    delete opts.method;
    if (method === 'post' && opts.body && typeof opts.body === 'object') opts.body = JSON.stringify(opts.body);

    return Promise.race([
        new Promise((_, reject) => setTimeout(() => reject(new Error(`请求超时: ${opts.url}`)), timeout)),
        new Promise((resolve, reject) => {
            const done = (err, resp, body) => {
                if (err) return reject(new Error(typeof err === 'string' ? err : (err.message || '请求失败')));
                resolve({ status: resp?.status || resp?.statusCode || 0, headers: resp?.headers || {}, body: body !== undefined ? body : resp?.body });
            };
            if (method === 'post') $.post(opts, done);
            else $.get(opts, done);
        })
    ]);
}

function getCookies(headers = {}) {
    const raw = headers['set-cookie'] ?? headers['Set-Cookie'];
    const list = Array.isArray(raw) ? raw : raw ? String(raw).split(/,(?=\s*[A-Za-z0-9_.-]+=)/) : [];
    return list.map(item => {
        const pair = String(item).split(';')[0];
        const index = pair.indexOf('=');
        return index > 0 ? { name: pair.slice(0, index).trim(), value: pair.slice(index + 1).trim() } : null;
    }).filter(Boolean);
}

function parseBody(req) {
    const body = req?.body;
    if (!body) return {};
    if (typeof body === 'object') return body;
    return $.toObj(String(body), {}) || {};
}

function reply(data, html) {
    if ($.replied) return;
    $.replied = true;
    const headers = {
        'Content-Type': html ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
    };
    const body = html || JSON.stringify(data ?? {});
    if ($.isQuanX()) $done({ status: 'HTTP/1.1 200 OK', headers, body });
    else $done({ response: { status: 200, headers, body } });
}

function passthrough() {
    if ($.replied) return;
    $.replied = true;
    $done({});
}

function sec(t, e) {
    if (null == e || e.length <= 0) return null;

    let n = '';
    for (let i = 0; i < e.length; i++) n += e.charCodeAt(i).toString();

    const o = Math.floor(n.length / 5);
    const r = parseInt(n.charAt(o) + n.charAt(2 * o) + n.charAt(3 * o) + n.charAt(4 * o) + n.charAt(5 * o));
    const c = Math.ceil(e.length / 2);
    const l = Math.pow(2, 31) - 1;

    if (r < 2) return null;

    const d = Math.round(1e9 * Math.random()) % 1e8;
    n += d;

    while (n.length > 10) {
        n = (parseInt(n.substring(0, 10)) + parseInt(n.substring(10, n.length))).toString();
    }

    n = (r * n + c) % l;

    let f = '';
    let h = '';
    for (let i = 0; i < t.length; i++) {
        f = parseInt(t.charCodeAt(i) ^ Math.floor(n / l * 255));
        h += f < 16 ? '0' + f.toString(16) : f.toString(16);
    }

    let dHex = d.toString(16);
    while (dHex.length < 8) dHex = '0' + dHex;

    return h += dHex;
}

function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function maskPhone(phone) {
    return String(phone).replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function localDate() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isLastRun() {
    return new Date().getHours() === LAST_RUN_HOUR;
}

class LoginError extends Error {}

// 获取环境变量
function getEnv(...keys) {
    for (let key of keys) {
        var value = $.isNode() ? process.env[key] || process.env[key.toUpperCase()] || process.env[key.toLowerCase()] || $.getdata(key) : $.getdata(key);
        if (value) return value;
    }
}

function debug(content, title = 'debug') {
    if (!$.is_debug) return;
    const text = typeof content === 'string' ? content : $.toStr(content);
    $.log(`\n----- ${title} -----\n${text}\n----- ${$.time('HH:mm:ss')} -----`);
}

// 发送消息
async function sendMsg(message, subtitle = '') {
    if (!message && !subtitle) return;
    try {
        if ($.isNode()) {
            let notify;
            try {
                notify = require('./sendNotify');
            } catch (e) {
                notify = require('./utils/sendNotify');
            }
            await notify.sendNotify($.name, [subtitle, message].filter(Boolean).join('\n'));
        } else {
            $.msg($.name, subtitle, message);
        }
    } catch (e) {
        $.log(`\n\n----- ${$.name} -----\n${[subtitle, message].filter(Boolean).join('\n')}`);
    }
}

// 脚本执行入口: $request 存在 → 登录页模式, 否则 → 定时任务模式
!(async () => {
    if ($.loginMode) {
        await handleLoginRequest();
    } else {
        await main();
    }
})()
    .catch(e => {
        $.logErr(e);
        if ($.loginMode) reply({ code: -1, msg: e.message || String(e) });
        else $.Subtitle.push(`❌ ${e.message || e}`);
    })
    .finally(async () => {
        if ($.loginMode) return;
        if ($.shouldNotify || $.Subtitle.length) {
            await sendMsg($.Messages.join('\n').trim(), $.Subtitle.join('\n').trim());
        }
        $.done();
    });

// prettier-ignore
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }


function Crypt(type, a, b, c) { function MD5(string) { function RotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); } function AddUnsigned(lX, lY) { var lX4, lY4, lX8, lY8, lResult; lX8 = (lX & 0x80000000); lY8 = (lY & 0x80000000); lX4 = (lX & 0x40000000); lY4 = (lY & 0x40000000); lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF); if (lX4 & lY4) { return (lResult ^ 0x80000000 ^ lX8 ^ lY8); } if (lX4 | lY4) { if (lResult & 0x40000000) { return (lResult ^ 0xC0000000 ^ lX8 ^ lY8); } else { return (lResult ^ 0x40000000 ^ lX8 ^ lY8); } } else { return (lResult ^ lX8 ^ lY8); } } function F(x, y, z) { return (x & y) | ((~x) & z); } function G(x, y, z) { return (x & z) | (y & (~z)); } function H(x, y, z) { return (x ^ y ^ z); } function I(x, y, z) { return (y ^ (x | (~z))); } function FF(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function GG(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function HH(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function II(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function ConvertToWordArray(string) { var lWordCount; var lMessageLength = string.length; var lNumberOfWords_temp1 = lMessageLength + 8; var lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64; var lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16; var lWordArray = Array(lNumberOfWords - 1); var lBytePosition = 0; var lByteCount = 0; while (lByteCount < lMessageLength) { lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8; lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition)); lByteCount++; } lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8; lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition); lWordArray[lNumberOfWords - 2] = lMessageLength << 3; lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29; return lWordArray; }; function WordToHex(lValue) { var WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount; for (lCount = 0; lCount <= 3; lCount++) { lByte = (lValue >>> (lCount * 8)) & 255; WordToHexValue_temp = "0" + lByte.toString(16); WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2); } return WordToHexValue; }; function Utf8Encode(string) { string = string.replace(/\r\n/g, "\n"); var utftext = ""; for (var n = 0; n < string.length; n++) { var c = string.charCodeAt(n); if (c < 128) { utftext += String.fromCharCode(c); } else if ((c > 127) && (c < 2048)) { utftext += String.fromCharCode((c >> 6) | 192); utftext += String.fromCharCode((c & 63) | 128); } else { utftext += String.fromCharCode((c >> 12) | 224); utftext += String.fromCharCode(((c >> 6) & 63) | 128); utftext += String.fromCharCode((c & 63) | 128); } } return utftext; }; var x = Array(); var k, AA, BB, CC, DD, a, b, c, d; var S11 = 7, S12 = 12, S13 = 17, S14 = 22; var S21 = 5, S22 = 9, S23 = 14, S24 = 20; var S31 = 4, S32 = 11, S33 = 16, S34 = 23; var S41 = 6, S42 = 10, S43 = 15, S44 = 21; string = Utf8Encode(string); x = ConvertToWordArray(string); a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476; for (k = 0; k < x.length; k += 16) { AA = a; BB = b; CC = c; DD = d; a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478); d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756); c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB); b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE); a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF); d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A); c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613); b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501); a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8); d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF); c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1); b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE); a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122); d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193); c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E); b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821); a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562); d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340); c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51); b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA); a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D); d = GG(d, a, b, c, x[k + 10], S22, 0x2441453); c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681); b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8); a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6); d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6); c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87); b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED); a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905); d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8); c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9); b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A); a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942); d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681); c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122); b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C); a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44); d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9); c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60); b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70); a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6); d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA); c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085); b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05); a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039); d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5); c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8); b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665); a = II(a, b, c, d, x[k + 0], S41, 0xF4292244); d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97); c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7); b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039); a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3); d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92); c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D); b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1); a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F); d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0); c = II(c, d, a, b, x[k + 6], S43, 0xA3014314); b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1); a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82); d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235); c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB); b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391); a = AddUnsigned(a, AA); b = AddUnsigned(b, BB); c = AddUnsigned(c, CC); d = AddUnsigned(d, DD); } var temp = WordToHex(a) + WordToHex(b) + WordToHex(c) + WordToHex(d); return temp.toLowerCase(); } function _rsa(pem, string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function BytesToBigInt(bytes) { let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); return n; } function BigIntToBytes(n, len) { const out = new Array(len).fill(0); for (let i = len - 1; i >= 0 && n > 0n; i--) { out[i] = Number(n & 0xffn); n >>= 8n; } return out; } function ModPow(base, exp, mod) { let r = 1n; base %= mod; while (exp > 0n) { if (exp & 1n) r = (r * base) % mod; base = (base * base) % mod; exp >>= 1n; } return r; } function DerRead(buf, off) { const tag = buf[off++]; let len = buf[off++]; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + i]; off += n; } return { tag, start: off, len }; } function DerChildren(buf, start, end) { const list = []; let off = start; while (off < end) { const t = DerRead(buf, off); list.push(t); off = t.start + t.len; } return list; } if (!_rsa._k || _rsa._kp !== pem) { try { const der = Base64ToBytes(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); let seqs = DerChildren(der, DerRead(der, 0).start, der.length); const inner = seqs.find(s => s.tag === 0x04); if (inner) { const seq2 = DerRead(der, inner.start); seqs = DerChildren(der, seq2.start, seq2.start + seq2.len); } const ints = seqs.filter(s => s.tag === 0x02); const n = BytesToBigInt(der.slice(ints[1].start, ints[1].start + ints[1].len)); const d = BytesToBigInt(der.slice(ints[3].start, ints[3].start + ints[3].len)); _rsa._k = { n, d, k: (n.toString(16).length + 1) >> 1 }; _rsa._kp = pem; } catch (e) { $.logErr('❌ [签名] 私钥解析失败: ' + (e.message || e)); return null; } } const key = _rsa._k; try { const digestInfo = [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20, ...SHA256(Utf8Encode(string))]; const padded = [0x00, 0x01, ...new Array(key.k - digestInfo.length - 3).fill(0xff), 0x00, ...digestInfo]; const sig = ModPow(BytesToBigInt(padded), key.d, key.n); return BytesToBase64(BigIntToBytes(sig, key.k)).replace(/\//g, '_').replace(/\+/g, '-'); } catch (e) { $.logErr('❌ [签名] 签名异常: ' + (e.message || e)); return null; } } function _rsaenc(b64Pub, string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function BytesToBigInt(bytes) { let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); return n; } function BigIntToBytes(n, len) { const out = new Array(len).fill(0); for (let i = len - 1; i >= 0 && n > 0n; i--) { out[i] = Number(n & 0xffn); n >>= 8n; } return out; } function ModPow(base, exp, mod) { let r = 1n; base %= mod; while (exp > 0n) { if (exp & 1n) r = (r * base) % mod; base = (base * base) % mod; exp >>= 1n; } return r; } function DerRead(buf, off) { const tag = buf[off++]; let len = buf[off++]; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + i]; off += n; } return { tag, start: off, len }; } function DerChildren(buf, start, end) { const list = []; let off = start; while (off < end) { const t = DerRead(buf, off); list.push(t); off = t.start + t.len; } return list; } if (!_rsaenc._k || _rsaenc._kp !== b64Pub) { try { let der = Base64ToBytes(String(b64Pub).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); if (der.length > 5 && der.slice(0, 5).map(b => String.fromCharCode(b)).join('') === '-----') { der = Base64ToBytes(der.map(b => String.fromCharCode(b)).join('').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); } const outer = DerRead(der, 0); const bitStr = DerChildren(der, outer.start, outer.start + outer.len).find(s => s.tag === 0x03); let ints; if (bitStr) { const seq = DerRead(der, bitStr.start + 1); ints = DerChildren(der, seq.start, seq.start + seq.len).filter(s => s.tag === 0x02); } else { ints = DerChildren(der, outer.start, outer.start + outer.len).filter(s => s.tag === 0x02); if (ints.length < 2) throw new Error('公钥解析失败(支持 SPKI/PKCS#1)'); } const n = BytesToBigInt(der.slice(ints[0].start, ints[0].start + ints[0].len)); const e = BytesToBigInt(der.slice(ints[1].start, ints[1].start + ints[1].len)); _rsaenc._k = { n, e, k: (n.toString(16).length + 1) >> 1 }; _rsaenc._kp = b64Pub; } catch (err) { $.logErr('❌ [加密] 公钥解析失败: ' + (err.message || err)); return null; } } const key = _rsaenc._k; try { const msg = Utf8Encode(string); const psLen = key.k - msg.length - 3; if (psLen < 8) { $.logErr('❌ [加密] 明文超出 RSA 长度上限'); return null; } const ps = new Array(psLen); for (let i = 0; i < psLen; i++) ps[i] = 1 + Math.floor(Math.random() * 255); const padded = [0x00, 0x02, ...ps, 0x00, ...msg]; return BytesToBase64(BigIntToBytes(ModPow(BytesToBigInt(padded), key.e, key.n), key.k)); } catch (err) { $.logErr('❌ [加密] RSA 加密异常: ' + (err.message || err)); return null; } } function _hmac(b64Key, msg) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } let key = Utf8Encode(b64Key); if (key.length > 64) key = SHA256(key); while (key.length < 64) key.push(0); const inner = SHA256(key.map(b => b ^ 0x36).concat(Utf8Encode(msg))); const outer = SHA256(key.map(b => b ^ 0x5c).concat(inner)); return outer.map(b => b.toString(16).padStart(2, '0')).join(''); } function _aes(plain, keyStr, ivStr, ecb, ivp) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } const SBOX = (function () { function gmul(a, b) { let p = 0; for (let i = 0; i < 8; i++) { if ((b >> i) & 1) p ^= a; a = ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; } return p; } const sbox = new Array(256); for (let x = 0; x < 256; x++) { let inv = 0; if (x !== 0) { inv = 1; while (gmul(inv, x) !== 1) inv++; } const r = (v, n) => ((v << n) | (v >> (8 - n))) & 0xff; sbox[x] = (inv ^ r(inv, 1) ^ r(inv, 2) ^ r(inv, 3) ^ r(inv, 4) ^ 0x63) & 0xff; } return sbox; })(); function expandKey(key) { const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]; const Nk = key.length >> 2, Nr = Nk + 6, tw = 4 * (Nr + 1); const w = []; for (let i = 0; i < Nk; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]); for (let i = Nk; i < tw; i++) { let t = w[i - 1].slice(); if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]].map(b => SBOX[b]); t[0] ^= RCON[i / Nk - 1]; } else if (Nk > 6 && i % Nk === 4) t = t.map(b => SBOX[b]); w.push([w[i - Nk][0] ^ t[0], w[i - Nk][1] ^ t[1], w[i - Nk][2] ^ t[2], w[i - Nk][3] ^ t[3]]); } const rk = []; for (let round = 0; round <= Nr; round++) { const blk = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) blk[4 * c + r] = w[4 * round + c][r]; rk.push(blk); } return { rk: rk, Nr: Nr }; } function encryptBlock(input, rk, Nr) { let s = input.slice(); const addRK = (round) => { for (let i = 0; i < 16; i++) s[i] ^= rk[round][i]; }; const xtime = (a) => ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; addRK(0); for (let round = 1; round <= Nr; round++) { for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]]; const t = s.slice(); for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) t[4 * c + r] = s[4 * ((c + r) % 4) + r]; s = t; if (round < Nr) { for (let c = 0; c < 4; c++) { const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3]; s[4 * c] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3; s[4 * c + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3; s[4 * c + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3); s[4 * c + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3); } } addRK(round); } return s; } const data = Utf8Encode(plain); const padLen = 16 - (data.length % 16); for (let i = 0; i < padLen; i++) data.push(padLen); const ks = expandKey(Utf8Encode(keyStr)); let prev = ecb ? null : Utf8Encode(ivStr).slice(0, 16); const out = ivp ? prev.slice() : []; for (let off = 0; off < data.length; off += 16) { const blk = new Array(16); for (let i = 0; i < 16; i++) blk[i] = data[off + i] ^ (ecb ? 0 : prev[i]); prev = encryptBlock(blk, ks.rk, ks.Nr); out.push(...prev); } return BytesToBase64(out); } function _aesdec(cipher, keyStr, ecb, hexIn, ivStr) { function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function HexToBytes(h) { const s = String(h).replace(/[^0-9a-fA-F]/g, ''); const bytes = []; for (let i = 0; i + 1 < s.length; i += 2) bytes.push(parseInt(s.substr(i, 2), 16)); if (s.length % 2) bytes.push(parseInt(s.slice(-1), 16)); return bytes; } function BytesToUtf8(bytes) { let s = ''; for (let i = 0; i < bytes.length;) { const b = bytes[i]; if (b < 128) { s += String.fromCharCode(b); i += 1; } else if (b >= 240 && i + 3 < bytes.length) { const cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); const v = cp - 0x10000; s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)); i += 4; } else if (b >= 224 && i + 2 < bytes.length) { s += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3; } else if (b >= 192 && i + 1 < bytes.length) { s += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2; } else { s += String.fromCharCode(b); i += 1; } } return s; } const SBOX = (function () { function gmul(a, b) { let p = 0; for (let i = 0; i < 8; i++) { if ((b >> i) & 1) p ^= a; a = ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; } return p; } const sbox = new Array(256); for (let x = 0; x < 256; x++) { let inv = 0; if (x !== 0) { inv = 1; while (gmul(inv, x) !== 1) inv++; } const r = (v, n) => ((v << n) | (v >> (8 - n))) & 0xff; sbox[x] = (inv ^ r(inv, 1) ^ r(inv, 2) ^ r(inv, 3) ^ r(inv, 4) ^ 0x63) & 0xff; } return sbox; })(); const INV_SBOX = (function () { const inv = new Array(256); for (let i = 0; i < 256; i++) inv[SBOX[i]] = i; return inv; })(); function expandKey(key) { const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]; const Nk = key.length >> 2, Nr = Nk + 6, tw = 4 * (Nr + 1); const w = []; for (let i = 0; i < Nk; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]); for (let i = Nk; i < tw; i++) { let t = w[i - 1].slice(); if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]].map(b => SBOX[b]); t[0] ^= RCON[i / Nk - 1]; } else if (Nk > 6 && i % Nk === 4) t = t.map(b => SBOX[b]); w.push([w[i - Nk][0] ^ t[0], w[i - Nk][1] ^ t[1], w[i - Nk][2] ^ t[2], w[i - Nk][3] ^ t[3]]); } const rk = []; for (let round = 0; round <= Nr; round++) { const blk = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) blk[4 * c + r] = w[4 * round + c][r]; rk.push(blk); } return { rk: rk, Nr: Nr }; } function decryptBlock(input, rk, Nr) { let s = input.slice(); const addRK = (round) => { for (let i = 0; i < 16; i++) s[i] ^= rk[round][i]; }; const xtime = (a) => ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; const mul = (a, b) => { let p = 0; for (let i = 0; i < 8; i++) { if ((b >> i) & 1) p ^= a; a = xtime(a); } return p; }; const irows = () => { const t = s.slice(); for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) t[4 * c + r] = s[4 * (((c - r) % 4 + 4) % 4) + r]; s = t; }; addRK(Nr); for (let round = Nr - 1; round >= 1; round--) { irows(); for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]; addRK(round); for (let c = 0; c < 4; c++) { const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3]; s[4 * c] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9); s[4 * c + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13); s[4 * c + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11); s[4 * c + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14); } } irows(); for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]; addRK(0); return s; } const raw = hexIn ? HexToBytes(cipher) : Base64ToBytes(cipher); if (!raw.length || raw.length % 16) return ''; const ks = expandKey(function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; }(keyStr)); let prev = null, start = 0; if (!ecb) { if (ivStr) { prev = _u8(ivStr).slice(0, 16); while (prev.length < 16) prev.push(0); start = 0; } else { prev = raw.slice(0, 16); start = 16; } } const out = []; for (let off = start; off < raw.length; off += 16) { const blk = raw.slice(off, off + 16); const dec = decryptBlock(blk, ks.rk, ks.Nr); const plainBlk = ecb ? dec : dec.map((b, i) => b ^ prev[i]); out.push(...plainBlk); if (!ecb) prev = blk; } const padLen = out[out.length - 1]; if (padLen >= 1 && padLen <= 16 && out.length >= padLen) { let ok = true; for (let i = 0; i < padLen; i++) if (out[out.length - 1 - i] !== padLen) ok = false; if (ok) out.length -= padLen; } return BytesToUtf8(out); } function _sha256hex(string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } return SHA256(Utf8Encode(string)).map(b => b.toString(16).padStart(2, '0')).join(''); } function _b64(str) { const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const u = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) u.push(c); else if (c < 2048) u.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); u.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else u.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } let out = ''; for (let i = 0; i < u.length; i += 3) { const b0 = u[i], b1 = u[i + 1], b2 = u[i + 2]; out += B[b0 >> 2]; out += b1 === undefined ? B[(b0 & 3) << 4] + '==' : b2 === undefined ? B[((b0 & 3) << 4) | (b1 >> 4)] + B[(b1 & 15) << 2] + '=' : B[((b0 & 3) << 4) | (b1 >> 4)] + B[((b1 & 15) << 2) | (b2 >> 6)] + B[b2 & 63]; } return out; } function _b64d(b64) { const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CH[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } let s = ''; for (let i = 0; i < bytes.length;) { const b = bytes[i]; if (b < 128) { s += String.fromCharCode(b); i += 1; } else if (b >= 240 && i + 3 < bytes.length) { const cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); const v = cp - 0x10000; s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)); i += 4; } else if (b >= 224 && i + 2 < bytes.length) { s += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3; } else if (b >= 192 && i + 1 < bytes.length) { s += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2; } else { s += String.fromCharCode(b); i += 1; } } return s; }function _des(data, keyStr) { const IP = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7]; const FP = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25]; const PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4]; const PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32]; const EX = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1]; const PP = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25]; const SB = [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13,15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9,10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12,7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14,2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3,12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13,4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12,13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11]; const SH = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]; function permute(bits, table) { const out = []; for (let i = 0; i < table.length; i++) out.push(bits[table[i] - 1]); return out; } function toBits(bytes) { const bits = []; for (let i = 0; i < bytes.length; i++) { for (let j = 7; j >= 0; j--) bits.push((bytes[i] >> j) & 1); } return bits; } function fromBits(bits) { const out = []; for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let b = 0; b < 8; b++) v = (v << 1) | bits[i + b]; out.push(v); } return out; } function utf8(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function toBase64(bytes) { const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CH[b0 >> 2]; s += b1 === undefined ? CH[(b0 & 3) << 4] + '==' : b2 === undefined ? CH[((b0 & 3) << 4) | (b1 >> 4)] + CH[(b1 & 15) << 2] + '=' : CH[((b0 & 3) << 4) | (b1 >> 4)] + CH[((b1 & 15) << 2) | (b2 >> 6)] + CH[b2 & 63]; } return s; } function subkeys(keyBytes) { const pc = permute(toBits(keyBytes), PC1); const C = pc.slice(0, 28); const D = pc.slice(28, 56); const keys = []; for (let r = 0; r < 16; r++) { for (let s = 0; s < SH[r]; s++) { C.push(C.shift()); D.push(D.shift()); } keys.push(permute(C.concat(D), PC2)); } return keys; } function encryptBlock(bytes8, keys) { const bits = permute(toBits(bytes8), IP); let L = bits.slice(0, 32); let R = bits.slice(32, 64); for (let r = 0; r < 16; r++) { const x = permute(R, EX).map((b, i) => b ^ keys[r][i]); const sres = []; for (let i = 0; i < 8; i++) { const e6 = x.slice(i * 6, i * 6 + 6); const row = (e6[0] << 1) | e6[5]; const col = (e6[1] << 3) | (e6[2] << 2) | (e6[3] << 1) | e6[4]; const v = SB[i * 64 + row * 16 + col]; for (let b = 3; b >= 0; b--) sres.push((v >> b) & 1); } const f = permute(sres, PP); const next = L.map((b, i) => b ^ f[i]); L = R; R = next; } return fromBits(permute(R.concat(L), FP)); } const keys = subkeys(utf8(String(keyStr)).slice(0, 8)); const bytes = utf8(String(data)); const pad = 8 - (bytes.length % 8); for (let i = 0; i < pad; i++) bytes.push(pad); const ct = []; for (let i = 0; i < bytes.length; i += 8) ct.push.apply(ct, encryptBlock(bytes.slice(i, i + 8), keys)); return toBase64(ct); } function _u8(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function _b64ToBytes(b64) { const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CH[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function _bytesToB64(bytes) { const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CH[b0 >> 2]; s += b1 === undefined ? CH[(b0 & 3) << 4] + '==' : b2 === undefined ? CH[((b0 & 3) << 4) | (b1 >> 4)] + CH[(b1 & 15) << 2] + '=' : CH[((b0 & 3) << 4) | (b1 >> 4)] + CH[((b1 & 15) << 2) | (b2 >> 6)] + CH[b2 & 63]; } return s; } switch (type) { case 'sha256': return _sha256hex(a); case 'md5': return MD5(a); case 'rsa-sha256': return _rsa(a, b); case 'rsa-enc-pkcs1': return _rsaenc(a, b); case 'hmac-sha256': return _hmac(a, b); case 'aes-cbc': return _aes(a, b, c); case 'aes-ecb': return _aes(a, b, null, true); case 'aes-cbc-ivp': return _aes(a, b, c, false, 2); case 'aes-cbc-dec-iv': return _aesdec(a, b, false, false, c); case 'base64-to-hex': return _b64ToBytes(a).map(x => ('0' + x.toString(16)).slice(-2)).join(''); case 'hex-to-base64': { const _hx = String(a).replace(/[^0-9a-fA-F]/g, ''); const _bs = []; for (let i = 0; i + 1 < _hx.length; i += 2) _bs.push(parseInt(_hx.substr(i, 2), 16)); return _bytesToB64(_bs); } case 'aes-cbc-dec': return _aesdec(a, b, false); case 'aes-ecb-dec': return _aesdec(a, b, true); case 'aes-ecb-dec-hex': return _aesdec(a, b, true, true); case 'base64-encode': return _b64(String(a)); case 'base64-decode': return _b64d(a); case 'des-ecb': return _des(a, b); default: return null; } }
