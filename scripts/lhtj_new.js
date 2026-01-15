/**
 * 脚本名称：龙湖天街签到 - 签到、抽奖
 * 活动规则：每日签到获得积分、珑珠奖励，可参与抽奖
 * 脚本说明：支持多账号，支持 NE / Node.js 环境。
 * 环境变量：lhtj_data
 * 更新时间：2026-01-15 优化结构

------------------ Surge 配置 ------------------

[MITM]
hostname = gw2c-hw-open.longfor.com

[Script]
龙湖天街获取Cookie = type=http-request,pattern=https:\/\/gw2c\-hw\-open\.longfor\.com\/lmarketing\-task\-api\-mvc\-prod\/openapi\/task\/v1\/signature\/clock,requires-body=0,max-size=0,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/lhtj_new.js,script-update-interval=0
龙湖天街 = type=cron,cronexp="0 1 * * *",timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/lhtj_new.js,script-update-interval=0

------------------- Loon 配置 -------------------

[MITM]
hostname = gw2c-hw-open.longfor.com

[Script]
http-request https:\/\/gw2c\-hw\-open\.longfor\.com\/lmarketing\-task\-api\-mvc\-prod\/openapi\/task\/v1\/signature\/clock tag=龙湖天街获取Cookie,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/lhtj_new.js
cron "0 1 * * *" script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/lhtj_new.js,tag=龙湖天街,enable=true

--------------- Quantumult X 配置 ---------------

[MITM]
hostname = gw2c-hw-open.longfor.com

[rewrite_local]
https:\/\/gw2c\-hw\-open\.longfor\.com\/lmarketing\-task\-api\-mvc\-prod\/openapi\/task\/v1\/signature\/clock url script-request-body https://raw.githubusercontent.com/jy0703/scripts/main/scripts/lhtj_new.js

[task_local]
0 1 * * * https://raw.githubusercontent.com/jy0703/scripts/main/scripts/lhtj_new.js, tag=龙湖天街, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/lhtj.png, enabled=true

 */

const $ = new Env('龙湖天街');
$.is_debug = getEnv('is_debug') || 'false';  // 调试模式
$.userInfo = getEnv('lhtj_data') || '';  // 获取账号
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
            $.user = $.userArr[i];
            
            // 初始化积分和珑珠统计
            $.user.totalPoints = 0;
            $.user.totalLZ = 0;

            // 执行小程序签到
            await doMiniProgramSign($.user);

            // 执行APP签到
            await doAppSign($.user);

            // 执行小程序抽奖签到和抽奖
            await doMiniProgramLotterySign($.user);
            await doMiniProgramLottery($.user);

            // 执行APP抽奖签到和抽奖
            await doAppLotterySign($.user);
            await doAppLottery($.user);

            // 获取用户信息
            await getUserInfo($.user);

            // 获取珑珠余额
            await getBalance($.user);

            // 在用户信息后添加该账号的统计信息
            $.beforeMsgs += `📊 本次运行获得: ${$.user.totalPoints} 积分, ${$.user.totalLZ} 珑珠\n`;
            
            // 合并通知
            $.messages.splice(0, 0, $.beforeMsgs), $.Messages = $.Messages.concat($.messages);
            
            // 在每个账号结束后添加额外换行
            $.Messages.push(""); // 添加一个空行作为账号间的分隔
        }
        
        // 添加总计信息
        let totalPoints = 0;
        let totalLZ = 0;
        for (const user of $.userArr) {
            totalPoints += user.totalPoints || 0;
            totalLZ += user.totalLZ || 0;
        }
        
        $.Messages.push(`\n📊 本次运行总计获得: ${totalPoints} 积分, ${totalLZ} 珑珠`);
        $.log(`\n----- 所有账号执行完成 -----\n`);
    } else {
        throw new Error('未找到 lhtj_data 变量 ❌');
    }
}

// 获取Cookie数据
function GetCookie() {
    try {
        if ($request && $request.method === 'OPTIONS') return;

        const header = ObjectKeys2LowerCase($request.headers);
        if (!header.cookie) throw new Error("获取Cookie错误，值为空");

        const newData = {
            "userName": '微信用户',
            'x-lf-dxrisk-token': header['x-lf-dxrisk-token'],
            "x-lf-channel": header['x-lf-channel'],
            "token": header.token,
            'x-lf-usertoken': header['x-lf-usertoken'],
            "cookie": header.cookie,
            "x-lf-bu-code": header['x-lf-bu-code'],
            'x-lf-dxrisk-source': header['x-lf-dxrisk-source']
        }
        
        const index = $.userArr.findIndex(e => e.token == newData.token);
        index !== -1 ? $.userArr[index] = newData : $.userArr.push(newData);
        $.setdata($.toStr($.userArr), 'lhtj_data');
        $.Messages.push('🎉获取Cookie成功!');
        $.log('🎉获取Cookie成功!');
    } catch (e) {
        $.log("❌ Cookie获取失败"), $.log(e);
    }
}

// 小程序签到
async function doMiniProgramSign(user) {
    let msg = '';
    try {
        const options = {
            url: "https://gw2c-hw-open.longfor.com/lmarketing-task-api-mvc-prod/openapi/task/v1/signature/clock",
            headers: {
                'cookie': user.cookie,
                'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.48(0x18003029) NetType/4G Language/zh_CN miniProgram/wx50282644351869da',
                'token': user.token,
                'x-lf-dxrisk-token': user['x-lf-dxrisk-token'],
                'x-gaia-api-key': 'c06753f1-3e68-437d-b592-b94656ea5517',
                'x-lf-bu-code': user['x-lf-bu-code'],
                'x-lf-channel': user['x-lf-channel'],
                'origin': 'https://longzhu.longfor.com',
                'referer': 'https://longzhu.longfor.com/',
                'x-lf-dxrisk-source': user['x-lf-dxrisk-source'],
                'Connection': 'keep-alive',
                'content-type': 'application/json',
                'Accept-Encoding': 'gzip,compress,br,deflate',
                'x-lf-usertoken': user['x-lf-usertoken']
            },
            body: {
                'activity_no': '11111111111686241863606037740000'
            }
        }

        const result = await Request(options);

        // 计算所有奖励的总和
        let reward_sum = 0;
        if(result?.data?.is_popup == 1 && result?.data?.reward_info && Array.isArray(result?.data?.reward_info)) {
            reward_sum = result.data.reward_info
                .filter(item => item?.reward_type === 20)  // 只保留reward_type为20的项
                .reduce((sum, item) => sum + (item?.reward_num || 0), 0);  // 计算这些项的reward_num总和
                
            // 更新累计积分
            user.totalPoints = (user.totalPoints || 0) + reward_sum;
        }
        
        if (result?.data?.is_popup == 1) {
            msg += `小程序签到: ✅ 成功, 获得 ${reward_sum} 分`;
        } else {
            msg += `小程序签到: 📝 今日已签到`;
        }
    } catch (e) {
        msg += `小程序签到: ❌ ${e.message}`;
        $.log(`❌ 小程序签到失败: ${e.message}`);
    }
    $.messages.push(msg), $.log(msg);
}

// APP签到
async function doAppSign(user) {
    let msg = '';
    try {
        const options = {
            url: "https://gw2c-hw-open.longfor.com/lmarketing-task-api-mvc-prod/openapi/task/v1/signature/clock",
            headers: {
                'cookie': user.cookie,
                'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.48(0x18003029) NetType/4G Language/zh_CN miniProgram/wx50282644351869da',
                'token': user.token,
                'x-lf-dxrisk-token': user['x-lf-dxrisk-token'],
                'x-gaia-api-key': 'c06753f1-3e68-437d-b592-b94656ea5517',
                'x-lf-bu-code': user['x-lf-bu-code'],
                'x-lf-channel': user['x-lf-channel'],
                'origin': 'https://longzhu.longfor.com',
                'referer': 'https://longzhu.longfor.com/',
                'x-lf-dxrisk-source': user['x-lf-dxrisk-source'],
                'x-lf-usertoken': user['x-lf-usertoken']
            },
            
            body: {
                'activity_no': '11111111111736501868255956070000'
            }
        };

        const result = await Request(options);
        
        // 计算所有奖励的总和
        let appreward_sum = 0;
        let lzreward = 0;
        if(result?.data?.is_popup == 1 && result?.data?.reward_info && Array.isArray(result?.data?.reward_info)) {
            appreward_sum = result.data.reward_info
                .filter(item => item?.reward_type === 20)  // 只保留reward_type为20的项
                .reduce((sum, item) => sum + (item?.reward_num || 0), 0);  // 计算这些项的reward_num总和
            
            // 查找珑珠奖励
            const rewardType10 = result.data.reward_info.find(item => item?.reward_type === 10);
            lzreward = rewardType10 ? rewardType10.reward_num : 0;
            
            // 更新累计积分和珑珠
            user.totalPoints = (user.totalPoints || 0) + appreward_sum;
            user.totalLZ = (user.totalLZ || 0) + lzreward;
        }
        
        if (result?.data?.is_popup == 1) {
            msg += `APP签到: ✅ 成功, 获得 ${appreward_sum} 分, ${lzreward} 龙珠`;
        } else {
            msg += `APP签到: 📝 今日已签到`;
        }
    } catch (e) {
        msg += `APP签到: ❌ ${e.message}`;
        $.log(`❌ APP签到失败: ${e.message}`);
    }
    $.messages.push(msg), $.log(msg);
}

// 小程序抽奖签到
async function doMiniProgramLotterySign(user) {
    let msg = '';
    try {
        const options = {
            url: "https://gw2c-hw-open.longfor.com/llt-gateway-prod/api/v1/activity/auth/lottery/sign",
            headers: {
                'cookie': user.cookie,
                'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.48(0x18003029) NetType/4G Language/zh_CN miniProgram/wx50282644351869da',
                'authtoken': user.token,
                'x-gaia-api-key': '2f9e3889-91d9-4684-8ff5-24d881438eaf',
                'x-lf-dxrisk-token': user['x-lf-dxrisk-token'],
                'bucode': user['x-lf-bu-code'],
                'channel': user['x-lf-channel'],
                'x-lf-dxrisk-source': user['x-lf-dxrisk-source'],
                'origin': 'https://llt.longfor.com',
                'referer': 'https://llt.longfor.com'
            },
            
            body: {
                "component_no": "CO13545A08P7EI9Y",
                "activity_no": "AP25O123K1HEE8DB"
            }
        };

        const result = await Request(options);
        
        if (result?.code == '0000') {
            msg += `小程序抽奖签到: ✅ 成功, 获得 ${result?.data?.chance} 次抽奖机会`;
        } else {
            msg += `小程序抽奖签到: ❌ ${result?.message}`;
        }
    } catch (e) {
        msg += `小程序抽奖签到: ❌ ${e.message}`;
        $.log(`❌ 小程序抽奖签到失败: ${e.message}`);
    }
    $.messages.push(msg), $.log(msg);
}

// 小程序抽奖
async function doMiniProgramLottery(user) {
    let msg = '';
    try {
        const options = {
            url: "https://gw2c-hw-open.longfor.com/llt-gateway-prod/api/v1/activity/auth/lottery/click",
            headers: {
                'cookie': user.cookie,
                'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.48(0x18003029) NetType/4G Language/zh_CN miniProgram/wx50282644351869da',
                'authtoken': user.token,
                'x-lf-dxrisk-token': user['x-lf-dxrisk-token'],
                'x-gaia-api-key': '2f9e3889-91d9-4684-8ff5-24d881438eaf',
                'bucode': user['x-lf-bu-code'],
                'channel': user['x-lf-channel'],
                'origin': 'https://llt.longfor.com',
                'referer': 'https://llt.longfor.com',
                'x-lf-dxrisk-source': user['x-lf-dxrisk-source']
            },
            
            body: {
                "component_no": "CO13545A08P7EI9Y",
                "activity_no": "AP25O123K1HEE8DB",
                "batch_no": ""
            }
        };
       
        const result = await Request(options);
        
        if (result?.code == '0000' && result?.data?.reward_num > 0) {
            // 更新累计珑珠
            user.totalLZ = (user.totalLZ || 0) + result?.data?.reward_num;
            msg += `小程序抽奖: ✅ 成功, 获得 ${result?.data?.reward_num} ${result?.data?.prize_name}`;
        } else if (result?.code == '0000' && result?.data?.reward_num == 0) {
            msg += `小程序抽奖: 😐 成功, 获得 空气`;
        } else {
            msg += `小程序抽奖: ❌ ${result?.message}`;
        }
    } catch (e) {
        msg += `小程序抽奖: ❌ ${e.message}`;
        $.log(`❌ 小程序抽奖失败: ${e.message}`);
    }
    $.messages.push(msg), $.log(msg);
}

// APP抽奖签到
async function doAppLotterySign(user) {
    let msg = '';
    try {
        // 定义两组ID
        const idGroups = [
            {
                component_no: "CC13U47045E3262G",
                activity_no: "AP25I123Y1CKKXSL"
            },
            {
                component_no: "CU15A06D41Y9ZECJ", 
                activity_no: "AP260010Y6WP4KCV"
            }
        ];
        
        let totalChances = 0;
        
        for(const group of idGroups) {
            const options = {
                url: "https://gw2c-hw-open.longfor.com/llt-gateway-prod/api/v1/activity/auth/lottery/sign",
                headers: {
                    'cookie': user.cookie,
                    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.48(0x18003029) NetType/4G Language/zh_CN miniProgram/wx50282644351869da',
                    'authtoken': user.token,
                    'x-gaia-api-key': '2f9e3889-91d9-4684-8ff5-24d881438eaf',
                    'x-lf-dxrisk-token': user['x-lf-dxrisk-token'],
                    'bucode': user['x-lf-bu-code'],
                    'channel': user['x-lf-channel'],
                    'x-lf-dxrisk-source': user['x-lf-dxrisk-source'],
                    'origin': 'https://llt.longfor.com',
                    'referer': 'https://llt.longfor.com'
                },
                
                body: {
                    "component_no": group.component_no,
                    "activity_no": group.activity_no
                }
            };
            
            const result = await Request(options);
            
            if (result?.code == '0000') {
                totalChances += result?.data?.chance;
                msg += `APP抽奖签到(${group.activity_no}): ✅ 成功, 获得 ${result?.data?.chance} 次抽奖机会\n`;
            } else {
                msg += `APP抽奖签到(${group.activity_no}): ❌ ${result?.message}\n`;
            }
        }
        
        // 清理多余换行
        msg = msg.trim();
    } catch (e) {
        msg = `APP抽奖签到: ❌ ${e.message}`;
        $.log(`❌ APP抽奖签到失败: ${e.message}`);
    }
    $.messages.push(msg), $.log(msg);
}

// APP抽奖
async function doAppLottery(user) {
    let msg = '';
    try {
        // 定义两组ID
        const idGroups = [
            {
                component_no: "CC13U47045E3262G",
                activity_no: "AP25I123Y1CKKXSL"
            },
            {
                component_no: "CU15A06D41Y9ZECJ", 
                activity_no: "AP260010Y6WP4KCV"
            }
        ];
        
        for(const group of idGroups) {
            // 先获取该组的抽奖次数
            const chanceOptions = {
                url: `https://gw2c-hw-open.longfor.com/llt-gateway-prod/api/v1/activity/auth/lottery/chance?component_no=${group.component_no}&activity_no=${group.activity_no}`,
                headers: {
                    'cookie': user.cookie,
                    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.48(0x18003029) NetType/4G Language/zh_CN miniProgram/wx50282644351869da',
                    'authtoken': user.token,
                    'x-gaia-api-key': '2f9e3889-91d9-4684-8ff5-24d881438eaf',
                    'x-lf-dxrisk-token': user['x-lf-dxrisk-token'],
                    'bucode': user['x-lf-bu-code'],
                    'channel': user['x-lf-channel'],
                    'x-lf-dxrisk-source': user['x-lf-dxrisk-source'],
                    'origin': 'https://llt.longfor.com',
                    'referer': 'https://llt.longfor.com'
                },
                method: 'get'
            };
            
            const chanceResult = await Request(chanceOptions);
            
            if (chanceResult?.code == '0000' && chanceResult?.data?.chance > 0) {
                // 执行该组的抽奖
                const options = {
                    url: "https://gw2c-hw-open.longfor.com/llt-gateway-prod/api/v1/activity/auth/lottery/click",
                    headers: {
                        'cookie': user.cookie,
                        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.48(0x18003029) NetType/4G Language/zh_CN miniProgram/wx50282644351869da',
                        'authtoken': user.token,
                        'x-gaia-api-key': '2f9e3889-91d9-4684-8ff5-24d881438eaf',
                        'x-lf-dxrisk-token': user['x-lf-dxrisk-token'],
                        'bucode': user['x-lf-bu-code'],
                        'channel': user['x-lf-channel'],
                        'origin': 'https://llt.longfor.com',
                        'referer': 'https://llt.longfor.com',
                        'x-lf-dxrisk-source': user['x-lf-dxrisk-source']
                    },
                    
                    body: {
                        "component_no": group.component_no,
                        "activity_no": group.activity_no,
                        "batch_no": ""
                    },
                    dataType: "json"
                };
                
                const result = await Request(options);
                
                if (result?.code == '0000' && result?.data?.reward_num > 0) {
                    // 更新累计珑珠
                    user.totalLZ = (user.totalLZ || 0) + result?.data?.reward_num;
                    msg += `APP抽奖(${group.activity_no}): ✅ 成功, 获得 ${result?.data?.reward_num} ${result?.data?.prize_name}\n`;
                } else if (result?.code == '0000' && result?.data?.reward_num == 0) {
                    msg += `APP抽奖(${group.activity_no}): 😐 成功, 获得 空气\n`;
                } else {
                    msg += `APP抽奖(${group.activity_no}): ❌ ${result?.message}\n`;
                }
            } else {
                msg += `APP抽奖(${group.activity_no}): 📝 无抽奖机会\n`;
            }
        }
        
        // 清理多余换行
        msg = msg.trim();
    } catch (e) {
        msg = `APP抽奖: ❌ ${e.message}`;
        $.log(`❌ APP抽奖失败: ${e.message}`);
    }
    $.messages.push(msg), $.log(msg);
}

// 获取用户信息
async function getUserInfo(user) {
    try {
        const options = {
            url: "https://longzhu-api.longfor.com/lmember-member-open-api-prod/api/member/v1/mine-info",
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.48(0x18003029) NetType/4G Language/zh_CN miniProgram/wx50282644351869da',
                'Referer': 'https://servicewechat.com/wx50282644351869da/424/page-frame.html',
                'token': user.token,
                'X-Gaia-Api-Key': 'd1eb973c-64ec-4dbe-b23b-22c8117c4e8e'
            },
            
            body: {
                "channel": user['x-lf-channel'],
                "bu_code": user['x-lf-bu-code'],
                "token": user.token
            }
        };
       
        const result = await Request(options);
        
        if (result?.code == '0000') {
            const userData = result?.data || {};
            const growth_value = userData?.growth_value || 0;
            const level = userData?.level || 0;
            const nick_name = userData?.nick_name || '未知';
            
            if ($.beforeMsgs) {
                $.beforeMsgs += '\n';
            }
            
            $.beforeMsgs += `用户名: ${nick_name}\n`;
            $.beforeMsgs += `成长值: ${growth_value}\n`;
            $.beforeMsgs += `等级: V${level}\n`;
        } else {
            $.log(`❌ 查询用户信息失败: ${$.toStr(result)}`);
        }
    } catch (e) {
        $.log(`❌ 查询用户信息失败: ${e.message}`);
    }
}

// 获取珑珠余额
async function getBalance(user) {
    try {
        const options = {
            url: "https://longzhu-api.longfor.com/lmember-member-open-api-prod/api/member/v1/balance",
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.48(0x18003029) NetType/4G Language/zh_CN miniProgram/wx50282644351869da',
                'Referer': 'https://servicewechat.com/wx50282644351869da/424/page-frame.html',
                'token': user.token,
                'X-Gaia-Api-Key': 'd1eb973c-64ec-4dbe-b23b-22c8117c4e8e'
            },
            
            body: {
                "channel": user['x-lf-channel'],
                "bu_code": user['x-lf-bu-code'],
                "token": user.token
            }
        };
        
        const result = await Request(options);
        
        if (result?.code == '0000') {
            const balanceData = result?.data || {};
            const balance = balanceData?.balance || 0;
            const expiring_lz = balanceData?.expiring_lz || 0;
            
            if ($.beforeMsgs) {
                $.beforeMsgs += '\n';
            }
            
            $.beforeMsgs += `珑珠余额: ${balance}\n`;
            $.beforeMsgs += `即将过期: ${expiring_lz}\n`;
        } else {
            $.log(`❌ 查询珑珠余额失败: ${$.toStr(result)}`);
        }
    } catch (e) {
        $.log(`❌ 查询珑珠余额失败: ${e.message}`);
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
