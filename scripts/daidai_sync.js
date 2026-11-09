/**
 * 脚本名称：呆呆面板同步 - BoxJS 数据传入呆呆
 * 脚本说明：把 BoxJS 里的数据一键同步到呆呆面板（仿 FoKit/Scripts 的 BoxJS→青龙 思路，通道划分也一致：cookie 类进环境变量、其余进配置文件）。
 *           数据流向：BoxJS → 取凭证网关(tools) POST /api/daidai/env/sync → 呆呆面板。
 *           账号凭证（cookie/token/账号数据及配套 UA）→ 面板环境变量：同名多行按来源 upsert——推送值与某现有行的账号标识有交集=同一来源=更新该行，
 *           无交集=新来源(另一台手机/新账号集)=同名新建一行（面板运行时按 & 合并注入，互不覆盖）；只增改，不删除、不禁用面板已有变量。
 *           开关/ref/活动ID/抓包产物等配置键 → 面板 config.sh（UI「配置文件」页可见，任务运行前自动 source，脚本 getEnv 从 process.env 读到）；
 *           进度状态/缓存键（xx_state、xx_cache、xx_jar_at、migu_native_xx、@键，脚本 $.getdata 读）→ 面板 box.dat（cwd 下，Env dataFile）；
 *           两者都由网关在面板上完成读-改-写，只增改不删。
 *           在 BoxJS 订阅「呆呆面板同步」点运行即同步；不写 cron 声明（面板订阅不会为它建任务，面板上也没有 BoxJS 数据可同步）。
 *           空值键不同步。运行缓存键(aeon_cache/ydyp_cache 等)是脚本运行时再生的，不同步。
 * 环境变量：TOOLS_API / @tools.address、TOOLS_API_TOKEN / @tools.token（网关连接，必填）；
 *           @daidai.keys（额外同步进环境变量的键，逗号分隔，键名即面板变量名）、@daidai.mute（true 静默）、daidai_debug
 * 更新时间：2026-11-08
 */

const $ = new Env('呆呆面板同步');
$.is_debug = getEnv('daidai_debug', 'is_debug') || 'false';  // 调试模式
$.Messages = [];
const MUTE = ['true', true].includes(getEnv('DAIDAI_MUTE', '@daidai.mute'));  // 肯定式：true 才静默

// 账号凭证 → 面板环境变量：[面板变量名, boxjs 键]，值取 $.getdata(boxjs 键)，与脚本 getEnv 的读取口径一致
const CREDENTIAL_CHAINS = [
    ['aliyun_data', 'aliyun_data'], ['baidu_data', 'baidu_data'], ['cll_data', 'cll_data'],
    ['cmcc_autologin_data', 'cmcc_autologin_data'], ['cmcc_data', 'cmcc_data'],
    ['kuwo_data', 'kuwo_data'], ['lhtj_data', 'lhtj_data'], ['manmanbuy_data', 'manmanbuy_data'],
    ['migu_data', 'migu_data'], ['mixc_data', 'mixc_data'], ['pingme_data', 'pingme_data'],
    ['quark_data', 'quark_data'], ['smzdm_data', 'smzdm_data'], ['tyyp_account', 'tyyp_account'],
    ['ydyp_data', 'ydyp_data'],
    ['AIKEBANG_TOKEN', 'AIKEBANG_TOKEN'], ['HDL', 'HDL'], ['LINLI_USERKEY', '@linli.userkey'],
    ['QUANSHUI_TOKEN', 'QUANSHUI_TOKEN'], ['ZTO_TOKEN', 'ZTO_TOKEN'], ['WPS_COOKIE', 'WPS_COOKIE'],
    ['manmanbuy_users', 'manmanbuy_users'], ['manmanbuy_token', 'manmanbuy_token'],
    ['SMZDM_COOKIE', 'SMZDM_COOKIE'], ['SMZDM_SK', 'SMZDM_SK'],
    // UA 与 cookie 配套使用，随凭证一起走环境变量
    ['SMZDM_USER_AGENT_APP', 'SMZDM_USER_AGENT_APP'], ['SMZDM_USER_AGENT_WEB', 'SMZDM_USER_AGENT_WEB'],
];

// 其余配置 → 面板 box.dat：只列 boxjs 原始键；@键归并成整段 app 存储（@tools.address → 存 tools 整段 JSON），
// 与 BoxJS 持久存储同构，脚本在 Node 下 $.getdata('@tools.address') 的解析结果与 NE 一致
const CONFIG_KEYS = [
    // ---- code 服务 ref / 活动配置 ----
    'aeon_ref', 'aeon_store', 'CMCC_BALANCE_REF', 'HDL_REF', 'LINLI_REF',
    'MILK_TEA_BRANDS', 'MILK_TEA_REF', 'NJ_CAMPAIGN_ID', 'NJ_REF', 'oppo_ref',
    'THYC_REF', 'WPS_REF', 'YXX_PLAZA_CODE', 'YXX_REF', 'cmcc_sevenday_prize_cfg',
    // ---- 共享服务 ----
    '@tools.address', '@tools.token', '@wxCode.address', '@wxCode.open', '@wxCode.token',
    // ---- 行为开关（不同步的话面板会按代码默认值跑，可能把你关掉的门禁打开）----
    'aliyun_cancel', 'aliyun_interact', 'aliyun_time', 'aliyun_video', 'aliyun_video_id',
    'baidu_do_ids', 'baidu_do_tasks',
    'cmcc_activity_id', 'cmcc_channel_id', 'cmcc_claim',
    'cmcc_gold', 'cmcc_gold_at',
    'cmcc_lucky3', 'cmcc_lucky3_draw', 'cmcc_lucky3_gdp', 'cmcc_lucky3_jar', 'cmcc_lucky3_page',
    'cmcc_lucky3_pools', 'cmcc_lucky3_risk_p3', 'cmcc_lucky3_state', 'cmcc_lucky3_task', 'cmcc_lucky3_zw',
    'cmcc_saturday', 'cmcc_seckill', 'cmcc_seed', 'cmcc_seed_channel', 'cmcc_seed_state',
    'cmcc_task_fail',
    // ---- 运行时进度状态（非 token 缓存，丢了会重置天序/退避）----
    'lhtj_lottery_app',
    'cmcc_sevenday_prize_gdp', 'cmcc_sevenday_prize_phone', 'cmcc_sevenday_prize_zw',
    'cmcc_sk_min', 'cmcc_task', 'cmcc_task_skip_days', 'cmcc_video',
    'cmcc_wed', 'cmcc_wed_sk', 'cmcc_wed_sk_at',
    'kuwo_device', 'kuwo_exchange', 'kuwo_notify', 'kuwo_ocr', 'kuwo_phone', 'kuwo_smid',
    'migu_comment', 'migu_comment_text', 'migu_ip', 'migu_listen', 'migu_listen_seconds', 'migu_ringtone',
    'milk_tea_probe',
    'smzdm_comment', 'smzdm_comment_max', 'smzdm_crowd_keyword', 'smzdm_crowd_silver_5',
    'wps_sk_at', 'wps_sk_lead', 'wps_sk_maxwait',
    'ydyp_device_id', 'ydyp_exchange_prizes',
    // ---- 调试开关：is_debug 单独一条，各脚本 getEnv 的第二键回落它在 Node 侧自然生效 ----
    'is_debug',
    'aeon_debug', 'aikebang_debug', 'aliyun_debug', 'baidu_debug', 'cll_debug', 'cmcc_balance_debug',
    'cmcc_debug', 'cmcc_sevenday_prize_debug', 'hdl_debug', 'kuwo_debug', 'lhtj_debug',
    'linli_debug', 'manmanbuy_debug', 'migu_debug', 'milk_tea_debug', 'mixc_debug', 'nj_debug',
    'oppo_debug', 'pingme_debug', 'quanshui_debug', 'quark_debug', 'smzdm_debug', 'thyc_debug',
    'tyyp_debug', 'wps_debug', 'ydyp_debug', 'ydyp_exchange_debug', 'yxx_debug', 'zt_debug',
];

// 主函数
async function main() {
    const api = (getEnv('TOOLS_API', '@tools.address') || '').replace(/\/+$/, '');
    const token = getEnv('TOOLS_API_TOKEN', '@tools.token') || '';
    if (!api) throw new Error('未填 @tools.address（boxjs「取凭证网关(tools)」分区）❌');
    if (!token) throw new Error('填了 @tools.address 但没填 @tools.token ❌');

    // 数据源只读 BoxJS 数据（$.getdata/$.getval），不读 process.env——在面板上跑时读进程环境会把面板变量又同步一遍，没有意义
    const envs = [];
    const seen = new Set();
    const collect = (name, boxjsKey) => {
        if (seen.has(name)) return;
        const v = $.getdata(boxjsKey);
        if (v === null || v === undefined || v === '') return;
        seen.add(name);
        envs.push({ name, value: String(v) });
    };
    for (const [name, key] of CREDENTIAL_CHAINS) collect(name, key);

    // 额外键：键名即面板变量名（面板只收字母数字下划线）
    const extras = (getEnv('DAIDAI_SYNC_KEYS', '@daidai.keys') || '').split(/[,，\s\n]+/).filter(Boolean);
    for (const k of extras) {
        if (!/^[A-Za-z0-9_]+$/.test(k)) { $.log(`⏭ 额外键 ${k}: 不是合法面板变量名(字母数字下划线)，跳过`); continue; }
        collect(k, k);
    }

    // 配置 → 面板 box.dat：取原始存储键值，@键归并到 app 整段（getval 读的是未解析的存储值）
    const boxjs = [];
    const seenRaw = new Set();
    for (const key of CONFIG_KEYS) {
        const rawKey = /^@/.test(key) ? key.slice(1).split('.')[0] : key;
        if (seenRaw.has(rawKey)) continue;
        const v = $.getval(rawKey);
        if (v === null || v === undefined || v === '') continue;
        seenRaw.add(rawKey);
        boxjs.push({ key: rawKey, value: String(v) });
    }

    if (!envs.length && !boxjs.length) { $.log('没有可同步的数据：内置清单与额外键在 BoxJS 里都是空值'); return; }
    if (envs.length) $.log(`📦 凭证 → 环境变量 ${envs.length} 个: ${envs.map(e => e.name).join(', ')}`);
    if (boxjs.length) $.log(`📦 配置 → 面板 box.dat ${boxjs.length} 个键: ${boxjs.map(e => e.key).join(', ')}`);

    const result = await Request({
        url: `${api}/api/daidai/env/sync`,
        headers: { 'X-Token': token },
        body: { envs, boxjs, source: getDaidaiSource() },
        _timeout: 30000,
    });
    if (!result || result.error) throw new Error(`网关同步失败: ${result?.error || '无响应(服务没启动或地址不对)'} ❌`);

    const { created = [], updated = [], unchanged = [], failed = [], boxjs: br = {} } = result;
    if (result.source) $.log(`📱 本机来源: ${result.source}（面板同名变量按来源分行，互不覆盖）`);
    if (created.length) $.log(`✅ 新建 ${created.length}: ${created.join(', ')}`);
    if (updated.length) $.log(`🔄 更新 ${updated.length}: ${updated.join(', ')}`);
    if (unchanged.length) $.log(`⏭ 同值跳过 ${unchanged.length}: ${unchanged.join(', ')}`);
    for (const f of failed) $.log(`❌ ${f.name}: ${f.error}`);
    const bu = br.updated || [], bc = br.unchanged || [], bf = br.failed || [];
    if (bu.length) $.log(`✅ box.dat 写入 ${bu.length}: ${bu.join(', ')}`);
    if (bc.length) $.log(`⏭ box.dat 同值跳过 ${bc.length}: ${bc.join(', ')}`);
    for (const f of bf) $.log(`❌ box.dat ${f.key}: ${f.error}`);
    const cs = result.config_sh || {}, cu = cs.updated || [], cc = cs.unchanged || [], cf = cs.failed || [];
    if (cu.length) $.log(`✅ config.sh 写入 ${cu.length}: ${cu.join(', ')}`);
    if (cc.length) $.log(`⏭ config.sh 同值跳过 ${cc.length}: ${cc.join(', ')}`);
    for (const f of cf) $.log(`❌ config.sh ${f.key}: ${f.error}`);
    $.Messages.push(`✅ 新建 ${created.length}　🔄 更新 ${updated.length}　⏭ 跳过 ${unchanged.length}　📄 box.dat 写 ${bu.length} 跳 ${bc.length}　🧾 config.sh 写 ${cu.length} 跳 ${cc.length}`);
    const fails = failed.map(f => `${f.name}(${f.error})`).concat(bf.map(f => `box.dat ${f.key}(${f.error})`));
    if (fails.length) $.Messages.push(`❌ 失败 ${fails.length}: ${fails.join('、')}`);
}

// 脚本执行入口
!(async () => {
    await main();
})()
    .catch((e) => $.Messages.push(e.message || e) && $.logErr(e))
    .finally(async () => {
        if (!MUTE) await sendMsg($.Messages.join('\n').trimStart().trimEnd());  // 推送通知
        $.isNode() || $.done();
    })


// 每台手机一个稳定的来源标识：BoxJS 本区 @daidai.device 手填；没填就自动生成一次并写回本地，
// 保证手动同步与抓包即时推送用的是同一个 source，落在面板同名变量的同一行。
function getDaidaiSource() {
    try {
        let v = String(getEnv('DAIDAI_DEVICE', '@daidai.device') || '').trim();
        v = v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
        if (v) return v;
        v = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        $.setdata(v, '@daidai.device');
        $.log(`📱 未设置 @daidai.device，已自动生成来源标识: ${v}（可在 BoxJS 里改成好记的名字）`);
        return v;
    } catch (e) { return ''; }
}


// 请求函数二次封装
async function Request(options) {
    try {
        options = options.url ? options : { url: options };
        const _method = options?._method || options?.method || ('body' in options ? 'post' : 'get');
        const _respType = options?._respType || 'body';
        const _timeout = options?._timeout || 15000;

        // Loon 的 $httpClient 默认沿「当前路由」(代理节点) 发请求、默认超时 5000ms：
        // BoxJS 里手动点同步时，发往局域网网关的请求会被丢到节点上超时。强制直连并放宽客户端超时
        // （Node 侧 got 的 timeout 单位不同，不设置，交给上面的 _timeout Promise.race 兜底）
        if (!$.isNode()) {
            const isLoon = typeof $.isLoon === 'function' && $.isLoon();
            const isQuanX = typeof $.isQuanX === 'function' && $.isQuanX();
            options.timeout = (isLoon || isQuanX) ? 30000 : 30;
            if (isLoon) options.node = 'DIRECT';
        }

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

function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.json", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t["media-url"], "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }