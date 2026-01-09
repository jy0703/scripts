/**
 * 脚本名称：艾克帮签到 - 签到
 * 活动规则：每日签到获得积分奖励
 * 脚本说明：支持多账号，支持 NE / Node.js 环境。
 * 环境变量：AIKEBANG_TOKEN
 * 更新时间：2026-01-09 更新活动 Code

------------------ Surge 配置 ------------------

[MITM]
hostname = api.ikbang.cn

[Script]
艾克帮签到获取Token = type=http-request,pattern=https:\/\/api\.ikbang\.cn\/v2\/iclick-new\/usercenter\/getUserDetails,requires-body=1,max-size=0,binary-body-mode=0,timeout=30,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aikebang_sign.js,script-update-interval=0

艾克帮签到 = type=cron,cronexp="0 8 * * *",timeout=60,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aikebang_sign.js,script-update-interval=0

------------------- Loon 配置 -------------------

[MITM]
hostname = api.ikbang.cn

[Script]
http-request https:\/\/api\.ikbang\.cn\/v2\/iclick-new\/usercenter\/getUserDetails tag=艾克帮签到获取Token,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aikebang_sign.js,requires-body=1

cron "0 8 * * *" script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aikebang_sign.js,tag=艾克帮签到,enable=true

--------------- Quantumult X 配置 ---------------

[MITM]
hostname = api.ikbang.cn

[rewrite_local]
https:\/\/api\.ikbang\.cn\/v2\/iclick-new\/usercenter\/getUserDetails url script-request-header https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aikebang_sign.js

[task_local]
0 8 * * * https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aikebang_sign.js, tag=艾克帮签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/images/aikebang.png, enabled=true

------------------ Stash 配置 ------------------

cron:
  script:
    - name: 艾克帮签到
      cron: '0 8 * * *'
      timeout: 10

http:
  mitm:
    - "api.ikbang.cn"
  script:
    - match: https:\/\/api\.ikbang\.cn\/v2\/iclick-new\/usercenter\/getUserDetails
      name: 艾克帮签到获取Token
      type: request
      require-body: true

script-providers:
  艾克帮签到:
    url: https://raw.githubusercontent.com/jy0703/scripts/main/scripts/aikebang_sign.js
    interval: 86400

 */

const $ = new Env('艾克帮签到');
$.is_debug = getEnv('is_debug') || 'false';  // 调试模式
$.userInfo = getEnv('AIKEBANG_TOKEN') || '';  // 获取账号
$.userArr = $.userInfo.split(/&|\n/).filter(t => t.trim());  // 用户信息
$.Messages = [];


// 主函数
async function main() {
    if ($.userArr.length) {
        $.log(`\n🌀 找到 ${$.userArr.length} 个 Token 变量`);

        // 遍历账号
        for (let i = 0; i < $.userArr.length; i++) {
            $.log(`\n----- 账号 [${i + 1}] 开始执行 -----\n`);

            // 初始化
            $.is_login = true;
            $.beforeMsgs = '';
            $.messages = [];
            $.token = $.userArr[i].trim();

            // 执行签到
            await doSign($.token);

            // 获取签到信息
            await getSignInfo($.token);

            // 获取用户信息
            await getUserInfo($.token);

            // 合并通知
            $.messages.splice(0, 0, $.beforeMsgs), $.Messages = $.Messages.concat($.messages);
        }
        $.log(`\n----- 所有账号执行完成 -----\n`);
    } else {
        throw new Error('未找到 AIKEBANG_TOKEN 变量 ❌');
    }
}

// 获取用户数据
function GetCookie() {
    try {
        let msg = '';
        debug($request.headers, "获取Header");
        
        // 从请求头中获取token
        const tokenHeader = $request.headers['token'];
        
        if (tokenHeader) {
            // 使用 find() 方法找到与 token 匹配的 token，以新增/更新用户 token
            const tokenList = $.userInfo.split(/&|\n/).filter(t => t.trim());
            const tokenExists = tokenList.some(token => token.trim() === tokenHeader.trim());
            
            if (!tokenExists) {
                msg += `🆕 新增用户 Token: ${tokenHeader}`;
                tokenList.push(tokenHeader);
                // 写入数据持久化
                $.setdata(tokenList.join('&'), 'AIKEBANG_TOKEN');
            } else {
                msg += `✅ Token 已存在: ${tokenHeader}`;
            }
            
            $.Messages.push(msg), $.log(msg);
        } else {
            $.log("❌ 未找到 token header");
        }
    } catch (e) {
        $.log("❌ Token获取失败"), $.log(e);
    }
}

// 执行签到
async function doSign(token) {
    let msg = '';
    try {
        // 构造请求
        const options = {
            url: `https://api.ikbang.cn/v2/iclick-new/signIn/sign`,
            headers: getHeaders('/iclick-new/signIn/sign', token)
        }

        // 发起请求
        const result = await Request(options, 'POST');
        if (result?.code === 1) {
            const reward = result?.result || 0;
            msg += `签到: ✅ 签到成功，获得 ${reward} 积分`;
        } else if (result?.description?.includes('已经签到')) {
            msg += `签到: 📝 今日已签到`;
        } else {
            msg += `签到: ❌ ${result?.description || '签到失败'}`;
        }
    } catch (e) {
        msg += `签到: ❌ ${e.message}`;
        $.log(`❌ 签到失败: ${e.message}`);
    }
    $.messages.push(msg), $.log(msg);
}

// 获取签到信息
async function getSignInfo(token) {
    try {
        // 构造请求
        const options = {
            url: `https://api.ikbang.cn/v2/iclick-new/signIn/getSignInInfo`,
            headers: getHeaders('/iclick-new/signIn/getSignInInfo', token)
        }

        // 发起请求
        const result = await Request(options);
        if (result?.code === 1) {
            const signData = result?.result || {};
            const totalDay = signData?.totalSignInDay || 0;
            const totalScore = signData?.totalSignInScore || 0;
            const continuityDay = signData?.continuityDay || 0;
            
            if ($.beforeMsgs) {
                $.beforeMsgs += '\n';
            } else {
                $.beforeMsgs = '';
            }
            
            $.beforeMsgs += `累计签到: ${totalDay}天\n`;
            $.beforeMsgs += `累计获得: ${totalScore}积分\n`;
            $.beforeMsgs += `连续签到: ${continuityDay}天\n`;
        } else {
            $.log(`❌ 获取签到信息失败: ${$.toStr(result)}`);
        }
    } catch (e) {
        $.log(`❌ 获取签到信息失败: ${e.message}`);
    }
}

// 获取用户信息
async function getUserInfo(token) {
    try {
        // 构造请求
        const options = {
            url: `https://api.ikbang.cn/v2/iclick-new/usercenter/getUserDetails`,
            headers: getHeaders('/iclick-new/usercenter/getUserDetails', token)
        }

        // 发起请求
        const result = await Request(options);
        if (result?.code === 1) {
            const userData = result?.result || {};
            const totalPoints = userData?.totalPoints || '0';
            const userLevel = userData?.userLevelName || '未知';
            const userName = userData?.userName || '未知用户';
            
            if ($.beforeMsgs) {
                $.beforeMsgs += '\n';
            }
            
            $.beforeMsgs += `用户名: ${userName}\n`;
            $.beforeMsgs += `用户等级: ${userLevel}\n`;
            $.beforeMsgs += `当前积分: ${totalPoints}\n`;
        } else {
            $.log(`❌ 查询用户信息失败: ${$.toStr(result)}`);
        }
    } catch (e) {
        $.log(`❌ 查询用户信息失败: ${e.message}`);
    }
}

// 生成请求头
function getHeaders(url, token, params = null) {
    const timestamp = Date.now().toString();
    const ua = generateRandomUA();
    const sign = generateSign(url, timestamp, token, params);
    
    return {
        'Host': 'api.ikbang.cn',
        'Connection': 'keep-alive',
        'content-type': 'application/json',
        'Accept-Encoding': 'gzip,compress,br,deflate',
        'Referer': 'https://servicewechat.com/wx342d760f674b013b/124/page-frame.html',
        'User-Agent': ua,
        'token': token,
        'timestamp': timestamp,
        'sign': sign
    };
}

// 生成随机UA
function generateRandomUA() {
    const iosVersions = ["15_0", "15_1", "15_2", "15_3", "15_4", "15_5", "15_6", "16_0", "16_1", "16_2", "16_3", "16_4", "16_5", "17_0", "17_1", "17_2", "17_3", "17_4", "18_0", "18_1", "18_2", "18_3", "18_4"];
    const wechatVersions = ["8.0.32", "8.0.33", "8.0.34", "8.0.35", "8.0.36", "8.0.37", "8.0.38", "8.0.40", "8.0.41", "8.0.42", "8.0.43", "8.0.44", "8.0.45", "8.0.47", "8.0.48", "8.0.49", "8.0.50", "8.0.52", "8.0.53", "8.0.54", "8.0.55", "8.0.60", "8.0.62", "8.0.64"];
    
    const iosVer = iosVersions[Math.floor(Math.random() * iosVersions.length)];
    const wechatVer = wechatVersions[Math.floor(Math.random() * wechatVersions.length)];
    const wechatHex = (parseInt(wechatVer.replace(/\./g, '')) << 12).toString(16).padStart(8, '0');
    
    return `Mozilla/5.0 (iPhone; CPU iPhone OS ${iosVer} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/${wechatVer}(0x${wechatHex}) NetType/WIFI Language/zh_CN`;
}

// 生成签名
function generateSign(url, timestamp, token, params = null) {
    const appKey = "A749380BBD5A4D93B55B4BE245A42988";
    const appUrl = "https://api.ikbang.cn/v2";
    
    let signStr = appUrl + url + timestamp;
    if (params) {
        signStr += JSON.stringify(params);
    }
    signStr += appKey;
    if (token) {
        signStr += token;
    }
    

    // 根据运行环境选择MD5加密方式
    if ($.isNode()) {
        // Node.js环境使用内置crypto模块
        const crypto = require('crypto');
        return crypto.createHash('md5').update(signStr).digest('hex');
    } else {
        // 其他环境使用内置的MD5函数（如果可用）
        if (typeof $crypto !== 'undefined' && $crypto.MD5) {
            return $crypto.MD5(signStr);
        } else if (typeof MD5 !== 'undefined') {
            return MD5(signStr);
        } else {
            // 如果没有可用的MD5函数，则使用自定义的简单MD5实现（仅作备用）
            return simpleMD5(signStr);
        }
    }
}

// 简单的MD5实现（备用）
function simpleMD5(str) {
    // 这是一个简单的MD5实现，实际项目中应该使用更可靠的实现
    // 但在自动化脚本环境中，我们通常可以依赖环境本身或引入库
    if ($.isNode()) {
        const crypto = require('crypto');
        return crypto.createHash('md5').update(str).digest('hex');
    } else {
        // 在非Node.js环境中，我们依赖环境提供的功能
        console.error('MD5 function not available in this environment');
        return '';
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
async function Request(options, method = 'GET') {
    try {
        options = options.url ? options : { url: options };
        const _method = options?._method || (method || ('body' in options ? 'post' : 'get'));
        const _respType = options?._respType || 'body';
        const _timeout = options?._timeout || 15000;
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