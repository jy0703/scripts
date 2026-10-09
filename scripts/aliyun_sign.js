/**
 * 脚本名称：阿里云开发者社区签到 - 社区签到、积分抽奖、文章互动、问答点赞、电子书评价
 * 活动规则：developer.aliyun.com 各社区板块每日签到得积分，积分商城另有点赞/收藏/评论/分享/问答/电子书等每日任务，完成后可领待领取积分
 * 脚本说明：支持多账号，支持 NE / Node.js 环境。Cookie 由本脚本 GetCookie 抓取后存入 aliyun_data
 * 环境变量：aliyun_data、aliyun_time、aliyun_interact、aliyun_cancel、aliyun_debug
 * 备注：Cookie 取自 developer.aliyun.com 站内请求，需在浏览器（或 APP 内嵌页）登录状态下打开"个人中心/积分商城"触发抓取
 * 更新时间：2026-10-10

------------------ Surge 配置 ------------------

[Script]
阿里云社区获取Cookie = type=http-request,pattern=^https?:\/\/developer\.aliyun\.com\/developer\/api\/(my\/user\/getUser|my\/score\/getUserScore|sign\/getSpaceSignInInfo),requires-body=0,max-size=0,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aliyun_sign.js,script-update-interval=0

阿里云社区签到 = type=cron,cronexp="0 7,13 * * *",wake-system=1,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aliyun_sign.js,script-update-interval=0

[MITM]
hostname = developer.aliyun.com

------------------- Loon 配置 -------------------

[Script]
http-request ^https?:\/\/developer\.aliyun\.com\/developer\/api\/(my\/user\/getUser|my\/score\/getUserScore|sign\/getSpaceSignInInfo) script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aliyun_sign.js, timeout=600, tag=阿里云社区获取Cookie

cron "0 7,13 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aliyun_sign.js, timeout=600, tag=阿里云社区签到

[MITM]
hostname = developer.aliyun.com

--------------- Quantumult X 配置 ---------------

[rewrite_local]
^https?:\/\/developer\.aliyun\.com\/developer\/api\/(my\/user\/getUser|my\/score\/getUserScore|sign\/getSpaceSignInInfo) url script-request-header https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aliyun_sign.js

[task_local]
"0 7,13 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aliyun_sign.js, tag=阿里云社区签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/aliyun.png, enabled=true

[MITM]
hostname = developer.aliyun.com

 */

const $ = new Env('阿里云社区签到');
$.is_debug = getEnv('aliyun_debug', 'is_debug') || 'false';  // 调试模式(boxjs 开关 aliyun_debug)
$.userInfo = getEnv('aliyun_data') || '';  // 获取账号
$.userArr = [].concat($.toObj($.userInfo) || []).filter(u => u && u.cookie);  // 用户信息
$.Messages = [];

// 分界时刻：之前做任务，之后领奖+收积分（与原版 aliyunWeb_time 同义）
const splitCfg = parseInt(getEnv('aliyun_time'));
const splitHour = Number.isNaN(splitCfg) ? 12 : Math.min(23, Math.max(0, splitCfg));

// 业务常量
const HOST = 'developer.aliyun.com';
const API = `https://${HOST}/developer/api`;
const UCC = 'https://ucc.aliyun.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// 社区板块：实测只有"我的社区"有签到任务组，其余具名社区对账号回 data=null（白跑 18 次请求），故只留这一个
const COMMUNITIES = [
    { code: '', name: '我的社区' },
];

// 任务行为代码
const ACT = { like: 'aliyun-public-like', favorite: 'aliyun-public-favorite', share: 'aliyun-public-share' };
const ACT_NAME = { [ACT.like]: '点赞', [ACT.favorite]: '收藏', [ACT.share]: '分享' };

// 互动文案
const COMMENT_TEXT = '写的真好，受益匪浅！';
const EBOOK_TEXT = '很棒的一本书，收获很多！';


// 主函数
async function main() {
    if ($.userArr.length) {
        $.log(`\n🌀 找到 ${$.userArr.length} 个账号变量`);

        for (let i = 0; i < $.userArr.length; i++) {
            $.log(`\n----- 账号 [${i + 1}/${$.userArr.length}] 开始执行 -----\n`);

            // 初始化
            $.messages = [];
            $.beforeMsgs = '';
            $.stat = { actCount: 0, acts: [], votes: [], ebooks: [], signs: [], bonuses: [], collected: 0, canceled: 0 };
            $.user = normalizeUser($.userArr[i]);

            if (!await checkLogin($.user)) {
                $.Messages.push(`⚠️ 账号 ${i + 1}: Cookie已失效，请重新抓取`);
                $.log(`❌ 账号 ${i + 1}: Cookie已失效，请重新抓取`);
                continue;
            }

            $.beforeMsgs += `🔹 账号 阿里云社区${i + 1}: ${$.user.userName}`;
            await getScore($.user, '执行前');

            const hour = new Date().getHours();
            const isTaskTime = hour < splitHour;
            $.log(`📝 ${hour} 点, ${isTaskTime ? `任务模式(${splitHour} 点前)` : `领奖模式(${splitHour} 点后)`}`);

            if (isTaskTime) {
                // 1. 各社区签到 + 达标抽奖
                $.log('\n--- 社区签到 ---');
                for (const community of COMMUNITIES) {
                    await signCommunity($.user, community);
                    await $.wait(randDelay());
                }

                // 2. 文章互动 / 问答点赞
                const configured = parseInt(getEnv('aliyun_interact'));
                const rounds = Number.isNaN(configured) ? 5 : Math.max(0, configured);
                $.log(`\n--- 文章互动 (${rounds} 轮) ---`);
                for (let j = 0; j < rounds; j++) {
                    await interactRound($.user, j);
                    await $.wait(randDelay());
                }
                if ($.stat.acts.length) $.messages.push(`\n✅ 文章互动: ${$.stat.acts.join(', ')}`);
                if ($.stat.votes.length) $.messages.push(`✅ 回答点赞: ${$.stat.votes.join(', ')}`);

                // 3. 电子书评价
                $.log('\n--- 电子书评价 ---');
                await doEbook($.user);
            } else {
                // 1. 领取各社区达标奖励
                $.log('\n--- 领取签到奖励 ---');
                for (const community of COMMUNITIES) {
                    await claimBonusOnly($.user, community);
                    await $.wait(randDelay());
                }

                // 2. 一键收取全部待领取积分
                $.log('\n--- 收取积分 ---');
                await collectScore($.user);

                // 3. 取消点赞与收藏（默认关闭，用于释放次日重复完成任务的名额）
                if (getEnv('aliyun_cancel') === 'true') {
                    $.log('\n--- 取消互动 ---');
                    await cancelInteractions($.user);
                }
            }

            // 收积分后服务端有延迟，稍等再读终值，否则"待领取"会显示成收取前的数字
            if (!isTaskTime) await $.wait(3000);
            await getScore($.user, '执行后');

            const bonusText = `抽奖 ${$.stat.bonuses.length} 次(${$.stat.bonuses.reduce((a, b) => a + b.score, 0)}分)`;
            const sum = isTaskTime
                ? `\n📊 签到 ${$.stat.signs.length}/${COMMUNITIES.length} 个社区, ${bonusText}, 互动 ${$.stat.actCount} 次, 回答点赞 ${$.stat.votes.length} 次, 电子书 ${$.stat.ebooks.length} 本`
                : `\n📊 ${bonusText}, 收取待领取 ${$.stat.collected} 积分, 取消互动 ${$.stat.canceled} 项`;
            $.log(sum);
            $.messages.push(`当前积分 ${$.user.score}，待领取 ${$.user.pendingScore}`, sum);
            $.messages.splice(0, 0, $.beforeMsgs);
            $.Messages = $.Messages.concat($.messages);
        }

        $.log(`\n----- 所有账号执行完成 -----\n`);
    } else {
        throw new Error('未找到 aliyun_data 变量 ❌');
    }
}

// 获取Cookie数据 (rewrite 抓取入口, 与头部 http-request 正则配套)
function GetCookie() {
    try {
        if ($request && $request.method === 'OPTIONS') return;

        const header = ObjectKeys2LowerCase($request.headers);
        if (!header.cookie) throw new Error('获取Cookie错误，值为空');
        if (!/login_aliyunid_ticket=[^;]+/.test(header.cookie)) throw new Error('Cookie 中缺少 login_aliyunid_ticket，请先登录开发者社区');

        const newData = {
            'cookie': header.cookie,
            'ua': header['user-agent'] || UA,
            'ticket': (header.cookie.match(/login_aliyunid_ticket=([^;]+)/) || [])[1] || ''
        };

        // ticket 唯一标识账号：isg/tfstk 等风控 cookie 每次都会变，不能整串比对
        const index = $.userArr.findIndex(e => normalizeUser(e).ticket === newData.ticket);
        if (index === -1) {
            $.userArr.push(newData);
            $.setdata($.toStr($.userArr), 'aliyun_data');
            $.Messages.push('🎉获取Cookie成功!');
            $.log('🎉获取Cookie成功!');
        } else {
            $.userArr[index] = newData;
            $.setdata($.toStr($.userArr), 'aliyun_data');
            $.log('🔄 已更新同名账号的 Cookie');
        }
    } catch (e) {
        $.log('❌ Cookie获取失败'), $.log(e);
    }
}

// 账号字段规整
function normalizeUser(item) {
    return {
        cookie: item.cookie || '',
        ua: item.ua || UA,
        ticket: item.ticket || ((item.cookie || '').match(/login_aliyunid_ticket=([^;]+)/) || [])[1] || '',
        userName: item.userName || '',
        userId: item.userId || '',
        score: 0,
        pendingScore: 0
    };
}

// 登录校验
async function checkLogin(user) {
    const result = await api(user, '/my/user/getUser');
    if (!result || result.code === '40001') return false;
    user.userName = result?.data?.userName || user.userName || '未知用户';
    user.userId = result?.data?.userId || user.userId || '';
    $.log(`👤 ${user.userName}`);
    return true;
}

// 积分
async function getScore(user, label) {
    const [total, pending] = await Promise.all([
        api(user, '/my/score/getUserScore', { params: { appCode: 'developer' } }),
        api(user, '/score/pending/getUserTotalPendingScore', { params: { appCode: 'developer' } })
    ]);
    if (typeof total?.data === 'number') user.score = total.data;
    if (typeof pending?.data === 'number') user.pendingScore = pending.data;
    $.log(`📝 ${label}积分: ${user.score}，待领取: ${user.pendingScore}`);
}

// 单个社区：签到 + 达标抽奖
async function signCommunity(user, community) {
    const taskGroupId = await getTaskGroupId(user, community);
    if (!taskGroupId) return;

    const task = await getSignInTask(user, taskGroupId);
    if (task) {
        const result = await api(user, '/task/actionLog', { form: task });
        if (result?.code === '200' || result?.message?.includes('成功')) {
            $.stat.signs.push(community.name);
            $.log(`✅ 签到 - ${community.name}: 成功`);
        } else {
            $.log(`❌ 签到 - ${community.name}: ${result?.message || $.toStr(result)}`);
        }
    } else {
        $.log(`📝 签到 - ${community.name}: 任务不在有效期`);
    }

    await claimBonus(user, community, taskGroupId);
}

// 只领达标奖励（分界后的领奖模式用）
async function claimBonusOnly(user, community) {
    const taskGroupId = await getTaskGroupId(user, community, '领奖');
    if (!taskGroupId) return;
    await claimBonus(user, community, taskGroupId);
}

async function getTaskGroupId(user, community, label = '签到') {
    const detail = await api(user, '/sign/getUserSpaceSignInDetail', { params: { excode: community.code } });
    const taskGroupId = detail?.data?.taskGroupId;
    if (!taskGroupId) $.log(`📝 ${label} - ${community.name}: 无签到任务`);
    return taskGroupId || null;
}

async function claimBonus(user, community, taskGroupId) {
    const qualified = await api(user, '/sign/assessSignInBonusQualification', { params: { taskGroupId } });
    if (qualified?.data !== true) {
        $.log(`📝 抽奖 - ${community.name}: ${qualified?.message || '未达标'}`);
        return;
    }
    const bonus = await api(user, '/sign/receiveSignInBonus', { form: { taskGroupId } });
    if (bonus?.code === '200') {
        const score = Number(bonus?.data) || 0;
        $.stat.bonuses.push({ name: community.name, score });
        $.log(`🎁 抽奖 - ${community.name}: 获得 ${score} 积分`);
        $.messages.push(`🎁 抽奖 ${community.name}: ${score} 积分`);
    } else {
        $.log(`❌ 抽奖 - ${community.name}: ${bonus?.message || $.toStr(bonus)}`);
    }
}

// 一键收取全部待领取积分
async function collectScore(user) {
    const result = await api(user, '/score/pending/receiveAllPendingScore', { params: { appCode: 'developer' } });
    if (result?.code === '200' || result?.success) {
        $.stat.collected = Number(result?.data) || 0;
        $.log(`✅ 收取积分: ${$.stat.collected}`);
        $.messages.push(`✅ 收取积分: ${$.stat.collected}`);
    } else {
        $.log(`❌ 收取积分: ${result?.message || $.toStr(result)}`);
    }
}

// 取任务组内当前有效的签到任务参数（finishRule 为 HTML 转义后的 JSON）
async function getSignInTask(user, taskGroupId) {
    const result = await api(user, '/task/getTaskGroup', { params: { groupId: taskGroupId } });
    const taskList = result?.data?.taskList || [];
    const now = Date.now();

    for (const task of taskList) {
        const start = task.gmtEnableStart || task.gmtStart || task.startTime;
        const end = task.gmtEnableEnd || task.gmtEnd || task.endTime;
        if (start && end && (now < start || now > end)) continue;

        const rule = $.toObj((task.finishRule || '').replace(/&quot;/g, '"'), null);
        const action = rule?.actions?.[0];
        if (!action?.actionCode) continue;

        return { actionCode: action.actionCode, activityCode: action.activityCode || action.actionCode, objectId: action.objectId || '' };
    }
    return null;
}

// 一轮文章互动（点赞+收藏，首轮附加评论与分享）+ 问答点赞
async function interactRound(user, round) {
    const articleId = pickOne(await scanIds(user, `https://${HOST}/group/aliware/article_hot`, { pageNum: rand(1, 30) }, /data-id="(\d+)"/g));
    if (articleId) {
        const done = [];
        for (const action of [ACT.like, ACT.favorite]) {
            if (await uccAction(user, articleId, action)) {
                $.stat.actCount++;
                done.push(ACT_NAME[action]);
                $.log(`✅ 文章${ACT_NAME[action]}: ${articleId}`);
            } else {
                $.log(`❌ 文章${ACT_NAME[action]}: ${articleId} 失败`);
            }
            await $.wait(randDelay());
        }
        if (round === 0) {
            if (await uccComment(user, articleId)) {
                $.stat.actCount++;
                done.push('评论');
                $.log(`✅ 文章评论: ${articleId}`);
            }
            await $.wait(randDelay());
            if (await uccAction(user, articleId, ACT.share)) {
                $.stat.actCount++;
                done.push('分享');
                $.log(`✅ 文章分享: ${articleId}`);
            }
        }
        if (done.length && !$.stat.acts.includes(articleId)) $.stat.acts.push(articleId);
    } else {
        $.log('📝 文章互动: 未取到文章id，跳过');
    }

    await voteAnswer(user);
}

// 问答：随机问题 → 随机回答 → 点赞
async function voteAnswer(user) {
    const csrf = await getCsrf(user, `${HOST}/ask/`);
    if (!csrf) {
        $.log('📝 问答点赞: 未取到 p_csrf，跳过');
        return;
    }

    for (let i = 0; i < 3; i++) {
        const asks = await scanAsks(user);
        if (!asks.length) continue;

        const ask = asks[rand(0, asks.length - 1)];
        const answerId = pickOne(await scanIds(user, `https://${HOST}/ask/${ask.id}`, {}, /class="answer-item"[^>]*data-id="(\d+)"/g));
        if (!answerId) {
            $.log(`📝 问答点赞: 问题 ${ask.id} 取不到回答，换一个`);
            continue;
        }

        const result = await api(user, '/my/ask/voteAnswer', {
            params: { p_csrf: csrf },
            form: { id: answerId, votes: 1 },
            referer: `https://${HOST}/ask/${ask.id}`
        });
        if (result?.code === '200' || result?.success) {
            const pair = `${ask.id}-${answerId}`;
            if (!$.stat.votes.includes(pair)) $.stat.votes.push(pair);
            $.log(`✅ 回答点赞: ${pair}(${ask.name})`);
        } else {
            $.log(`❌ 回答点赞: ${result?.message || $.toStr(result)}`);
        }
        return;
    }
    $.log('📝 问答点赞: 没找到可点赞的回答，跳过');
}

// 问答列表：一问题常无人回答（点了不计数），按条目里的回答数过滤
// 列表页 /ask 会 301 到 /ask/，NE 里默认不跟随重定向，必须带尾斜杠
async function scanAsks(user) {
    const url = `https://${HOST}/ask/?pageNum=${rand(1, 30)}`;
    const html = await Request({ url, headers: baseHeaders(user, `https://${HOST}/ask/`), _raw: true });
    if (typeof html !== 'string') return [];
    const asks = [...html.split(/class="askProduct-item"/).slice(1)]
        .map(block => ({
            id: (block.match(/data-id="(\d+)"/) || [])[1] || '',
            answers: parseInt((block.match(/askProduct-item-info-answer[^>]*>\s*(\d+)/) || [])[1] || '0') || 0,
            name: ((block.match(/askProduct-item-title-text[^>]*>\s*<h3[^>]*>([^<]+)</) || [])[1] || '').trim()
        }))
        .filter(x => x.id && x.answers > 0);
    if (!asks.length) $.log('📝 问答点赞: 该页问题均无回答，换页');
    return asks;
}


// 电子书评价
async function doEbook(user) {
    const ebookId = pickOne(await scanIds(user, `https://${HOST}/ebook/index/__0_0_0_${rand(1, 500)}`, {}, /href="\/ebook\/(\d+)"/g));
    if (!ebookId) {
        $.log('📝 电子书评价: 未取到电子书id，跳过');
        return;
    }

    const csrf = await getCsrf(user, `${HOST}/ebook/${ebookId}`);
    const result = await api(user, '/ebook/mark/add', {
        params: { p_csrf: csrf },
        json: { eBookId: ebookId, score: 10, content: EBOOK_TEXT },
        referer: `https://${HOST}/ebook/${ebookId}`
    });
    if (result?.code === '200' || result?.success) {
        if (!$.stat.ebooks.includes(ebookId)) $.stat.ebooks.push(ebookId);
        $.log(`✅ 电子书评价: ${ebookId}`);
    } else {
        $.log(`❌ 电子书评价: ${result?.message || $.toStr(result)}`);
    }
}

// 取消收藏与点赞
async function cancelInteractions(user) {
    const result = await api(user, '/my/subscribe/listUserFavor', { params: { pageNum: 1, pageSize: 10, type: 1 } });
    const list = result?.data?.list || [];
    if (!list.length) {
        $.log('📝 取消互动: 收藏列表为空');
        return;
    }
    $.log('✅ 开始取消文章的点赞与收藏记录');
    for (const item of list) {
        const objectId = item.objectId;
        if (!objectId) continue;
        for (const action of [ACT.like, ACT.favorite]) {
            await uccAction(user, objectId, action, true);
            $.log(`📝 取消${ACT_NAME[action]}: ${objectId}`);
            await $.wait(randDelay());
        }
        $.stat.canceled++;
    }
}

// ---------- 接口封装 ----------

// 社区 API：GET / POST(form) / POST(json) 三态
async function api(user, path, opts = {}) {
    const url = path.startsWith('http') ? path : API + path;
    const options = { url, headers: baseHeaders(user, opts.referer || `https://${HOST}/`) };

    if (opts.params) options.url = `${url}?${buildQuery(opts.params)}`;

    if (opts.form) {
        options._method = 'post';
        options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        options.body = $.queryStr(opts.form);
    } else if (opts.json) {
        options._method = 'post';
        options.headers['Content-Type'] = 'application/json';
        options.body = opts.json;
    }

    const result = await Request(options);
    if (result?.code === '40001') $.log('⚠️ 接口返回未登录，Cookie 可能已失效');
    return result;
}

// ucc 组件接口（JSONP）：点赞/收藏/分享
async function uccAction(user, objectId, actionCode, cancel = false) {
    const token = await getUccCsrf(user);
    const url = `${UCC}/uccPagingComponent/likeOrNotLike?${$.queryStr({
        bizCategory: 'yq-article',
        actionCode,
        objectId,
        status: cancel ? 1 : 0,
        uccCsrfToken: token,
        callback: jsonpCallback()
    })}`;
    const result = await jsonp({ url, headers: baseHeaders(user, `https://${HOST}/`) });
    return result?.code === '200' || result?.success === true;
}

// ucc 组件接口（JSONP）：评论
async function uccComment(user, objectId) {
    const token = await getUccCsrf(user);
    const url = `${UCC}/uccPagingComponent/addComment?${$.queryStr({
        content: encodeURIComponent(COMMENT_TEXT),
        objectId,
        bizCategory: 'developer-ecology',
        commentType: 0,
        sourceAppCode: 'aliyun',
        sourceBizCategory: 'developer-ecology-group',
        uccCsrfToken: token,
        callback: jsonpCallback()
    })}`;
    const result = await jsonp({ url, headers: baseHeaders(user, `https://${HOST}/`) });
    return result?.code === '200' || result?.success === true;
}

// ucc 组件 csrf（与 developer 站的 p_csrf 不是同一套）
async function getUccCsrf(user) {
    const result = await jsonp({ url: `${UCC}/uccPagingComponent/getUser?callback=${jsonpCallback()}`, headers: baseHeaders(user, `https://${HOST}/`) });
    return result?.uccCsrfToken || result?.data?.uccCsrfToken || '';
}

// developer 站 p_csrf（挂在 cookie 的 c_csrf 上，需带 Cookie 请求）
async function getCsrf(user, refererHostPath) {
    const result = await Request({ url: `https://${HOST}/csrfToken`, headers: baseHeaders(user, `https://${refererHostPath}`) });
    return result?.token || '';
}

// 与 $.queryStr 不同，空串参数也保留（社区签到 excode 为空即"我的社区"）
function buildQuery(params) {
    return Object.keys(params).map(k => `${k}=${params[k] === undefined || params[k] === null ? '' : params[k]}`).join('&');
}

// JSONP：响应形如 /**/cb_xxx({...})
async function jsonp(options) {
    const body = await Request({ ...options, _respType: 'body', _raw: true });
    if (typeof body !== 'string') return body || null;
    const start = body.indexOf('(');
    const end = body.lastIndexOf(')');
    if (start < 0 || end <= start) return null;
    return $.toObj(body.slice(start + 1, end), null);
}

// 从页面 HTML 里取出全部候选 id（去重，供轮换）
async function scanIds(user, base, params, re) {
    const url = params && Object.keys(params).length ? `${base}?${buildQuery(params)}` : base;
    const html = await Request({ url, headers: baseHeaders(user, `https://${HOST}/`), _raw: true });
    if (typeof html !== 'string') return [];
    return [...new Set([...html.matchAll(re)].map(m => m[1]))];
}

function pickOne(ids) {
    return ids.length ? ids[rand(0, ids.length - 1)] : null;
}

function baseHeaders(user, referer) {
    return {
        'Cookie': user.cookie,
        'User-Agent': user.ua || UA,
        'Referer': referer,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9'
    };
}

function jsonpCallback() {
    const chars = '0123456789abcdef';
    let s = 'jQuery';
    for (let i = 0; i < 20; i++) s += chars[Math.floor(Math.random() * 16)];
    return `${s}_${Date.now()}`;
}

function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randDelay() {
    return rand(1000, 3000);
}

// ---------- 工具函数 ----------

// key 转小写 (抓包头大小写不定)
function ObjectKeys2LowerCase(obj = {}) { return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v])); }

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

// 请求函数二次封装；_raw=true 时返回原始字符串（HTML / JSONP）
async function Request(options) {
    try {
        options = options.url ? options : { url: options };
        const _method = options?._method || options?.method || ('body' in options ? 'post' : 'get');
        const _respType = options?._respType || 'body';
        const _timeout = options?._timeout || 20000;

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
                    const raw = response?.body !== undefined ? response.body : data;
                    if (options._raw) {
                        resolve(raw);
                    } else if (_respType !== 'all') {
                        resolve($.toObj(raw, raw));
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

