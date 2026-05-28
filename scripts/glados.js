/**
 * 脚本名称：GLaDOS / Railgun 自动签到 + 积分兑换（多账号版）
 * 更新时间：2026-05-28
 * 作者：Curtinp118 | 参考 lhtj_new.js 结构优化
 * 使用说明：访问 GLaDOS 任意域名的 /console/account 页面抓包保存 Cookie，定时任务自动执行签到。
 *          支持 glados.network、railgun.info、glados.vip，各域名支持多账号。
 * 环境变量：GLADOS_DATA

------------------ Surge 配置 ------------------

[MITM]
hostname = glados.network, railgun.info, glados.vip

[Script]
GLaDOS获取Cookie = type=http-request,pattern=https:\/\/(glados\.network|railgun\.info|glados\.vip)\/console\/account,requires-body=0,max-size=0,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/glados.js,script-update-interval=0
GLaDOS = type=cron,cronexp="10 7 * * *",timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/glados.js,script-update-interval=0

------------------- Loon 配置 -------------------

[MITM]
hostname = glados.network, railgun.info, glados.vip

[Script]
http-request https:\/\/(glados\.network|railgun\.info|glados\.vip)\/console\/account tag=GLaDOS获取Cookie,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/glados.js
cron "10 7 * * *" script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/glados.js,tag=GLaDOS,enable=true

--------------- Quantumult X 配置 ---------------

[MITM]
hostname = %APPEND% glados.network, railgun.info, glados.vip

[rewrite_local]
^https:\/\/(glados\.network|railgun\.info|glados\.vip)\/console\/account$ url script-request-header https://raw.githubusercontent.com/jy0703/scripts/main/scripts/glados.js

[task_local]
10 7 * * * https://raw.githubusercontent.com/jy0703/scripts/main/scripts/glados.js, tag=GLaDOS 签到, enabled=true

 */

const $ = new Env('GLaDOS');
$.is_debug = getEnv('is_debug') || 'false';
$.userInfo = getEnv('GLADOS_DATA') || '';
$.userArr = $.toObj($.userInfo) || [];
$.Messages = [];

const DOMAINS = ["glados.network", "railgun.info", "glados.vip"];
const EXCHANGE_PLAN = "plan500";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function safeJsonParse(str) {
    try {
        return JSON.parse(str);
    } catch (_) {
        return null;
    }
}

function getEnv(...keys) {
    for (let key of keys) {
        var value = $.isNode() ? process.env[key] || process.env[key.toUpperCase()] || process.env[key.toLowerCase()] || $.getdata(key) : $.getdata(key);
        if (value) return value;
    }
}

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

async function Request(options) {
    try {
        options = options.url ? options : { url: options };
        const _method = options?._method || options?.method || ('body' in options ? 'post' : 'get');
        const _respType = options?._respType || 'body';
        const _timeout = options?._timeout || 15000;

        if ((_method.toLowerCase() === 'post' || _method.toLowerCase() === 'put') && options.body && typeof options.body === 'object') {
            options.body = JSON.stringify(options.body);
            if (!options.headers) {
                options.headers = {};
            }
            if (!options.headers['Content-Type'] && !options.headers['content-type']) {
                options.headers['Content-Type'] = 'application/json;charset=UTF-8';
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

function GetCookie() {
    try {
        $.log("[GLaDOS] GetCookie 函数已触发");
        
        if ($request) {
            $.log(`[GLaDOS] 请求方法: ${$request.method}`);
            $.log(`[GLaDOS] 请求URL: ${$request.url}`);
            
            if ($request.method === 'OPTIONS') {
                $.log("[GLaDOS] OPTIONS 请求，跳过");
                return;
            }
        }

        const headers = $request?.headers || {};
        $.log(`[GLaDOS] 请求头: ${JSON.stringify(headers)}`);
        
        const header = Object.keys(headers).reduce((acc, key) => {
            acc[key.toLowerCase()] = headers[key];
            return acc;
        }, {});

        const cookie = header['cookie'] || header['Cookie'] || '';
        const host = header['host'] || header['Host'] || ($request?.url ? new URL($request.url).hostname : '');

        $.log(`[GLaDOS] Cookie: ${cookie ? '存在 (' + cookie.length + '字符)' : '为空'}`);
        $.log(`[GLaDOS] Host: ${host}`);

        if (!cookie) {
            throw new Error("Cookie 为空");
        }

        if (!host) {
            throw new Error("Host 为空");
        }

        if (!DOMAINS.includes(host)) {
            throw new Error(`不支持的域名: ${host}，支持的域名: ${DOMAINS.join(', ')}`);
        }

        const newData = {
            "userName": '用户',
            "cookie": cookie,
            "domain": host
        };

        const index = $.userArr.findIndex(e => e.cookie == newData.cookie && e.domain == newData.domain);
        if (index !== -1) {
            $.userArr[index] = newData;
            $.Messages.push(`🔄 Cookie已更新 [${host}]`);
            $.log(`🔄 Cookie已更新 [${host}]`);
        } else {
            $.userArr.push(newData);
            $.Messages.push(`🎉 Cookie保存成功 [${host}]`);
            $.log(`🎉 Cookie保存成功 [${host}]`);
        }

        $.setdata($.toStr($.userArr), 'GLADOS_DATA');
        $.log(`[GLaDOS] GLADOS_DATA 已保存，共 ${$.userArr.length} 个账号`);
    } catch (e) {
        $.log("[GLaDOS] ❌ Cookie获取失败:"), $.log(e.message || e);
        $.Messages.push(`❌ Cookie获取失败: ${e.message || e}`);
    }
}

async function checkin(cookie, domain) {
    const url = `https://${domain}/api/user/checkin`;
    const options = {
        url: url,
        method: 'post',
        headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            'Origin': `https://${domain}`,
            'Referer': `https://${domain}/console/current`,
            'User-Agent': UA,
            'Cookie': cookie
        },
        body: { token: domain }
    };

    try {
        const result = await Request(options);
        if (!result) {
            return { status: "签到失败", code: -2, message: "响应为空", points: "0" };
        }

        const code = result?.code ?? -2;
        const message = result?.message || "";
        const points = String(result?.points ?? 0);

        if (code === 0) {
            $.log(`✅ 签到成功 [${domain}]: +${points} 积分, ${message}`);
            return { status: "签到成功", code: 0, message, points };
        } else if (code === 1) {
            $.log(`🔄 重复签到 [${domain}]: ${message}`);
            return { status: "重复签到", code: 1, message, points: "0" };
        } else {
            $.log(`❌ 签到失败 [${domain}]: code=${code}, ${message}`);
            return { status: "签到失败", code, message, points: "0" };
        }
    } catch (error) {
        $.log(`❌ 签到网络错误 [${domain}]: ${error.message}`);
        return { status: "签到失败", code: -2, message: error.message, points: "0" };
    }
}

async function getStatus(cookie, domain) {
    const url = `https://${domain}/api/user/status`;
    const options = {
        url: url,
        method: 'get',
        headers: {
            'Origin': `https://${domain}`,
            'Referer': `https://${domain}/console/current`,
            'User-Agent': UA,
            'Cookie': cookie
        }
    };

    try {
        const result = await Request(options);
        if (!result) {
            return { leftDays: "N/A" };
        }

        const leftDays = result?.data?.leftDays;
        if (leftDays !== undefined && leftDays !== null) {
            const days = parseInt(parseFloat(leftDays), 10);
            $.log(`📊 剩余天数 [${domain}]: ${days} 天`);
            return { leftDays: `${days} 天` };
        }
        return { leftDays: "N/A" };
    } catch (error) {
        $.log(`❌ 查询状态失败 [${domain}]: ${error.message}`);
        return { leftDays: "N/A" };
    }
}

async function getPoints(cookie, domain) {
    const url = `https://${domain}/api/user/points`;
    const options = {
        url: url,
        method: 'get',
        headers: {
            'Origin': `https://${domain}`,
            'Referer': `https://${domain}/console/current`,
            'User-Agent': UA,
            'Cookie': cookie
        }
    };

    try {
        const result = await Request(options);
        if (!result) {
            return { points: "N/A", pointsNum: 0 };
        }

        const points = result?.points;
        if (points !== undefined && points !== null) {
            const pointsInt = parseInt(parseFloat(points), 10);
            $.log(`💰 总积分 [${domain}]: ${pointsInt}`);
            return { points: `${pointsInt}`, pointsNum: pointsInt };
        }
        return { points: "N/A", pointsNum: 0 };
    } catch (error) {
        $.log(`❌ 查询积分失败 [${domain}]: ${error.message}`);
        return { points: "N/A", pointsNum: 0 };
    }
}

async function exchange(cookie, domain, plan) {
    const url = `https://${domain}/api/user/exchange`;
    const options = {
        url: url,
        method: 'post',
        headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            'Origin': `https://${domain}`,
            'Referer': `https://${domain}/console/current`,
            'User-Agent': UA,
            'Cookie': cookie
        },
        body: { planType: plan }
    };

    try {
        const result = await Request(options);
        if (!result) {
            return `兑换失败: 响应为空`;
        }

        const code = result?.code ?? -2;
        const message = result?.message || "";

        if (code === 0) {
            $.log(`🎁 兑换成功 [${domain}]: ${plan}, ${message}`);
            return `兑换成功(${plan})`;
        } else {
            $.log(`❌ 兑换失败 [${domain}]: code=${code}, ${message}`);
            return `兑换失败: ${message}`;
        }
    } catch (error) {
        $.log(`❌ 兑换失败 [${domain}]: ${error.message}`);
        return `兑换失败: ${error.message}`;
    }
}

async function checkinForAccount(user, index) {
    const accountLabel = `账号 #${index + 1}`;
    $.log(`\n══════ ${accountLabel} | ${user.domain} ══════`);

    const statusBefore = await getStatus(user.cookie, user.domain);
    const checkinResult = await checkin(user.cookie, user.domain);
    const pointsResult = await getPoints(user.cookie, user.domain);

    let exchangeResult = "跳过(积分不足)";
    if (pointsResult.pointsNum >= 500) {
        exchangeResult = await exchange(user.cookie, user.domain, EXCHANGE_PLAN);
    } else {
        $.log(`积分 ${pointsResult.pointsNum} < 500，跳过兑换`);
    }

    const statusAfter = await getStatus(user.cookie, user.domain);

    return {
        accountLabel,
        domain: user.domain,
        status: checkinResult.status,
        code: checkinResult.code,
        message: checkinResult.message,
        earnedPoints: checkinResult.points,
        totalPoints: pointsResult.points,
        daysBefore: statusBefore.leftDays,
        daysAfter: statusAfter.leftDays,
        exchange: exchangeResult
    };
}

async function main() {
    if ($.userArr.length) {
        $.log(`\n🌀 找到 ${$.userArr.length} 个账号`);

        const delay = Math.floor(Math.random() * 11);
        $.log(`随机延迟 ${delay}s`);
        await new Promise(resolve => setTimeout(resolve, delay * 1000));

        const allResults = [];

        for (let i = 0; i < $.userArr.length; i++) {
            const user = $.userArr[i];
            const result = await checkinForAccount(user, i);
            allResults.push(result);
        }

        const totalAccounts = allResults.length;
        const ok = allResults.filter(r => r.code === 0).length;
        const dup = allResults.filter(r => r.code === 1).length;
        const fail = allResults.filter(r => r.code !== 0 && r.code !== 1).length;

        const lines = allResults.map(r => {
            const icon = r.code === 0 ? "✅" : r.code === 1 ? "🔄" : "❌";
            const pts = r.earnedPoints !== "0" ? ` +${r.earnedPoints}` : "";
            return `${icon} ${r.accountLabel} ${r.domain} | ${r.status}${pts} | ${r.daysBefore}→${r.daysAfter} | ${r.totalPoints}积分 | ${r.exchange}`;
        });

        $.Messages.push(`\n══════ 签到结果 ══════`);
        $.Messages.push(...lines);
        $.Messages.push(`\n📊 总计: ${totalAccounts}账号 成功${ok} 重复${dup} 失败${fail}`);

        $.log(`\n══════ 签到结果 ══════`);
        $.log(lines.join('\n'));
        $.log(`\n📊 总计: ${totalAccounts}账号 成功${ok} 重复${dup} 失败${fail}`);
    } else {
        throw new Error('未找到 GLADOS_DATA 变量 ❌');
    }
}

!(async () => {
    if (typeof $request !== `undefined`) {
        GetCookie();
    } else {
        await main();
    }
})()
    .catch((e) => {
        $.Messages.push(e.message || e);
        $.logErr(e);
    })
    .finally(async () => {
        await sendMsg($.Messages.join('\n').trim());
        $.done();
    });

function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapiToken"); if (r) { r = r.replace(/\r\n/g, "\n").split("\n"); let c = r.findIndex((t => t.includes("API Token"))); if (-1 !== c) { var d = r[c].split(":")[1].trim(); } r = r.find((t => /^https?:\/\//.test(t))) } if (!r || !d) return $.msg($.name, "boxjs配置错误", "请检查Http Api配置"), void s(!1); $task.fetch({ url: r + "/api/runHelper", method: "POST", headers: { "Authorization": "Bearer " + d, "Content-Type": "application/json" }, body: JSON.stringify({ script: t, name: $.name }) }, ((t, r, a) => { try { a = JSON.parse(a) } catch (t) { } a ? a.success ? ($.log("\n[task_local] Helper返回:\n" + a.log), s(!0)) : ($.log("\n[task_local] Helper错误:\n" + a.message), $.msg($.name, "Helper执行失败", a.message), s(!1)) : ($.log("\n[task_local] Helper无返回"), s(!1)) })) } } log(t, e = "") { this.isMute || (t = "string" == typeof t ? t : JSON.stringify(t, null, 2), console.log(e ? `[${e}] ${t}` : t), this.logs.push(t)) } logErr(t, e = "error") { console.log(`[${e}]`, t) } time(t = "YYYY-MM-DD HH:mm:ss") { let e = new Date; const n = { "M+": e.getMonth() + 1, "d+": e.getDate(), "H+": e.getHours(), "m+": e.getMinutes(), "s+": e.getSeconds(), "q+": Math.floor((e.getMonth() + 3) / 3), S: e.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (e.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let a in n) new RegExp("(" + a + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? n[a] : ("00" + n[a]).substr(("" + n[a]).length))); return t } msg(t, e = "", n = "", a = "") { if (this.isMute) return; if ("undefined" != typeof $notify) $notify(t, e, n, a); else if ("undefined" != typeof $notification) $notification.post(t, e, n); else $.log("\n" + t + (e ? "\n" + e : "") + (n ? "\n" + n : "")) } done(t = {}) { "undefined" != typeof $done ? $done(t) : "undefined" != typeof $task ? $task.complete() : "undefined" != typeof $loon ? "" : "undefined" != typeof $surge ? "" : "undefined" != typeof $node ? process.exit(0) : "" } getdata(t) { var e = ""; if ("undefined" != typeof $prefs && (e = $prefs.valueForKey(t)), "undefined" != typeof $loon && (e = $loon.getKeyValue(t)), "undefined" != typeof $surge && (e = $persistentStore.read(t)), "undefined" != typeof $node) { try { e = require("fs").readFileSync("box.dat", "utf-8") } catch (t) { } try { e = JSON.parse(e)[t] } catch (t) { e = null } } return e } setdata(t, e) { var n = !1; if ("undefined" != typeof $prefs && (n = $prefs.setValueForKey(t, e)), "undefined" != typeof $loon && (n = $loon.setKeyValue(e, t)), "undefined" != typeof $surge && (n = $persistentStore.write(t, e)), "undefined" != typeof $node) { try { var a = require("fs"), i = "box.dat", r = {}; try { r = JSON.parse(a.readFileSync(i, "utf-8")) } catch (t) { } r[e] = t, a.writeFileSync(i, JSON.stringify(r)), n = !0 } catch (t) { n = !1 } } return n } } }
