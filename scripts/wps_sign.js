/**
 * 脚本名称：WPS签到 - 签到
 * 活动规则：每日签到获得积分奖励
 * 脚本说明：支持多账号，支持 NE / Node.js 环境。
 * 环境变量：WPS_COOKIE
 * 更新时间：2026-01-18 更新活动 Code

------------------ Surge 配置 ------------------

[MITM]
hostname = personal-bus.wps.cn, personal-act.wps.cn, account.wps.cn

[Script]
WPS签到获取Cookie = type=http-request,pattern=https:\/\/account\.wps\.cn\/p\/auth\/check,requires-body=1,max-size=0,binary-body-mode=0,timeout=30,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/wps_sign.js,script-update-interval=0

WPS签到 = type=cron,cronexp="0 8 * * *",timeout=60,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/wps_sign.js,script-update-interval=0

------------------- Loon 配置 -------------------

[MITM]
hostname = personal-bus.wps.cn, personal-act.wps.cn, account.wps.cn

[Script]
http-request https:\/\/account\.wps\.cn\/p\/auth\/check tag=WPS签到获取Cookie,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/wps_sign.js,requires-body=1

cron "0 8 * * *" script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/wps_sign.js,tag=WPS签到,enable=true

--------------- Quantumult X 配置 ---------------

[MITM]
hostname = personal-bus.wps.cn, personal-act.wps.cn, account.wps.cn

[rewrite_local]
https:\/\/account\.wps\.cn\/p\/auth\/check url script-request-header https://raw.githubusercontent.com/jy0703/scripts/main/scripts/wps_sign.js

[task_local]
0 8 * * * https://raw.githubusercontent.com/jy0703/scripts/main/scripts/wps_sign.js, tag=WPS签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/images/wps.png, enabled=true

------------------ Stash 配置 ------------------

cron:
  script:
    - name: WPS签到
      cron: '0 8 * * *'
      timeout: 10

http:
  mitm:
    - "personal-bus.wps.cn"
    - "personal-act.wps.cn" 
    - "account.wps.cn"
  script:
    - match: https:\/\/account\.wps\.cn\/p\/auth\/check
      name: WPS签到获取Cookie
      type: request
      require-body: true

script-providers:
  WPS签到:
    url: https://raw.githubusercontent.com/jy0703/scripts/main/scripts/wps_sign.js
    interval: 86400

 */

const $ = new Env('WPS签到');
$.is_debug = getEnv('is_debug') || 'false';  // 调试模式
$.userInfo = getEnv('WPS_COOKIE') || '';  // 获取账号
$.userArr = $.toObj($.userInfo) || [];  // 用户信息
$.Messages = [];


// 主函数
async function main() {
    if ($.userArr.length) {
        $.log(`\n🌀 找到 ${$.userArr.length} 个 Cookie 变量`);

        // 遍历账号
        for (let i = 0; i < $.userArr.length; i++) {
            $.log(`\n----- 账号 [${i + 1}] 开始执行 -----\n`);

            // 初始化
            $.is_login = true;
            $.beforeMsgs = '';
            $.messages = [];
            $.cookie = $.userArr[i];
            $.uid = extractUidFromCookie($.cookie);
            $.act_csrf_token = extractCsrfTokenFromCookie($.cookie);

            if (!$.uid || !$.act_csrf_token) {
                $.log(`❌ Cookie 格式不正确，缺少必要参数\n`);
                continue;
            }

            // 获取公钥
            const publicKey = await getPublicKey();
            if (publicKey) {
                // 执行签到
                await doSign();
            }

            // 完成分享任务
            await doShareTask();

            // 获取抽奖次数并抽奖
            const userInfo = await getUserInfo();
            if (userInfo && userInfo.lottery_times > 0) {
                await doLottery(userInfo.lottery_times);
            }

            // 合并通知
            $.messages.splice(0, 0, $.beforeMsgs), $.Messages = $.Messages.concat($.messages);
        }
        $.log(`\n----- 所有账号执行完成 -----\n`);
    } else {
        throw new Error('未找到 WPS_COOKIE 变量 ❌');
    }
}

// 提取uid
function extractUidFromCookie(cookie) {
    const match = cookie.match(/(?:^|;)\s*uid\s*=\s*([^;]+)/);
    return match ? match[1] : null;
}

// 提取csrf token
function extractCsrfTokenFromCookie(cookie) {
    const match = cookie.match(/(?:^|;)\s*act_csrf_token\s*=\s*([^;]+)/);
    return match ? match[1] : null;
}

// 获取公钥
async function getPublicKey() {
    try {
        const options = {
            url: `https://personal-bus.wps.cn/sign_in/v1/encrypt/key`,
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'origin': 'https://personal-act.wps.cn',
                'referer': 'https://personal-act.wps.cn/',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0'
            }
        
        }

        const response = await Request(options);

        if (response && response.code === 1000000) {
            $.log(`✅ 获取公钥成功\n`);
            return response.data;
        } else {
            $.log(`❌ 获取公钥失败: ${response ? response.msg : '网络错误'}\n`);
            return null;
        }
    } catch (e) {
        $.log(`❌ 获取公钥异常: ${e.message}\n`);
        return null;
    }
}

// 签到
async function doSign() {
    try {
        // 此处需要一个远程服务来处理加密数据，这里简化为直接调用签到接口
        // 实际使用中可能需要类似原Python脚本中的远程加密服务
        const options = {
            url: `https://personal-bus.wps.cn/sign_in/v1/sign_in`,
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'content-type': 'application/json',
                'origin': 'https://personal-act.wps.cn',
                'referer': 'https://personal-act.wps.cn/',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
                'cookie': $.cookie
            },
            body: {
                'userId': parseInt($.uid)
            }
        }

        const response = await Request(options);

        if (response && response.code === 1000000) {
            const rewards = response.data.rewards[0];
            $.log(`✅ 签到成功: ${rewards.reward_name}\n`);
            $.messages.push(`签到成功: ${rewards.reward_name}`);
        } else if (response && response.msg && response.msg.includes('has sign')) {
            $.log(`✅ 今日已签到\n`);
            $.messages.push(`今日已签到`);
        } else {
            $.log(`❌ 签到失败: ${response ? JSON.stringify(response) : '网络错误'}\n`);
        }
    } catch (e) {
        $.log(`❌ 签到异常: ${e.message}\n`);
    }
}

// 完成分享任务
async function doShareTask() {
    try {
        // 完成任务
        const options = {
            url: `https://personal-act.wps.cn/activity-rubik/activity/component_action`,
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'content-type': 'application/json',
                'origin': 'https://personal-act.wps.cn',
                'referer': 'https://personal-act.wps.cn/rubik2/portal/HD2025031821201822/YM2025040908558269?cs_from=web_vipcenter_banner_inpublic&mk_key=4b9deqIfqNO3KCZrgH17WPH1kdzMoKUEvya&position=pc_aty_ban3_kaixue_test_b',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
                'x-act-csrf-token': $.act_csrf_token,
                'cookie': $.cookie
            },
            body: {
                'component_uniq_number': {
                    'activity_number': 'HD2025031821201822',
                    'page_number': 'YM2025040908558269',
                    'component_number': 'ZJ2025040709458367',
                    'component_node_id': 'FN1744160180RthG',
                    'filter_params': {
                        'cs_from': 'web_vipcenter_banner_inpublic',
                        'mk_key': '4b9deqIfqNO3KCZrgH17WPH1kdzMoKUEvya',
                        'position': 'pc_aty_ban3_kaixue_test_b',
                    },
                },
                'component_type': 35,
                'component_action': 'task_center.finish',
                'task_center': {
                    'task_id': 33,
                },
            }
        }

        const finishResponse = await Request(options);

        if (finishResponse && finishResponse.result === 'ok') {
            $.log(`✅ 模拟完成任务成功\n`);
        } else {
            $.log(`❌ 模拟完成任务失败: ${finishResponse ? JSON.stringify(finishResponse) : '网络错误'}\n`);
        }

        // 领取奖励
        const rewardOptions = {
            url: `https://personal-act.wps.cn/activity-rubik/activity/component_action`,
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'content-type': 'application/json',
                'origin': 'https://personal-act.wps.cn',
                'referer': 'https://personal-act.wps.cn/rubik2/portal/HD2025031821201822/YM2025040908558269?cs_from=web_vipcenter_banner_inpublic&mk_key=4b9deqIfqNO3KCZrgH17WPH1kdzMoKUEvya&position=pc_aty_ban3_kaixue_test_b',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
                'x-act-csrf-token': $.act_csrf_token,
                'cookie': $.cookie
            },
            body: {
                'component_uniq_number': {
                    'activity_number': 'HD2025031821201822',
                    'page_number': 'YM2025040908558269',
                    'component_number': 'ZJ2025040709458367',
                    'component_node_id': 'FN1744160180RthG',
                    'filter_params': {
                        'cs_from': 'web_vipcenter_banner_inpublic',
                        'mk_key': '4b9deqIfqNO3KCZrgH17WPH1kdzMoKUEvya',
                        'position': 'pc_aty_ban3_kaixue_test_b',
                    },
                },
                'component_type': 35,
                'component_action': 'task_center.reward',
                'task_center': {
                    'task_id': 33,
                },
            }
        }

        const rewardResponse = await Request(rewardOptions);

        if (rewardResponse && rewardResponse.result === 'ok') {
            $.log(`✅ 领取分享奖励成功\n`);
            $.messages.push(`领取分享奖励成功`);
        } else {
            $.log(`❌ 领取分享奖励失败: ${rewardResponse ? JSON.stringify(rewardResponse) : '网络错误'}\n`);
        }
    } catch (e) {
        $.log(`❌ 完成分享任务异常: ${e.message}\n`);
    }
}

// 获取用户信息
async function getUserInfo() {
    try {
        const options = {
            url: `https://personal-act.wps.cn/activity-rubik/activity/page_info?activity_number=HD2025031821201822&page_number=YM2025040908558269&filter_params=%7B%22cs_from%22:%22web_vipcenter_banner_inpublic%22,%22mk_key%22:%224b9deqIfqNO3KCZrgH17WPH1kdzMoKUEvya%22,%22position%22:%22pc_aty_ban3_kaixue_test_b%22%7D`,
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'referer': 'https://personal-act.wps.cn/rubik2/portal/HD2025031821201822/YM2025040908558269?cs_from=web_vipcenter_banner_inpublic&mk_key=4b9deqIfqNO3KCZrgH17WPH1kdzMoKUEvya&position=pc_aty_ban3_kaixue_test_b',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
                'cookie': $.cookie
            }
        }

        const response = await Request(options);

        if (response && response.result === 'ok') {
            let lotteryTimes = null;
            let userIntegral = null;

            for (const item of response.data) {
                if (lotteryTimes === null) {
                    if (item.type === 45 && item.lottery_v2) {
                        for (const session of item.lottery_v2.lottery_list || []) {
                            if (session.session_id === 2) {
                                lotteryTimes = session.times;
                                break;
                            }
                        }
                    }
                }
                if (userIntegral === null) {
                    if (item.task_center_user_info) {
                        userIntegral = item.task_center_user_info.integral;
                    } else if (item.integral_waterfall) {
                        userIntegral = item.integral_waterfall.user_integral;
                    }
                }
                if (lotteryTimes !== null && userIntegral !== null) {
                    break;
                }
            }

            $.log(`✅ 获取用户信息成功 - UID: ${$.uid}, 积分: ${userIntegral}, 抽奖次数: ${lotteryTimes}\n`);
            $.messages.push(`UID: ${$.uid}, 积分: ${userIntegral}, 抽奖次数: ${lotteryTimes}`);

            return {
                lottery_times: lotteryTimes,
                user_integral: userIntegral
            };
        } else {
            $.log(`❌ 获取用户信息失败: ${response ? JSON.stringify(response) : '网络错误'}\n`);
            return null;
        }
    } catch (e) {
        $.log(`❌ 获取用户信息异常: ${e.message}\n`);
        return null;
    }
}

// 抽奖
async function doLottery(times) {
    try {
        for (let i = 0; i < times; i++) {
            const options = {
                url: `https://personal-act.wps.cn/activity-rubik/activity/component_action`,
                headers: {
                    'sec-ch-ua-platform': '"Windows"',
                    'Referer': 'https://personal-act.wps.cn/rubik2/portal/HD2025031821201822/YM2025040908558269?cs_from=web_vipcenter_banner_inpublic&mk_key=4b9deqIfqNO3KCZrgH17WPH1kdzMoKUEvya&position=pc_aty_ban3_kaixue_test_b',
                    'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Microsoft Edge";v="134"',
                    'sec-ch-ua-mobile': '?0',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
                    'Accept': 'application/json, text/plain, */*',
                    'Content-Type': 'application/json',
                    'X-Act-Csrf-Token': $.act_csrf_token,
                    'cookie': $.cookie
                },
                body: {
                    'component_uniq_number': {
                        'activity_number': 'HD2025031821201822',
                        'page_number': 'YM2025040908558269',
                        'component_number': 'ZJ2025092916516585',
                        'component_node_id': 'FN1762345949vdR1',
                        'filter_params': {
                            'cs_from': 'web_vipcenter_banner_inpublic',
                            'mk_key': '4b9deqIfqNO3KCZrgH17WPH1kdzMoKUEvya',
                            'position': 'pc_aty_ban3_kaixue_test_b',
                        },
                    },
                    'component_type': 45,
                    'component_action': 'lottery_v2.exec',
                    'lottery_v2': {
                        'session_id': 2,
                    },
                }
            }
            const response = await Request(options);

            if (response && response.result === 'ok') {
                const rewardName = response.data.lottery_v2.reward_name;
                $.log(`✅ 第${i+1}次抽奖成功: ${rewardName}\n`);
                $.messages.push(`第${i+1}次抽奖: ${rewardName}`);
            } else {
                $.log(`❌ 第${i+1}次抽奖失败: ${response ? JSON.stringify(response) : '网络错误'}\n`);
            }

            // 抽奖间隔
            await $.wait(2000);
        }
    } catch (e) {
        $.log(`❌ 抽奖异常: ${e.message}\n`);
    }
}

function GetCookie() {
    try {
        let msg = '';
        debug($request.headers, "获取Header");
        
        // 从请求头中获取cookie
        const cookie = $request.headers['Cookie'] || $request.headers['cookie'];
        
        if (cookie) {
            // 从Cookie中提取uid
            const uidMatch = cookie.match(/(?:^|;)\s*uid\s*=\s*([^;]+)/);
            const uid = uidMatch ? uidMatch[1] : null;
            
            if (!uid) {
                $.log(`❌ 无法从Cookie中提取uid`);
                return;
            }
            
            $.log(`✅ 成功获取 Cookie，提取到 UID: ${uid}`);
            
            // 使用 find() 方法找到与 uid 匹配的对象，以新增/更新用户 cookie
            const user = $.userArr.find(user => user.uid === uid);
            if (user) {
                if (user.cookie == cookie) {
                    $.log(`🔄 Cookie未发生变化，无需更新`);
                    return;
                }
                msg += `♻️ 更新用户 [${uid}] Cookie`;
                user.cookie = cookie;
            } else {
                msg += `🆕 新增用户 [${uid}] Cookie`;
                $.userArr.push({ "uid": uid, "cookie": cookie });
            }
            // 写入数据持久化
            $.setdata($.toStr($.userArr), 'WPS_COOKIE');
            $.Messages.push(msg), $.log(msg);
        } else {
            $.log(`❌ 未能从请求头获取Cookie`);
        }
    } catch (e) {
        $.log("❌ Cookie获取失败"), $.log(e);
    }
}

// 脚本执行入口
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
    })

// 请求函数二次封装
async function Request(options) {
    try {
    options = options.url ? options : { url: options };
    const _method = options?._method || options?.method || ('body' in options ? 'post' : 'get');
    const _respType = options?._respType || 'body';
    const _timeout = options?._timeout || 15000;
    // 如果请求方法是post且有body，则将body序列化为JSON字符串
    if ((_method.toLowerCase() === 'post' || _method.toLowerCase() === 'put') && options.body && typeof options.body === 'object') {
        options.body = JSON.stringify(options.body);
        // 设置正确的Content-Type头部
        if (!options.headers) {
            options.headers = {};
        }
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
        })
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


// 获取环境变量
function getEnv(...keys) {
    for (let key of keys) {
        var value = $.isNode() ? process.env[key] || process.env[key.toUpperCase()] || process.env[key.toLowerCase()] || $.getdata(key) : $.getdata(key);
        if (value) return value;
    }
}


/**
 * DEBUG
 * @param {*} content - 传入内容
 * @param {*} title - 标题
 */
function debug(content, title = "debug") {
    let start = `\n----- ${title} -----\n`;
    let end = `\n----- ${$.time('HH:mm:ss')} -----\n`;
    if ($.is_debug === 'true') {
        if (typeof content == "string") {
            $.log(start + content + end);
        } else if (typeof content == "object") {
            $.log(start + $.toStr(content) + end);
        }
    }
}

// prettier-ignore
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }

