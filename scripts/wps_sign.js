/**
 * 脚本名称：WPS签到 - 签到
 * 活动规则：每日签到获得积分奖励
 * 脚本说明：支持多账号，支持 NE / Node.js 环境。
 * 环境变量：WPS_COOKIE
 * 更新时间：2026-02-05 添加了办公助手、天天领福利、WPS超级会员小程序功能

------------------ Surge 配置 ------------------

[MITM]
hostname = personal-act.wps.cn

[Script]
WPS签到获取Cookie = type=http-request,pattern=https:\/\/personal-act\.wps\.cn\/activity-rubik\/activity\/component_action,requires-body=1,max-size=0,binary-body-mode=0,timeout=30,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/wps_sign.js,script-update-interval=0

WPS签到 = type=cron,cronexp="0 8 * * *",timeout=60,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/wps_sign.js,script-update-interval=0

------------------- Loon 配置 -------------------

[MITM]
hostname = personal-act.wps.cn

[Script]
http-request https:\/\/personal-act\.wps\.cn\/activity-rubik\/activity\/component_action tag=WPS签到获取Cookie,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/wps_sign.js,requires-body=1

cron "0 8 * * *" script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/wps_sign.js,tag=WPS签到,enable=true

--------------- Quantumult X 配置 ---------------

[MITM]
hostname = personal-act.wps.cn

[rewrite_local]
https:\/\/personal-act\.wps\.cn\/activity-rubik\/activity\/component_action url script-request-header https://raw.githubusercontent.com/jy0703/scripts/main/scripts/wps_sign.js

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
    - match: https:\/\/personal-act\.wps\.cn\/activity-rubik\/activity\/component_action
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
            $.cookie = $.userArr[i].cookie;  // 从对象中提取cookie字符串
            $.uid = extractUidFromCookie($.userArr[i]);
            $.act_csrf_token = extractCsrfTokenFromCookie($.userArr[i]);

            if (!$.uid || !$.act_csrf_token) {
                $.log(`❌ Cookie 格式不正确，缺少必要参数\n`);
                continue;
            }

            // WPS任务中心
            await doSign()

            // 执行所有任务（替代原有的doShareTask）
            await doAllTasks();

            // 获取抽奖次数并抽奖
            const userInfo = await getUserInfo();
            if (userInfo && userInfo.lottery_times > 0) {
                await doLottery(userInfo.lottery_times);
            }
            
            // 办公助手
            await doFragmentCollectTasks();
            
            // 天天领福利
            await doLottery3Tasks();
            
            // WPS超级会员小程序
            await doSvipAppletSign();

            // 合并通知
            $.messages.splice(0, 0, $.beforeMsgs), $.Messages = $.Messages.concat($.messages);
        }
        $.log(`\n----- 所有账号执行完成 -----\n`);
    } else {
        throw new Error('未找到 WPS_COOKIE 变量 ❌');
    }
}

// 提取uid
function extractUidFromCookie(cookieObj) {
    // 如果cookie是对象，从中提取cookie字符串
    const cookieString = typeof cookieObj === 'string' ? cookieObj : cookieObj.cookie;
    if (!cookieString) return null;
    
    const match = cookieString.match(/(?:^|;)\s*uid\s*=\s*([^;]+)/);
    return match ? match[1] : null;
}

// 提取csrf token
function extractCsrfTokenFromCookie(cookieObj) {
    // 如果cookie是对象，从中提取cookie字符串
    const cookieString = typeof cookieObj === 'string' ? cookieObj : cookieObj.cookie;
    if (!cookieString) return null;
    
    const match = cookieString.match(/(?:^|;)\s*act_csrf_token\s*=\s*([^;]+)/);
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
                'priority': 'u=1, i',
                'referer': 'https://personal-act.wps.cn/',
                'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Microsoft Edge";v="134"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-site',
                'cookie': $.cookie,
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
        // 首先获取签到所需的加密参数
        const publicKey = await getPublicKey();
        if (!publicKey) {
            $.log(`❌ 获取公钥失败，无法进行签到\n`);
            return;
        }

        // 通过远程服务获取签到参数
        const signParams = await getSignParams(publicKey);
        if (!signParams) {
            $.log(`❌ 获取签到参数失败，无法进行签到\n`);
            return;
        }

        const options = {
            url: `https://personal-bus.wps.cn/sign_in/v1/sign_in`,
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'content-type': 'application/json',
                'origin': 'https://personal-act.wps.cn',
                'referer': 'https://personal-act.wps.cn/',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
                'cookie': $.cookie,
                'token': signParams.token  // 使用远程服务返回的token
            },
            body: signParams.data  // 使用远程服务返回的数据
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

// 获取签到参数
async function getSignParams(encryptData) {
    try {
        const params = {
            'encryptData': encryptData,
            'userId': parseInt($.uid),
        };

        const options = {
            url: `https://py.leishennb.icu/v1/rnl-2-gather/get-wps-publickey`,
            headers: {
                'accept': '*/*',
                'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'content-type': 'application/json',
                'origin': 'https://personal-act.wps.cn',
                'referer': 'https://personal-act.wps.cn/',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
                'cookie': $.cookie
            },
            body: params
        }

        const response = await Request(options);

        if (response && response.code === 200) {  // 修改成功状态码为200
            $.log(`✅ 获取签到参数成功\n`);
            return response.data;  // 返回token和data
        } else {
            $.log(`❌ 获取签到参数失败: ${response ? JSON.stringify(response) : '网络错误'}\n`);
            return null;
        }
    } catch (e) {
        $.log(`❌ 获取签到参数异常: ${e.message}\n`);
        return null;
    }
}

// 通用完成任务
async function doCommonTask(taskId, title, componentAction = 'task_center.finish') {
    try {
        const options = {
            url: `https://personal-act.wps.cn/activity-rubik/activity/component_action`,
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'content-type': 'application/json',
                'origin': 'https://personal-act.wps.cn',
                'referer': 'https://personal-act.wps.cn/rubik2/portal/HD2025031821201822/YM2025040908558269?cs_from=web_vipcenter_banner_inpublic&mk_key=4b9deqIfqNO3KCZrgH17WPH1kdzMoKUEvya&position=pc_aty_ban3_kaixue_test_b',
                'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Microsoft Edge";v="134"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
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
                'component_action': componentAction,
                'task_center': {
                    'task_id': taskId,
                },
            }
        }

        const response = await Request(options);

        if (response && response.result === 'ok') {
            const taskCenter = response.data?.task_center;
            if (taskCenter?.success) {
                $.log(`✅ 完成任务 [${title}] 成功\n`);
                return taskCenter.token || true;
            } else {
                const reason = taskCenter?.reason || '未知原因';
                $.log(`❌ 完成任务 [${title}] 失败：${reason}\n`);
                return false;
            }
        } else {
            $.log(`❌ 完成任务 [${title}] 失败：${response ? JSON.stringify(response) : '网络错误'}\n`);
            return false;
        }
    } catch (e) {
        $.log(`❌ 完成任务 [${title}] 异常: ${e.message}\n`);
        return false;
    }
}

// 通用领取奖励
async function claimReward(taskId, title) {
    try {
        const options = {
            url: `https://personal-act.wps.cn/activity-rubik/activity/component_action`,
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'content-type': 'application/json',
                'origin': 'https://personal-act.wps.cn',
                'referer': 'https://personal-act.wps.cn/rubik2/portal/HD2025031821201822/YM2025040908558269?cs_from=web_vipcenter_banner_inpublic&mk_key=4b9deqIfqNO3KCZrgH17WPH1kdzMoKUEvya&position=pc_aty_ban3_kaixue_test_b',
                'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Microsoft Edge";v="134"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
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
                    'task_id': taskId,
                },
            }
        }

        const response = await Request(options);

        if (response && response.result === 'ok') {
            const taskCenter = response.data?.task_center;
            if (taskCenter?.success) {
                $.log(`✅ 领取 [${title}] 奖励成功\n`);
                return true;
            } else {
                const reason = taskCenter?.reason || '未知原因';
                $.log(`❌ 领取 [${title}] 奖励失败：${reason}\n`);
                return false;
            }
        } else {
            $.log(`❌ 领取 [${title}] 奖励失败：${response ? JSON.stringify(response) : '网络错误'}\n`);
            return false;
        }
    } catch (e) {
        $.log(`❌ 领取 [${title}] 奖励异常: ${e.message}\n`);
        return false;
    }
}

// 获取任务信息（用于浏览任务）
async function getTaskInfo(token) {
    try {
        const startTime = Math.floor(Date.now()/1000)*1000;
        const options = {
            url: `https://personal-act.wps.cn/activity-rubik/user/task_center/task_info?batch_tag=${startTime}&token=${token}`,
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'priority': 'u=1, i',
                'referer': 'https://personal-act.wps.cn/rubik2/portal/HD2025091109421588/YM2025091121369865?cs_from=android_ucsty_rwzx&positon=ad_rwzx_task',
                'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Microsoft Edge";v="134"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
                'cookie': $.cookie
            }
        }

        const response = await Request(options);

        if (response && response.result === 'ok') {
            return startTime + response.data.start_at;
        } else {
            $.log(`❌ 获取任务信息失败：${response ? JSON.stringify(response) : '网络错误'}\n`);
            return null;
        }
    } catch (e) {
        $.log(`❌ 获取任务信息异常: ${e.message}\n`);
        return null;
    }
}

// 完成浏览任务
async function doBrowseTask(taskId, title) {
    try {
        // 开始任务
        const token = await doCommonTask(taskId, title, 'task_center.start');
        if (!token) {
            $.log(`❌ 浏览任务 [${title}] 启动失败\n`);
            return false;
        }

        // 获取任务信息
        const batchTag = await getTaskInfo(token);
        if (!batchTag) {
            $.log(`❌ 获取浏览任务信息失败，跳过\n`);
            return false;
        }

        // 等待一段时间（模拟浏览）
        await $.wait(11000); // 等待11秒

        // 完成浏览任务
        const browseFinishResult = await finishBrowseTask(token, title, batchTag);
        if (browseFinishResult) {
            // 领取奖励
            await $.wait(1000);
            await claimReward(taskId, title);
        }
        
        await $.wait(2000);
        return browseFinishResult;
    } catch (e) {
        $.log(`❌ 完成浏览任务 [${title}] 异常: ${e.message}\n`);
        return false;
    }
}

// 完成浏览任务提交
async function finishBrowseTask(token, title, batchTag) {
    try {
        const options = {
            url: `https://personal-act.wps.cn/activity-rubik/user/task_center/task_finish`,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                'sec-ch-ua-platform': '"Windows"',
                'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Microsoft Edge";v="134"',
                'sec-ch-ua-mobile': '?0',
                'origin': 'https://personal-act.wps.cn',
                'sec-fetch-site': 'same-origin',
                'sec-fetch-mode': 'cors',
                'sec-fetch-dest': 'empty',
                'referer': 'https://personal-act.wps.cn/rubik2/portal/HD2025031721339450/YM2025031721331326?cs_from=ad_ucsty_rwzx&position=ad_ucsty_rwzx',
                'accept-language': 'zh-CN,zh;q=0.9',
                'priority': 'u=1, i',
                'cookie': $.cookie
            },
            body: {
                'batch_tag': batchTag,
                'token': token,
            }
        }

        const response = await Request(options);

        if (response && response.result === 'ok') {
            $.log(`✅ 任务 [${title}] 浏览完成\n`);
            return true;
        } else {
            $.log(`❌ 任务 [${title}] 浏览失败：${response ? JSON.stringify(response) : '网络错误'}\n`);
            return false;
        }
    } catch (e) {
        $.log(`❌ 任务 [${title}] 浏览异常: ${e.message}\n`);
        return false;
    }
}

// 执行所有任务
async function doAllTasks() {
    // 获取任务列表
    const pageInfo = await getUserInfo();
    if (!pageInfo || !pageInfo.task_list) {
        $.log(`❌ 获取任务列表失败\n`);
        return;
    }

    const taskList = pageInfo.task_list;
    $.log(`✅ 获取到 ${taskList.length} 个任务\n`);

    for (const task of taskList) {
        const taskId = task.task_id;
        const title = task.title;
        const taskStatus = task.task_status;

        if (taskStatus === 2) {
            $.log(`🔄 任务 [${title}] 已完成\n`);
            continue;
        }

        // 检查是否是浏览任务
        if (title.includes('浏览')) {
            await doBrowseTask(taskId, title);
            continue;
        }

        // 检查是否需要跳过的任务
        const skipKeywords = ['消费', '邀请', '微博', '苏宁易购', '开通会员'];
        if (skipKeywords.some(keyword => title.includes(keyword))) {
            $.log(`⏭️ 跳过任务 [${title}]\n`);
            continue;
        }

        // 完成普通任务
        const taskResult = await doCommonTask(taskId, title);
        if (taskResult) {
            await $.wait(1000);
            await claimReward(taskId, title);
        }
        await $.wait(2000);
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
            let taskList = null;

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
                if (taskList === null) {
                    if (item.task_center) {
                        taskList = item.task_center.task_list;
                    }
                }
                if (lotteryTimes !== null && userIntegral !== null && taskList !== null) {
                    break;
                }
            }

            $.log(`✅ 获取用户信息成功 - UID: ${$.uid}, 积分: ${userIntegral}, 抽奖次数: ${lotteryTimes}\n`);
            // $.messages.push(`UID: ${hideSensitiveData($.uid,2,2)}, 积分: ${userIntegral}, 抽奖次数: ${lotteryTimes}`);

            return {
                lottery_times: lotteryTimes,
                user_integral: userIntegral,
                task_list: taskList
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

// WPS超级会员小程序签到
async function doSvipAppletSign() {
    try {
        const options = {
            url: `https://personal-bus.wps.cn/activity/clock_in/v1/clock_in`,
            headers: {
                'Host': 'personal-bus.wps.cn',
                'Connection': 'keep-alive',
                'date': 'Tue, 20 Jan 2026 14:42:58 GMT',
                'charset': 'utf-8',
                'signature': '0d8ff00f5c74de36d0b2e677c82b22a1dd5ab196b0d227cc875fb051eec50156',
                'x-csrftoken': '1234567890',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 14; 23117RK66C Build/UKQ1.230804.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.7444.173 Mobile Safari/537.36 XWEB/1420153 MMWEBSDK/20240404 MMWEBID/3531 MicroMessenger/8.0.49.2600(0x2800313D) WeChat/arm64 Weixin Android Tablet NetType/WIFI Language/zh_CN ABI/arm64 MiniProgramEnv/android',
                'content-type': 'application/json',
                'Referer': 'https://servicewechat.com/wx2f333d84a103825d/240/page-frame.html',
                'cookie': $.cookie
            },
            body: {"client_type": 1}
        };

        const response = await Request(options);

        if (response && response.result === 'ok') {
            $.log(`✅ 小程序签到成功\n`);
            $.messages.push(`小程序签到成功`);
        } else if (response && response.msg && response.msg.includes('already clocked in today')) {
            $.log(`✅ 小程序今日已签到\n`);
            $.messages.push(`小程序今日已签到`);
        } else {
            $.log(`❌ 小程序签到失败: ${response ? JSON.stringify(response) : '网络错误'}\n`);
        }
    } catch (e) {
        $.log(`❌ 小程序签到异常: ${e.message}\n`);
    }
}

// 办公助手任务
async function doFragmentCollectTasks() {
    try {
        // 获取活动信息
        const pageInfoOptions = {
            url: `https://personal-act.wps.cn/activity-rubik/activity/page_info?activity_number=HD2025031010408781&page_number=YM2025061216463517&filter_params=%7B%22cs_from%22:%22xinchao_activity_lottery%22,%22position%22:%22xinchao_bgzs_autoreply_2148_cj%22%7D`,
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'referer': 'https://personal-act.wps.cn/rubik2/portal/HD2025031010408781/YM2025061216463517?cs_from=xinchao_activity_lottery&position=xinchao_bgzs_autoreply_2148_cj',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
                'cookie': $.cookie
            }
        };

        const pageInfoResponse = await Request(pageInfoOptions);

        if (pageInfoResponse && pageInfoResponse.result === 'ok') {
            let taskList = null;
            let lotteryTimes = null;

            for (const item of pageInfoResponse.data) {
                if (item.task_center && item.task_center.task_list) {
                    taskList = item.task_center.task_list;
                }
                
                if (item.lottery && item.lottery.rewards && Array.isArray(item.lottery.rewards) && item.lottery.rewards.length > 0) {
                    const firstReward = item.lottery.rewards[0];
                    if (firstReward.times !== undefined) {
                        lotteryTimes = firstReward.times;
                    }
                }
                
                if (taskList !== null && lotteryTimes !== null) {
                    break;
                }
            }

            $.log(`✅ 办公助手 - 获取到 ${taskList ? taskList.length : 0} 个任务, 抽奖次数: ${lotteryTimes}\n`);
            
            // 完成任务
            if (taskList) {
                await doFragmentCollectTaskList(taskList);
            }
            
            // 抽奖
            if (lotteryTimes > 0) {
                await doFragmentCollectLottery(lotteryTimes);
            }
        } else {
            $.log(`❌ 获取办公助手活动信息失败: ${pageInfoResponse ? JSON.stringify(pageInfoResponse) : '网络错误'}\n`);
        }
    } catch (e) {
        $.log(`❌ 办公助手任务异常: ${e.message}\n`);
    }
}

// 办公助手任务列表处理
async function doFragmentCollectTaskList(taskList) {
    // 先处理"每日访问当前活动"任务
    for (const task of taskList) {
        const taskId = task.task_id;
        const title = task.title;
        const taskStatus = task.task_status;

        if (taskStatus === 1 && title.includes('每日访问当前活动')) {
            const rewardResult = await doFragmentCollectReward(taskId, title);
            if (rewardResult) {
                await $.wait(2000);
            }
            break; // 只处理这一个任务
        }
    }

    // 再处理其他任务
    for (const task of taskList) {
        const taskId = task.task_id;
        const title = task.title;
        const taskStatus = task.task_status;

        if (taskStatus === 1) {
            $.log(`🔄 任务 [${title}] 已完成\n`);
            continue;
        }

        if (title.includes('每日访问当前活动')) {
            continue; // 跳过上面已经处理过的任务
        }

        const rewardResult = await doFragmentCollectReward(taskId, title);
        if (rewardResult) {
            await $.wait(2000);
        }
    }
}

// 办公助手领取奖励
async function doFragmentCollectReward(taskId, title) {
    try {
        const options = {
            url: `https://personal-act.wps.cn/activity-rubik/activity/component_action`,
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'content-type': 'application/json',
                'origin': 'https://personal-act.wps.cn',
                'referer': 'https://personal-act.wps.cn/rubik2/portal/HD2025031010408781/YM2025061216463517?cs_from=xinchao_activity_lottery&position=xinchao_bgzs_autoreply_2148_cj',
                'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Microsoft Edge";v="134"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
                'cookie': $.cookie
            },
            body: {
                'component_uniq_number': {
                    'activity_number': 'HD2025031010408781',
                    'page_number': 'YM2025061216463517',
                    'component_number': 'ZJ2024083022083755',
                    'component_node_id': 'FN1740387182DaYX'
                },
                'component_type': 14,
                'component_action': 'task_center.reward',
                'task_center': {
                    'task_id': taskId
                }
            }
        };

        const response = await Request(options);

        if (response && response.result === 'ok') {
            const taskCenter = response.data?.task_center;
            if (taskCenter?.success) {
                $.log(`✅ 领取 [${title}] 奖励成功\n`);
                return true;
            } else {
                const reason = taskCenter?.reason;
                $.log(`❌ 领取 [${title}] 奖励失败：已领取\n`);
                return false;
            }
        } else {
            $.log(`❌ 领取 [${title}] 奖励失败：${response ? JSON.stringify(response) : '网络错误'}\n`);
            return false;
        }
    } catch (e) {
        $.log(`❌ 领取 [${title}] 奖励异常: ${e.message}\n`);
        return false;
    }
}

// 办公助手抽奖
async function doFragmentCollectLottery(times) {
    try {
        for (let i = 0; i < times; i++) {
            const options = {
                url: `https://personal-act.wps.cn/activity-rubik/activity/component_action`,
                headers: {
                    'accept': 'application/json, text/plain, */*',
                    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                    'content-type': 'application/json',
                    'origin': 'https://personal-act.wps.cn',
                    'referer': 'https://personal-act.wps.cn/rubik2/portal/HD2025031010408781/YM2025061216463517?cs_from=xinchao_activity_lottery&position=xinchao_bgzs_autoreply_2148_cj',
                    'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Microsoft Edge";v="134"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Windows"',
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'same-origin',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
                    'cookie': $.cookie
                },
                body: {
                    'component_uniq_number': {
                        'activity_number': 'HD2025031010408781',
                        'page_number': 'YM2025061216463517',
                        'component_number': 'ZJ2024083022081230',
                        'component_node_id': 'FN1741940010rC4c',
                    },
                    'component_type': 2,
                    'component_action': 'lottery.exec',
                    'lottery': {
                        'pay_source': '',
                        'integral_source': '',
                        'position': 'bgzs_tasks_cj',
                        'source': '',
                        'ids': '1115,1119,1116,1117,1120,1121,1122,1118',
                        'sign': '',
                    },
                }
            };

            const response = await Request(options);

            if (response && response.result === 'ok') {
                const rewardName = response.data.lottery.name;
                $.log(`✅ 办公助手第${i+1}次抽奖成功: ${rewardName}\n`);
                $.messages.push(`办公助手第${i+1}次抽奖: ${rewardName}`);
            } else {
                $.log(`❌ 办公助手第${i+1}次抽奖失败: ${response ? JSON.stringify(response) : '网络错误'}\n`);
            }

            // 抽奖间隔
            await $.wait(2000);
        }
    } catch (e) {
        $.log(`❌ 办公助手抽奖异常: ${e.message}\n`);
    }
}

// 天天领福利任务
async function doLottery3Tasks() {
    try {
        // 签到
        await doLottery3SignIn();
        
        // 获取抽奖次数并抽奖
        const pageInfo = await getLottery3PageInfo();
        if (pageInfo && pageInfo.lottery_times > 0) {
            await doLottery3(pageInfo.lottery_times);
        }
    } catch (e) {
        $.log(`❌ 天天领福利任务异常: ${e.message}\n`);
    }
}

// 天天领福利签到
async function doLottery3SignIn() {
    try {
        const signDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD 格式
        
        const options = {
            url: `https://personal-act.wps.cn/activity-rubik/activity/component_action`,
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9',
                'content-type': 'application/json',
                'origin': 'https://personal-act.wps.cn',
                'referer': 'https://personal-act.wps.cn/rubik2/portal/HD2025031721339450/YM2025031721331326?cs_from=ad_ucsty_rwzx&position=ad_ucsty_rwzx',
                'sec-ch-ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'x-act-csrf-token': $.act_csrf_token,
                'cookie': $.cookie
            },
            body: {
                'component_uniq_number': {
                    'activity_number': 'HD2025031721339450',
                    'page_number': 'YM2025031721331326',
                    'component_number': 'ZJ2025061815363325',
                    'component_node_id': 'FN1750234948dBVL',
                    'filter_params': {
                        'cs_from': 'ad_ucsty_rwzx',
                        'position': 'ad_ucsty_rwzx',
                    },
                },
                'component_type': 42,
                'component_action': 'fragment_collect.sign_in',
                'fragment_collect': {
                    'sign_date': signDate,
                    'series_id': '',
                    'is_new_sign_series': true,
                },
            }
        };

        const response = await Request(options);

        if (response && response.result === 'ok') {
            const success = response.data?.fragment_collect?.success;
            const rewards = response.data?.fragment_collect?.reason;
            if (success) {
                $.log(`✅ 天天领福利签到成功: ${rewards}\n`);
                $.messages.push(`天天领福利签到: ${rewards}`);
            } else {
                $.log(`❌ 天天领福利签到失败: ${rewards}\n`);
            }
        } else if (response && response.msg && response.msg.includes('Duplicate entry')) {
            $.log(`✅ 天天领福利今日已签到\n`);
            $.messages.push(`天天领福利今日已签到`);
        } else {
            $.log(`❌ 天天领福利签到失败: ${response ? JSON.stringify(response) : '网络错误'}\n`);
        }
    } catch (e) {
        $.log(`❌ 天天领福利签到异常: ${e.message}\n`);
    }
}

// 获取天天领福利页面信息
async function getLottery3PageInfo() {
    try {
        const options = {
            url: `https://personal-act.wps.cn/activity-rubik/activity/page_info?activity_number=HD2025031721339450&page_number=YM2025031721331326&filter_params=%7B%22cs_from%22:%22ad_ucsty_rwzx%22,%22position%22:%22ad_ucsty_rwzx%22%7D`,
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9',
                'cache-control': 'no-cache',
                'pragma': 'no-cache',
                'priority': 'u=1, i',
                'referer': 'https://personal-act.wps.cn/rubik2/portal/HD2025031721339450/YM2025031721331326?cs_from=ad_ucsty_rwzx&position=ad_ucsty_rwzx',
                'sec-ch-ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'cookie': $.cookie
            }
        };

        const response = await Request(options);

        if (response && response.result === 'ok') {
            let lotteryTimes = null;

            for (const item of response.data) {
                if (lotteryTimes === null) {
                    if (item.lottery_v2) {
                        for (const session of item.lottery_v2.lottery_list || []) {
                            if (session.times) {
                                lotteryTimes = session.times;
                                break;
                            }
                        }
                    }
                }
                if (lotteryTimes !== null) {
                    break;
                }
            }

            $.log(`✅ 获取天天领福利信息成功 - 抽奖次数: ${lotteryTimes}\n`);
            return {
                lottery_times: lotteryTimes
            };
        } else {
            $.log(`❌ 获取天天领福利信息失败: ${response ? JSON.stringify(response) : '网络错误'}\n`);
            return null;
        }
    } catch (e) {
        $.log(`❌ 获取天天领福利信息异常: ${e.message}\n`);
        return null;
    }
}

// 天天领福利抽奖
async function doLottery3(times) {
    try {
        for (let i = 0; i < times; i++) {
            const options = {
                url: `https://personal-act.wps.cn/activity-rubik/activity/component_action`,
                headers: {
                    'accept': 'application/json, text/plain, */*',
                    'accept-language': 'zh-CN,zh;q=0.9',
                    'cache-control': 'no-cache',
                    'content-type': 'application/json',
                    'origin': 'https://personal-act.wps.cn',
                    'pragma': 'no-cache',
                    'priority': 'u=1, i',
                    'referer': 'https://personal-act.wps.cn/rubik2/portal/HD2025031721339450/YM2025031721331326?cs_from=ad_ucsty_rwzx&position=ad_ucsty_rwzx',
                    'sec-ch-ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Windows"',
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'same-origin',
                    'x-act-csrf-token': $.act_csrf_token,
                    'cookie': $.cookie
                },
                body: {
                    'component_uniq_number': {
                        'activity_number': 'HD2025031721339450',
                        'page_number': 'YM2025031721331326',
                        'component_number': 'ZJ2025092916515917',
                        'component_node_id': 'FN1761875116m2x8',
                        'filter_params': {
                            'cs_from': 'ad_ucsty_rwzx',
                            'position': 'ad_ucsty_rwzx',
                        },
                    },
                    'component_type': 45,
                    'component_action': 'lottery_v2.exec',
                    'lottery_v2': {
                        'session_id': 3001,
                    },
                }
            };

            const response = await Request(options);

            if (response && response.result === 'ok') {
                const rewardName = response.data.lottery_v2.reward_name;
                $.log(`✅ 天天领福利第${i+1}次抽奖成功: ${rewardName}\n`);
                $.messages.push(`天天领福利第${i+1}次抽奖: ${rewardName}`);
            } else {
                $.log(`❌ 天天领福利第${i+1}次抽奖失败: ${response ? JSON.stringify(response) : '网络错误'}\n`);
            }

            // 抽奖间隔
            await $.wait(2000);
        }
    } catch (e) {
        $.log(`❌ 天天领福利抽奖异常: ${e.message}\n`);
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
        // 仅处理 activity-rubik 的请求来获取 Cookie
        if ($request.url.includes('personal-act.wps.cn/activity-rubik/activity/component_action')) {
            GetCookie();
        }
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

/**
 * 数据脱敏
 * @param {string} string - 传入字符串
 * @param {number} head_length - 前缀展示字符数，默认为 2
 * @param {number} foot_length - 后缀展示字符数，默认为 2
 * @returns {string} - 返回字符串
 */
function hideSensitiveData(string, head_length = 2, foot_length = 2) {
    try {
      let star = '';
      for (var i = 0; i < string.length - head_length - foot_length; i++) {
        star += '*';
      }
      return string.substring(0, head_length) + star + string.substring(string.length - foot_length);
    } catch (e) {
      return string;
    }
  }
  

// prettier-ignore
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }