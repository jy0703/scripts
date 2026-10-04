/**
 * 脚本名称：移动云盘商品抢兑
 * 活动规则：云朵中心（sign_in_3）用云朵抢兑商品，每日 10:00 / 16:00 / 00:00 补货
 * 脚本说明：复用「移动云盘签到」(ydyp.js) 抓包得到的 App 端 Authorization，
 *          sso querySpecToken → tyrzLogin 取 jwtToken（与 App 同为 loginType=2 登录态），
 *          再读商品列表、识别滑块偏移量(纯 JS PNG + 掩码 NCC)、按 prizeId 调用 exchangeV3(App 端接口) 抢兑。
 *          deviceId 走数美 deviceprofile/v4（RSA 公钥加密设备指纹，每次运行动态取号），失败回退「移动云盘签到」(ydyp.js) 写在 ydyp_cache 里的 deviceId，再缺失靠服务端 Set-Cookie 回填。
 * 配置说明：账号来自 boxjs「移动云盘签到」分组的 ydyp_data（由签到插件抓取 user-njs.yun.139.com/user/ 的 Authorization），
 *          Authorization 的到期刷新同样由签到脚本维护，本脚本只读不写；Node 环境变量 YDYP_DATA 同名可用。
 *          抢兑商品ID: boxjs「移动云盘商品抢兑」里的 ydyp_exchange_prizes（多个英文逗号分隔，留空则只查询不兑换）
 * 更新时间：2026-10-04

------------------ Surge 配置 ------------------

[Script]
移动云盘商品抢兑 = type=cron,cronexp="0 10,16,0 * * *",script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/ydyp_exchange.js,wake-system=1

------------------- Loon 配置 -------------------

[Script]
cron "0 10,16,0 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/ydyp_exchange.js, timeout=600, tag=移动云盘商品抢兑

--------------- Quantumult X 配置 ---------------

[task_local]
"0 10,16,0 * * *", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/ydyp_exchange.js, tag=移动云盘商品抢兑, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/ydyp.png, enabled=true

 */

const $ = new Env('移动云盘商品抢兑');
$.is_debug = getEnv('is_debug') || 'false';  // 调试模式
$.Messages = [];

// ---- 业务常量 ----
const SCRIPT_VERSION = '2.0.0';
const CLIENT_VERSION = '13.0.0';
const MARKET_NAME = 'sign_in_3';
const BASE_M = 'https://m.mcloud.139.com';
const SOURCE_ID = '1097';
const TARGET_SOURCE_ID = '001005';
const YDYP_DATA_KEY = 'ydyp_data';             // 由 ydyp.js(移动云盘签到) 维护的账号数组 [{Authorization, phone, deviceId}]
const YDYP_CACHE_KEY = 'ydyp_cache';           // 由 ydyp.js 维护, 本脚本只读刷新后的 Authorization 与 deviceId

const UA = 'Mozilla/5.0 (Linux; Android 11; M2012K10C Build/RP1A.200720.011; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/90.0.4430.210 Mobile Safari/537.36 MCloudApp/10.0.1';
const MARKET_UA_POOL = [
    'Mozilla/5.0 (Linux; Android 14; 23127HN0CC Build/UKQ1.230917.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/143.0.7499.146 Mobile Safari/537.36 MCloudApp/13.0.0 AppLanguage/zh-CN',
    'Mozilla/5.0 (Linux; Android 14; 24053PY09C Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.6522.118 Mobile Safari/537.36 MCloudApp/13.0.0 AppLanguage/zh-CN',
    'Mozilla/5.0 (Linux; Android 13; 23049RAD8C Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/143.0.7499.146 Mobile Safari/537.36 MCloudApp/13.0.0 AppLanguage/zh-CN',
    'Mozilla/5.0 (Linux; Android 14; PGP110 Build/UKQ1.230917.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.6464.127 Mobile Safari/537.36 MCloudApp/13.0.0 AppLanguage/zh-CN',
    'Mozilla/5.0 (Linux; Android 14; RMXP4721 Build/UKQ1.230917.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/143.0.7499.146 Mobile Safari/537.36 MCloudApp/13.0.0 AppLanguage/zh-CN',
    'Mozilla/5.0 (Linux; Android 13; M2012K10C Build/RP1A.200720.011; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.6522.118 Mobile Safari/537.36 MCloudApp/13.0.0 AppLanguage/zh-CN',
    'Mozilla/5.0 (Linux; Android 14; V2324A Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/143.0.7499.146 Mobile Safari/537.36 MCloudApp/13.0.0 AppLanguage/zh-CN',
    'Mozilla/5.0 (Linux; Android 13; RE58B1 Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.6385.82 Mobile Safari/537.36 MCloudApp/13.0.0 AppLanguage/zh-CN',
    'Mozilla/5.0 (Linux; Android 14; 22081212C Build/UKQ1.230917.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/143.0.7499.146 Mobile Safari/537.36 MCloudApp/13.0.0 AppLanguage/zh-CN',
    'Mozilla/5.0 (Linux; Android 14; LLY-AN00 Build/HONORLLY-AN00; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.6522.118 Mobile Safari/537.36 MCloudApp/13.0.0 AppLanguage/zh-CN',
];

// ---------- 数美设备指纹常量 (照 py _SM_* 搬运) ----------
const SM_PUBLIC_KEY = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC8KHAcHbkCn5rxGgGJE+07tY+pt86D/oZ7sA51FaEBv2jgno2TI9zHJVYKJynmiKpixgwUcv93EfWIrU/p/UCs5Vu+odS3I4UBp3R7IZ1A0W01FkumAHYW2PQpMm8ueQKPLUq/idkpG/9b2JDv/qU+Ks36nbUPwlW4CjdfrV+V9QIDAQAB';
const SM_ORGANIZATION = 'FXlyfmWg2AzwbrxDKSv5';
const SM_ANDROID_MODELS = [
    { model: '23127HN0CC', build: 'UKQ1.230917.001', android: '14', chrome: '143.0.7499.146' },
    { model: '24053PY09C', build: 'UP1A.231005.007', android: '14', chrome: '142.0.6522.118' },
    { model: '23049RAD8C', build: 'TKQ1.221114.001', android: '13', chrome: '143.0.7499.146' },
    { model: 'PGP110', build: 'UKQ1.230917.001', android: '14', chrome: '141.0.6464.127' },
    { model: 'RMXP4721', build: 'UKQ1.230917.001', android: '14', chrome: '143.0.7499.146' },
    { model: 'M2012K10C', build: 'RP1A.200720.011', android: '11', chrome: '142.0.6522.118' },
    { model: 'V2324A', build: 'UP1A.231005.007', android: '14', chrome: '143.0.7499.146' },
    { model: 'RE58B1', build: 'TKQ1.221114.001', android: '13', chrome: '140.0.6385.82' },
    { model: '22081212C', build: 'UKQ1.230917.001', android: '14', chrome: '143.0.7499.146' },
    { model: 'LLY-AN00', build: 'HONORLLY-AN00', android: '14', chrome: '142.0.6522.118' },
];
const SM_SCREENS = [
    { w: 1080, h: 2340, dpr: 2.625 },
    { w: 1080, h: 2400, dpr: 2.75 },
    { w: 720, h: 1280, dpr: 1.5 },
    { w: 1080, h: 2160, dpr: 2.625 },
    { w: 1080, h: 2310, dpr: 2.625 },
];
const SM_DEVICE_PROFILE_URL = 'https://slw.h5cmpassport.com:9090/deviceprofile/v4';
const SM_DE_FLAGS = '|10011011111000111100001100101101111100110101001110000000000100000';

// 主函数
async function main() {
    $.prizeIds = (getEnv('ydyp_exchange_prizes') || '').split(/[,，\s]+/).filter(Boolean);
    const users = $.toObj(getEnv(YDYP_DATA_KEY)) || [];

    if (!Array.isArray(users) || !users.length) throw new Error(`未找到 ${YDYP_DATA_KEY} 变量：请先在「移动云盘签到」插件打开捕获开关、进 App 首页抓一次 Authorization ❌`);
    if (!$.prizeIds.length) $.log('⚠️ 未配置 ydyp_exchange_prizes，将仅查询商品列表/已有商品，不执行抢兑');
    $.log(`移动云盘商品抢兑 v${SCRIPT_VERSION}，共 ${users.length} 个 App 端账号，商品ID: ${$.prizeIds.join(',') || '(无)'}`);

    for (let i = 0; i < users.length; i++) {
        const phone = maskPhone(String((users[i] || {}).phone || '').trim() || phoneFromAuthorization((users[i] || {}).Authorization));
        $.log(`\n----- 账号 [${i + 1}/${users.length}] ${phone || '(未取到手机号)'} 开始执行 -----\n`);
        $.messages = [];
        await runAccount(users[i]);
        $.messages.splice(0, 0, `🔹 账号 ${i + 1} [${$.refLabel || phone}]`);
        $.Messages = $.Messages.concat($.messages);
        if (i < users.length - 1) await $.wait(1000 + Math.floor(Math.random() * 2000));
    }
}

// 单账号: App 端 Authorization → sso+jwt → 抢兑
async function runAccount(user) {
    await $.wait(1000 * (2 + Math.floor(Math.random() * 5)));
    const account = String((user || {}).phone || '').trim() || phoneFromAuthorization((user || {}).Authorization);
    // 优先用「移动云盘签到」按有效期自动刷新后的 Authorization
    const Authorization = normalizeAuthorization(ydypCacheRecord(account).token || (user || {}).Authorization);
    if (!account || !Authorization) {
        $.messages.push(`❌ 账号无效: ydyp_data 缺少 phone/Authorization，跳过执行`);
        return;
    }
    $.refLabel = maskPhone(account);
    const deviceId = await fetchDeviceId() || deviceIdFromYdypCache(account);

    const ex = new Exchange({ account, Authorization, deviceId });
    if (!ex.Authorization) {
        $.messages.push(`❌ 组装账号无效，跳过执行`);
        return;
    }
    if (!await ex.jwt()) {
        $.err_accounts = ($.err_accounts || '') + `${ex.encryptAccount}\n`;
        $.messages.push(`❌ 登录: sso/jwt 未通过，需重新抓取 App 端 Authorization`);
        return;
    }
    await ex.run();
}

// ---------- 账号缓存 (ydyp.js 维护, 本脚本只读) ----------
function normalizeAuthorization(token) {
    token = String(token || '').trim();
    if (token && !token.startsWith('Basic ')) return `Basic ${token}`;
    return token;
}

// ydyp_data 漏填 phone 时从 Basic 认证里解 (mobile:手机号:token)
function phoneFromAuthorization(authorization) {
    try {
        const parts = Crypt('base64-decode', normalizeAuthorization(authorization).slice(6)).split(':');
        return parts.length >= 2 ? String(parts[1]).trim() : '';
    } catch (e) {
        return '';
    }
}

function maskPhone(phone) {
    return phone.length >= 11 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone;
}

function ydypCacheRecord(phone) {
    const data = $.toObj($.getdata(YDYP_CACHE_KEY));
    return (data && typeof data === 'object' && data[phone]) || {};
}

// 复用「移动云盘签到」(ydyp.js) 缓存里的 deviceId
function deviceIdFromYdypCache(phone) {
    const record = ydypCacheRecord(phone);
    return String(record.marketDeviceId || record.deviceId || '').trim();
}

// ---------- 数美 deviceId (照 py _sm_get_smid / _generate_device_profile / fetch_device_id) ----------
function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function uuid4() {
    const hex = '0123456789abcdef';
    let s = '';
    for (let i = 0; i < 32; i++) s += hex.charAt(Math.floor(Math.random() * 16));
    s = s.slice(0, 12) + '4' + s.slice(13);
    s = s.slice(0, 16) + '89ab'.charAt(Math.floor(Math.random() * 4)) + s.slice(17);
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

// py 用 datetime.now(timezone(+8)) + strftime, 这里固定按北京时间出串
function bjTimeStr() {
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    const p = n => String(n).padStart(2, '0');
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    return {
        stamp: `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`,
        readable: `${wd} ${mon} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
    };
}

function smGetSmid(uid, stamp) {
    const base = stamp + Crypt('md5', uid) + '00';
    return base + Crypt('md5', `smsk_web_${base}`).slice(0, 14) + '0';
}

function buildDeviceProfile() {
    const phone = pick(SM_ANDROID_MODELS);
    const screen = pick(SM_SCREENS);
    const uaStr = `Mozilla/5.0 (Linux; Android ${phone.android}; ${phone.model} Build/${phone.build}; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/${phone.chrome} Mobile Safari/537.36 MCloudApp/13.0.0 AppLanguage/zh-CN`;
    const availH = screen.h - randInt(48, 128);
    const uid = uuid4();
    const bj = bjTimeStr();
    const nowTs = Date.now();
    const startTime = nowTs - randInt(1800000, 5400000);
    const r1 = num => Number(num.toFixed(1));
    const ep = Crypt('rsa-enc-pkcs1', SM_PUBLIC_KEY, uid);
    if (!ep) return null;
    const env = {
        protocol: 242, organization: SM_ORGANIZATION, appId: 'default',
        os: 'web', version: '3.0.0', sdkver: '3.0.0', box: '',
        rtype: 'all', smid: smGetSmid(uid, bj.stamp), subVersion: '1.0.0',
        time: nowTs - startTime,
        cdp: 0, maxTouchPoints: 5, connectionRtt: 0, cpucount: 8,
        battery: { charging: 0, level: Number((0.6 + Math.random() * 0.35).toFixed(2)) },
        dg: `5.0 ${uaStr.slice('Mozilla/'.length)}`, gj: 'zh-CN', rr: 'Google Inc.', sv: 'Netscape', qc: 'Mozilla',
        ye: 8, jq: 8, lo: [], bw: '', lr: 'Etc/GMT-8',
        nr: 1, no: 0, br: 1, ra: 0,
        gt: screen.w, wy: screen.w, cj: availH, wt: randInt(100, 180),
        hu: ['chrome'], documentExist: 1, yi: ['location'], dx: 'UTF-8',
        ig: `${bj.readable} (GMT+08:00)`,
        ii: 1, fs: 0, ga: 0, tk: 0, rm: 0, kr: 0, nk: 0,
        by: 'srgb', ar: 0, or: 0, et: 0, zc: 0, fj: 0, dc: 0, vd: 0,
        ni: '', hn: '',
        hv: '48000_2_1_0_2_explicit_speakers|______',
        de: Crypt('md5', uid).slice(0, 16) + SM_DE_FLAGS,
        xt: 1, vh: 0, xc: { red: '0' },
        pm: {
            default: r1(120.5 + Math.random() * 20),
            apple: r1(120.5 + Math.random() * 20),
            serif: r1(100 + Math.random() * 20),
            sans: r1(120.5 + Math.random() * 20),
            mono: r1(100 + Math.random() * 20),
            min: r1(10 + Math.random() * 2),
            system: r1(120.5 + Math.random() * 20),
        },
        ob: { maxTouchPoints: 5, touchEvent: true, touchStart: true },
        incognito: {
            getDirectoryExist: 0, getDirectoryIncognito: 0, maxTouchPointsExist: 1,
            indexedDBIncognito: 0, openDatabaseExist: 0, openDatabaseIncognito: 0,
            localStorageExist: 1, localStorageIncognito: 0, promiseExist: 1,
            promiseAllSettledExist: 1, queryUsageAndQuotaIncognito: 0,
            webkitRequestFileSystemIncognito: 0, serviceWorkerExist: 1,
            indexedDBExist: 1, browserName: 'Chrome',
        },
        t: `${bj.readable} GMT+0800 (GMT+08:00)`,
        collectTime: randInt(50, 130),
    };
    return JSON.stringify({
        appId: 'default', organization: SM_ORGANIZATION,
        ep: ep, data: Crypt('base64-encode', JSON.stringify(env)),
        os: 'web', encode: 1, compress: 0
    });
}

async function fetchDeviceId() {
    const payload = buildDeviceProfile();
    if (!payload) {
        $.log('动态获取deviceId失败: ep 加密未就绪');
        return null;
    }
    await $.wait(randInt(500, 1500));
    const response = await Request({
        url: SM_DEVICE_PROFILE_URL,
        headers: {
            'User-Agent': pick(MARKET_UA_POOL),
            'Content-Type': 'application/json;charset=UTF-8',
            'Origin': 'https://m.mcloud.139.com',
            'Referer': `${BASE_M}/portal/mobilecloud/index.html?path=newsignin&sourceid=${SOURCE_ID}&enableShare=1&token=&targetSourceId=${TARGET_SOURCE_ID}`
        },
        body: payload,
        _respType: 'body',
        _timeout: 15000
    });
    const result = (response && typeof response === 'object') ? response : $.toObj(response);
    if (result && result.code === 1100 && result.detail && result.detail.deviceId) {
        $.log(`✅ [数美] deviceId 获取成功: B${String(result.detail.deviceId).slice(0, 12)}…`);
        return `B${result.detail.deviceId}`;
    }
    $.log(`动态获取deviceId失败: ${result ? String($.toStr(result)).slice(0, 200) : String(response).slice(0, 200)}`);
    return null;
}

// ---------- 兑换业务(照 py Exchange 类搬运) ----------
class Exchange {
    constructor(user) {
        try {
            this.Authorization = user.Authorization;
            this.account = user.account;
            if (!this.Authorization || !this.account) throw new Error(`变量值格式错误: ${$.toStr(user)}`);
            this.targetPrizeIds = $.prizeIds.slice();
            this.clientVersion = CLIENT_VERSION;
            this.marketBaseUrl = BASE_M;
            this.marketSourceId = SOURCE_ID;
            this.ssoToken = null;
            this.userDomainId = '';
            this.marketDeviceId = user.deviceId || deviceIdFromYdypCache(this.account);
            if (!this.marketDeviceId) this.log('⚠️ 数美取号与 ydyp_cache 均无 deviceId，靠服务端 Set-Cookie 回填');
            this.marketHeaders = {};
            this.marketCookies = {};
            this.userLogLines = [];
            this.cloudTotal = 0;
            this.cloudToReceive = 0;
            this.exchangeSuccess = 0;
            this.exchangeSkipped = [];
            this.encryptAccount = maskPhone(this.account);
            this.jwtHeaders = { 'User-Agent': UA, 'Accept': '*/*', 'Host': 'caiyun.feixin.10086.cn:7071' };
        } catch (e) {
            $.log(`${e.message || e}`);
            this.Authorization = null;
        }
    }

    log(content) {
        $.log(String(content));
        this.userLogLines.push(String(content));
    }

    async guard(fn) {
        try {
            return await fn();
        } catch (e) {
            const errStr = `错误: ${e.message || e}`;
            $.log(errStr);
            this.userLogLines.push(errStr);
            return null;
        }
    }

    sleep(minDelay = 0.5, maxDelay = 1.5) {
        return $.wait((Math.random() * (maxDelay - minDelay) + minDelay) * 1000);
    }

    randomUa() {
        return MARKET_UA_POOL[Math.floor(Math.random() * MARKET_UA_POOL.length)];
    }

    // ---------- 请求核心 (对应 py send_request + raise_for_status) ----------
    async sendRequest({ url, headers = {}, cookies = {}, data = null, params = null, method = 'GET', retries = 3 }) {
        const requestHeaders = Object.assign({}, headers);
        const jar = Object.assign({}, cookies);
        const cookieText = Object.keys(jar)
            .filter(key => jar[key] !== undefined && jar[key] !== null && jar[key] !== '')
            .map(key => `${key}=${jar[key]}`).join('; ');
        if (cookieText) requestHeaders['Cookie'] = cookieText;

        const options = {
            url: params ? appendQuery(url, params) : url,
            headers: requestHeaders,
            _method: (method || 'GET').toLowerCase(),
            _respType: 'all',
            _timeout: 30000
        };
        if (data !== null && data !== undefined) options.body = data;

        for (let attempt = 0; attempt < retries; attempt++) {
            const response = await Request(options);
            const status = Number(response && (response.status || response.statusCode)) || 0;
            if (response && (status === 0 || status < 400)) {
                if ($.is_debug === 'true') $.log(`\n【${url}】响应数据:\n${response.body || ''}`);
                return response.body === undefined ? '' : String(response.body);
            }
            $.log(`请求异常: ${url}${status ? ` (status=${status})` : ''}`);
            if (attempt >= retries - 1) return null;
            await $.wait(1000);
        }
        return null;
    }

    async requestJson(opts) {
        const text = await this.sendRequest(opts);
        if (text === null) return null;
        const data = $.toObj(text);
        if (data === null) {
            this.log(`响应解析失败: ${String(text).slice(0, 120)}`);
            return null;
        }
        return data;
    }

    // ---------- SSO 取 token ----------
    async sso() {
        const ssoData = await this.requestJson({
            url: 'https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken',
            headers: {
                'Authorization': this.Authorization,
                'User-Agent': UA,
                'Content-Type': 'application/json',
                'Accept': '*/*',
                'Host': 'orches.yun.139.com'
            },
            data: { account: this.account, toSourceId: TARGET_SOURCE_ID },
            method: 'POST'
        });
        if (!ssoData) {
            this.log('刷新Token失败: 接口无响应');
            return null;
        }
        if (ssoData.success) {
            this.ssoToken = ssoData.data.token;
            return this.ssoToken;
        }
        this.log(`刷新Token失败: ${ssoData.message || '未知错误'}`);
        return null;
    }

    // ---------- JWT 认证 ----------
    async jwt() {
        return await this.guard(async () => {
            const token = await this.sso();
            if (!token) {
                this.log('ck可能失效了');
                return false;
            }
            const jwtData = await this.requestJson({
                url: `https://caiyun.feixin.10086.cn:7071/portal/auth/tyrzLogin.action?ssoToken=${token}`,
                headers: this.jwtHeaders,
                method: 'POST'
            });
            if (!jwtData) {
                this.log('JWT获取失败: 接口无响应');
                return false;
            }
            if (jwtData.code !== 0) {
                this.log(`JWT获取失败: ${jwtData.msg || '未知错误'}`);
                return false;
            }
            const jwtToken = jwtData.result.token;
            this.jwtHeaders['jwtToken'] = jwtToken;
            this.buildMarketContext(jwtToken);
            this.log('JWT获取成功');
            return true;
        });
    }

    static extractUserDomainId(jwtToken) {
        try {
            let payload = String(jwtToken).split('.')[1];
            payload += '==='.slice((payload.length + 3) % 4);
            const data = JSON.parse(Crypt('base64-decode', payload));
            let sub = data.sub || '';
            if (typeof sub === 'string') sub = JSON.parse(sub);
            return (sub && sub.userDomainId) || '';
        } catch (e) {
            return '';
        }
    }

    buildMarketContext(jwtToken) {
        this.userDomainId = Exchange.extractUserDomainId(jwtToken);
        this.marketHeaders = {
            'User-Agent': this.randomUa(),
            'Accept': '*/*',
            'jwtToken': jwtToken,
            'X-Requested-With': 'com.chinamobile.mcloud',
            'Referer': this.buildMarketPageUrl()
        };
        this.marketCookies = { 'jwtToken': jwtToken };
        if (this.userDomainId) this.marketCookies['userDomainId'] = this.userDomainId;
        this.seedMarketDeviceCookie();
    }

    buildMarketPageUrl(sourceId) {
        const currentSourceId = sourceId || this.marketSourceId;
        return `${this.marketBaseUrl}/portal/mobilecloud/index.html?path=newsignin&sourceid=${currentSourceId}&enableShare=1&token=${this.ssoToken || ''}&targetSourceId=${TARGET_SOURCE_ID}`;
    }

    getMarketDeviceId() {
        if (this.marketDeviceId) return this.marketDeviceId.startsWith('B') ? this.marketDeviceId : `B${this.marketDeviceId}`;
        for (const name of Object.keys(this.marketCookies)) {
            if (name.startsWith('.thumbcache_') && this.marketCookies[name]) {
                let value = this.marketCookies[name];
                try { value = decodeURIComponent(value); } catch (e) { }
                return value.startsWith('B') ? value : `B${value}`;
            }
        }
        return '';
    }

    seedMarketDeviceCookie() {
        let deviceId = this.marketDeviceId;
        if (!deviceId) return;
        // 请求头 deviceId 带 "B" 前缀，Cookie .thumbcache_ 内存的是去前缀的原值
        if (deviceId.startsWith('B')) deviceId = deviceId.slice(1);
        for (const name of Object.keys(this.marketCookies)) {
            if (name.startsWith('.thumbcache_') && this.marketCookies[name] === deviceId) return;
        }
        this.marketCookies[`.thumbcache_${this.account}`] = deviceId;
    }

    buildSigninHeaders(extra) {
        const headers = {
            'jwtToken': this.marketHeaders['jwtToken'] || '',
            'deviceid': this.getMarketDeviceId(),
            'activityid': MARKET_NAME,
            'appversion': `${this.clientVersion}.0`,
            'cache-control': 'no-cache',
            'showloading': 'true',
            'content-type': 'application/json;charset=UTF-8',
            'accept': '*/*',
            'referer': this.buildMarketPageUrl(),
            'user-agent': this.randomUa(),
            'x-requested-with': 'com.chinamobile.mcloud',
            'accept-language': 'zh,zh-CN;q=0.9,en-US;q=0.8,en;q=0.7'
        };
        return Object.assign(headers, extra || {});
    }

    requestMarketJson(url, { params, headers, data, method = 'GET', retries = 3 } = {}) {
        return this.requestJson({
            url, params, data, method, retries,
            headers: headers || this.buildSigninHeaders(),
            cookies: this.marketCookies
        });
    }

    // ---------- 查询云朵 ----------
    async getCloudInfo() {
        return await this.guard(async () => {
            const data = await this.requestMarketJson(`${this.marketBaseUrl}/ycloud/signin/page/infoV3`, { params: { client: 'app' } });
            if (!data || data.code !== 0) {
                this.log('查询云朵失败');
                return 0;
            }
            const result = data.result || {};
            this.cloudTotal = result.total || 0;
            this.cloudToReceive = result.toReceive || 0;
            this.log(`当前云朵: ${this.cloudTotal}, 待领取: ${this.cloudToReceive}`);
            return this.cloudTotal;
        });
    }

    // ---------- 商品列表 ----------
    async getExchangeList() {
        return await this.guard(async () => {
            const data = await this.requestMarketJson(`${this.marketBaseUrl}/ycloud/signin/page/exchangeList`, {
                params: { client: 'app', clientVersion: this.clientVersion }
            });
            if (!data) {
                this.log('获取商品列表失败: 接口无响应');
                return [];
            }
            if (data.code !== 0) {
                this.log(`获取商品列表失败: ${data.msg || '未知错误'}`);
                return [];
            }
            const result = data.result || {};
            const allItems = [];
            for (const groupKey of Object.keys(result)) {
                const items = result[groupKey];
                if (Array.isArray(items)) {
                    for (const item of items) {
                        item._group = groupKey;
                        allItems.push(item);
                    }
                }
            }
            this.log(`获取商品列表成功: 共${allItems.length}个商品`);
            return allItems;
        });
    }

    // ---------- 滑块验证码 ----------
    async getSlide() {
        return await this.guard(async () => {
            const data = await this.requestMarketJson(`${this.marketBaseUrl}/ycloud/auth-service/slide/getSlide`, {
                method: 'POST',
                data: {},
                headers: this.buildSigninHeaders({ 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' })
            });
            if (!data) {
                this.log('获取滑块验证码失败: 接口无响应');
                return null;
            }
            if (data.code !== 0) {
                this.log(`获取滑块验证码失败: ${data.msg || '未知错误'}`);
                return null;
            }
            const result = data.result || {};
            const puzzle = result.puzzle || '';
            const picture = result.picture || '';
            if (!puzzle || !picture) {
                this.log('获取滑块验证码失败: 图片数据为空');
                return null;
            }
            this.log('获取滑块验证码成功，开始识别偏移量...');
            return SlideOffset(puzzle, picture);
        });
    }

    // ---------- 兑换商品 ----------
    async exchangePrize(prizeId, prizeName = '') {
        return await this.guard(async () => {
            this.log(`开始兑换商品: ${prizeName || prizeId}`);
            let offset = null;
            for (let slideAttempt = 0; slideAttempt < 3; slideAttempt++) {
                offset = await this.getSlide();
                if (offset !== null) break;
                this.log(`第${slideAttempt + 1}次滑块识别失败，重新获取...`);
                await $.wait(1000);
            }
            if (offset === null || offset === undefined) {
                this.log('滑块验证码识别失败，跳过兑换');
                return false;
            }
            const finalOffset = offset + randInt(-3, 3);
            this.log(`最终偏移量: ${finalOffset}`);
            const data = await this.requestMarketJson(`${this.marketBaseUrl}/ycloud/signin/page/exchangeV3`, {
                method: 'POST',
                data: {
                    prizeId: Number(prizeId),
                    client: 'app',
                    clientVersion: this.clientVersion,
                    puzzleOffset: finalOffset,
                    smsCode: '',
                    deviceId: this.getMarketDeviceId()
                },
                headers: this.buildSigninHeaders({ 'isdeviceId': 'true' })
            });
            if (!data) {
                this.log('兑换失败: 接口无响应');
                return false;
            }
            if (data.code === 0) {
                const result = data.result || {};
                this.log(`兑换成功! 商品: ${result.prizeName || prizeName}`);
                if (result.expireTime) this.log(`过期时间: ${result.expireTime}`);
                return true;
            }
            const msg = data.msg || '未知错误';
            this.log(`兑换失败: ${msg}`);
            if (/验证|滑块/.test(String(msg)) || /puzzle/i.test(String(msg))) {
                this.log('验证码验证失败，尝试重新识别...');
                return await this.retryExchangeWithSlide(prizeId, prizeName);
            }
            return false;
        });
    }

    async retryExchangeWithSlide(prizeId, prizeName = '', maxRetries = 3) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            await this.sleep(1, 2);
            let offset = await this.getSlide();
            if (offset === null || offset === undefined) offset = randInt(150, 500);
            const finalOffset = offset + randInt(-3, 3);
            this.log(`重试第${attempt + 1}次，偏移量: ${finalOffset}`);
            const data = await this.requestMarketJson(`${this.marketBaseUrl}/ycloud/signin/page/exchangeV3`, {
                method: 'POST',
                data: {
                    prizeId: Number(prizeId),
                    client: 'app',
                    clientVersion: this.clientVersion,
                    puzzleOffset: finalOffset,
                    smsCode: '',
                    deviceId: this.getMarketDeviceId()
                },
                headers: this.buildSigninHeaders({ 'isdeviceId': 'true' })
            });
            if (!data) continue;
            if (data.code === 0) {
                const result = data.result || {};
                this.log(`兑换成功! 商品: ${result.prizeName || prizeName}`);
                return true;
            }
            const msg = data.msg || '未知错误';
            this.log(`重试第${attempt + 1}次失败: ${msg}`);
            if (!/验证|滑块/.test(String(msg)) && !/puzzle/i.test(String(msg))) break;
        }
        this.log(`重试${maxRetries}次后仍失败`);
        return false;
    }

    // ---------- 查询已有商品 ----------
    async queryReceivedPrizes() {
        return await this.guard(async () => {
            const data = await this.requestMarketJson(`${this.marketBaseUrl}/ycloud/prizeApi/checkPrize/getUserPrizeLogPageV2`, {
                params: { currPage: '1', pageSize: '15' }
            });
            if (!data) {
                this.log('查询已有商品失败: 接口无响应');
                return [];
            }
            if (data.code !== 0) {
                this.log(`查询已有商品失败: ${data.msg || '未知错误'}`);
                return [];
            }
            const result = (data.result && data.result.result) || [];
            const pending = [];
            for (const item of result) {
                if (item.flag === 1) pending.push(item.prizeName || '');
            }
            this.log(pending.length ? `待领取商品: ${pending.join(', ')}` : '暂无待领取商品');
            return pending;
        });
    }

    // ---------- 主流程 ----------
    async run() {
        return await this.guard(async () => {
            this.log(`\n===== 开始抢兑流程 =====`);

            this.log(`\n--- 查询云朵余额 ---`);
            const cloudTotal = await this.getCloudInfo();
            await this.sleep();

            const items = (await this.getExchangeList()) || [];
            if (!items.length) {
                this.log('商品列表为空，退出');
                return;
            }

            const targetItems = [];
            if (this.targetPrizeIds.length) {
                for (const pid of this.targetPrizeIds) {
                    const hit = items.find(item => String(item.prizeId) === String(pid));
                    if (hit) targetItems.push(hit);
                    else this.log(`商品ID ${pid} 未在列表中找到`);
                }
            } else {
                this.log('\n未指定商品ID，跳过兑换（仅查询商品列表和已有商品）');
            }

            if (!targetItems.length) {
                this.log('没有可兑换的商品');
            } else {
                this.log(`\n--- 开始兑换 ---`);
                let successCount = 0;
                for (const item of targetItems) {
                    const pid = item.prizeId || '';
                    const name = item.prizeName || '';
                    const dailyRemain = item.dailyRemainderCount || 0;
                    if (dailyRemain <= 0) {
                        this.exchangeSkipped.push([name, '已抢光']);
                        this.log(`跳过 ${name} (已抢光)`);
                        continue;
                    }
                    this.log(`\n尝试兑换: ${name} (ID:${pid})`);
                    if (await this.exchangePrize(pid, name)) successCount++;
                    await this.sleep(2, 4);
                }
                this.exchangeSuccess = successCount;
                this.log(`\n兑换完成: 成功${successCount}个`);
            }

            this.log(`\n--- 查询已有商品 ---`);
            await this.queryReceivedPrizes();
            await this.sleep();

            // 汇总(精简四行, 对应 py build_bark_notify)
            $.messages.push(`☁️ 云朵 ${cloudTotal || 0} | 📥 待领取 ${this.cloudToReceive || 0}`);
            if (this.exchangeSkipped.length) {
                $.messages.push(`⏭ 跳过: ${this.exchangeSkipped.slice(0, 4).map(s => `${s[0]}(${s[1]})`).join('、')}`);
            }
            $.messages.push(`🎁 兑换: 成功 ${this.exchangeSuccess} 个`);
            this.log(`用户【${this.encryptAccount}】: 云朵${cloudTotal || 0}`);
        });
    }
}

// ---------- 工具函数 ----------
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 与 requests 的 params 一致: 空值也保留
function appendQuery(url, params) {
    const keys = Object.keys(params || {});
    if (!keys.length) return url;
    const query = keys
        .filter(key => params[key] !== undefined && params[key] !== null)
        .map(key => `${key}=${encodeURIComponent(params[key])}`).join('&');
    return url + (url.indexOf('?') === -1 ? '?' : '&') + query;
}

function getEnv(...keys) {
    for (let key of keys) {
        var value = $.isNode() ? process.env[key] || process.env[key.toUpperCase()] || process.env[key.toLowerCase()] || $.getdata(key) : $.getdata(key);
        if (value) return value;
    }
}

function debug(content, title = 'debug') {
    let start = `\n----- ${title} -----\n`;
    let end = `\n----- ${$.time('HH:mm:ss')} -----\n`;
    if ($.is_debug === 'true') {
        if (typeof content == 'string') $.log(start + content + end);
        else if (typeof content == 'object') $.log(start + $.toStr(content) + end);
    }
}

// 请求函数二次封装
async function Request(options) {
    try {
        options = options.url ? options : { url: options };
        const _method = options?._method || options?.method || ('body' in options ? 'post' : 'get');
        const _respType = options?._respType || 'body';
        const _timeout = options?._timeout || 15000;

        if ((_method.toLowerCase() === 'post' || _method.toLowerCase() === 'put') && options.body && typeof options.body === 'object') {
            options.body = JSON.stringify(options.body);
            options.headers = options.headers || {};
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
                });
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

// 脚本执行入口
!(async () => {
    await main();
})()
    .catch((e) => { $.logErr(e); $.Messages.push(`❌ ${e.message || e}`); })
    .finally(async () => {
        let message = $.Messages.join('\n');
        if ($.err_accounts) message = `失效账号:\n${$.err_accounts}\n` + message;
        await sendMsg(message);
        $.done();
    });

function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }

// ---------- 通用加密封装 Crypt() ----------

function Crypt(type, a, b, c) { function MD5(string) { function RotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); } function AddUnsigned(lX, lY) { var lX4, lY4, lX8, lY8, lResult; lX8 = (lX & 0x80000000); lY8 = (lY & 0x80000000); lX4 = (lX & 0x40000000); lY4 = (lY & 0x40000000); lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF); if (lX4 & lY4) { return (lResult ^ 0x80000000 ^ lX8 ^ lY8); } if (lX4 | lY4) { if (lResult & 0x40000000) { return (lResult ^ 0xC0000000 ^ lX8 ^ lY8); } else { return (lResult ^ 0x40000000 ^ lX8 ^ lY8); } } else { return (lResult ^ lX8 ^ lY8); } } function F(x, y, z) { return (x & y) | ((~x) & z); } function G(x, y, z) { return (x & z) | (y & (~z)); } function H(x, y, z) { return (x ^ y ^ z); } function I(x, y, z) { return (y ^ (x | (~z))); } function FF(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function GG(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function HH(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function II(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function ConvertToWordArray(string) { var lWordCount; var lMessageLength = string.length; var lNumberOfWords_temp1 = lMessageLength + 8; var lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64; var lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16; var lWordArray = Array(lNumberOfWords - 1); var lBytePosition = 0; var lByteCount = 0; while (lByteCount < lMessageLength) { lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8; lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition)); lByteCount++; } lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8; lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition); lWordArray[lNumberOfWords - 2] = lMessageLength << 3; lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29; return lWordArray; }; function WordToHex(lValue) { var WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount; for (lCount = 0; lCount <= 3; lCount++) { lByte = (lValue >>> (lCount * 8)) & 255; WordToHexValue_temp = "0" + lByte.toString(16); WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2); } return WordToHexValue; }; function Utf8Encode(string) { string = string.replace(/\r\n/g, "\n"); var utftext = ""; for (var n = 0; n < string.length; n++) { var c = string.charCodeAt(n); if (c < 128) { utftext += String.fromCharCode(c); } else if ((c > 127) && (c < 2048)) { utftext += String.fromCharCode((c >> 6) | 192); utftext += String.fromCharCode((c & 63) | 128); } else { utftext += String.fromCharCode((c >> 12) | 224); utftext += String.fromCharCode(((c >> 6) & 63) | 128); utftext += String.fromCharCode((c & 63) | 128); } } return utftext; }; var x = Array(); var k, AA, BB, CC, DD, a, b, c, d; var S11 = 7, S12 = 12, S13 = 17, S14 = 22; var S21 = 5, S22 = 9, S23 = 14, S24 = 20; var S31 = 4, S32 = 11, S33 = 16, S34 = 23; var S41 = 6, S42 = 10, S43 = 15, S44 = 21; string = Utf8Encode(string); x = ConvertToWordArray(string); a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476; for (k = 0; k < x.length; k += 16) { AA = a; BB = b; CC = c; DD = d; a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478); d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756); c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB); b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE); a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF); d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A); c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613); b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501); a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8); d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF); c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1); b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE); a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122); d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193); c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E); b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821); a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562); d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340); c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51); b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA); a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D); d = GG(d, a, b, c, x[k + 10], S22, 0x2441453); c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681); b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8); a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6); d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6); c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87); b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED); a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905); d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8); c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9); b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A); a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942); d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681); c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122); b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C); a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44); d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9); c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60); b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70); a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6); d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA); c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085); b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05); a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039); d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5); c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8); b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665); a = II(a, b, c, d, x[k + 0], S41, 0xF4292244); d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97); c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7); b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039); a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3); d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92); c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D); b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1); a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F); d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0); c = II(c, d, a, b, x[k + 6], S43, 0xA3014314); b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1); a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82); d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235); c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB); b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391); a = AddUnsigned(a, AA); b = AddUnsigned(b, BB); c = AddUnsigned(c, CC); d = AddUnsigned(d, DD); } var temp = WordToHex(a) + WordToHex(b) + WordToHex(c) + WordToHex(d); return temp.toLowerCase(); } function _rsa(pem, string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function BytesToBigInt(bytes) { let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); return n; } function BigIntToBytes(n, len) { const out = new Array(len).fill(0); for (let i = len - 1; i >= 0 && n > 0n; i--) { out[i] = Number(n & 0xffn); n >>= 8n; } return out; } function ModPow(base, exp, mod) { let r = 1n; base %= mod; while (exp > 0n) { if (exp & 1n) r = (r * base) % mod; base = (base * base) % mod; exp >>= 1n; } return r; } function DerRead(buf, off) { const tag = buf[off++]; let len = buf[off++]; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + i]; off += n; } return { tag, start: off, len }; } function DerChildren(buf, start, end) { const list = []; let off = start; while (off < end) { const t = DerRead(buf, off); list.push(t); off = t.start + t.len; } return list; } if (!_rsa._k || _rsa._kp !== pem) { try { const der = Base64ToBytes(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); let seqs = DerChildren(der, DerRead(der, 0).start, der.length); const inner = seqs.find(s => s.tag === 0x04); if (inner) { const seq2 = DerRead(der, inner.start); seqs = DerChildren(der, seq2.start, seq2.start + seq2.len); } const ints = seqs.filter(s => s.tag === 0x02); const n = BytesToBigInt(der.slice(ints[1].start, ints[1].start + ints[1].len)); const d = BytesToBigInt(der.slice(ints[3].start, ints[3].start + ints[3].len)); _rsa._k = { n, d, k: (n.toString(16).length + 1) >> 1 }; _rsa._kp = pem; } catch (e) { $.logErr('❌ [签名] 私钥解析失败: ' + (e.message || e)); return null; } } const key = _rsa._k; try { const digestInfo = [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20, ...SHA256(Utf8Encode(string))]; const padded = [0x00, 0x01, ...new Array(key.k - digestInfo.length - 3).fill(0xff), 0x00, ...digestInfo]; const sig = ModPow(BytesToBigInt(padded), key.d, key.n); return BytesToBase64(BigIntToBytes(sig, key.k)).replace(/\//g, '_').replace(/\+/g, '-'); } catch (e) { $.logErr('❌ [签名] 签名异常: ' + (e.message || e)); return null; } } function _rsaenc(b64Pub, string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function BytesToBigInt(bytes) { let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); return n; } function BigIntToBytes(n, len) { const out = new Array(len).fill(0); for (let i = len - 1; i >= 0 && n > 0n; i--) { out[i] = Number(n & 0xffn); n >>= 8n; } return out; } function ModPow(base, exp, mod) { let r = 1n; base %= mod; while (exp > 0n) { if (exp & 1n) r = (r * base) % mod; base = (base * base) % mod; exp >>= 1n; } return r; } function DerRead(buf, off) { const tag = buf[off++]; let len = buf[off++]; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + i]; off += n; } return { tag, start: off, len }; } function DerChildren(buf, start, end) { const list = []; let off = start; while (off < end) { const t = DerRead(buf, off); list.push(t); off = t.start + t.len; } return list; } if (!_rsaenc._k || _rsaenc._kp !== b64Pub) { try { const der = Base64ToBytes(String(b64Pub).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); const outer = DerRead(der, 0); const bitStr = DerChildren(der, outer.start, outer.start + outer.len).find(s => s.tag === 0x03); if (!bitStr) throw new Error('非 SPKI 公钥'); const seq = DerRead(der, bitStr.start + 1); const ints = DerChildren(der, seq.start, seq.start + seq.len).filter(s => s.tag === 0x02); const n = BytesToBigInt(der.slice(ints[0].start, ints[0].start + ints[0].len)); const e = BytesToBigInt(der.slice(ints[1].start, ints[1].start + ints[1].len)); _rsaenc._k = { n, e, k: (n.toString(16).length + 1) >> 1 }; _rsaenc._kp = b64Pub; } catch (err) { $.logErr('❌ [加密] 公钥解析失败: ' + (err.message || err)); return null; } } const key = _rsaenc._k; try { const msg = Utf8Encode(string); const psLen = key.k - msg.length - 3; if (psLen < 8) { $.logErr('❌ [加密] 明文超出 RSA 长度上限'); return null; } const ps = new Array(psLen); for (let i = 0; i < psLen; i++) ps[i] = 1 + Math.floor(Math.random() * 255); const padded = [0x00, 0x02, ...ps, 0x00, ...msg]; return BytesToBase64(BigIntToBytes(ModPow(BytesToBigInt(padded), key.e, key.n), key.k)); } catch (err) { $.logErr('❌ [加密] RSA 加密异常: ' + (err.message || err)); return null; } } function _hmac(b64Key, msg) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } let key = Utf8Encode(b64Key); if (key.length > 64) key = SHA256(key); while (key.length < 64) key.push(0); const inner = SHA256(key.map(b => b ^ 0x36).concat(Utf8Encode(msg))); const outer = SHA256(key.map(b => b ^ 0x5c).concat(inner)); return outer.map(b => b.toString(16).padStart(2, '0')).join(''); } function _aes(plain, keyStr, ivStr, ecb, ivp) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } const SBOX = (function () { function gmul(a, b) { let p = 0; for (let i = 0; i < 8; i++) { if ((b >> i) & 1) p ^= a; a = ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; } return p; } const sbox = new Array(256); for (let x = 0; x < 256; x++) { let inv = 0; if (x !== 0) { inv = 1; while (gmul(inv, x) !== 1) inv++; } const r = (v, n) => ((v << n) | (v >> (8 - n))) & 0xff; sbox[x] = (inv ^ r(inv, 1) ^ r(inv, 2) ^ r(inv, 3) ^ r(inv, 4) ^ 0x63) & 0xff; } return sbox; })(); function expandKey(key) { const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]; const Nk = key.length >> 2, Nr = Nk + 6, tw = 4 * (Nr + 1); const w = []; for (let i = 0; i < Nk; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]); for (let i = Nk; i < tw; i++) { let t = w[i - 1].slice(); if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]].map(b => SBOX[b]); t[0] ^= RCON[i / Nk - 1]; } else if (Nk > 6 && i % Nk === 4) t = t.map(b => SBOX[b]); w.push([w[i - Nk][0] ^ t[0], w[i - Nk][1] ^ t[1], w[i - Nk][2] ^ t[2], w[i - Nk][3] ^ t[3]]); } const rk = []; for (let round = 0; round <= Nr; round++) { const blk = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) blk[4 * c + r] = w[4 * round + c][r]; rk.push(blk); } return { rk: rk, Nr: Nr }; } function encryptBlock(input, rk, Nr) { let s = input.slice(); const addRK = (round) => { for (let i = 0; i < 16; i++) s[i] ^= rk[round][i]; }; const xtime = (a) => ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; addRK(0); for (let round = 1; round <= Nr; round++) { for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]]; const t = s.slice(); for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) t[4 * c + r] = s[4 * ((c + r) % 4) + r]; s = t; if (round < Nr) { for (let c = 0; c < 4; c++) { const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3]; s[4 * c] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3; s[4 * c + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3; s[4 * c + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3); s[4 * c + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3); } } addRK(round); } return s; } const data = Utf8Encode(plain); const padLen = 16 - (data.length % 16); for (let i = 0; i < padLen; i++) data.push(padLen); const ks = expandKey(Utf8Encode(keyStr)); let prev = ecb ? null : Utf8Encode(ivStr).slice(0, 16); const out = ivp ? prev.slice() : []; for (let off = 0; off < data.length; off += 16) { const blk = new Array(16); for (let i = 0; i < 16; i++) blk[i] = data[off + i] ^ (ecb ? 0 : prev[i]); prev = encryptBlock(blk, ks.rk, ks.Nr); out.push(...prev); } return BytesToBase64(out); } function _aesdec(cipher, keyStr, ecb, hexIn) { function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function HexToBytes(h) { const s = String(h).replace(/[^0-9a-fA-F]/g, ''); const bytes = []; for (let i = 0; i + 1 < s.length; i += 2) bytes.push(parseInt(s.substr(i, 2), 16)); if (s.length % 2) bytes.push(parseInt(s.slice(-1), 16)); return bytes; } function BytesToUtf8(bytes) { let s = ''; for (let i = 0; i < bytes.length;) { const b = bytes[i]; if (b < 128) { s += String.fromCharCode(b); i += 1; } else if (b >= 240 && i + 3 < bytes.length) { const cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); const v = cp - 0x10000; s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)); i += 4; } else if (b >= 224 && i + 2 < bytes.length) { s += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3; } else if (b >= 192 && i + 1 < bytes.length) { s += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2; } else { s += String.fromCharCode(b); i += 1; } } return s; } const SBOX = (function () { function gmul(a, b) { let p = 0; for (let i = 0; i < 8; i++) { if ((b >> i) & 1) p ^= a; a = ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; } return p; } const sbox = new Array(256); for (let x = 0; x < 256; x++) { let inv = 0; if (x !== 0) { inv = 1; while (gmul(inv, x) !== 1) inv++; } const r = (v, n) => ((v << n) | (v >> (8 - n))) & 0xff; sbox[x] = (inv ^ r(inv, 1) ^ r(inv, 2) ^ r(inv, 3) ^ r(inv, 4) ^ 0x63) & 0xff; } return sbox; })(); const INV_SBOX = (function () { const inv = new Array(256); for (let i = 0; i < 256; i++) inv[SBOX[i]] = i; return inv; })(); function expandKey(key) { const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]; const Nk = key.length >> 2, Nr = Nk + 6, tw = 4 * (Nr + 1); const w = []; for (let i = 0; i < Nk; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]); for (let i = Nk; i < tw; i++) { let t = w[i - 1].slice(); if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]].map(b => SBOX[b]); t[0] ^= RCON[i / Nk - 1]; } else if (Nk > 6 && i % Nk === 4) t = t.map(b => SBOX[b]); w.push([w[i - Nk][0] ^ t[0], w[i - Nk][1] ^ t[1], w[i - Nk][2] ^ t[2], w[i - Nk][3] ^ t[3]]); } const rk = []; for (let round = 0; round <= Nr; round++) { const blk = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) blk[4 * c + r] = w[4 * round + c][r]; rk.push(blk); } return { rk: rk, Nr: Nr }; } function decryptBlock(input, rk, Nr) { let s = input.slice(); const addRK = (round) => { for (let i = 0; i < 16; i++) s[i] ^= rk[round][i]; }; const xtime = (a) => ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; const mul = (a, b) => { let p = 0; for (let i = 0; i < 8; i++) { if ((b >> i) & 1) p ^= a; a = xtime(a); } return p; }; const irows = () => { const t = s.slice(); for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) t[4 * c + r] = s[4 * (((c - r) % 4 + 4) % 4) + r]; s = t; }; addRK(Nr); for (let round = Nr - 1; round >= 1; round--) { irows(); for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]; addRK(round); for (let c = 0; c < 4; c++) { const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3]; s[4 * c] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9); s[4 * c + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13); s[4 * c + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11); s[4 * c + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14); } } irows(); for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]; addRK(0); return s; } const raw = hexIn ? HexToBytes(cipher) : Base64ToBytes(cipher); if (!raw.length || raw.length % 16) return ''; const ks = expandKey(function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; }(keyStr)); let prev = null, start = 0; if (!ecb) { prev = raw.slice(0, 16); start = 16; } const out = []; for (let off = start; off < raw.length; off += 16) { const blk = raw.slice(off, off + 16); const dec = decryptBlock(blk, ks.rk, ks.Nr); const plainBlk = ecb ? dec : dec.map((b, i) => b ^ prev[i]); out.push(...plainBlk); if (!ecb) prev = blk; } const padLen = out[out.length - 1]; if (padLen >= 1 && padLen <= 16 && out.length >= padLen) { let ok = true; for (let i = 0; i < padLen; i++) if (out[out.length - 1 - i] !== padLen) ok = false; if (ok) out.length -= padLen; } return BytesToUtf8(out); } function _sha256hex(string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } return SHA256(Utf8Encode(string)).map(b => b.toString(16).padStart(2, '0')).join(''); } function _b64(str) { const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const u = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) u.push(c); else if (c < 2048) u.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); u.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else u.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } let out = ''; for (let i = 0; i < u.length; i += 3) { const b0 = u[i], b1 = u[i + 1], b2 = u[i + 2]; out += B[b0 >> 2]; out += b1 === undefined ? B[(b0 & 3) << 4] + '==' : b2 === undefined ? B[((b0 & 3) << 4) | (b1 >> 4)] + B[(b1 & 15) << 2] + '=' : B[((b0 & 3) << 4) | (b1 >> 4)] + B[((b1 & 15) << 2) | (b2 >> 6)] + B[b2 & 63]; } return out; } function _b64d(b64) { const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CH[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } let s = ''; for (let i = 0; i < bytes.length;) { const b = bytes[i]; if (b < 128) { s += String.fromCharCode(b); i += 1; } else if (b >= 240 && i + 3 < bytes.length) { const cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); const v = cp - 0x10000; s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)); i += 4; } else if (b >= 224 && i + 2 < bytes.length) { s += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3; } else if (b >= 192 && i + 1 < bytes.length) { s += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2; } else { s += String.fromCharCode(b); i += 1; } } return s; }switch (type) { case 'sha256': return _sha256hex(a); case 'md5': return MD5(a); case 'rsa-sha256': return _rsa(a, b); case 'rsa-enc-pkcs1': return _rsaenc(a, b); case 'hmac-sha256': return _hmac(a, b); case 'aes-cbc': return _aes(a, b, c); case 'aes-ecb': return _aes(a, b, null, true); case 'aes-cbc-ivp': return _aes(a, b, c, false, 2); case 'aes-cbc-dec': return _aesdec(a, b, false); case 'aes-ecb-dec': return _aesdec(a, b, true); case 'aes-ecb-dec-hex': return _aesdec(a, b, true, true); case 'base64-encode': return _b64(String(a)); case 'base64-decode': return _b64d(a); default: return null; } }

// ---------- 滑块识别: PNG 解码 + alpha 掩码 NCC (对应 py identify_slide_offset) ----------

function SlideOffset(puzzleB64, pictureB64) { function log(msg) { if (typeof console !== 'undefined' && console.log) console.log('[NCC] ' + msg); } function b64decode(str) { var ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; var map = new Int16Array(256); var i; for (i = 0; i < 256; i++) map[i] = -1; for (i = 0; i < 64; i++) map[ABC.charCodeAt(i)] = i; var out = new Uint8Array(((str.length / 4) | 0) * 3 + 4); var o = 0, group = 0, gc = 0; for (i = 0; i < str.length; i++) { var c = str.charCodeAt(i); if (c === 61) continue; var v = c < 256 ? map[c] : -1; if (v < 0) continue; group = (group << 6) | v; gc++; if (gc === 4) { out[o++] = (group >> 16) & 255; out[o++] = (group >> 8) & 255; out[o++] = group & 255; group = 0; gc = 0; } } if (gc === 2) { out[o++] = (group >> 4) & 255; } else if (gc === 3) { out[o++] = (group >> 10) & 255; out[o++] = (group >> 2) & 255; } return out.subarray(0, o); } function inflate(data, start) { if (start + 2 > data.length) throw new Error('zlib too short'); var cmf = data[start]; if ((cmf & 0x0f) !== 8) throw new Error('bad compression method'); var d = data, p = start + 2, bitBuf = 0, bitCnt = 0; var out = new Uint8Array(Math.max(1024, d.length * 4)); var olen = 0; function getBit() { if (bitCnt === 0) { if (p >= d.length) throw new Error('inflate: unexpected end of input'); bitBuf = d[p++]; bitCnt = 8; } var b = bitBuf & 1; bitBuf >>= 1; bitCnt--; return b; } function getBits(n) { var v = 0; for (var i = 0; i < n; i++) v |= getBit() << i; return v; } function need(n) { if (olen + n <= out.length) return; var cap = out.length; while (cap < olen + n) cap *= 2; var no = new Uint8Array(cap); no.set(out.subarray(0, olen)); out = no; } function buildHuff(lengths, n) { var i, maxLen = 0; for (i = 0; i < n; i++) if (lengths[i] > maxLen) maxLen = lengths[i]; if (maxLen > 15) throw new Error('code length too long'); if (maxLen === 0) return { counts: null, offsets: null, symbols: null, maxLen: 0 }; var counts = new Int32Array(maxLen + 1); for (i = 0; i < n; i++) counts[lengths[i]]++; counts[0] = 0; var offs = new Int32Array(maxLen + 1), code = 0; for (i = 1; i <= maxLen; i++) { offs[i] = code; code += counts[i]; } var symbols = new Int32Array(code); var cur = new Int32Array(maxLen + 1); for (i = 1; i <= maxLen; i++) cur[i] = offs[i]; for (i = 0; i < n; i++) { var l = lengths[i]; if (l) symbols[cur[l]++] = i; } return { counts: counts, offsets: offs, symbols: symbols, maxLen: maxLen }; } function decodeSym(h) { if (h.maxLen === 0) throw new Error('empty huffman table'); var code = 0, first = 0, len; for (len = 1; len <= h.maxLen; len++) { code |= getBit(); var cnt = h.counts[len]; if (code - first < cnt) return h.symbols[h.offsets[len] + (code - first)]; first = (first + cnt) << 1; code <<= 1; } throw new Error('invalid huffman code'); } var LENS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]; var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]; var DISTS = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]; var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]; var CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]; var lit = null, dist = null, isFinal = false; do { isFinal = getBit() === 1; var type = getBits(2); if (type === 0) { bitCnt = 0; var len = getBits(16); getBits(16); if (p + len > d.length) throw new Error('stored block truncated'); need(len); out.set(d.subarray(p, p + len), olen); p += len; olen += len; } else { if (type === 1) { var fl = new Int32Array(288), i; for (i = 0; i < 144; i++) fl[i] = 8; for (i = 144; i < 256; i++) fl[i] = 9; for (i = 256; i < 280; i++) fl[i] = 7; for (i = 280; i < 288; i++) fl[i] = 8; var fd = new Int32Array(30); for (i = 0; i < 30; i++) fd[i] = 5; lit = buildHuff(fl, 288); dist = buildHuff(fd, 30); } else if (type === 2) { var hlit = getBits(5) + 257, hdist = getBits(5) + 1, hclen = getBits(4) + 4; if (hlit > 288 || hdist > 32) throw new Error('bad dynamic header'); var clens = new Int32Array(19); var k; for (k = 0; k < hclen; k++) clens[CLORDER[k]] = getBits(3); var cl = buildHuff(clens, 19); var lengths = new Int32Array(hlit + hdist); var t = 0; while (t < hlit + hdist) { var sym = decodeSym(cl); var rep = 0, val = 0; if (sym < 16) { lengths[t++] = sym; continue; } else if (sym === 16) { val = t > 0 ? lengths[t - 1] : 0; rep = 3 + getBits(2); } else if (sym === 17) { rep = 3 + getBits(3); } else { rep = 11 + getBits(7); } if (t + rep > hlit + hdist) throw new Error('length overflow'); for (k = 0; k < rep; k++) lengths[t++] = val; } lit = buildHuff(lengths.subarray(0, hlit), hlit); dist = buildHuff(lengths.subarray(hlit), hdist); } else { throw new Error('bad block type'); } for (;;) { var s = decodeSym(lit); if (s === 256) break; if (s < 256) { need(1); out[olen++] = s; } else { var li = s - 257; if (li >= 29) throw new Error('bad length symbol'); var nlen = LENS[li] + getBits(LEXT[li]); var ds = decodeSym(dist); if (ds >= 30) throw new Error('bad distance symbol'); var dd = DISTS[ds] + getBits(DEXT[ds]); if (dd > olen) throw new Error('distance beyond output'); need(nlen); var from = olen - dd; for (k = 0; k < nlen; k++) out[olen++] = out[from + k]; } } } } while (!isFinal); return out.subarray(0, olen); } function pngDecode(bytes) { var SIG = [137, 80, 78, 71, 13, 10, 26, 10]; if (bytes.length < 8) throw new Error('png: too short'); var i; for (i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) throw new Error('png: bad signature'); var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); var w = 0, h = 0, bd = 0, ct = -1, interlace = -1; var plte = null, trns = null; var idatParts = [], idatLen = 0; var p = 8, haveIhdr = false, done = false; while (!done && p + 8 <= bytes.length) { var clen = dv.getUint32(p); p += 4; var t1 = bytes[p], t2 = bytes[p + 1], t3 = bytes[p + 2], t4 = bytes[p + 3]; p += 4; if (p + clen > bytes.length) throw new Error('png: chunk truncated'); if (t1 === 73 && t2 === 72 && t3 === 68 && t4 === 82) { w = dv.getUint32(p); h = dv.getUint32(p + 4); bd = bytes[p + 8]; ct = bytes[p + 9]; interlace = bytes[p + 12]; haveIhdr = true; if (w <= 0 || h <= 0) throw new Error('png: bad size'); if (bd === 16) throw new Error('png: bitDepth 16 unsupported'); if (interlace !== 0) throw new Error('png: interlace unsupported'); } else if (t1 === 80 && t2 === 76 && t3 === 84 && t4 === 69) { plte = bytes.subarray(p, p + clen); } else if (t1 === 116 && t2 === 82 && t3 === 78 && t4 === 83) { trns = bytes.subarray(p, p + clen); } else if (t1 === 73 && t2 === 68 && t3 === 65 && t4 === 84) { idatParts.push(bytes.subarray(p, p + clen)); idatLen += clen; } else if (t1 === 73 && t2 === 69 && t3 === 78 && t4 === 68) { done = true; } p += clen + 4; } if (!haveIhdr || idatLen === 0) throw new Error('png: missing IHDR/IDAT'); if (ct !== 0 && ct !== 2 && ct !== 3 && ct !== 4 && ct !== 6) throw new Error('png: bad colorType'); if (ct !== 3 && bd !== 8) throw new Error('png: unsupported bitDepth'); if (ct === 3 && bd !== 1 && bd !== 2 && bd !== 4 && bd !== 8) throw new Error('png: unsupported palette bitDepth'); if (ct === 3 && (!plte || plte.length < 3)) throw new Error('png: palette without PLTE'); var comp = new Uint8Array(idatLen); var q = 0; for (i = 0; i < idatParts.length; i++) { comp.set(idatParts[i], q); q += idatParts[i].length; } var raw = inflate(comp, 0); var chn = ct === 0 || ct === 3 ? 1 : ct === 2 ? 3 : ct === 4 ? 2 : 4; var stride = (w * chn * bd + 7) >> 3; var bpp = Math.max(1, (chn * bd + 7) >> 3); var expect = (stride + 1) * h; if (raw.length < expect) throw new Error('png: incomplete scanline data'); var out = new Uint8Array(w * h * 4); var prev = new Uint8Array(stride), cur = new Uint8Array(stride); var rp = (stride + 1) * h; var y, x; for (y = 0; y < h; y++) { var base = y * (stride + 1); var f = raw[base]; var line = raw.subarray(base + 1, base + 1 + stride); if (f === 0) { cur.set(line); } else if (f === 1) { for (x = 0; x < stride; x++) cur[x] = (line[x] + (x >= bpp ? cur[x - bpp] : 0)) & 255; } else if (f === 2) { for (x = 0; x < stride; x++) cur[x] = (line[x] + prev[x]) & 255; } else if (f === 3) { for (x = 0; x < stride; x++) { var a = x >= bpp ? cur[x - bpp] : 0; cur[x] = (line[x] + ((a + prev[x]) >> 1)) & 255; } } else if (f === 4) { for (x = 0; x < stride; x++) { var aa = x >= bpp ? cur[x - bpp] : 0; var bb = prev[x]; var cc = x >= bpp ? prev[x - bpp] : 0; var sa = bb - cc, sb = aa - cc; var pa = Math.abs(sa), pb = Math.abs(sb), pc = Math.abs(sa + sb); var pr = (pa <= pb && pa <= pc) ? aa : (pb <= pc) ? bb : cc; cur[x] = (line[x] + pr) & 255; } } else { throw new Error('png: bad filter type'); } var ob = y * w * 4; if (ct === 6) { for (x = 0; x < w; x++) { var s4 = x * 4; out[ob + x * 4] = cur[s4]; out[ob + x * 4 + 1] = cur[s4 + 1]; out[ob + x * 4 + 2] = cur[s4 + 2]; out[ob + x * 4 + 3] = cur[s4 + 3]; } } else if (ct === 2) { for (x = 0; x < w; x++) { var s3 = x * 3; out[ob + x * 4] = cur[s3]; out[ob + x * 4 + 1] = cur[s3 + 1]; out[ob + x * 4 + 2] = cur[s3 + 2]; out[ob + x * 4 + 3] = 255; } } else if (ct === 0) { for (x = 0; x < w; x++) { out[ob + x * 4] = cur[x]; out[ob + x * 4 + 1] = cur[x]; out[ob + x * 4 + 2] = cur[x]; out[ob + x * 4 + 3] = 255; } } else if (ct === 4) { for (x = 0; x < w; x++) { out[ob + x * 4] = cur[x * 2]; out[ob + x * 4 + 1] = cur[x * 2]; out[ob + x * 4 + 2] = cur[x * 2]; out[ob + x * 4 + 3] = cur[x * 2 + 1]; } } else { var mask = (1 << bd) - 1; for (x = 0; x < w; x++) { var idx; if (bd === 8) idx = cur[x]; else idx = (cur[(x * bd) >> 3] >> (8 - bd - (x * bd & 7))) & mask; var pi = idx * 3; var r = pi + 2 < plte.length ? plte[pi] : 0; var g = pi + 2 < plte.length ? plte[pi + 1] : 0; var b = pi + 2 < plte.length ? plte[pi + 2] : 0; var al = trns && idx < trns.length ? trns[idx] : 255; out[ob + x * 4] = r; out[ob + x * 4 + 1] = g; out[ob + x * 4 + 2] = b; out[ob + x * 4 + 3] = al; } } prev.set(cur); } return { w: w, h: h, data: out }; } try { var puzzle = decodeImg(puzzleB64); var picture = decodeImg(pictureB64); function decodeImg(b64) { var s = String(b64); var head = s.length > 100 ? s.slice(0, 100) : s; if (head.indexOf(',') >= 0) s = s.split(',', 2)[1]; return pngDecode(b64decode(s)); } var pz = puzzle, bg = picture; var Hb = bg.h, Wb = bg.w; var maskFull = new Uint8Array(pz.w * pz.h); var any = false; var xx, yy2, idx; for (yy2 = 0; yy2 < pz.h; yy2++) { for (xx = 0; xx < pz.w; xx++) { if (pz.data[(yy2 * pz.w + xx) * 4 + 3] > 128) { maskFull[yy2 * pz.w + xx] = 1; any = true; } } } if (!any) { log('拼图块无实体像素'); return null; } var y0 = pz.h, y1 = -1, x0 = pz.w, x1 = -1; for (yy2 = 0; yy2 < pz.h; yy2++) { for (xx = 0; xx < pz.w; xx++) { if (maskFull[yy2 * pz.w + xx]) { if (yy2 < y0) y0 = yy2; if (yy2 > y1) y1 = yy2; if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; } } } y1 = y1 + 1; x1 = x1 + 1; var ph = y1 - y0, pw = x1 - x0; if (ph > Hb || pw > Wb || y0 + ph > Hb) { log('拼图块尺寸异常'); return null; } var mIdx = new Int32Array(ph * pw); var n = 0; for (yy2 = 0; yy2 < ph; yy2++) { var rowb = (y0 + yy2) * pz.w; for (xx = 0; xx < pw; xx++) { if (maskFull[(rowb + x0 + xx)]) mIdx[n++] = yy2 * pw + xx; } } if (n < 100) { log('拼图块实体过小'); return null; } var pieceR = new Float64Array(n), pieceG = new Float64Array(n), pieceB = new Float64Array(n); var sumR = 0, sumG = 0, sumB = 0; for (idx = 0; idx < n; idx++) { var mi = mIdx[idx]; var py = y0 + ((mi / pw) | 0), px = x0 + (mi % pw); var o = (py * pz.w + px) * 4; var r = pz.data[o], g = pz.data[o + 1], b = pz.data[o + 2]; pieceR[idx] = r; pieceG[idx] = g; pieceB[idx] = b; sumR += r; sumG += g; sumB += b; } var tMeanR = sumR / n, tMeanG = sumG / n, tMeanB = sumB / n; var tR = new Float64Array(n), tG = new Float64Array(n), tB = new Float64Array(n); var tNormSq = 0; for (idx = 0; idx < n; idx++) { tR[idx] = pieceR[idx] - tMeanR; tG[idx] = pieceG[idx] - tMeanG; tB[idx] = pieceB[idx] - tMeanB; tNormSq += tR[idx] * tR[idx] + tG[idx] * tG[idx] + tB[idx] * tB[idx]; } var tNorm = Math.sqrt(tNormSq); if (tNorm < 1e-6) { log('拼图块内容全平'); return null; } var scores = new Float64Array(Wb - pw + 1); var valid = new Uint8Array(Wb - pw + 1); var bufR = new Float64Array(n), bufG = new Float64Array(n), bufB = new Float64Array(n); var bestScore = -Infinity, bestX = -1, anyScore = false; var maxX = Wb - pw; for (var x = 0; x <= maxX; x++) { var psR = 0, psG = 0, psB = 0; for (idx = 0; idx < n; idx++) { var mi2 = mIdx[idx]; var by = y0 + ((mi2 / pw) | 0); var bx = x + (mi2 % pw); var bo = (by * Wb + bx) * 4; var vR = bg.data[bo], vG = bg.data[bo + 1], vB = bg.data[bo + 2]; bufR[idx] = vR; bufG[idx] = vG; bufB[idx] = vB; psR += vR; psG += vG; psB += vB; } var pMeanR = psR / n, pMeanG = psG / n, pMeanB = psB / n; var pNormSq = 0, dot = 0; for (idx = 0; idx < n; idx++) { var cR = bufR[idx] - pMeanR, cG = bufG[idx] - pMeanG, cB = bufB[idx] - pMeanB; pNormSq += cR * cR + cG * cG + cB * cB; dot += tR[idx] * cR + tG[idx] * cG + tB[idx] * cB; } var pNorm = Math.sqrt(pNormSq); if (pNorm < 1e-6) continue; var s = dot / (tNorm * pNorm); scores[x] = s; valid[x] = 1; if (!anyScore || s > bestScore || (s === bestScore && x > bestX)) { bestScore = s; bestX = x; anyScore = true; } } if (!anyScore) { log('背景全平'); return null; } var second = null, secondX = -1; for (x = 0; x <= maxX; x++) { if (!valid[x] || Math.abs(x - bestX) <= 10) continue; var sv = scores[x]; if (second === null || sv > second || (sv === second && x > secondX)) { second = sv; secondX = x; } } if (second === null) second = 0.0; var margin = bestScore - second; var offset = bestX - x0; log('凹槽x=' + bestX + ' score=' + bestScore.toFixed(3) + ' 次峰margin=' + margin.toFixed(3) + ' 实体左=' + x0 + ' → offset=' + offset); if (bestScore < 0.35 || margin < 0.08) log('置信度偏低，结果可能不准'); if (offset < 0 || offset > Wb) { log('offset 异常 ' + offset); return null; } return offset | 0; } catch (e) { log('异常 ' + e); return null; } } if (typeof module !== 'undefined' && module.exports) module.exports = SlideOffset;
