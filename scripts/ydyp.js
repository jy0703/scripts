/**
 * 脚本名称：移动云盘签到 - 签到
 * 活动规则：每日签到获得云朵奖励
 * 脚本说明：支持多账号，支持 NE / Node.js 环境。
 * 环境变量：ydyp_data
 * 更新时间：2026-01-22

------------------ Surge 配置 ------------------

[MITM]
hostname = h.139.com

[Script]
移动云盘签到获取Token = type=http-request,pattern=^https?:\/\/h\.139\.com\/ccopapi\/share\/share5gMessage,requires-body=1,max-size=0,binary-body-mode=0,timeout=30,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/ydyp.js,script-update-interval=0
移动云盘签到 = type=cron,cronexp="0 8 * * *",timeout=60,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/ydyp.js,script-update-interval=0

------------------- Loon 配置 -------------------

[MITM]
hostname = h.139.com

cron "0 8 * * *" script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/ydyp.js,tag=移动云盘签到,enable=true

--------------- Quantumult X 配置 ---------------

[MITM]
hostname = h.139.com

[rewrite_local]
^https?:\/\/h\.139\.com\/ccopapi\/share\/share5gMessage url script-request-header https://raw.githubusercontent.com/jy0703/scripts/main/scripts/ydyp.js

[task_local]
0 8 * * * https://raw.githubusercontent.com/jy0703/scripts/main/scripts/ydyp.js, tag=移动云盘签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/yidongyunpan.png, enabled=true

------------------ Stash 配置 ------------------

cron:
  script:
    - name: 移动云盘签到
      cron: '0 8 * * *'
      timeout: 10

http:
  mitm:
    - "happy.mail.10086.cn"
    - "caiyun.feixin.10086.cn"
    - "orches.yun.139.com"
    - "h.139.com"
  script:
    - match: ^https?:\/\/h\.139\.com\/ccopapi\/share\/share5gMessage
      name: 移动云盘签到获取Token
      type: request
      require-body: true

script-providers:
  移动云盘签到:
    url: https://raw.githubusercontent.com/jy0703/scripts/main/scripts/ydyp.js
    interval: 86400

 */

const $ = new Env('移动云盘签到');
$.is_debug = getEnv('is_debug') || 'false';  // 调试模式
$.userInfo = getEnv('ydyp_data') || '';  // 获取账号
$.userArr = $.toObj($.userInfo) || [{'Authorization':'Basic bW9iaWxlOjE1OTU4MTY1NzQxOndoZ2I3N1VrfDF8UkNTfDE3NzE2MDc3ODcyNzV8cXZmbGxNbXZJWFNmN21GaWlkai5JUUg5dHhjVFNRSXNYejk5Q2RiZVJVVkhyY1J0UjRFcG9tbHZxa2RiTEdSbWJNclg2OUtKakd2czBIdEpETkowdU8xeDE3TzVDZUFYeEpYU1diMU5pQUlPWnExVV9PN0IwVUhic2ZkSUUyeE1IZGdoOUNlbDhUWktKbzc2MzFTRFBpTUlHV1ZXV1NZVTFjXzRsdzVZT1EwLQ==','phone':'15958165741','token':'bW9iaWxlOjE1OTU4MTY1NzQxOndoZ2I3N1VrfDF8UkNTfDE3NzE2MDc3ODcyNzV8cXZmbGxNbXZJWFNmN21GaWlkai5JUUg5dHhjVFNRSXNYejk5Q2RiZVJVVkhyY1J0UjRFcG9tbHZxa2RiTEdSbWJNclg2OUtKakd2czBIdEpETkowdU8xeDE3TzVDZUFYeEpYU1diMU5pQUlPWnExVV9PN0IwVUhic2ZkSUUyeE1IZGdoOUNlbDhUWktKbzc2MzFTRFBpTUlHV1ZXV1NZVTFjXzRsdzVZT1EwLQ=='}];  // 用户信息 - 从JSON字符串转换为数组
$.Messages = [];
$.err_accounts = '';
$.err_message = '';
$.user_amount = '';


// 主函数
async function main() {
    if ($.userArr.length) {
        $.log(`\n🌀 找到 ${$.userArr.length} 个 CK 变量`);

        // 遍历账号
        for (let i = 0; i < $.userArr.length; i++) {
            $.log(`\n======== ▷ 第 ${i + 1} 个账号 ◁ ========`);
            $.log(`\n----- 账号 [${i + 1}] 开始执行 -----\n`);

            // 初始化
            $.is_login = true;
            $.messages = [];
            const authorization = $.userArr[i]['Authorization'];
            const phone = $.userArr[i]['phone'];
            const token = $.userArr[i]['token'];
            const encrypted_phone = phone.substring(0, 3) + "****" + phone.substring(7);

            // 执行任务
            await runAccount(authorization, phone, token, encrypted_phone);

            // 随机等待5-10s进行下一个账号
            if (i < $.userArr.length - 1) {
                const waitTime = Math.floor(Math.random() * 6) + 5; // 5-10秒
                $.log(`\n随机等待${waitTime}s进行下一个账号`);
                await $.wait(waitTime * 1000);
            }
        }

        $.log(`\n----- 所有账号执行完成 -----\n`);
        
        // 输出异常账号信息
        if ($.err_accounts.trim() !== '') {
            $.Messages.push(`\n失效账号:\n${$.err_accounts}`);
        } else {
            $.Messages.push('当前所有账号ck有效');
        }
        
        if ($.err_message.trim() !== '') {
            $.Messages.push(`\n-错误信息: \n${$.err_message}`);
        }
        
        if ($.user_amount.trim() !== '') {
            $.Messages.push(`\n-云朵数量: \n${$.user_amount}`);
        }
    } else {
        throw new Error('未找到 ydyp_data 变量 ❌');
    }
}

// 执行单个账号任务
async function runAccount(authorization, phone, token, encrypted_phone) {
    // 初始化全局变量
    $.currentAuth = authorization;
    $.currentPhone = phone;
    $.currentToken = token;
    $.currentEncryptedPhone = encrypted_phone;
    $.notebook_id = null;
    $.note_token = null;
    $.note_auth = null;
    $.click_num = 15;  // 定义抽奖次数和摇一摇戳一戳次数
    $.draw = 1;  // 抽奖次数，首次免费
    $.timestamp = Date.now().toString();
    $.ua = 'Mozilla/5.0 (Linux; Android 11; M2012K10C Build/RP1A.200720.011; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/90.0.4430.210 Mobile Safari/537.36 MCloudApp/10.0.1';
    $.fruit_url = 'https://happy.mail.10086.cn/jsp/cn/garden/';
    
    if (await jwt()) {
        await signin_status();
        await click();
        // 任务
        await get_tasklist('sign_in_3', 'cloud_app');
        // $.log('\n☁️ 云朵大作战');
        // await cloud_game();
        // $.log('\n🌳 果园任务');
        // await fruitLogin();
        $.log('\n📰 公众号任务');
        await wxsign();
        await shake();
        await surplus_num();
        $.log('\n🔥 热门任务');
        await backup_cloud();
        await open_send();
        $.log('\n📧 139邮箱任务');
        await get_tasklist('newsign_139mail', 'email_app');
        await receive();
    } else {
        // 失效账号
        $.err_accounts += encrypted_phone + '\n';
    }
}

async function sleep(min_delay = 1, max_delay = 1.5) {
    const delay = Math.random() * (max_delay - min_delay) + min_delay;
    return $.wait(delay * 1000);
}

function log_info(err_msg = null, amount = null) {
    if (err_msg !== null) {
        $.err_message += `用户[${$.currentEncryptedPhone}]:${err_msg}\n`;  // 错误信息
    } else if (amount !== null) {
        $.user_amount += `用户[${$.currentEncryptedPhone}]:${amount}\n`;  // 云朵数量
    }
}

async function sso() {
    const options = {
        url: 'https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken',
        headers: {
            'Authorization': $.currentAuth,
            'User-Agent': $.ua,
            'Content-Type': 'application/json',
            'Accept': '*/*',
            'Host': 'orches.yun.139.com'
        },
        body: {"account": $.currentPhone, "toSourceId": "001005"},
                
    };

    try {
        const sso_data = await Request(options);
        if (sso_data && sso_data.success) {
            const refresh_token = sso_data.data.token;
            return refresh_token;
        } else {
            if (sso_data) {
                $.log(sso_data.message);
            }
            return null;
        }
    } catch (e) {
        $.log(`❌ SSO请求异常: ${e.message}`);
        return null;
    }
}

async function jwt() {
    // 获取jwttoken
    const token = await sso();
    if (token !== null) {
        const options = {
            url: `https://caiyun.feixin.10086.cn:7071/portal/auth/tyrzLogin.action?ssoToken=${token}`,
            headers: {
                'User-Agent': $.ua,
                'Accept': '*/*',
                'Host': 'caiyun.feixin.10086.cn:7071',
            },
                        
        };
        
        try {
            const jwt_data = await Request(options);
            
            if (jwt_data && jwt_data.code !== 0) {
                $.log(jwt_data.msg);
                return false;
            }
            
            if (jwt_data) {
                $.jwtHeaders = {
                    'User-Agent': $.ua,
                    'Accept': '*/*',
                    'Host': 'caiyun.feixin.10086.cn:7071',
                    'jwtToken': jwt_data.result.token
                };
                
                $.cookies = {
                    'jwtToken': jwt_data.result.token,
                    'sensors_stay_time': $.timestamp
                };
                
                return true;
            }
        } catch (e) {
            $.log(`❌ JWT请求异常: ${e.message}`);
            return false;
        }
    } else {
        $.log('-ck可能失效了');
        return false;
    }
}

async function signin_status() {
    await sleep();
    const options = {
        url: 'https://caiyun.feixin.10086.cn/market/signin/page/info?client=app',
        headers: $.jwtHeaders,
        
    };

    try {
        const check_data = await Request(options);
        
        if (check_data && check_data.msg === 'success') {
            const today_sign_in = check_data.result ? check_data.result.todaySignIn : false;

            if (today_sign_in) {
                $.log('✅已签到');
            } else {
                $.log('❌ 未签到');               
                const signin_options = {
                    url: 'https://caiyun.feixin.10086.cn/market/manager/commonMarketconfig/getByMarketRuleName?marketName=sign_in_3',
                    headers: $.jwtHeaders,
                    
                };
                
                const signin_data = await Request(signin_options);

                if (signin_data && signin_data.msg === 'success') {
                    $.log('✅签到成功');
                } else {
                    if (signin_data) {
                        $.log(signin_data.msg);
                        log_info(signin_data.msg);
                    }
                }
            }
        } else if (check_data) {
            $.log(check_data.msg);
            log_info(check_data.msg);
        }
    } catch (e) {
        $.log(`❌ 签到状态请求异常: ${e.message}`);
    }
}

async function click() {
    let successful_click = 0;  // 获得次数

    try {
        for (let i = 0; i < $.click_num; i++) {
            const options = {
                url: "https://caiyun.feixin.10086.cn/market/signin/task/click?key=task&id=319",
                headers: $.jwtHeaders,
                
            };
            
            const return_data = await Request(options);
            
            await $.wait(200); // 等待0.2秒

            if (return_data && return_data.result) {
                $.log(`✅${return_data.result}`);
                successful_click += 1;
            }
        }

        if (successful_click === 0) {
            $.log(`❌未获得 x ${$.click_num}`);
        }
    } catch (e) {
        $.log(`错误信息:${e.message}`);
    }
}

async function refresh_notetoken() {
    try {
        const options = {
            url: 'http://mnote.caiyun.feixin.10086.cn/noteServer/api/authTokenRefresh.do',
            headers: {
                'X-Tingyun-Id': 'p35OnrDoP8k;c=2;r=1122634489;u=43ee994e8c3a6057970124db00b2442c::8B3D3F05462B6E4C',
                'Charset': 'UTF-8',
                'Connection': 'Keep-Alive',
                'User-Agent': 'mobile',
                'APP_CP': 'android',
                'CP_VERSION': '3.2.0',
                'x-huawei-channelsrc': '10001400',
                'Host': 'mnote.caiyun.feixin.10086.cn',
                'Content-Type': 'application/json; charset=UTF-8',
                'Accept-Encoding': 'gzip'
            },
            
            body: {
                "authToken": $.currentToken,
                "userPhone": $.currentPhone
            },
            
        };
        
        const response = await Request(options);
        
        if (response) {
            // 获取响应头中的 NOTE_TOKEN 和 APP_AUTH
            // 由于JavaScript无法直接获取响应头，我们假设它们存在
            $.note_token = response.NOTE_TOKEN || 'default_token';
            $.note_auth = response.APP_AUTH || 'default_auth';
        }
    } catch (e) {
        $.log('出错了:', e.message);
    }
}

async function get_tasklist(url, app_type) {
    const options = {
        url: `https://caiyun.feixin.10086.cn/market/signin/task/taskList?marketname=${url}`,
        headers: $.jwtHeaders,
        
    };
    
    const return_data = await Request(options);
    
    await sleep();
    
    // 任务列表
    const task_list = return_data && return_data.result ? return_data.result : {};

    try {
        for (const task_type in task_list) {
            const tasks = task_list[task_type];
            
            if (['new', 'hidden', 'hiddenabc'].includes(task_type)) {
                continue;
            }
            
            if (app_type === 'cloud_app') {
                if (task_type === 'month') {
                    $.log('\n📆 云盘每月任务');
                    for (const month of tasks) {
                        const task_id = month.id;
                        
                        if ([110, 113, 417, 409].includes(task_id)) {
                            continue;
                        }
                        
                        const task_name = month.name || '';
                        const task_status = month.state || '';

                        if (task_status === 'FINISH') {
                            $.log(`-已完成: ${task_name}`);
                            continue;
                        }
                        
                        $.log(`-去完成: ${task_name}`);
                        await do_task(task_id, 'month', 'cloud_app');
                        await $.wait(2000);
                    }
                } else if (task_type === 'day') {
                    $.log('\n📆 云盘每日任务');
                    for (const day of tasks) {
                        const task_id = day.id;
                        
                        if (task_id === 404) {
                            continue;
                        }
                        
                        const task_name = day.name;
                        const task_status = day.state || '';

                        if (task_status === 'FINISH') {
                            $.log(`-已完成: ${task_name}`);
                            continue;
                        }
                        
                        $.log(`-去完成: ${task_name}`);
                        await do_task(task_id, 'day', 'cloud_app');
                    }
                }
            } else if (app_type === 'email_app') {
                if (task_type === 'month') {
                    $.log('\n📆 139邮箱每月任务');
                    for (const month of tasks) {
                        const task_id = month.id;
                        const task_name = month.name || '';
                        const task_status = month.state || '';
                        
                        if ([1004, 1005, 1015, 1020].includes(task_id)) {
                            continue;
                        }

                        if (task_status === 'FINISH') {
                            $.log(`-已完成: ${task_name}`);
                            continue;
                        }
                        
                        $.log(`-去完成: ${task_name}`);
                        await do_task(task_id, 'month', 'email_app');
                        await $.wait(2000);
                    }
                }
            }
        }
    } catch (e) {
        $.log(`错误信息:${e.message}`);
    }
}

async function do_task(task_id, task_type, app_type) {
    await sleep(); 
    const options = {
        url: `https://caiyun.feixin.10086.cn/market/signin/task/click?key=task&id=${task_id}`,
        headers: $.jwtHeaders,
        
    };
    
    await Request(options);

    if (app_type === 'cloud_app') {
        if (task_type === 'day') {
            if (task_id === 106) {
                $.log('-开始上传文件，默认0kb');
                await updata_file();
            } else if (task_id === 107) {
                await refresh_notetoken();
                $.log('-获取默认笔记id');
                const note_options = {
                    url: 'http://mnote.caiyun.feixin.10086.cn/noteServer/api/syncNotebookV3.do',
                    headers: {
                        'X-Tingyun-Id': 'p35OnrDoP8k;c=2;r=1122634489;u=43ee994e8c3a6057970124db00b2442c::8B3D3F05462B6E4C',
                        'Charset': 'UTF-8',
                        'Connection': 'Keep-Alive',
                        'User-Agent': 'mobile',
                        'APP_CP': 'android',
                        'CP_VERSION': '3.2.0',
                        'x-huawei-channelsrc': '10001400',
                        'APP_NUMBER': $.currentPhone,
                        'APP_AUTH': $.note_auth,
                        'NOTE_TOKEN': $.note_token,
                        'Host': 'mnote.caiyun.feixin.10086.cn',
                        'Content-Type': 'application/json; charset=UTF-8',
                        'Accept': '*/*'
                    },
                    body: {
                        "addNotebooks": [],
                        "delNotebooks": [],
                        "notebookRefs": [],
                        "updateNotebooks": []
                    },
                    
                };
                
                const return_data = await Request(note_options);
                
                if (return_data === null) {
                    return $.log('出错了');
                }
                
                if (return_data.notebooks && return_data.notebooks.length > 0) {
                    $.notebook_id = return_data.notebooks[0].notebookId;
                    $.log('开始创建笔记');
                    await create_note();
                }
            }
        } else if (task_type === 'month') {
            // 月任务暂无特殊处理
        }
    } else if (app_type === 'email_app') {
        if (task_type === 'month') {
            // 邮箱月任务暂无特殊处理
        }
    }
}

async function updata_file() {
    try {
        const options = {
            url: 'https://personal-kd-njs.yun.139.com/hcy/file/create',
            headers: {
                'x-yun-op-type': '1',
                'x-yun-sub-op-type': '100',
                'x-yun-api-version': 'v1',
                'x-yun-client-info': '6|127.0.0.1|1|12.1.0|realme|RMX5060|BCFF2BBA6881DD8E4971803C63DDB5E4|02-00-00-00-00-00|android 15|1264X2592|zh||||032|0|',
                'x-yun-app-channel': '10000023',
                'Authorization': $.currentAuth,
                'Content-Type': 'application/json; charset=UTF-8',
                'User-Agent': 'okhttp/4.12.0',
                'Host': 'personal-kd-njs.yun.139.com',
                'Connection': 'Keep-Alive'
            },
            body: {
                "contentHash": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9", // SHA256 hash of "0"
                "contentHashAlgorithm": "SHA256",
                "contentType": "application/oct-stream",
                "fileRenameMode": "force_rename",
                "localCreatedAt": new Date().toISOString().slice(0, -1) + "+08:00",
                "name": `auto_upload_${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}${String(new Date().getDate()).padStart(2,'0')}_${String(new Date().getHours()).padStart(2,'0')}${String(new Date().getMinutes()).padStart(2,'0')}${String(new Date().getSeconds()).padStart(2,'0')}.txt`,
                "parallelUpload": true,
                "parentFileId": "/",
                "partInfos": [{
                    "end": 1,
                    "partNumber": 1,
                    "partSize": 1,
                    "start": 0
                }],
                "size": 1,
                "type": "file"
            }
        };
        
        const response = await Request(options);
        
        if (response) {
            if (response.success) {
                const final_name = response.data?.fileName || `auto_upload_${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}${String(new Date().getDate()).padStart(2,'0')}_${String(new Date().getHours()).padStart(2,'0')}${String(new Date().getMinutes()).padStart(2,'0')}${String(new Date().getSeconds()).padStart(2,'0')}.txt`;
                $.log(`-上传文件成功，文件名: ${final_name}`);
            } else {
                const error_msg = response.message || "未知错误";
                $.log(`-上传失败: ${error_msg}`);
            }
        } else {
            $.log(`-上传失败，服务器响应为空`);
        }
    } catch (e) {
        $.log(`-上传失败: ${e.message}`);
    }
}

async function create_note() {
    const note_id = get_note_id(32);  // 获取随机笔记id
    const createtime = Date.now().toString();
    await $.wait(3000);
    const updatetime = Date.now().toString();
    const options = {
        url: 'http://mnote.caiyun.feixin.10086.cn/noteServer/api/createNote.do',
        headers: {
            'X-Tingyun-Id': 'p35OnrDoP8k;c=2;r=1122634489;u=43ee994e8c3a6057970124db00b2442c::8B3D3F05462B6E4C',
            'Charset': 'UTF-8',
            'Connection': 'Keep-Alive',
            'User-Agent': 'mobile',
            'APP_CP': 'android',
            'CP_VERSION': '3.2.0',
            'x-huawei-channelsrc': '10001400',
            'APP_NUMBER': $.currentPhone,
            'APP_AUTH': $.note_auth,
            'NOTE_TOKEN': $.note_token,
            'Host': 'mnote.caiyun.feixin.10086.cn',
            'Content-Type': 'application/json; charset=UTF-8',
            'Accept': '*/*'
        },
        
        body: {
            "archived": 0,
            "attachmentdir": note_id,
            "attachmentdirid": "",
            "attachments": [],
            "audioInfo": {
                "audioDuration": 0,
                "audioSize": 0,
                "audioStatus": 0
            },
            "contentid": "",
            "contents": [{
                "contentid": 0,
                "data": "<font size=\"3\">000000</font>",
                "noteId": note_id,
                "sortOrder": 0,
                "type": "RICHTEXT"
            }],
            "cp": "",
            "createtime": createtime,
            "description": "android",
            "expands": {
                "noteType": 0
            },
            "latlng": "",
            "location": "",
            "noteid": note_id,
            "notestatus": 0,
            "remindtime": "",
            "remindtype": 1,
            "revision": "1",
            "sharecount": "0",
            "sharestatus": "0",
            "system": "mobile",
            "tags": [{
                "id": $.notebook_id,
                "orderIndex": "0",
                "text": "默认笔记本"
            }],
            "title": "00000",
            "topmost": "0",
            "updatetime": updatetime,
            "userphone": $.currentPhone,
            "version": "1.00",
            "visitTime": ""
        },
        
    };
    
    const create_note_data = await Request(options);
    
    if (create_note_data && create_note_data.status === 200) {
        $.log('-创建笔记成功');
    } else {
        $.log('-创建失败');
    }
}

function get_note_id(length) {
    const characters = '19f3a063d67e4694ca63a4227ec9a94a19088404f9a28084e3e486b928039a299bf756ebc77aa4f6bfa250308ec6a8be8b63b5271a00350d136d117b8a72f39c5bd15cdfd350cba4271dc797f15412d9f269e666aea5039f5049d00739b320bb9e8585a008b52c1cbd86970cae9476446f3e41871de8d9f6112db94b05e5dc7ea0a942a9daf145ac8e487d3d5cba7cea145680efc64794d43dd15c5062b81e1cda7bf278b9bc4e1b8955846e6bc4b6a61c28f831f81b2270289e5a8a677c3141ddc9868129060c0c3b5ef507fbd46c004f6de346332ef7f05c0094215eae1217ee7c13c8dca6d174cfb49c716dd42903bb4b02d823b5f1ff93c3f88768251b56cc';
    let note_id = '';
    for (let i = 0; i < length; i++) {
        note_id += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return note_id;
}

async function wxsign() {
    await sleep();
    const options = {
        url: 'https://caiyun.feixin.10086.cn/market/playoffic/followSignInfo?isWx=true',
        headers: $.jwtHeaders,
    };
    
    const return_data = await Request(options);

    if (return_data && return_data.msg !== 'success') {
        return $.log(return_data.msg);
    }
    
    if (return_data && return_data.result && !return_data.result.todaySignIn) {
        return $.log('❌签到失败,可能未绑定公众号');
    }
    
    return $.log('✅签到成功');
}

async function shake() {
    let successful_shakes = 0;  // 记录成功摇中的次数

    try {
        for (let i = 0; i < $.click_num; i++) {
            const options = {
                url: "https://caiyun.feixin.10086.cn:7071/market/shake-server/shake/shakeIt?flag=1",
                headers: $.jwtHeaders,
                _method: 'POST',
            };
            
            const return_data = await Request(options);
            
            await $.wait(1000);
            
            if (return_data && return_data.result) {
                const shake_prize_config = return_data.result.shakePrizeconfig;

                if (shake_prize_config) {
                    $.log(`🎉摇一摇获得: ${shake_prize_config.name}`);
                    successful_shakes += 1;
                }
            }
        }
    } catch (e) {
        $.log(`错误信息: ${e.message}`);
    }
    
    if (successful_shakes === 0) {
        $.log(`❌未摇中 x ${$.click_num}`); // 失败不通知
    }
}

async function surplus_num() {
    await sleep();
    const info_options = {
        url: 'https://caiyun.feixin.10086.cn/market/playoffic/drawInfo',
        headers: $.jwtHeaders,
        
    };
    
    const draw_info_data = await Request(info_options);

    if (draw_info_data && draw_info_data.msg === 'success') {
        const remain_num = draw_info_data.result ? draw_info_data.result.surplusNumber || 0 : 0;
        $.log(`剩余抽奖次数${remain_num}`);
        
        if (remain_num > 50 - $.draw) {
            for (let i = 0; i < $.draw; i++) {
                await sleep();
                
                const draw_options = {
                    url: "https://caiyun.feixin.10086.cn/market/playoffic/draw",
                    headers: $.jwtHeaders,
                    
                };
                
                const draw_data = await Request(draw_options);

                if (draw_data && draw_data.code === 0) {
                    const prize_name = draw_data.result ? draw_data.result.prizeName || "" : "";
                    $.log("✅抽奖成功，获得:" + prize_name);
                } else {
                    $.log("❌抽奖失败");
                }
            }
        }
    } else if (draw_info_data) {
        $.log(draw_info_data.msg);
        log_info(draw_info_data.msg);
    }
}

async function fruitLogin() {
    const token = await sso();
    if (token !== null) {
        $.log("-果园专区token刷新成功");
        await sleep();

        // 使用原生HTTP请求获取Cookie
        const options = {
            url: `${$.fruit_url}login/caiyunsso.do?token=${token}&account=${$.currentPhone}&targetSourceId=001208&sourceid=1003&enableShare=1`,
            headers: {
                'Host': 'happy.mail.10086.cn',
                'Upgrade-Insecure-Requests': '1',
                'User-Agent': $.ua,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
                'Referer': 'https://caiyun.feixin.10086.cn:7071/',
                'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            _respType: 'all'
        };
        
        const loginInfoData = await Request(options);
        if (!loginInfoData) {
            $.log("果园登录失败");
            return;
        }
        
        // 从响应中提取Cookie
        const treeCookie = loginInfoData.headers['set-cookie'] ? 
            loginInfoData.headers['set-cookie'].join('; ') : 
            (loginInfoData.headers.cookie || '');
            
        $.treeHeaders = {
            'Host': 'happy.mail.10086.cn',
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': $.ua,
            'Referer': 'https://happy.mail.10086.cn/jsp/cn/garden/wap/index.html?sourceid=1003',
            'Cookie': treeCookie,
        };

        const login_options = {
            url: `${$.fruit_url}login/userinfo.do`,
            headers: $.treeHeaders,
            
        };
        
        const doLoginData = await Request(login_options);
        
        if (doLoginData && doLoginData.result && doLoginData.result.islogin === 1) {
            // 去做果园任务
            await fruitTask();
        } else {
            $.log('❌果园登录失败');
        }
    } else {
        $.log("果园专区token刷新失败");
    }
}

async function fruitTask() {
    // 签到任务
    const check_options = {
        url: `${$.fruit_url}task/checkinInfo.do`,
        headers: $.treeHeaders,
        
    };
    
    let check_sign_data = await Request(check_options);
    
    if (check_sign_data && check_sign_data.success) {
        const today_checkin = check_sign_data.result ? check_sign_data.result.todayCheckin || 0 : 0;
        if (today_checkin === 1) {
            $.log('-果园今日已签到');
        } else {
            const checkin_options = {
                url: `${$.fruit_url}task/checkin.do`,
                headers: $.treeHeaders,
                
            };
            
            const checkin_data = await Request(checkin_options);
            if (checkin_data && checkin_data.result && checkin_data.result.code === 1) {
                $.log('-果园签到成功');
            }
            await sleep();
            
            const water_options = {
                url: `${$.fruit_url}user/clickCartoon.do?cartoonType=widget`,
                headers: $.treeHeaders,
                
            };
            
            const color_options = {
                url: `${$.fruit_url}user/clickCartoon.do?cartoonType=color`,
                headers: $.treeHeaders,
                
            };
            
            const water_data = await Request(water_options);
            const color_data = await Request(color_options);
            
            const given_water = water_data && water_data.result ? water_data.result.given || 0 : 0;
            $.log(`-领取每日水滴: ${given_water}`);
            if (color_data && color_data.result) {
                $.log(`-每日雨滴:${color_data.result.msg}`);
            }
        }
    } else if (check_sign_data) {
        $.log(`-果园签到查询失败: ${check_sign_data.msg || ''}`);
    }

    // 获取任务列表
    const task_list_options = {
        url: `${$.fruit_url}task/taskList.do?clientType=PE`,
        headers: $.treeHeaders,
        
    };
    
    const task_state_options = {
        url: `${$.fruit_url}task/taskState.do`,
        headers: $.treeHeaders,
        
    };
    
    let task_list_data = await Request(task_list_options);
    let task_state_data = await Request(task_state_options);
    
    const task_state_result = task_state_data && task_state_data.result ? task_state_data.result : [];
    const task_list = task_list_data && task_list_data.result ? task_list_data.result : [];

    for (const task of task_list) {
        const task_id = task.taskId || '';
        const task_name = task.taskName || '';
        const water_num = task.waterNum || 0;
        
        if (task_id === 2002 || task_id === 2003) {
            continue;
        }

        const task_obj = task_state_result.find(state => state.taskId === task_id);
        const task_state = task_obj ? task_obj.taskState || 0 : 0;

        if (task_state === 2) {
            $.log(`-已完成: ${task_name}`);
        } else {
            await do_fruit_task(task_name, task_id, water_num);
        }
    }

    // 果树信息
    await tree_info();
}

async function do_fruit_task(task_name, task_id, water_num) {
    $.log(`-去完成: ${task_name}`);
    const options = {
        url: `${$.fruit_url}task/doTask.do?taskId=${task_id}`,
        headers: $.treeHeaders,
    };
    
    const do_task_data = await Request(options);

    if (do_task_data && do_task_data.success) {
        
        const water_options = {
            url: `${$.fruit_url}task/givenWater.do?taskId=${task_id}`,
            headers: $.treeHeaders,
            
        };
        
        const get_water_data = await Request(water_options);

        if (get_water_data && get_water_data.success) {
            $.log(`-已完成任务获得水滴: ${water_num}`);
        } else {
            const msg = get_water_data && get_water_data.msg ? get_water_data.msg : '';
            $.log(`❌领取失败: ${msg}`);
        }
    } else {
        const msg = do_task_data && do_task_data.msg ? do_task_data.msg : '';
        $.log(`❌参与任务失败: ${msg}`);
    }
}

async function tree_info() {
    const options = {
        url: `${$.fruit_url}user/treeInfo.do`,
        headers: $.treeHeaders,   
    };
    
    const treeinfo_data = await Request(options);

    if (!(treeinfo_data && treeinfo_data.success)) {
        const error_message = treeinfo_data && treeinfo_data.msg ? treeinfo_data.msg : '获取果园任务列表失败';
        $.log(error_message);
    } else {
        const collect_water = treeinfo_data.result ? treeinfo_data.result.collectWater || 0 : 0;
        const tree_level = treeinfo_data.result ? treeinfo_data.result.treeLevel || 0 : 0;
        $.log(`-当前小树等级: ${tree_level} 剩余水滴: ${collect_water}`);
        
        if ([2, 4, 6, 8].includes(tree_level)) {
            // 开宝箱
            const options = {
                url: `${$.fruit_url}prize/openBox.do`,
                headers: $.treeHeaders,
                
            };
            
            const openbox_data = await Request(options);
            if (openbox_data && openbox_data.result) {
                $.log(`- ${openbox_data.result.msg}`);
            }
        }

        const watering_amount = Math.floor(collect_water / 20);  // 计算需要浇水的次数
        
        if (watering_amount > 0) {
            for (let i = 0; i < watering_amount; i++) {
                const watering_options = {
                    url: `${$.fruit_url}user/watering.do?isFast=0`,
                    headers: $.treeHeaders,
                    
                };
                
                const watering_data = await Request(watering_options);
                if (watering_data && watering_data.success) {
                    $.log('✔️ 浇水成功');
                    await $.wait(3000);
                }
            }
        } else {
            $.log('-水滴不足!');
        }
    }
}

async function cloud_game() {
    const info_options = {
        url: 'https://caiyun.feixin.10086.cn/market/signin/hecheng1T/info?op=info',
        headers: $.jwtHeaders,  
    };
    
    const game_info_data = await Request(info_options);
    
    if (game_info_data && game_info_data.code === 0) {
        const currnum = game_info_data.result ? (game_info_data.result.info ? game_info_data.result.info.curr || 0 : 0) : 0;
        const count = game_info_data.result ? (game_info_data.result.history ? (game_info_data.result.history['0'] ? game_info_data.result.history['0'].count || '' : '') : '') : '';
        const rank = game_info_data.result ? (game_info_data.result.history ? (game_info_data.result.history['0'] ? game_info_data.result.history['0'].rank || '' : '') : '') : '';

        $.log(`今日剩余游戏次数: ${currnum}\n本月排名: ${rank}    合成次数: ${count}`);

        for (let i = 0; i < currnum; i++) {
            const begin_options = {
                url: 'https://caiyun.feixin.10086.cn/market/signin/hecheng1T/beinvite',
                headers: $.jwtHeaders,  
            };
            
            await Request(begin_options);
            
            $.log('-开始游戏,等待10-15秒完成游戏');
            const waitTime = Math.floor(Math.random() * 6) + 10; // 10-15秒
            await $.wait(waitTime * 1000);
            
            const end_options = {
                url: 'https://caiyun.feixin.10086.cn/market/signin/hecheng1T/finish?flag=true&r=active',
                headers: $.jwtHeaders,   
            };
            
            const end_data = await Request(end_options);
            console.log(end_data);
            if (end_data && end_data.code === 0) {
                $.log('游戏成功');
            }
        }
    } else {
        $.log("-获取游戏信息失败");
    }
}

async function receive() {
    const receive_options = {
        url: "https://caiyun.feixin.10086.cn/market/signin/page/receive",
        headers: $.jwtHeaders, 
    };
    
    const prize_options = {
        url: `https://caiyun.feixin.10086.cn/market/prizeApi/checkPrize/getUserPrizeLogPage?currPage=1&pageSize=15&_=${$.timestamp}`,
        headers: $.jwtHeaders,    
    };
    
    const receive_data = await Request(receive_options);
    
    await sleep();
    
    const prize_data = await Request(prize_options);
    
    let result = prize_data && prize_data.result ? prize_data.result.result : [];
    let rewards = '';
    
    if (result && Array.isArray(result)) {
        for (const value of result) {
            const prizeName = value.prizeName;
            const flag = value.flag;
            if (flag === 1) {
                rewards += `-待领取奖品: ${prizeName}\n`;
            }
        }
    }

    const receive_amount = receive_data && receive_data.result ? receive_data.result.receive : '';
    const total_amount = receive_data && receive_data.result ? receive_data.result.total : '';
    
    $.log(`\n-当前待领取:${receive_amount}云朵`);
    $.log(`-当前云朵数量:${total_amount}云朵`);
    
    const msg = `云朵数量:${total_amount} \n${rewards}`;
    log_info(null, msg);
}

async function backup_cloud() {
    const options = {
        url: 'https://caiyun.feixin.10086.cn/market/backupgift/info',
        headers: $.jwtHeaders,   
    };
    
    const backup_data = await Request(options);
    
    const state = backup_data && backup_data.result ? backup_data.result.state : '';
    
    if (state === -1) {
        $.log('本月未备份,暂无连续备份奖励');
    } else if (state === 0) {
        $.log('-领取本月连续备份奖励');
        const cur_options = {
            url: 'https://caiyun.feixin.10086.cn/market/backupgift/receive',
            headers: $.jwtHeaders,  
        };
        
        const cur_data = await Request(cur_options);
        if (cur_data && cur_data.result) {
            $.log(`-获得云朵数量:${cur_data.result.result}`);
        }
    } else if (state === 1) {
        $.log('-已领取本月连续备份奖励');
    }
    
    await sleep();
    
    const expend_options = {
        url: 'https://caiyun.feixin.10086.cn/market/signin/page/taskExpansion',
        headers: $.jwtHeaders,
    };
    
    const expend_data = await Request(expend_options);

    const curMonthBackup = expend_data && expend_data.result ? expend_data.result.curMonthBackup : '';  // 本月备份
    const preMonthBackup = expend_data && expend_data.result ? expend_data.result.preMonthBackup : '';  // 上月备份
    const curMonthBackupTaskAccept = expend_data && expend_data.result ? expend_data.result.curMonthBackupTaskAccept : '';  // 本月是否领取
    const nextMonthTaskRecordCount = expend_data && expend_data.result ? expend_data.result.nextMonthTaskRecordCount : '';  // 下月备份云朵
    const acceptDate = expend_data && expend_data.result ? expend_data.result.acceptDate : '';  // 月份

    if (curMonthBackup) {
        $.log(`- 本月已备份，下月可领取膨胀云朵: ${nextMonthTaskRecordCount}`);
    } else {
        $.log('- 本月还未备份，下月暂无膨胀云朵');
    }

    if (preMonthBackup) {
        if (curMonthBackupTaskAccept) {
            $.log('- 上月已备份，膨胀云朵已领取');
        } else {
            // 领取
            const receive_options = {
                url: `https://caiyun.feixin.10086.cn/market/signin/page/receiveTaskExpansion?acceptDate=${acceptDate}`,
                headers: $.jwtHeaders,  
            };
            
            const receive_data = await Request(receive_options);
            
            if (receive_data && receive_data.code !== 0) {
                const msg = receive_data && receive_data.msg ? receive_data.msg : '';
                $.log(`-领取失败:${msg}`);
            } else {
                const cloudCount = receive_data && receive_data.result ? receive_data.result.cloudCount : '';
                $.log(`- 膨胀云朵领取成功: ${cloudCount}朵`);
            }
        }
    } else {
        $.log('-上月未备份，本月无膨胀云朵领取');
    }
}

async function open_send() {
    const options = {
        url: 'https://caiyun.feixin.10086.cn/market/msgPushOn/task/status',
        headers: $.jwtHeaders, 
    };
    
    const send_data = await Request(options);

    const pushOn = send_data && send_data.result ? send_data.result.pushOn : '';  // 0未开启，1开启，2未领取，3已领取
    const firstTaskStatus = send_data && send_data.result ? send_data.result.firstTaskStatus : '';
    const secondTaskStatus = send_data && send_data.result ? send_data.result.secondTaskStatus : '';
    const onDuaration = send_data && send_data.result ? send_data.result.onDuaration : '';  // 开启时间

    if (pushOn === 1) {
        if (firstTaskStatus === 3) {
            $.log('- 任务1奖励已领取');
        } else {
            // 领取任务1
            $.log('- 领取任务1奖励');
            
            const reward1_options = {
                url: 'https://caiyun.feixin.10086.cn/market/msgPushOn/task/obtain',
                headers: $.jwtHeaders,
                body: {"type": 1}, 
            };
            
            const reward1_data = await Request(reward1_options);
            
            if (reward1_data && reward1_data.result) {
                $.log(reward1_data.result.description || '');
            }
        }

        if (secondTaskStatus === 2) {
            // 领取任务2
            $.log('- 领取任务2奖励');
            
            const reward2_options = {
                url: 'https://caiyun.feixin.10086.cn/market/msgPushOn/task/obtain',
                headers: $.jwtHeaders,
                body: {"type": 2},   
            };
            
            const reward2_data = await Request(reward2_options);
            
            if (reward2_data && reward2_data.result) {
                $.log(reward2_data.result.description || '');
            }
        }

        $.log(`- 通知已开启天数: ${onDuaration}, 满31天可领取奖励`);
    } else {
        $.log('- 通知权限未开启');
    }
}


// 脚本执行入口
// 获取用户数据
function GetCookie() {
    try {
        let msg = '';
        debug($request, "获取请求信息");
        
        const authorization = $request.headers['Authorization'] || $request.headers['authorization'];
        if (authorization) {
            // 从响应体中获取手机号等信息
            const response = $.toObj($response.body);
            const phone = response?.result?.phone || response?.result?.mobile || response?.phone || response?.mobile;
            
            if (phone && authorization) {
                $.log(`✅ 成功获取用户信息`);
                
                // 使用 find() 方法找到与 phone 匹配的对象，以新增/更新用户信息
                const user = $.userArr.find(user => user.phone === phone);
                if (user) {
                    if (user.authorization == authorization) return;
                    msg += `♻️ 更新用户 [${phone}] 信息`;
                    user.authorization = authorization;
                    // 如果还有其他信息也需要更新，比如token
                    if (response?.result?.token) {
                        user.token = response?.result?.token;
                    }
                } else {
                    msg += `🆕 新增用户 [${phone}] 信息`;
                    $.userArr.push({
                        "phone": phone,
                        "Authorization": authorization,
                        "token": response?.result?.token || ''
                    });
                }
                
                // 写入数据持久化
                $.setdata($.toStr($.userArr), 'ydyp_data');
                $.Messages.push(msg), $.log(msg);
            }
        }
    } catch (e) {
        $.log("❌ 用户信息获取失败"), $.log(e);
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
            new Promise((_, reject) => setTimeout(() => reject(new Error(`❌ 请求超时： ${options['url']}`)), _timeout)),
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
        return null;
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