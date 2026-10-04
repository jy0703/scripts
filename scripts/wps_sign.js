/**
 * 脚本名称：WPS签到
 * 活动规则：WPS任务中心(签到+任务+抽奖)、天天领福利、WPS挑战计划、WPS超级会员小程序(签到+浏览任务+抽奖)
 * 脚本说明：支持多账号，支持 NE / Node.js 环境。对齐 wps.py v4.0.0。
 * 环境变量：WPS_COOKIE（自动抓取，JSON数组 [{uid,cookie}]，条目可加 ref 字段用于小程序浏览任务）
 * 小程序浏览任务：依赖 YYB code 服务，boxjs 配置 @wxCode.address / @wxCode.ref / @wxCode.token
 *          （Node 环境变量 WX_CODE_ADDRESS / WX_CODE_REF / WX_CODE_TOKEN 亦可，多个 ref 逗号分隔按账号顺序对应）
 * 获取 Cookie：在 WPS 内从会员中心横幅进入签到活动页（触发 rubik2/portal 页面请求）即可抓取，Cookie 含 uid 即可入库
 * 更新时间：2026-10-04 小程序签到改动态签名，新增挑战计划与小程序浏览任务

------------------ Surge 配置 ------------------

[MITM]
hostname = personal-act.wps.cn

[Script]
WPS签到获取Cookie = type=http-request,pattern=^https?:\/\/personal-act\.wps\.cn\/rubik2\/portal\/,requires-body=1,max-size=0,binary-body-mode=0,timeout=30,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/wps_sign.js,script-update-interval=0

WPS签到 = type=cron,cronexp="0 8 * * *",timeout=60,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/wps_sign.js,script-update-interval=0

------------------- Loon 配置 -------------------

[MITM]
hostname = personal-act.wps.cn

[Script]
http-request ^https?:\/\/personal-act\.wps\.cn\/rubik2\/portal\/ tag=WPS签到获取Cookie,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/wps_sign.js,requires-body=1

cron "0 8 * * *" script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/wps_sign.js,tag=WPS签到,enable=true

--------------- Quantumult X 配置 ---------------

[MITM]
hostname = personal-act.wps.cn

[rewrite_local]
^https?:\/\/personal-act\.wps\.cn\/rubik2\/portal\/ url script-request-header https://raw.githubusercontent.com/jy0703/scripts/main/scripts/wps_sign.js

[task_local]
0 8 * * * https://raw.githubusercontent.com/jy0703/scripts/main/scripts/wps_sign.js, tag=WPS签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/wps.png, enabled=true

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
    - match: ^https?:\/\/personal-act\.wps\.cn\/rubik2\/portal\/
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

// 功能开关（对齐 py global_config，办公助手活动 2026.03.16 结束默认关闭）
const GLOBAL_CONFIG = {
    task_center: true,
    lottery3: true,
    fragment_collect: false,
    challenge: true,
};

// 小程序浏览任务依赖的 code 服务(YYB Go)配置
$.codeServer = (getEnv('WX_CODE_ADDRESS', '@wxCode.address') || '').replace(/\/+$/, '');
$.refStr = getEnv('WX_CODE_REF', '@wxCode.ref') || '';
$.yybToken = getEnv('WX_CODE_TOKEN', '@wxCode.token') || '';
$.refList = $.refStr.split(',').map(s => s.trim()).filter(Boolean);

// 超级会员小程序常量
const APPLET_APP_ID = 'wx2f333d84a103825d';
const APPLET_CHANNEL_CODE = 'WPSPDFGJ1001';
const APPLET_S_KEY_DEFAULT = '06196ab4da15c09a3aaee610162ca56f';
const APPLET_SS = '7908b285f33c837d';
const APPLET_LOTTERY_ACTIVITY = 'HD2024082815116866';
const APPLET_LOTTERY_PAGE = 'YM2024082815122017';
const APPLET_LOTTERY_COMPONENT_DEFAULT = 'ZJ2025092916516585';
const APPLET_LOTTERY_NODE_DEFAULT = 'FN1766995952bvx3';
const APPLET_LOTTERY_SESSION_DEFAULT = 1;
const MINI_UA = 'Mozilla/5.0 (Linux; Android 14; 23117RK66C Build/UKQ1.230804.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.7444.173 Mobile Safari/537.36 XWEB/1420153 MMWEBSDK/20240404 MMWEBID/3531 MicroMessenger/8.0.49.2600(0x2800313D) WeChat/arm64 Weixin Android Tablet NetType/WIFI Language/zh_CN ABI/arm64 MiniProgramEnv/android';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0';
const SKIP_KEYWORDS = ['邀请', 'PDF转换', 'PDF合并', '语音速记', '关注', '消费', '开通会员', '认证', '上喜马拉雅', '微博', '苏宁易购', '添加'];


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
            // 小程序任务 ref：账号条目自带 > @wxCode.ref 按序对应 > 单 ref 全局共用
            $.ref = $.userArr[i].ref || $.refList[i] || ($.refList.length === 1 ? $.refList[0] : '');

            if (!$.uid) {
                $.log(`❌ Cookie 格式不正确，缺少必要参数\n`);
                continue;
            }

            if (GLOBAL_CONFIG.task_center) {
                $.log(`# 开始执行 WPS任务中心 任务`);
                // WPS任务中心：签到 → 两轮任务 → 抽奖
                await doSign();
                await $.wait(1000);
                await doAllTasks();
                await $.wait(1500);
                await doAllTasks();
                await $.wait(1500);
                const userInfo = await getUserInfo();
                if (userInfo && userInfo.lottery_times > 0) {
                    await doLottery(userInfo.lottery_times);
                }
                $.log(`# 执行完成 WPS任务中心 任务`);
            }

            // 天天领福利
            if (GLOBAL_CONFIG.lottery3) {
                $.log(`# 开始执行 天天领福利 任务`);
                await doLottery3Tasks();
                $.log(`# 执行完成 天天领福利 任务`);
            }

            // 办公助手（活动 2026.03.16 结束，默认关闭）
            if (GLOBAL_CONFIG.fragment_collect) {
                $.log(`# 开始执行 WPS办公助手 任务`);
                await doFragmentCollectTasks();
                $.log(`# 执行完成 WPS办公助手 任务`);
            }

            // WPS挑战计划
            if (GLOBAL_CONFIG.challenge) {
                $.log(`# 开始执行 WPS挑战计划 任务`);
                await doChallengeTasks();
                $.log(`# 执行完成 WPS挑战计划 任务`);
            }

            // WPS超级会员小程序（签到 + 浏览任务 + 抽奖）
            $.log(`# 开始执行 wps超级会员小程序 任务`);
            await doSvipApplet();
            $.log(`# 执行完成 wps超级会员小程序 任务`);

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
        if (SKIP_KEYWORDS.some(keyword => title.includes(keyword))) {
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

// ---------- WPS超级会员小程序 ----------

// 小程序签名: 排序JSON -> MD5 -> HMAC-SHA256(密钥为 ss 字符串原始字节)
function generateSign(t, i, r) {
    const n = {};
    Object.keys(t).sort().forEach(k => n[k] = t[k]);
    const md5p = Crypt('md5', JSON.stringify(n));
    const utcTime = new Date().toUTCString();
    return { date: utcTime, signature: Crypt('hmac-sha256', r, i + md5p + utcTime) };
}

function appletSignHeaders(sign) {
    return {
        'Host': 'personal-bus.wps.cn',
        'Connection': 'keep-alive',
        'date': sign.date,
        'charset': 'utf-8',
        'signature': sign.signature,
        'x-csrftoken': '1234567890',
        'User-Agent': MINI_UA,
        'content-type': 'application/json',
        'Referer': `https://servicewechat.com/${APPLET_APP_ID}/240/page-frame.html`,
        'cookie': $.cookie
    };
}

function appletHeaders() {
    return {
        'accept': '*/*',
        'accept-language': 'zh-CN,zh;q=0.9',
        'content-type': 'application/json',
        'x-csrftoken': '1234567890',
        'x-pop-token': '',
        'xweb_xhr': '1',
        'User-Agent': WIN_UA,
        'Referer': `https://servicewechat.com/${APPLET_APP_ID}/252/page-frame.html`,
        'cookie': $.cookie
    };
}

// 调用 code 服务(YYB Go)获取微信 code
async function getWxCode(ref) {
    const options = {
        url: `${$.codeServer}/wxapp/getCode`,
        headers: { 'Content-Type': 'application/json' },
        body: { ref, app_id: APPLET_APP_ID }
    };
    if ($.yybToken) options.headers['Authorization'] = `Bearer ${$.yybToken}`;
    const resp = await Request(options);
    if (!resp || resp.code !== 0 || !resp?.data?.result) {
        $.log(`❌ 获取小程序code失败: ${$.toStr(resp)}\n`);
        return null;
    }
    const result = typeof resp.data.result === 'string' ? $.toObj(resp.data.result) : resp.data.result;
    if (!result || !result.code) {
        $.log(`❌ 获取小程序code为空: ${$.toStr(result)}\n`);
        return null;
    }
    $.log(`✅ 获取code成功: ${result.code}\n`);
    return String(result.code);
}

async function doSvipApplet() {
    try {
        // 尝试获取最新 s_key，失败用默认值
        let sKey = APPLET_S_KEY_DEFAULT;
        try {
            const infoResp = await Request({
                url: 'https://personal-bus.wps.cn/activity/clock_in/v1/info',
                headers: appletSignHeaders(generateSign({}, sKey, APPLET_SS))
            });
            if (infoResp && infoResp.data && infoResp.data.s_key) {
                sKey = infoResp.data.s_key;
                $.log(`✅ 获取到新s_key\n`);
            }
        } catch (e) {
            $.log(`⚠️ 获取签到信息失败: ${e.message}，使用默认s_key\n`);
        }

        const body = { client_type: 1 };
        const response = await Request({
            url: 'https://personal-bus.wps.cn/activity/clock_in/v1/clock_in',
            headers: appletSignHeaders(generateSign(body, sKey, APPLET_SS)),
            body
        });

        let signSuccess = false;
        if (response && response.result === 'ok') {
            const days = (response.data && response.data.continuous_days) || '?';
            $.log(`✅ 小程序签到成功，已签到${days}天\n`);
            $.messages.push(`小程序签到成功，已签到${days}天`);
            signSuccess = true;
        } else if (response && response.msg && response.msg.includes('already clocked in today')) {
            $.log(`✅ 小程序今日已签到\n`);
            $.messages.push('小程序今日已签到');
            signSuccess = true;
        } else {
            $.log(`❌ 小程序签到失败: ${response ? JSON.stringify(response) : '网络错误'}\n`);
        }

        // 签到成功后执行浏览任务(需要 ref + code 服务)
        if (signSuccess) {
            if ($.ref && $.codeServer && $.yybToken) {
                await $.wait(1000);
                await executeAppletBrowse();
            } else if (!$.ref) {
                $.log(`⚠️ 当前账号无 ref，跳过小程序浏览任务(配置 @wxCode.* 或在 WPS_COOKIE 条目加 ref 字段)\n`);
            }
        }
    } catch (e) {
        $.log(`❌ 小程序签到异常: ${e.message}\n`);
    }
}

// 小程序任务概览(浏览任务完成状态)
async function getAppletOutline() {
    const authCode = await getWxCode($.ref);
    if (!authCode) return null;
    try {
        const response = await Request({
            url: `https://personal-bus.wps.cn/activity/clock_in/v1/task/outline?mp_id=app_op_act&auth_code=${encodeURIComponent(authCode)}`,
            headers: appletHeaders()
        });
        if (response && response.result === 'ok' && response.data) {
            $.log(`✅ 获取小程序任务outline成功\n`);
            return response.data;
        }
        $.log(`❌ 获取小程序任务outline失败: ${response ? response.msg : '网络错误'}\n`);
        return null;
    } catch (e) {
        $.log(`❌ 获取小程序任务outline异常: ${e.message}\n`);
        return null;
    }
}

// 小程序浏览任务列表(过滤已完成)
async function getAppletTaskList() {
    try {
        const response = await Request({
            url: 'https://tiance.wps.cn/dce/exec/api/market/activity',
            headers: appletHeaders(),
            body: {
                channel_code: APPLET_CHANNEL_CODE,
                platform: 16,
                rmsp: 'vip_clock',
                version: 'release',
                device: 5,
                filter_info: { mini_platfrom: 'android', isPad: 'no', support_virtual: 1 }
            }
        });
        if (response && response.result === 'ok' && response.data) {
            const material = (response.data[0] && response.data[0].config && response.data[0].config.material) || [];
            const browseTasks = (material[0] && material[0].element && material[0].element.browse) || [];
            if (!browseTasks.length) {
                $.log(`ℹ️ 当前无可用浏览任务\n`);
                return [];
            }
            const outline = await getAppletOutline();
            if (!outline) {
                $.log(`⚠️ 获取任务状态失败，返回全部 ${browseTasks.length} 个浏览任务\n`);
                return browseTasks;
            }
            const outlineBrowse = outline.browse || [];
            let completed = 0;
            const pending = [];
            for (const task of browseTasks) {
                const ob = outlineBrowse.find(o => o.app_id === task.app_id);
                if (ob && ob.status === 1) {
                    completed++;
                } else {
                    if (ob) {
                        task.status = ob.status !== undefined ? ob.status : 0;
                        task.type = ob.type || 'browse';
                    }
                    pending.push(task);
                }
            }
            if (completed > 0) $.log(`ℹ️ 过滤已完成浏览任务 ${completed} 个\n`);
            for (const t of pending) $.log(`  - ${t.title || '未知'} (app_id=${t.app_id})\n`);
            return pending;
        }
        $.log(`❌ 获取小程序任务列表失败: ${response ? response.msg : '网络错误'}\n`);
        return null;
    } catch (e) {
        $.log(`❌ 获取小程序任务列表异常: ${e.message}\n`);
        return null;
    }
}

// 单个浏览任务: start_browse → 等待 → finish_browse
async function browseSingleTask(task) {
    const title = task.title || '未知任务';
    const browseAppId = task.app_id;
    const clientType = task.client_type || 'wechat';
    const path = task.path || '';

    const authCodeStart = await getWxCode($.ref);
    if (!authCodeStart) return false;

    try {
        const startResp = await Request({
            url: 'https://personal-bus.wps.cn/activity/clock_in/v1/task/start_browse',
            headers: appletHeaders(),
            body: {
                mp_id: 'app_op_act',
                auth_code: authCodeStart,
                browse_app_id: browseAppId,
                client_type: clientType,
                version: 'new',
                path
            }
        });
        if (startResp && startResp.result !== 'ok') {
            const msg = (startResp && startResp.msg) || '未知错误';
            if (msg.includes('已完成') || msg.includes('完成')) {
                $.log(`ℹ️ 浏览任务已完成，跳过 [${title}]\n`);
                return true;
            }
            $.log(`❌ start_browse失败 [${title}]: ${msg}\n`);
            return false;
        }
        $.log(`✅ start_browse成功 [${title}]，等待15~17秒\n`);
    } catch (e) {
        $.log(`❌ start_browse异常 [${title}]: ${e.message}\n`);
        return false;
    }

    await $.wait(15000 + Math.floor(Math.random() * 2000));

    const authCodeFinish = await getWxCode($.ref);
    if (!authCodeFinish) return false;

    try {
        const finishResp = await Request({
            url: 'https://personal-bus.wps.cn/activity/clock_in/v1/task/finish_browse',
            headers: appletHeaders(),
            body: {
                mp_id: 'app_op_act',
                auth_code: authCodeFinish,
                app_id: browseAppId,
                client_type: clientType,
                path,
                version: 'new',
                user_id: parseInt($.uid)
            }
        });
        if (finishResp && finishResp.result === 'ok') {
            $.log(`✅ 浏览任务完成 [${title}]\n`);
            return true;
        }
        const msg = (finishResp && finishResp.msg) || '未知错误';
        if (msg.includes('已完成') || msg.includes('完成')) {
            $.log(`ℹ️ 浏览任务已完成 [${title}]\n`);
            return true;
        }
        $.log(`❌ finish_browse失败 [${title}]: ${msg}\n`);
        return false;
    } catch (e) {
        $.log(`❌ finish_browse异常 [${title}]: ${e.message}\n`);
        return false;
    }
}

// 小程序抽奖页面信息(动态取组件号与抽奖次数)
async function getAppletPageInfo() {
    try {
        const response = await Request({
            url: `https://personal-act.wps.cn/activity-rubik/activity/page_info?activity_number=${APPLET_LOTTERY_ACTIVITY}&page_number=${APPLET_LOTTERY_PAGE}&filter_params=%7B%22virtualPayEnabled%22:%221%22%7D`,
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9',
                'cache-control': 'no-cache',
                'pragma': 'no-cache',
                'content-type': 'application/json',
                'origin': 'https://personal-act.wps.cn',
                'referer': `https://personal-act.wps.cn/rubik2/portal/${APPLET_LOTTERY_ACTIVITY}/${APPLET_LOTTERY_PAGE}?virtualPayEnabled=1`,
                'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Android WebView";v="146"',
                'sec-ch-ua-mobile': '?1',
                'sec-ch-ua-platform': '"Android"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'User-Agent': WIN_UA,
                'cookie': $.cookie
            }
        });
        if (response && response.result === 'ok') {
            let componentNumber = null;
            let componentNodeId = null;
            let sessionId = null;
            let lotteryTimes = 0;
            for (const item of response.data || []) {
                if (item.type === 45 && item.lottery_v2) {
                    const uniq = item.component_uniq_number || {};
                    componentNumber = uniq.component_number || componentNumber;
                    componentNodeId = uniq.component_node_id || componentNodeId;
                    for (const session of item.lottery_v2.lottery_list || []) {
                        if (session.times) {
                            lotteryTimes = Math.max(lotteryTimes, session.times || 0);
                            if (session.session_id !== undefined && session.session_id !== null) {
                                sessionId = session.session_id;
                            }
                        }
                    }
                }
            }
            return {
                component_number: componentNumber || APPLET_LOTTERY_COMPONENT_DEFAULT,
                component_node_id: componentNodeId || APPLET_LOTTERY_NODE_DEFAULT,
                session_id: sessionId || APPLET_LOTTERY_SESSION_DEFAULT,
                lottery_times: lotteryTimes
            };
        }
        $.log(`❌ 获取小程序抽奖页面信息失败: ${response ? response.msg : '网络错误'}\n`);
        return null;
    } catch (e) {
        $.log(`❌ 获取小程序抽奖页面信息异常: ${e.message}\n`);
        return null;
    }
}

// 备用接口获取小程序抽奖次数
async function getAppletLotteryTimes() {
    try {
        const response = await Request({
            url: 'https://personal-bus.wps.cn/activity/clock_in/v1/task/lottery_times?position=wx_xcx_clock_activity',
            headers: appletHeaders()
        });
        if (response && response.result === 'ok') {
            const times = response.data || 0;
            $.log(`ℹ️ 当前小程序抽奖次数: ${times}\n`);
            return times;
        }
        $.log(`❌ 获取小程序抽奖次数失败: ${response ? response.msg : '网络错误'}\n`);
        return 0;
    } catch (e) {
        $.log(`❌ 获取小程序抽奖次数异常: ${e.message}\n`);
        return 0;
    }
}

async function appletLottery(componentNumber, componentNodeId, sessionId) {
    const cn = componentNumber || APPLET_LOTTERY_COMPONENT_DEFAULT;
    const cid = componentNodeId || APPLET_LOTTERY_NODE_DEFAULT;
    const sid = sessionId || APPLET_LOTTERY_SESSION_DEFAULT;
    try {
        const response = await Request({
            url: 'https://personal-act.wps.cn/activity-rubik/activity/component_action',
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9',
                'cache-control': 'no-cache',
                'content-type': 'application/json',
                'origin': 'https://personal-act.wps.cn',
                'pragma': 'no-cache',
                'referer': `https://personal-act.wps.cn/rubik2/portal/${APPLET_LOTTERY_ACTIVITY}/${APPLET_LOTTERY_PAGE}?virtualPayEnabled=1`,
                'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Android WebView";v="146"',
                'sec-ch-ua-mobile': '?1',
                'sec-ch-ua-platform': '"Android"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'User-Agent': WIN_UA,
                'cookie': $.cookie
            },
            body: {
                component_uniq_number: {
                    activity_number: APPLET_LOTTERY_ACTIVITY,
                    page_number: APPLET_LOTTERY_PAGE,
                    component_number: cn,
                    component_node_id: cid,
                    filter_params: { virtualPayEnabled: '1' },
                },
                component_type: 45,
                component_action: 'lottery_v2.exec',
                lottery_v2: { session_id: sid },
            }
        });
        if (response && response.result === 'ok') {
            const lotteryV2 = response.lottery_v2 || (response.data && response.data.lottery_v2) || {};
            if (lotteryV2 && lotteryV2.success) {
                const rewardName = lotteryV2.reward_name || '未知奖品';
                $.log(`✅ 小程序抽奖成功: ${rewardName}\n`);
                $.messages.push(`小程序抽奖: ${rewardName}`);
                return true;
            } else if (lotteryV2) {
                $.log(`⚠️ 小程序抽奖失败: error_code=${lotteryV2.error_code !== undefined ? lotteryV2.error_code : -1}, msg=${lotteryV2.send_msg || ''}\n`);
                return false;
            }
        }
        $.log(`❌ 小程序抽奖请求失败: ${response ? response.msg : '网络错误'}\n`);
        return false;
    } catch (e) {
        $.log(`❌ 小程序抽奖异常: ${e.message}\n`);
        return false;
    }
}

// 浏览任务 + 抽奖全流程
async function executeAppletBrowse() {
    $.log(`开始获取小程序任务列表...\n`);
    const browseTasks = await getAppletTaskList();
    if (browseTasks && browseTasks.length) {
        let okCount = 0, failCount = 0;
        for (const task of browseTasks) {
            const title = task.title || '未知任务';
            $.log(`正在执行浏览任务 [${title}]\n`);
            if (await browseSingleTask(task)) {
                okCount++;
                $.messages.push(`浏览任务[${title}] 完成`);
            } else {
                failCount++;
                $.messages.push(`浏览任务[${title}] 失败`);
            }
            await $.wait(1000);
        }
        $.log(`✅ 小程序浏览任务完成：成功${okCount}个，失败${failCount}个\n`);
        $.messages.push(`小程序浏览任务：成功${okCount}个，失败${failCount}个`);
        await $.wait(1000);
    } else {
        $.log(`ℹ️ 无待执行的浏览任务\n`);
    }

    let lotteryTimes = 0, compNum = null, compNode = null, sessionId = null;
    const pageData = await getAppletPageInfo();
    if (pageData) {
        lotteryTimes = pageData.lottery_times;
        compNum = pageData.component_number;
        compNode = pageData.component_node_id;
        sessionId = pageData.session_id;
    } else {
        $.log(`⚠️ 动态获取抽奖组件信息失败，使用备用接口获取抽奖次数\n`);
        lotteryTimes = await getAppletLotteryTimes();
    }

    if (lotteryTimes > 0) {
        $.log(`ℹ️ 剩余${lotteryTimes}次抽奖机会\n`);
        for (let i = 0; i < lotteryTimes; i++) {
            const result = await appletLottery(compNum, compNode, sessionId);
            if (!result) {
                $.log(`ℹ️ 抽奖第${i + 1}次失败，终止抽奖\n`);
                break;
            }
            await $.wait(1000 + Math.floor(Math.random() * 1000));
        }
    } else {
        $.log(`ℹ️ 无可用抽奖次数\n`);
    }
}

// ---------- WPS挑战计划 ----------

async function getChallengePageInfo() {
    try {
        const response = await Request({
            url: 'https://personal-act.wps.cn/activity-rubik/activity/page_info?activity_number=HD2025121517384715&page_number=YM2025121517381164&filter_params=%7B%22cs_from%22:%22pc_ucsty_rwzx_task%22,%22position%22:%22pc_rwzx_task%22%7D',
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9',
                'priority': 'u=1, i',
                'referer': 'https://personal-act.wps.cn/rubik2/portal/HD2025121517384715/YM2025121517381164?cs_from=pc_ucsty_rwzx_task&position=pc_rwzx_task',
                'sec-ch-ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'user-agent': WIN_UA,
                'cookie': $.cookie
            }
        });
        if (response && response.result === 'ok') {
            let taskList = null;
            for (const item of response.data || []) {
                if (item.task_center) {
                    const _taskList = item.task_center.task_list || [];
                    if (_taskList.length) taskList = _taskList;
                }
            }
            return { task_list: taskList };
        }
        $.log(`❌ 获取WPS挑战计划任务列表失败: ${response ? JSON.stringify(response) : '网络错误'}\n`);
        return null;
    } catch (e) {
        $.log(`❌ 获取WPS挑战计划任务列表异常: ${e.message}\n`);
        return null;
    }
}

async function challengeComponentAction(title, taskId, componentAction, actionName) {
    try {
        const response = await Request({
            url: 'https://personal-act.wps.cn/activity-rubik/activity/component_action',
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9',
                'content-type': 'application/json',
                'origin': 'https://personal-act.wps.cn',
                'priority': 'u=1, i',
                'referer': 'https://personal-act.wps.cn/rubik2/portal/HD2025121517384715/YM2025121517381164?cs_from=pc_ucsty_rwzx_task&position=pc_rwzx_task',
                'sec-ch-ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'user-agent': WIN_UA,
                'cookie': $.cookie
            },
            body: {
                component_uniq_number: {
                    activity_number: 'HD2025121517384715',
                    page_number: 'YM2025121517381164',
                    component_number: 'ZJ2025031817022062',
                    component_node_id: 'FN17642133971jKe',
                    filter_params: {
                        cs_from: 'pc_ucsty_rwzx_task',
                        position: 'pc_rwzx_task',
                    },
                },
                component_type: 35,
                component_action: componentAction,
                task_center: { task_id: taskId },
            }
        });
        if (response && response.result === 'ok') {
            const taskCenter = response.data && response.data.task_center;
            if (taskCenter && taskCenter.success) {
                $.log(`✅ ${actionName}任务 [${title}] 成功\n`);
                if (actionName === '领取') $.messages.push(`挑战计划领取 [${title}] 奖励成功`);
                return taskCenter.token || true;
            }
            const reason = (taskCenter && taskCenter.reason) || JSON.stringify(response);
            $.log(`❌ ${actionName}任务 [${title}] 失败：${reason}\n`);
            $.messages.push(`挑战计划${actionName}任务 [${title}] 失败`);
            return false;
        }
        $.log(`❌ ${actionName}任务 [${title}] 失败：${response ? JSON.stringify(response) : '网络错误'}\n`);
        return false;
    } catch (e) {
        $.log(`❌ ${actionName}任务 [${title}] 异常: ${e.message}\n`);
        return false;
    }
}

async function doChallengeTasks() {
    const pageData = await getChallengePageInfo();
    if (!pageData) return;
    const taskList = pageData.task_list || [];
    $.log(`✅ 挑战计划获取到 ${taskList.length} 个任务\n`);
    for (const task of taskList) {
        const taskId = task.task_id;
        const title = task.title;
        if (task.task_status === 2) {
            $.log(`🔄 任务 [${title}] 已完成\n`);
            continue;
        }
        if (SKIP_KEYWORDS.some(keyword => title.includes(keyword))) {
            $.log(`⏭️ 跳过任务 [${title}]\n`);
            continue;
        }
        const isDone = await challengeComponentAction(title, taskId, 'task_center.finish', '完成');
        if (isDone) {
            await $.wait(1000);
            await challengeComponentAction(title, taskId, 'task_center.reward', '领取');
        }
        await $.wait(1000);
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
                $.log(`✅ 天天领福利签到成功\n`);
                $.messages.push(`天天领福利签到成功`);
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
                    'cookie': $.cookie
                },
                body: {
                    'component_uniq_number': {
                        'activity_number': 'HD2025031721339450',
                        'page_number': 'YM2025031721331326',
                        'component_number': 'ZJ2025092916515917',
                        'component_node_id': 'FN1761875116m2x8',
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
        // 仅处理活动页请求来获取 Cookie（Cookie 中带 uid 即可）
        if ($request.url.includes('personal-act.wps.cn/rubik2/portal/')) {
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
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }// 通用加密入口: Crypt(type, ...args), 支持 md5/sha256/hmac-sha256/rsa/aes/base64
function Crypt(type, a, b, c) { function MD5(string) { function RotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); } function AddUnsigned(lX, lY) { var lX4, lY4, lX8, lY8, lResult; lX8 = (lX & 0x80000000); lY8 = (lY & 0x80000000); lX4 = (lX & 0x40000000); lY4 = (lY & 0x40000000); lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF); if (lX4 & lY4) { return (lResult ^ 0x80000000 ^ lX8 ^ lY8); } if (lX4 | lY4) { if (lResult & 0x40000000) { return (lResult ^ 0xC0000000 ^ lX8 ^ lY8); } else { return (lResult ^ 0x40000000 ^ lX8 ^ lY8); } } else { return (lResult ^ lX8 ^ lY8); } } function F(x, y, z) { return (x & y) | ((~x) & z); } function G(x, y, z) { return (x & z) | (y & (~z)); } function H(x, y, z) { return (x ^ y ^ z); } function I(x, y, z) { return (y ^ (x | (~z))); } function FF(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function GG(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function HH(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function II(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function ConvertToWordArray(string) { var lWordCount; var lMessageLength = string.length; var lNumberOfWords_temp1 = lMessageLength + 8; var lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64; var lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16; var lWordArray = Array(lNumberOfWords - 1); var lBytePosition = 0; var lByteCount = 0; while (lByteCount < lMessageLength) { lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8; lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition)); lByteCount++; } lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8; lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition); lWordArray[lNumberOfWords - 2] = lMessageLength << 3; lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29; return lWordArray; }; function WordToHex(lValue) { var WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount; for (lCount = 0; lCount <= 3; lCount++) { lByte = (lValue >>> (lCount * 8)) & 255; WordToHexValue_temp = "0" + lByte.toString(16); WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2); } return WordToHexValue; }; function Utf8Encode(string) { string = string.replace(/\r\n/g, "\n"); var utftext = ""; for (var n = 0; n < string.length; n++) { var c = string.charCodeAt(n); if (c < 128) { utftext += String.fromCharCode(c); } else if ((c > 127) && (c < 2048)) { utftext += String.fromCharCode((c >> 6) | 192); utftext += String.fromCharCode((c & 63) | 128); } else { utftext += String.fromCharCode((c >> 12) | 224); utftext += String.fromCharCode(((c >> 6) & 63) | 128); utftext += String.fromCharCode((c & 63) | 128); } } return utftext; }; var x = Array(); var k, AA, BB, CC, DD, a, b, c, d; var S11 = 7, S12 = 12, S13 = 17, S14 = 22; var S21 = 5, S22 = 9, S23 = 14, S24 = 20; var S31 = 4, S32 = 11, S33 = 16, S34 = 23; var S41 = 6, S42 = 10, S43 = 15, S44 = 21; string = Utf8Encode(string); x = ConvertToWordArray(string); a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476; for (k = 0; k < x.length; k += 16) { AA = a; BB = b; CC = c; DD = d; a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478); d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756); c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB); b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE); a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF); d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A); c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613); b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501); a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8); d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF); c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1); b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE); a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122); d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193); c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E); b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821); a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562); d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340); c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51); b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA); a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D); d = GG(d, a, b, c, x[k + 10], S22, 0x2441453); c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681); b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8); a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6); d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6); c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87); b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED); a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905); d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8); c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9); b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A); a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942); d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681); c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122); b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C); a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44); d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9); c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60); b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70); a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6); d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA); c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085); b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05); a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039); d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5); c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8); b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665); a = II(a, b, c, d, x[k + 0], S41, 0xF4292244); d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97); c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7); b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039); a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3); d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92); c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D); b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1); a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F); d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0); c = II(c, d, a, b, x[k + 6], S43, 0xA3014314); b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1); a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82); d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235); c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB); b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391); a = AddUnsigned(a, AA); b = AddUnsigned(b, BB); c = AddUnsigned(c, CC); d = AddUnsigned(d, DD); } var temp = WordToHex(a) + WordToHex(b) + WordToHex(c) + WordToHex(d); return temp.toLowerCase(); } function _rsa(pem, string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function BytesToBigInt(bytes) { let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); return n; } function BigIntToBytes(n, len) { const out = new Array(len).fill(0); for (let i = len - 1; i >= 0 && n > 0n; i--) { out[i] = Number(n & 0xffn); n >>= 8n; } return out; } function ModPow(base, exp, mod) { let r = 1n; base %= mod; while (exp > 0n) { if (exp & 1n) r = (r * base) % mod; base = (base * base) % mod; exp >>= 1n; } return r; } function DerRead(buf, off) { const tag = buf[off++]; let len = buf[off++]; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + i]; off += n; } return { tag, start: off, len }; } function DerChildren(buf, start, end) { const list = []; let off = start; while (off < end) { const t = DerRead(buf, off); list.push(t); off = t.start + t.len; } return list; } if (!_rsa._k || _rsa._kp !== pem) { try { const der = Base64ToBytes(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); let seqs = DerChildren(der, DerRead(der, 0).start, der.length); const inner = seqs.find(s => s.tag === 0x04); if (inner) { const seq2 = DerRead(der, inner.start); seqs = DerChildren(der, seq2.start, seq2.start + seq2.len); } const ints = seqs.filter(s => s.tag === 0x02); const n = BytesToBigInt(der.slice(ints[1].start, ints[1].start + ints[1].len)); const d = BytesToBigInt(der.slice(ints[3].start, ints[3].start + ints[3].len)); _rsa._k = { n, d, k: (n.toString(16).length + 1) >> 1 }; _rsa._kp = pem; } catch (e) { $.logErr('❌ [签名] 私钥解析失败: ' + (e.message || e)); return null; } } const key = _rsa._k; try { const digestInfo = [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20, ...SHA256(Utf8Encode(string))]; const padded = [0x00, 0x01, ...new Array(key.k - digestInfo.length - 3).fill(0xff), 0x00, ...digestInfo]; const sig = ModPow(BytesToBigInt(padded), key.d, key.n); return BytesToBase64(BigIntToBytes(sig, key.k)).replace(/\//g, '_').replace(/\+/g, '-'); } catch (e) { $.logErr('❌ [签名] 签名异常: ' + (e.message || e)); return null; } } function _rsaenc(b64Pub, string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function BytesToBigInt(bytes) { let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); return n; } function BigIntToBytes(n, len) { const out = new Array(len).fill(0); for (let i = len - 1; i >= 0 && n > 0n; i--) { out[i] = Number(n & 0xffn); n >>= 8n; } return out; } function ModPow(base, exp, mod) { let r = 1n; base %= mod; while (exp > 0n) { if (exp & 1n) r = (r * base) % mod; base = (base * base) % mod; exp >>= 1n; } return r; } function DerRead(buf, off) { const tag = buf[off++]; let len = buf[off++]; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + i]; off += n; } return { tag, start: off, len }; } function DerChildren(buf, start, end) { const list = []; let off = start; while (off < end) { const t = DerRead(buf, off); list.push(t); off = t.start + t.len; } return list; } if (!_rsaenc._k || _rsaenc._kp !== b64Pub) { try { const der = Base64ToBytes(String(b64Pub).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); const outer = DerRead(der, 0); const bitStr = DerChildren(der, outer.start, outer.start + outer.len).find(s => s.tag === 0x03); if (!bitStr) throw new Error('非 SPKI 公钥'); const seq = DerRead(der, bitStr.start + 1); const ints = DerChildren(der, seq.start, seq.start + seq.len).filter(s => s.tag === 0x02); const n = BytesToBigInt(der.slice(ints[0].start, ints[0].start + ints[0].len)); const e = BytesToBigInt(der.slice(ints[1].start, ints[1].start + ints[1].len)); _rsaenc._k = { n, e, k: (n.toString(16).length + 1) >> 1 }; _rsaenc._kp = b64Pub; } catch (err) { $.logErr('❌ [加密] 公钥解析失败: ' + (err.message || err)); return null; } } const key = _rsaenc._k; try { const msg = Utf8Encode(string); const psLen = key.k - msg.length - 3; if (psLen < 8) { $.logErr('❌ [加密] 明文超出 RSA 长度上限'); return null; } const ps = new Array(psLen); for (let i = 0; i < psLen; i++) ps[i] = 1 + Math.floor(Math.random() * 255); const padded = [0x00, 0x02, ...ps, 0x00, ...msg]; return BytesToBase64(BigIntToBytes(ModPow(BytesToBigInt(padded), key.e, key.n), key.k)); } catch (err) { $.logErr('❌ [加密] RSA 加密异常: ' + (err.message || err)); return null; } } function _hmac(b64Key, msg) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } let key = Utf8Encode(b64Key); if (key.length > 64) key = SHA256(key); while (key.length < 64) key.push(0); const inner = SHA256(key.map(b => b ^ 0x36).concat(Utf8Encode(msg))); const outer = SHA256(key.map(b => b ^ 0x5c).concat(inner)); return outer.map(b => b.toString(16).padStart(2, '0')).join(''); } function _aes(plain, keyStr, ivStr, ecb, ivp) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } const SBOX = (function () { function gmul(a, b) { let p = 0; for (let i = 0; i < 8; i++) { if ((b >> i) & 1) p ^= a; a = ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; } return p; } const sbox = new Array(256); for (let x = 0; x < 256; x++) { let inv = 0; if (x !== 0) { inv = 1; while (gmul(inv, x) !== 1) inv++; } const r = (v, n) => ((v << n) | (v >> (8 - n))) & 0xff; sbox[x] = (inv ^ r(inv, 1) ^ r(inv, 2) ^ r(inv, 3) ^ r(inv, 4) ^ 0x63) & 0xff; } return sbox; })(); function expandKey(key) { const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]; const Nk = key.length >> 2, Nr = Nk + 6, tw = 4 * (Nr + 1); const w = []; for (let i = 0; i < Nk; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]); for (let i = Nk; i < tw; i++) { let t = w[i - 1].slice(); if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]].map(b => SBOX[b]); t[0] ^= RCON[i / Nk - 1]; } else if (Nk > 6 && i % Nk === 4) t = t.map(b => SBOX[b]); w.push([w[i - Nk][0] ^ t[0], w[i - Nk][1] ^ t[1], w[i - Nk][2] ^ t[2], w[i - Nk][3] ^ t[3]]); } const rk = []; for (let round = 0; round <= Nr; round++) { const blk = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) blk[4 * c + r] = w[4 * round + c][r]; rk.push(blk); } return { rk: rk, Nr: Nr }; } function encryptBlock(input, rk, Nr) { let s = input.slice(); const addRK = (round) => { for (let i = 0; i < 16; i++) s[i] ^= rk[round][i]; }; const xtime = (a) => ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; addRK(0); for (let round = 1; round <= Nr; round++) { for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]]; const t = s.slice(); for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) t[4 * c + r] = s[4 * ((c + r) % 4) + r]; s = t; if (round < Nr) { for (let c = 0; c < 4; c++) { const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3]; s[4 * c] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3; s[4 * c + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3; s[4 * c + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3); s[4 * c + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3); } } addRK(round); } return s; } const data = Utf8Encode(plain); const padLen = 16 - (data.length % 16); for (let i = 0; i < padLen; i++) data.push(padLen); const ks = expandKey(Utf8Encode(keyStr)); let prev = ecb ? null : Utf8Encode(ivStr).slice(0, 16); const out = ivp ? prev.slice() : []; for (let off = 0; off < data.length; off += 16) { const blk = new Array(16); for (let i = 0; i < 16; i++) blk[i] = data[off + i] ^ (ecb ? 0 : prev[i]); prev = encryptBlock(blk, ks.rk, ks.Nr); out.push(...prev); } return BytesToBase64(out); } function _aesdec(cipher, keyStr, ecb, hexIn) { function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function HexToBytes(h) { const s = String(h).replace(/[^0-9a-fA-F]/g, ''); const bytes = []; for (let i = 0; i + 1 < s.length; i += 2) bytes.push(parseInt(s.substr(i, 2), 16)); if (s.length % 2) bytes.push(parseInt(s.slice(-1), 16)); return bytes; } function BytesToUtf8(bytes) { let s = ''; for (let i = 0; i < bytes.length;) { const b = bytes[i]; if (b < 128) { s += String.fromCharCode(b); i += 1; } else if (b >= 240 && i + 3 < bytes.length) { const cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); const v = cp - 0x10000; s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)); i += 4; } else if (b >= 224 && i + 2 < bytes.length) { s += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3; } else if (b >= 192 && i + 1 < bytes.length) { s += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2; } else { s += String.fromCharCode(b); i += 1; } } return s; } const SBOX = (function () { function gmul(a, b) { let p = 0; for (let i = 0; i < 8; i++) { if ((b >> i) & 1) p ^= a; a = ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; } return p; } const sbox = new Array(256); for (let x = 0; x < 256; x++) { let inv = 0; if (x !== 0) { inv = 1; while (gmul(inv, x) !== 1) inv++; } const r = (v, n) => ((v << n) | (v >> (8 - n))) & 0xff; sbox[x] = (inv ^ r(inv, 1) ^ r(inv, 2) ^ r(inv, 3) ^ r(inv, 4) ^ 0x63) & 0xff; } return sbox; })(); const INV_SBOX = (function () { const inv = new Array(256); for (let i = 0; i < 256; i++) inv[SBOX[i]] = i; return inv; })(); function expandKey(key) { const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]; const Nk = key.length >> 2, Nr = Nk + 6, tw = 4 * (Nr + 1); const w = []; for (let i = 0; i < Nk; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]); for (let i = Nk; i < tw; i++) { let t = w[i - 1].slice(); if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]].map(b => SBOX[b]); t[0] ^= RCON[i / Nk - 1]; } else if (Nk > 6 && i % Nk === 4) t = t.map(b => SBOX[b]); w.push([w[i - Nk][0] ^ t[0], w[i - Nk][1] ^ t[1], w[i - Nk][2] ^ t[2], w[i - Nk][3] ^ t[3]]); } const rk = []; for (let round = 0; round <= Nr; round++) { const blk = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) blk[4 * c + r] = w[4 * round + c][r]; rk.push(blk); } return { rk: rk, Nr: Nr }; } function decryptBlock(input, rk, Nr) { let s = input.slice(); const addRK = (round) => { for (let i = 0; i < 16; i++) s[i] ^= rk[round][i]; }; const xtime = (a) => ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; const mul = (a, b) => { let p = 0; for (let i = 0; i < 8; i++) { if ((b >> i) & 1) p ^= a; a = xtime(a); } return p; }; const irows = () => { const t = s.slice(); for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) t[4 * c + r] = s[4 * (((c - r) % 4 + 4) % 4) + r]; s = t; }; addRK(Nr); for (let round = Nr - 1; round >= 1; round--) { irows(); for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]; addRK(round); for (let c = 0; c < 4; c++) { const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3]; s[4 * c] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9); s[4 * c + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13); s[4 * c + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11); s[4 * c + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14); } } irows(); for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]; addRK(0); return s; } const raw = hexIn ? HexToBytes(cipher) : Base64ToBytes(cipher); if (!raw.length || raw.length % 16) return ''; const ks = expandKey(function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; }(keyStr)); let prev = null, start = 0; if (!ecb) { prev = raw.slice(0, 16); start = 16; } const out = []; for (let off = start; off < raw.length; off += 16) { const blk = raw.slice(off, off + 16); const dec = decryptBlock(blk, ks.rk, ks.Nr); const plainBlk = ecb ? dec : dec.map((b, i) => b ^ prev[i]); out.push(...plainBlk); if (!ecb) prev = blk; } const padLen = out[out.length - 1]; if (padLen >= 1 && padLen <= 16 && out.length >= padLen) { let ok = true; for (let i = 0; i < padLen; i++) if (out[out.length - 1 - i] !== padLen) ok = false; if (ok) out.length -= padLen; } return BytesToUtf8(out); } function _sha256hex(string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } return SHA256(Utf8Encode(string)).map(b => b.toString(16).padStart(2, '0')).join(''); } function _b64(str) { const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const u = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) u.push(c); else if (c < 2048) u.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); u.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else u.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } let out = ''; for (let i = 0; i < u.length; i += 3) { const b0 = u[i], b1 = u[i + 1], b2 = u[i + 2]; out += B[b0 >> 2]; out += b1 === undefined ? B[(b0 & 3) << 4] + '==' : b2 === undefined ? B[((b0 & 3) << 4) | (b1 >> 4)] + B[(b1 & 15) << 2] + '=' : B[((b0 & 3) << 4) | (b1 >> 4)] + B[((b1 & 15) << 2) | (b2 >> 6)] + B[b2 & 63]; } return out; } function _b64d(b64) { const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CH[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } let s = ''; for (let i = 0; i < bytes.length;) { const b = bytes[i]; if (b < 128) { s += String.fromCharCode(b); i += 1; } else if (b >= 240 && i + 3 < bytes.length) { const cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); const v = cp - 0x10000; s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)); i += 4; } else if (b >= 224 && i + 2 < bytes.length) { s += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3; } else if (b >= 192 && i + 1 < bytes.length) { s += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2; } else { s += String.fromCharCode(b); i += 1; } } return s; }switch (type) { case 'sha256': return _sha256hex(a); case 'md5': return MD5(a); case 'rsa-sha256': return _rsa(a, b); case 'rsa-enc-pkcs1': return _rsaenc(a, b); case 'hmac-sha256': return _hmac(a, b); case 'aes-cbc': return _aes(a, b, c); case 'aes-ecb': return _aes(a, b, null, true); case 'aes-cbc-ivp': return _aes(a, b, c, false, 2); case 'aes-cbc-dec': return _aesdec(a, b, false); case 'aes-ecb-dec': return _aesdec(a, b, true); case 'aes-ecb-dec-hex': return _aesdec(a, b, true, true); case 'base64-encode': return _b64(String(a)); case 'base64-decode': return _b64d(a); default: return null; } }
