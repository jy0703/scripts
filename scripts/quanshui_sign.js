/**
 * 脚本名称：泉水签到 - 签到
 * 活动规则：每日签到获得积分奖励
 * 脚本说明：支持多账号，支持 NE / Node.js 环境。
 * 环境变量：QUANSHUI_TOKEN、quanshui_debug
 * 更新时间：2026-01-08 更新活动 Code

------------------ Surge 配置 ------------------

[MITM]
hostname = java-uapi.quanzhan888.com

[Script]
泉水签到获取Token = type=http-request,pattern=^https?:\/\/java-uapi\.quanzhan888\.com\/u\/user-center\/index,requires-body=1,max-size=0,binary-body-mode=0,timeout=30,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quanshui_sign.js,script-update-interval=0

泉水签到 = type=cron,cronexp="0 8 * * *",timeout=60,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quanshui_sign.js,script-update-interval=0

------------------- Loon 配置 -------------------

[MITM]
hostname = java-uapi.quanzhan888.com

[Script]
http-request ^https?:\/\/java-uapi\.quanzhan888\.com\/u\/user-center\/index tag=泉水签到获取Token,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quanshui_sign.js,requires-body=1

cron "0 8 * * *" script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quanshui_sign.js,tag=泉水签到,enable=true

--------------- Quantumult X 配置 ---------------

[MITM]
hostname = java-uapi.quanzhan888.com

[rewrite_local]
^https?:\/\/java-uapi\.quanzhan888\.com\/u\/user-center\/index url script-request-header https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quanshui_sign.js

[task_local]
0 8 * * * https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quanshui_sign.js, tag=泉水签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/quanshui.png, enabled=true

------------------ Stash 配置 ------------------

cron:
  script:
    - name: 泉水签到
      cron: '0 8 * * *'
      timeout: 10

http:
  mitm:
    - "java-uapi.quanzhan888.com"
  script:
    - match: ^https?:\/\/java-uapi\.quanzhan888\.com\/u\/user-center\/index
      name: 泉水签到获取Token
      type: request
      require-body: true

script-providers:
  泉水签到:
    url: https://raw.githubusercontent.com/jy0703/scripts/main/scripts/quanshui_sign.js
    interval: 86400

 */

const $ = new Env('泉水签到');
$.is_debug = getEnv('quanshui_debug', 'is_debug') || 'false';  // 调试模式
$.userInfo = getEnv('QUANSHUI_TOKEN') || '';  // 获取账号
$.userArr = $.userInfo.split(/&|\n/).filter(t => t.trim());  // 用户信息
$.Messages = [];
// 抓包即时推送呆呆的未决请求：入口 $.done() 前必须等完，否则 Loon/Surge 会掐断异步 POST
$.daidaiTasks = [];


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

        // 获取签到列表
        await getSignList($.token);

        // 获取用户信息
        await getUserInfo($.token);

        // 合并通知
        $.messages.splice(0, 0, $.beforeMsgs), $.Messages = $.Messages.concat($.messages);
    }
    $.log(`\n----- 所有账号执行完成 -----\n`);
    } else {
    throw new Error('未找到 QUANSHUI_TOKEN 变量 ❌');
    }
}

// 获取用户数据
function GetCookie() {
    try {
    let msg = '';
    debug($request.headers, "获取Header");
    
    // 从请求头中获取authorization
    const authHeader = $request.headers['authorization'] || $request.headers['Authorization'];
    
    if (authHeader) {
        // 使用 find() 方法找到与 authorization 匹配的 token，以新增/更新用户 token
        const tokenList = $.userInfo.split(/&|\n/).filter(t => t.trim());
        const tokenExists = tokenList.some(token => token.trim() === authHeader.trim());
        
        if (!tokenExists) {
        msg += `🆕 新增用户 Token: ${authHeader}`;
        tokenList.push(authHeader);
        // 写入数据持久化
        $.setdata(tokenList.join('&'), 'QUANSHUI_TOKEN');
        pushDaidai({ envs: [['QUANSHUI_TOKEN', tokenList.join('&')]] });
        } else {
        return;
        }
        
        $.Messages.push(msg), $.log(msg);
    } else {
        $.log("❌ 未找到 authorization header");
    }
    } catch (e) {
    $.log("❌ Token获取失败"), $.log(e);
    }
}

// 执行签到
async function doSign(token) {
    let msg = '';
    try {
    // 获取当前日期 YYYY-MM-DD 格式
    const today = new Date();
    const signDate = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

    // 构造请求
    const options = {
        url: `https://java-uapi.quanzhan888.com/u/user-sign/do-sign?signDate=${signDate}`,
        headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12; M2007J22C Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.7444.173 Mobile Safari/537.36 XWEB/1420125 MMWEBSDK/20251006 MMWEBID/6699 MicroMessenger/8.0.66.2980(0x28004252) WeChat/arm64 Weixin NetType/4G Language/zh_CN ABI/arm64 MiniProgramEnv/android',
        'Content-Type': 'application/json',
        'version': '2.0.10',
        'charset': 'utf-8',
        'referer': 'https://servicewechat.com/wxcee27346cf362ba6/191/page-frame.html',
        'authorization': token
        }
    }

    // 发起请求
    const result = await Request(options);
    if (result?.code === 200 || result?.code === 0) {
        msg += `签到: ✅ ${'签到成功' || result?.msg || result?.message}`;
    } else if (result?.msg?.includes('已签到') || result?.message?.includes('已签到')) {
        msg += `签到: 📝 今日已签到`;
    } else {
        msg += `签到: ❌ ${result?.msg || result?.message || '签到失败'}`;
    }
    } catch (e) {
    msg += `签到: ❌ ${e.message}`;
    $.log(`❌ 签到失败: ${e.message}`);
    }
    $.messages.push(msg), $.log(msg);
}

// 获取签到列表
async function getSignList(token) {
    try {
    // 构造请求
    const options = {
        url: `https://java-uapi.quanzhan888.com/u/user-sign/list`,
        headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12; M2007J22C Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.7444.173 Mobile Safari/537.36 XWEB/1420125 MMWEBSDK/20251006 MMWEBID/6699 MicroMessenger/8.0.66.2980(0x28004252) WeChat/arm64 Weixin NetType/4G Language/zh_CN ABI/arm64 MiniProgramEnv/android',
        'Content-Type': 'application/json',
        'version': '2.0.10',
        'charset': 'utf-8',
        'referer': 'https://servicewechat.com/wxcee27346cf362ba6/191/page-frame.html',
        'authorization': token
        }
    }

    // 发起请求
    const result = await Request(options);
    if (result?.code === 200 || result?.code === 0) {
        if (result.data && result.data.sign_list && result.data.sign_list.length > 0) {
        // 获取今日签到奖励
        const todaySign = result.data.sign_list.find(s => s.day === new Date().getDate());
        if (todaySign && todaySign.prizeMoney !== undefined) {
            $.beforeMsgs = `\n今日奖励: ${todaySign.prizeMoney}元`;
        }
        }
    } else {
        $.log(`❌ 获取签到列表失败: ${$.toStr(result)}`);
    }
    } catch (e) {
    $.log(`❌ 获取签到列表失败: ${e.message}`);
    }
}

// 获取用户信息
async function getUserInfo(token) {
    try {
    // 构造请求
    const options = {
        url: `https://java-uapi.quanzhan888.com/u/user-center/index`,
        headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12; M2007J22C Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.7444.173 Mobile Safari/537.36 XWEB/1420125 MMWEBSDK/20251006 MMWEBID/6699 MicroMessenger/8.0.66.2980(0x28004252) WeChat/arm64 Weixin NetType/4G Language/zh_CN ABI/arm64 MiniProgramEnv/android',
        'Content-Type': 'application/json',
        'version': '2.0.10',
        'charset': 'utf-8',
        'referer': 'https://servicewechat.com/wxcee27346cf362ba6/191/page-frame.html',
        'authorization': token
        }
    }

    // 发起请求
    const result = await Request(options);
    if (result?.code === 200 || result?.code === 0) {
        if (result.data) {
        const { total_balance, sign_total_prize, sign_month_num, points_num, coupon_num } = result.data;
        
        if ($.beforeMsgs) {
            $.beforeMsgs += '\n';
        } else {
            $.beforeMsgs = '';
        }
        
        $.beforeMsgs += `账户余额: ${total_balance || 0}元\n`;
        $.beforeMsgs += `签到累计: ${sign_total_prize || 0}元\n`;
        $.beforeMsgs += `本月签到: ${sign_month_num || 0}天\n`;
        
        if (points_num && points_num > 0) {
            $.beforeMsgs += `积分: ${points_num}\n`;
        }
        if (coupon_num && coupon_num > 0) {
            $.beforeMsgs += `优惠券: ${coupon_num}张\n`;
        }
        }
    } else {
        $.log(`❌ 查询用户信息失败: ${$.toStr(result)}`);
    }
    } catch (e) {
    $.log(`❌ 查询用户信息失败: ${e.message}`);
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
    // 抓包即时推送是异步 POST：必须等它落地再 $.done()，Loon/Surge 在 $done() 后会丢弃未完成请求
    if ($.daidaiTasks && $.daidaiTasks.length) await Promise.all($.daidaiTasks);
    $.isNode() || $.done();
    })


// 请求函数二次封装
async function Request(options) {
    try {
    options = options.url ? options : { url: options };
    const _method = options?._method || ('body' in options ? 'post' : 'get');
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


// 每台手机一个稳定的来源标识：BoxJS「呆呆面板同步」分区的 @daidai.device 手填；
// 没填就自动生成一次并写回本地，保证同一台手机以后每次抓包都落在面板的同一行。
function getDaidaiSource() {
    try {
        let v = String($.getdata('@daidai.device') || $.getdata('DAIDAI_DEVICE') || '').trim();
        v = v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
        if (v) return v;
        v = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        $.setdata(v, '@daidai.device');
        $.log(`[呆呆推送] 未设置 @daidai.device，已自动生成来源标识: ${v}（可在 BoxJS 里改成好记的名字）`);
        return v;
    } catch (e) { return ''; }
}

// 重写抓到的数据即时推呆呆面板（仅手机侧；网关同值跳过，失败静默不影响主流程）
// 注意：抓包脚本会在 finally 里立刻 $.done()，Loon/Surge 在 $done() 后结束脚本、丢弃未完成请求。
// 所以这里把 POST 包成 Promise 登记进 $.daidaiTasks，由入口统一 await，否则「抓包成功但呆呆没数据」。
function pushDaidai(payload) {
    try {
        if ($.isNode()) return;
        const api = (getEnv('TOOLS_API', '@tools.address') || '').replace(/\/+$/, '');
        const token = getEnv('TOOLS_API_TOKEN', '@tools.token') || '';
        const envs = (payload.envs || []).map(([name, value]) => ({ name, value: String(value) }));
        const boxjs = (payload.boxjs || []).map(([key, value]) => ({ key, value: String(value) }));
        if (!api || !token) { $.log('[呆呆推送] 跳过：BoxJS「取凭证网关(tools)」的 @tools.address / @tools.token 未配置'); return; }
        if (!envs.length && !boxjs.length) return;
        const source = getDaidaiSource();   // 两台手机各占面板同名变量的一行
        const url = `${api}/api/daidai/env/sync`;
        const isLoon = typeof $.isLoon === 'function' && $.isLoon();
        const isQuanX = typeof $.isQuanX === 'function' && $.isQuanX();
        const opts = {
            url,
            headers: { 'X-Token': token, 'Content-Type': 'application/json' },
            body: $.toStr({ envs, boxjs, source }),
            // Loon 的 $httpClient 默认沿「当前路由」(代理节点) 发请求，局域网网关会被发到节点上超时；
            // 且它默认超时只有 5000ms、单位是毫秒（Surge/Stash/Shadowrocket 是秒），必须按平台区分
            timeout: (isLoon || isQuanX) ? 15000 : 15,
        };
        if (isLoon) opts.node = 'DIRECT';   // Loon 专用：强制直连，别把内网请求丢给代理节点
        $.log(`[呆呆推送] → ${url}${source ? ` (来源 ${source})` : ''}`);
        const task = new Promise((resolve) => {
            let settled = false;
            const finish = (line) => {
                if (settled) return;
                settled = true;
                if (line) $.log(line);
                resolve();
            };
            // 兜底超时：网关不通/隧道卡住也不能把重写脚本挂死（要大于客户端 timeout）
            const timer = setTimeout(() => finish('[呆呆推送] 超时已忽略(20s)'), 20000);
            try {
                $.post(opts, (err, resp, data) => {
                    clearTimeout(timer);
                    const r = $.toObj(data) || {};
                    const fail = (r.failed || []).map(f => f.name || f.key).join(',');
                    if (err || r.error || fail) {
                        finish(`[呆呆推送] 异常已忽略(${url}): ${err && (err.message || err) || r.error || fail}`);
                    } else {
                        const parts = [
                            r.source && `来源 ${r.source}`,
                            (r.created || []).length && `新建 ${r.created.length}`,
                            (r.updated || []).length && `更新 ${r.updated.length}`,
                            (r.unchanged || []).length && `同值跳过 ${r.unchanged.length}`,
                            (r.boxjs && r.boxjs.updated || []).length && `box.dat 写 ${r.boxjs.updated.length}`,
                            (r.config_sh && r.config_sh.updated || []).length && `config.sh 写 ${r.config_sh.updated.length}`,
                        ].filter(Boolean).join('、');
                        finish(`[呆呆推送] 完成: ${parts || '网关已受理'}`);
                    }
                });
            } catch (e) { clearTimeout(timer); finish(`[呆呆推送] 异常已忽略: ${e.message || e}`); }
        });
        $.daidaiTasks.push(task);
        return task;
    } catch (e) { $.log(`[呆呆推送] 异常已忽略: ${e.message || e}`); }
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
