/**
 * 脚本名称：车来了签到 - 签到、惊喜任务（分享朋友圈等）
 * 活动规则：每日签到获得金币奖励，7 天一周期；每日惊喜任务（如分享至朋友圈）完成可领额外金币
 * 脚本说明：支持多账号，支持 NE / Node.js 环境。签到参数（URL 查询参数）由本脚本的 GetCookie 抓取后存入 cll_data
 * 环境变量：cll_data、cll_debug
 * 备注：secret 参数随登录变化，若签到返回"非法请求"，请重新打开签到页抓取参数
 * 更新时间：2026-10-05 修正任务领取：incomplete 先 report 再 claim

------------------ Surge 配置 ------------------

[Script]
车来了获取签到参数 = type=http-request,pattern=^https?:\/\/web\.chelaile\.net\.cn\/api\/op-activity-api\/daily-act\/(signin|config|task\/complete),requires-body=0,max-size=0,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cll_sign.js,script-update-interval=0

车来了签到 = type=cron,cronexp="0 1 * * *",wake-system=1,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cll_sign.js,script-update-interval=0

[MITM]
hostname = web.chelaile.net.cn

------------------- Loon 配置 -------------------

[Script]
http-request ^https?:\/\/web\.chelaile\.net\.cn\/api\/op-activity-api\/daily-act\/(signin|config|task\/complete) script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cll_sign.js, timeout=600, tag=车来了获取签到参数

cron "0 1 * * *" script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cll_sign.js, timeout=600, tag=车来了签到

[MITM]
hostname = web.chelaile.net.cn

--------------- Quantumult X 配置 ---------------

[rewrite_local]
^https?:\/\/web\.chelaile\.net\.cn\/api\/op-activity-api\/daily-act\/(signin|config|task\/complete) url script-request-header https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cll_sign.js

[task_local]
0 1 * * * https://raw.githubusercontent.com/jy0703/scripts/main/scripts/cll_sign.js, tag=车来了签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/cll.png, enabled=true

[MITM]
hostname = web.chelaile.net.cn

 */

const $ = new Env('车来了签到');
$.is_debug = getEnv('cll_debug', 'is_debug') || 'false';  // 调试模式(boxjs 开关 cll_debug)
$.userInfo = getEnv('cll_data') || '';  // 获取账号
$.userArr = parseAccountList($.userInfo);  // 用户信息
$.Messages = [];
// 抓包即时推送呆呆的未决请求：入口 $.done() 前必须等完，否则 Loon/Surge 会掐断异步 POST
$.daidaiTasks = [];

const HOST = 'web.chelaile.net.cn';
const API_BASE = '/api/op-activity-api/daily-act';
// 抓取时剔除的参数：任务专属参数与动态签名三件套（已验证回放无需 signature）
const DROP_KEYS = ['taskType', 'status', 'h5TimeStamp', 'nonce', 'signature'];


// 主函数
async function main() {
    if ($.userArr.length) {
        $.log(`\n🌀 找到 ${$.userArr.length} 个签到参数`);

        // 遍历账号
        for (let i = 0; i < $.userArr.length; i++) {
            $.log(`\n----- 账号 [${i + 1}] 开始执行 -----\n`);

            // 初始化
            $.messages = [];
            $.beforeMsgs = '';
            $.user = $.userArr[i];

            // 查询活动信息（连签天数、惊喜任务列表）
            await getActivityInfo($.user);

            // 执行签到
            await doSign($.user);

            // 领取惊喜任务奖励（分享朋友圈等）
            await doTaskClaims($.user);

            // 合并通知
            $.messages.splice(0, 0, $.beforeMsgs), $.Messages = $.Messages.concat($.messages);
        }

        $.log(`\n----- 所有账号执行完成 -----\n`);
    } else {
        throw new Error('未找到 cll_data 变量 ❌');
    }
}

// 获取签到参数
function GetCookie() {
    try {
        if ($request && $request.method === 'OPTIONS') return;

        const paramsRaw = parseRawQuery($request.url);
        DROP_KEYS.forEach(k => delete paramsRaw[k]);
        if ((!paramsRaw.userId && !paramsRaw.accountId) || !paramsRaw.secret) throw new Error('获取签到参数错误，值为空');

        const capture = {
            'paramsRaw': paramsRaw,
            'headers': {
                'user-agent': $request.headers['user-agent'] || $request.headers['User-Agent'],
                'referer': $request.headers['referer'] || $request.headers['Referer']
            }
        };

        const id = getAccountId(capture);
        const index = $.userArr.findIndex(e => getAccountId(e) === id);
        index !== -1 ? $.userArr[index] = capture : $.userArr.push(capture);
        $.setdata($.toStr($.userArr), 'cll_data');
        pushDaidai({ envs: [['cll_data', $.toStr($.userArr)]] });
        $.Messages.push('🎉获取签到参数成功!');
        $.log('🎉获取签到参数成功!');
    } catch (e) {
        $.log("❌ 签到参数获取失败"), $.log(e);
    }
}

// 查询活动信息
async function getActivityInfo(user) {
    try {
        const options = {
            url: buildUrl(user, '/config'),
            headers: buildHeaders(user)
        };

        const result = await Request(options);

        if (result?.status === '00') {
            const data = result?.data || {};
            user.tasks = data?.surpriseTasks || [];

            const signDays = data?.userStatus?.signDays || 0;
            $.beforeMsgs += `🚌 账号 ${getAccountId(user)} | 已连签 ${signDays} 天\n`;
        } else {
            $.log(`❌ 查询活动信息失败: ${result?.errmsg || $.toStr(result)}`);
        }
    } catch (e) {
        $.log(`❌ 查询活动信息失败: ${e.message}`);
    }
}

// 签到
async function doSign(user) {
    let msg = '';
    try {
        const options = {
            url: buildUrl(user, '/signin'),
            headers: buildHeaders(user)
        };

        const result = await Request(options);
        const status = result?.status;

        if (status === '00') {
            msg = `✅ 签到: 成功, 获得 ${result?.data?.rewardValue || 0} ${rewardName(result?.data?.rewardType)}`;
        } else if (status === '1002') {
            msg = `📝 签到: 今日已签到`;
        } else {
            msg = `❌ 签到: ${result?.errmsg || $.toStr(result)}`;
        }
    } catch (e) {
        msg = `❌ 签到: ${e.message}`;
        $.log(`❌ 签到失败: ${e.message}`);
    }
    $.messages.push(msg), $.log(msg);
}

// 领取惊喜任务奖励（任务状态机: incomplete 未完成 → pending 待领取 → claimed 已领取）
async function doTaskClaims(user) {
    const tasks = user.tasks || [];
    if (!tasks.length) {
        const msg = `📝 惊喜任务: 今日无任务`;
        $.messages.push(msg), $.log(msg);
        return;
    }

    for (const task of tasks) {
        let msg = '';
        const name = task.taskContent || task.taskType;

        if (task.status === 'claimed') {
            msg = `📝 任务[${name}]: 今日已领取`;
            $.messages.push(msg), $.log(msg);
            continue;
        }

        // 未完成：分享任务直接 report 上报完成即可（服务端不校验真实分享），视频类任务需 APP 内看完广告，跳过
        if (task.status === 'incomplete') {
            if (task.taskType !== 'share') {
                msg = `⏭️ 任务[${name}]: 需在APP内完成, 跳过`;
                $.messages.push(msg), $.log(msg);
                continue;
            }
            try {
                const reportResult = await Request({ url: buildUrl(user, '/task/complete', { taskType: task.taskType, status: 'report' }), headers: buildHeaders(user) });
                if (reportResult?.status !== '00') {
                    msg = `❌ 任务[${name}]: 上报失败, ${reportResult?.errmsg || $.toStr(reportResult)}`;
                    $.messages.push(msg), $.log(msg);
                    continue;
                }
                $.log(`📤 任务[${name}]: 上报完成, 等待状态刷新`);
                await $.wait(1500);
            } catch (e) {
                msg = `❌ 任务[${name}]: 上报失败, ${e.message}`;
                $.messages.push(msg), $.log(msg);
                continue;
            }
        }

        // pending（含刚上报的）统一走领取
        try {
            const options = {
                url: buildUrl(user, '/task/complete', { taskType: task.taskType, status: 'claim' }),
                headers: buildHeaders(user)
            };

            const result = await Request(options);

            if (result?.status === '00') {
                const rewardValue = result?.data?.rewardValue || task.rewardValue || 0;
                msg = `🎁 任务[${name}]: 成功, 获得 ${rewardValue} ${rewardName(result?.data?.rewardType || task.rewardType)}`;
            } else if (result?.status === '1005') {
                msg = `📝 任务[${name}]: 今日已领取`;
            } else {
                msg = `❌ 任务[${name}]: ${result?.errmsg || $.toStr(result)}`;
            }
        } catch (e) {
            msg = `❌ 任务[${name}]: ${e.message}`;
        }
        $.messages.push(msg), $.log(msg);
        await $.wait(1000);
    }
}

// 奖励类型名称
function rewardName(type) {
    return type === 'coin' ? '金币' : type === 'vip' ? 'VIP' : (type || '');
}

// 组装请求地址，原始参数直接回放（服务端按天判重，已验证可复用）
function buildUrl(user, path, extra = {}) {
    const params = { ...(user?.paramsRaw || {}), ...extra };
    const query = Object.keys(params).map(k => `${k}=${params[k]}`).join('&');
    return `https://${HOST}${API_BASE}${path}?${query}`;
}

// 请求头沿用抓包内容
function buildHeaders(user) {
    const headers = { ...user?.headers };
    delete headers['Content-Length']; delete headers['content-length'];
    delete headers[':authority']; delete headers[':method']; delete headers[':path']; delete headers[':scheme'];
    // WAF 会话 Cookie 已过期，不携带
    delete headers['cookie']; delete headers['Cookie'];
    headers['Host'] = HOST;
    headers['Accept'] = headers['Accept'] || 'application/json, text/plain, */*';
    return headers;
}

// 保留原始未解码的查询参数，回放请求基于原始值
function parseRawQuery(url) {
    const query = (url.split('?')[1] || '').split('#')[0];
    const rawMap = {};
    query.split('&').forEach(pair => {
        if (!pair) return;
        const idx = pair.indexOf('=');
        if (idx < 0) return;
        rawMap[pair.slice(0, idx)] = pair.slice(idx + 1);
    });
    return rawMap;
}

// 账号标识
function getAccountId(capture) {
    const params = capture?.paramsRaw || {};
    return params.userId || params.accountId || '未知';
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
// 账号变量兼容面板同名多行合并格式：row&row（每行一台手机的 JSON），也兼容单数组/单对象
function parseAccountList(raw) {
    if (!raw) return [];
    const out = [];
    const s = String(raw);
    let depth = 0, inStr = false, esc = false, start = 0;
    const emit = seg => { const a = $.toObj(seg); if (Array.isArray(a)) out.push(...a); else if (a && typeof a === 'object') out.push(a); };
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true;
        else if (ch === '[' || ch === '{') depth++;
        else if (ch === ']' || ch === '}') depth--;
        else if (ch === '&' && depth <= 0) { emit(s.slice(start, i)); start = i + 1; }
    }
    emit(s.slice(start));
    return out;
}
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

