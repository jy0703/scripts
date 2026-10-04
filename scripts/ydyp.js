/**
 * 脚本名称：移动云盘自动签到 - 签到
 * 活动规则：每日签到、云朵中心任务、算力大作战、红包派对，领取云朵与奖品
 * 脚本说明：支持多账号，支持 NE / Node.js 环境。Authorization 由本脚本 GetCookie 抓取（打开移动云盘 App 即可命中），deviceId 可选、需自行抓包填写
 * 环境变量：ydyp_data（账号）、ydyp_device_id（可选，全局 deviceId）、ydyp_cache（脚本自维护的 deviceId/Token 缓存）
 * 对应 Python 版本：ydyp.py v5.0.8
 * 更新时间：2026-10-04

抓取点（仅一条）：
^https?:\/\/user-njs\.yun\.139\.com\/user\/    → 请求头 Authorization（Basic mobile:手机号:token），打开 App 首页即触发
deviceId 不在抓取范围内：MCloudApp 13.0 的云朵中心请求（m.mcloud.139.com/ycloud/signin/）没有 deviceId 请求头，
只有 startSignIn 的 query 参数与 Cookie .thumbcache_<hash>，需要时手动抓包填入 ydyp_device_id 或账号项的 deviceId。

------------------ Surge 配置 ------------------

[MITM]
hostname = user-njs.yun.139.com

[Script]
移动云盘签到获取Token = type=http-request,pattern=^https?:\/\/user-njs\.yun\.139\.com\/user\/,requires-body=0,max-size=0,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/ydyp.js,script-update-interval=0
移动云盘签到 = type=cron,cronexp="0 8 * * *",timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/ydyp.js,script-update-interval=0

------------------- Loon 配置 -------------------

[MITM]
hostname = user-njs.yun.139.com

http-request ^https?:\/\/user-njs\.yun\.139\.com\/user\/ script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/ydyp.js,timeout=600,tag=移动云盘签到获取Token

cron "0 8 * * *" script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/ydyp.js,timeout=600,tag=移动云盘签到

--------------- Quantumult X 配置 ---------------

[MITM]
hostname = user-njs.yun.139.com

[rewrite_local]
^https?:\/\/user-njs\.yun\.139\.com\/user\/ url script-request-header https://raw.githubusercontent.com/jy0703/scripts/main/scripts/ydyp.js

[task_local]
0 8 * * * https://raw.githubusercontent.com/jy0703/scripts/main/scripts/ydyp.js, tag=移动云盘签到, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/ydyp.png, enabled=true

------------------ Stash 配置 ------------------

cron:
  script:
    - name: 移动云盘签到
      cron: '0 8 * * *'
      timeout: 600

http:
  mitm:
    - "user-njs.yun.139.com"
  script:
    - match: ^https?:\/\/user-njs\.yun\.139\.com\/user\/
      name: 移动云盘签到获取Token
      type: request

script-providers:
  移动云盘签到:
    url: https://raw.githubusercontent.com/jy0703/scripts/main/scripts/ydyp.js
    interval: 86400

 */

const $ = new Env('移动云盘签到');
$.is_debug = getEnv('is_debug') || 'false';  // 调试模式
$.userInfo = getEnv('ydyp_data') || '';  // 获取账号
$.userArr = $.toObj($.userInfo) || [];  // 用户信息 [{Authorization, phone, deviceId}]
$.Messages = [];
$.err_accounts = '';
$.user_amount = '';

// ---------- 业务常量 (照 ydyp.py v5.0.8 搬运) ----------
const SCRIPT_VERSION = '5.0.9';
const CLIENT_VERSION = '12.5.4';
const UA = '';            // py ua：APP 接口不发送自定义 UA
const MARKET_UA = '';     // py market_ua：云朵中心 H5 接口
const REAL_DEVICE_ID = '';
const CLOUD_FILE_DUMMY_HASH = '5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9';  // sha256('0')
const TOKEN_VALID_TIME = 21600000;
const TOKEN_REFRESH_ADVANCE = 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_AES_KEY = 'c7lXOigXahPnTViq';
const TOKEN_EXPIRE_SECONDS_FALLBACK = 2592000;
const MARKET_BASE_URL = 'https://m.mcloud.139.com';
const MARKET_SOURCE_ID = '1097';
const TOKENPK_MARKET_NAME = 'National_TokenPK';
const TOKENPK_SOURCE_ID = '1030';
const TOKENPK_PRIZE_PAGE_URL = 'https://m.mcloud.139.com/portal/cloudItem/index.html?path=getPrize&sourceid=1102';
const TOKENPK_INVITE_CODE = 'eb11f7338ef147c48b39d92ec14e75bd2008';
const RED_PACKET_SOURCE_ID = '001216';
const RED_PACKET_VERSION = 'SYS_CONFIG_Y';
const RED_PACKET_BASE_URL = 'https://cpactiv.buy.139.com/cloudphone-market';
const RED_PACKET_PAGE_URL = 'https://cpactiv.buy.139.com/#/redEnvelopeParty/home?channelSrc=red-cmccapp';
const RED_PACKET_APP_ID = '12345681';
const RED_PACKET_SIGN_KEY = 'e10adc3949ba59abbe56e057f20f883e';
const RED_PACKET_CHANNEL_SRC = 'red-cmccapp';
const RED_PACKET_BROWSE_TASKS = ['NOVICE_2', 'NOVICE_3', 'MONTHLY_1'];
const RED_PACKET_DIRECT_TASKS = ['MONTHLY_4', 'MONTHLY_5'];
const RED_PACKET_KNOWN_ANSWERS = {
    '如何查看并更新移动云手机客户端最新版本？': '进入“我的”-点击“关于云手机”-点击“检查新版本”',
    '移动云手机可领取定向流量，每月赠送的定向流量是（  ）。': '30GB',
    '移动云手机端内订购的专业版分辨率已升级到1080P，该说法是否正确？': '正确',
    '移动云手机支持视频录制，该说法是否正确？': '正确',
    '云手机支持通过手机、平板、电脑等多种终端设备登录使用，该说法是否正确？': '正确',
    '使用中国移动号码登录移动云手机，是否支持手机号一键登录？': '支持',
    '只有中国移动运营商号码能使用移动云手机？': '不正确',
    '移动云手机是否需要充电使用？': '不需要',
    '移动云手机支持截图，该说法是否正确？': '正确',
    '移动云手机AI灵犀助手已接入DeepSeek，是否正确？': '正确',
    '移动云手机内支持画面清晰度切换，该说法是否正确？': '正确',
    '移动云手机支持连接蓝牙使用吗？': '不支持',
    '在云手机内安装游戏应用是否占本地手机存储空间？': '否，不占本地空间',
    '如何更换云机内的桌面主题或壁纸？': '云机内-【设置】-壁纸/个性主题',
    '如何将云手机里的应用添加至本地手机桌面？': '云手机桌面-长按应用-发送图标到本地',
};
const RED_PACKET_MANUAL_TASKS = {
    'NOVICE_1': '需跳转领取定向流量',
};
// AI 相机样图（与 py get_ai_camera_sample_base64 同一张 256x256 PNG 的 base64）
const AI_CAMERA_SAMPLE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAADoklEQVR4nO3TwU1UAQBFUXqxFPcufk32YAcWZC/ujYGQQAZkUOaNc09yCniLd++Obz8g626+AIYEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYD3+/n909vN154kAM521u+vvAQBcIa/vP4VZiAA3uQfXv+qMhAAf/ZB77+GBgTAaz70+teQgQB40cXeP2xAAJx24fevGhAAJ0zeP2lAADw3fP/lGxAAT8zff+EGBMAT8+sLgJn57y/fgAB4MH/8pAEB8GB+dwEwM//6qgEB8Nv86AJgZv7yYQMCQAC0zS8uAGbm/942IIC6+bkFwNL83AJgaX5uAbA0P7cAWJqfWwAszc8tAJbm5xYAS/NzC4Cl+bkFwNL83AJgaX5uAbA0P7cAWJqfWwAszc8tAMbm/169/xAAhwCIm19cAIzNXz55/yEA7s2PLgDG5l+//PsPAfBofncBMDZ//IXffwiAZ+a/v+T7DwHwzPz6AmCs8/5DAJwUef8hAF5SeP8hAF5x8+8/BMDrbvv9hwB4i5u8/j0B8CY3+f5DAJzllq5/TwCc7Tauf08AvN//+/tHAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpd5+/foEsAZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZD2C50n1zRaK+ZsAAAAAElFTkSuQmCC';
// deviceId / Token 缓存键，对应 py 的 ydyp_device_ids.json
const CACHE_KEY = 'ydyp_cache';

// ---------- 通用工具 ----------
function normalizeAuthorization(token) {
    token = (token || '').trim();
    if (token && !token.startsWith('Basic ')) return `Basic ${token}`;
    return token;
}

function randomString(length = 16) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let out = '';
    for (let i = 0; i < length; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
}

function uuid4Hex() {
    const hex = '0123456789abcdef';
    let s = '';
    for (let i = 0; i < 32; i++) s += hex.charAt(Math.floor(Math.random() * 16));
    s = s.slice(0, 12) + '4' + s.slice(13);
    const variant = hex.charAt(((parseInt(s.charAt(16), 16) & 0x3) | 0x8));
    s = s.slice(0, 16) + variant + s.slice(17);
    return s;
}

function uuid4() {
    const s = uuid4Hex();
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

// x-yun-tid，与 py generate_uuid 同格式
function generateUuid() {
    return `${randomString(8)}-${randomString(4)}-4${randomString(3)}-${'89ab'.charAt(Math.floor(Math.random() * 4))}${randomString(3)}-${randomString(12)}`;
}

function generateDeviceId() {
    if (REAL_DEVICE_ID) return REAL_DEVICE_ID;
    const deviceInfo = {
        deviceId: uuid4Hex().toUpperCase(),
        brand: 'Apple',
        model: 'iPhone 16 Pro',
        system: 'iOS 18.7',
        timestamp: Date.now()
    };
    return Crypt('base64-encode', JSON.stringify(deviceInfo));
}

function getEnvDeviceId() {
    return (getEnv('ydyp_device_id') || '').trim();
}

function buildXDeviceInfo(deviceId, netType = 'wifi', terminalType = '8', version = CLIENT_VERSION, brand = 'Apple', model = 'iPhone 16 Pro', system = 'iOS 18.7') {
    return `${netType}||${terminalType}|${version}|${brand}|${model}|${deviceId}||${system.toLowerCase()}|||||`;
}

function aesEncrypt(data, key) {
    const plain = typeof data === 'string' ? data : JSON.stringify(data);
    return Crypt('aes-ecb', plain, key);
}

function extractRawToken(token) {
    token = normalizeAuthorization(token);
    if (token.startsWith('Basic ')) token = token.slice(6);
    try {
        const parts = Crypt('base64-decode', token).split(':');
        if (parts.length >= 3) return parts[2];
    } catch (e) { }
    return token;
}

function buildAuthorization(account, rawToken) {
    return `Basic ${Crypt('base64-encode', `mobile:${account}:${rawToken}`)}`;
}

function parseExpireTimeToMillis(expireTime) {
    let expireSeconds = Math.floor(parseFloat(expireTime));
    if (isNaN(expireSeconds) || expireSeconds <= 0) expireSeconds = TOKEN_EXPIRE_SECONDS_FALLBACK;
    return Date.now() + expireSeconds * 1000;
}

// ---------- deviceId / Token 缓存 (对应 py 的 ydyp_device_ids.json) ----------
function loadStorage() {
    const data = $.toObj($.getdata(CACHE_KEY));
    return (data && typeof data === 'object') ? data : {};
}

function saveStorage(data) {
    data.updatedAt = Date.now();
    $.setdata($.toStr(data), CACHE_KEY);
}

function getStorageInfo(account) {
    const record = loadStorage()[account];
    return (record && typeof record === 'object') ? record : {};
}

function patchStorage(account, fields) {
    const data = loadStorage();
    const record = (data[account] && typeof data[account] === 'object') ? data[account] : {};
    Object.assign(record, fields);
    data[account] = record;
    saveStorage(data);
}

function getDeviceId(account) {
    return getStorageInfo(account).deviceId || '';
}

function saveDeviceId(deviceId, account) {
    patchStorage(account, { deviceId });
}

function saveTokenInfo(account, token, expiresAt, lastRefreshAt) {
    patchStorage(account, { token, expiresAt, lastRefreshAt });
}

function saveTokenpkAssistState(account, inviteCode, month) {
    patchStorage(account, { tokenpkAssistCode: inviteCode, tokenpkAssistMonth: month });
}

function ensureStorageEntry(account, token = '') {
    const data = loadStorage();
    const record = (data[account] && typeof data[account] === 'object') ? data[account] : {};
    if (record.deviceId === undefined) record.deviceId = '';
    const normalizedToken = normalizeAuthorization(token);
    if (normalizedToken && record.token !== normalizedToken) record.token = normalizedToken;
    if (record.expiresAt === undefined) record.expiresAt = 0;
    if (record.lastRefreshAt === undefined) record.lastRefreshAt = 0;
    data[account] = record;
    saveStorage(data);
}

// ---------- 北京时间 (接口文件名/有效期展示按 UTC+8) ----------
function pad2(num, width = 2) {
    return String(num).padStart(width, '0');
}

function bjNow() {
    return new Date(Date.now() + 8 * 3600 * 1000);
}

function bjStamp(withSeparator = true) {
    const d = bjNow();
    const ymd = `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
    const hms = `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`;
    return withSeparator ? `${ymd}_${hms}` : `${ymd}${hms}`;
}

function bjMonth() {
    const d = bjNow();
    return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}`;
}

function bjIsoMs() {
    const d = bjNow();
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}.${pad2(d.getUTCMilliseconds(), 3)}+08:00`;
}

function stripTags(text) {
    return (text || '').replace(/<[^>]+>/g, '');
}

// 对齐 py `x or []`：接口异常返回空对象/空串时按空数组处理，避免 for..of 抛错
function toArray(value) {
    return Array.isArray(value) ? value : [];
}


// ---------- 移动云盘任务类 ----------
class YP {
    constructor(user) {
        try {
            this.notebookId = null;
            this.noteToken = null;
            this.noteAuth = null;
            this.authToken = null;
            this.clickNum = 15;
            this.ssoToken = null;
            this.userDomainId = '';
            this.marketDeviceId = '';
            this.marketXDeviceInfo = '';
            this.marketHeaders = {};
            this.marketCookies = {};
            this.redPacketToken = '';
            this.redPacketMobile = '';
            this.userLogLines = [];
            this.cookies = { 'sensors_stay_time': String(Date.now()) };
            this.jwtHeaders = {
                'User-Agent': UA,
                'Accept': '*/*',
                'Host': 'caiyun.feixin.10086.cn:7071',
            };

            const authorization = normalizeAuthorization(user.Authorization);
            const phone = (user.phone || '').trim();
            if (!authorization || !phone) {
                throw new Error(`⚠️ 变量值格式错误: ${$.toStr(user)}`);
            }
            this.Authorization = authorization;
            this.account = phone;

            this.loadPersistedAuthorization();
            this.loadOrCreateMarketDeviceProfile(user.deviceId);
            this.authToken = extractRawToken(this.Authorization);

            this.encryptAccount = this.account.length >= 11
                ? this.account.slice(0, 3) + '****' + this.account.slice(-4)
                : this.account;
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

    sleep(minDelay = 1, maxDelay = 1.5) {
        return $.wait((Math.random() * (maxDelay - minDelay) + minDelay) * 1000);
    }

    getStorageRecord() {
        return getStorageInfo(this.account);
    }

    loadPersistedAuthorization() {
        const storedToken = normalizeAuthorization(getStorageInfo(this.account).token);
        if (storedToken) this.Authorization = storedToken;
    }

    loadOrCreateMarketDeviceProfile(userDeviceId) {
        ensureStorageEntry(this.account, this.Authorization);

        const envDeviceId = getEnvDeviceId();
        if (envDeviceId) {
            this.marketDeviceId = envDeviceId;
            this.marketXDeviceInfo = buildXDeviceInfo(envDeviceId);
            return;
        }
        // 账号变量里直接填的 deviceId 优先于缓存
        if (userDeviceId) {
            this.marketDeviceId = String(userDeviceId).trim();
            this.marketXDeviceInfo = buildXDeviceInfo(this.marketDeviceId);
            saveDeviceId(this.marketDeviceId, this.account);
            return;
        }
        const storedDeviceId = getDeviceId(this.account);
        if (storedDeviceId) {
            this.marketDeviceId = storedDeviceId;
            this.marketXDeviceInfo = buildXDeviceInfo(storedDeviceId);
            return;
        }
        this.marketDeviceId = generateDeviceId();
        this.marketXDeviceInfo = buildXDeviceInfo(this.marketDeviceId);
        if (this.marketDeviceId) saveDeviceId(this.marketDeviceId, this.account);
    }

    saveAuthorizationRecord({ token, userDomainId, refreshed, expiresAt, marketDeviceId, xDeviceInfo } = {}) {
        let finalToken = normalizeAuthorization(token || this.Authorization);
        const oldRecord = this.getStorageRecord();
        if (!finalToken) finalToken = normalizeAuthorization(oldRecord.token);
        let lastRefreshAt = oldRecord.lastRefreshAt || 0;
        if (refreshed) lastRefreshAt = Date.now();
        const recordExpiresAt = parseInt(expiresAt || oldRecord.expiresAt || (Date.now() + TOKEN_VALID_TIME), 10);

        const record = Object.assign({}, oldRecord, {
            account: this.account,
            token: finalToken,
            authToken: extractRawToken(finalToken),
            expiresAt: recordExpiresAt,
            updatedAt: Date.now(),
            lastRefreshAt,
        });
        if (userDomainId || oldRecord.userDomainId) record.userDomainId = userDomainId || oldRecord.userDomainId;
        const finalMarketDeviceId = marketDeviceId || oldRecord.marketDeviceId;
        const finalXDeviceInfo = xDeviceInfo || oldRecord.xDeviceInfo;
        if (finalMarketDeviceId) record.marketDeviceId = finalMarketDeviceId;
        if (finalXDeviceInfo) record.xDeviceInfo = finalXDeviceInfo;
        patchStorage(this.account, record);
    }

    shouldRefreshAuthorization(force = false) {
        if (force) return [true, '强制刷新'];
        const stored = this.getStorageRecord();
        const now = Date.now();
        const expiresAt = parseInt(stored.expiresAt || 0, 10);
        if (!stored.token) return [true, '本地无缓存Token'];
        if (now >= expiresAt) return [true, '缓存Token已过期'];
        if (expiresAt - now <= TOKEN_REFRESH_ADVANCE) return [true, `将在 ${((expiresAt - now) / 3600000).toFixed(1)} 小时后过期`];
        return [false, `Token 状态良好（剩余 ${((expiresAt - now) / 86400000).toFixed(1)} 天）`];
    }

    async refreshAuthorizationToken(force = false) {
        const [needRefresh, reason] = this.shouldRefreshAuthorization(force);
        if (!needRefresh) {
            this.log(`-Authorization状态: ${reason}`);
            return true;
        }

        // 使用微信小程序UA刷新Token（源码：miniprogram|||1.0）
        const refreshHeaders = {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47(0x18002f2c) NetType/WIFI Language/zh_CN miniProgram/wx4e4ed37286c816c2',
            'x-yun-tid': generateUuid(),
            'Authorization': this.Authorization,
            'x-yun-api-version': 'v1',
            'x-yun-module-type': '100',
            'x-yun-op-type': '1',
            'x-yun-app-channel': '10214200',
            'x-yun-client-info': '||8||||||||||||',
            'hcy-cool-flag': '1',
        };
        const stored = this.getStorageRecord();
        if (stored.userDomainId) refreshHeaders['x-yun-uni'] = stored.userDomainId;

        const refreshData = await this.requestJson({
            url: 'https://user-njs.yun.139.com/user/auth/refreshToken',
            headers: refreshHeaders,
            data: { 'data': aesEncrypt({ phoneNumber: this.account }, REFRESH_TOKEN_AES_KEY) },
            method: 'POST',
            retries: 1
        });
        if (!refreshData) {
            this.log(`-Authorization刷新失败: 接口无响应 (${reason})`);
            return true;
        }
        const code = String(refreshData.code || '');
        const data = refreshData.data;
        const success = !!refreshData.success;
        const isSuccess = ['0', '00', '000', '0000'].includes(code) || success || (code.startsWith('0') && code.length <= 4);
        if (!isSuccess || !data || typeof data !== 'object') {
            this.log(`-Authorization刷新失败: ${refreshData.message || refreshData.msg || '未知错误'} (code=${code || 'unknown'})`);
            return true;
        }
        const rawToken = data.token;
        if (!rawToken) {
            this.log('-Authorization刷新失败: 响应缺少token');
            return true;
        }
        const expiresAt = parseExpireTimeToMillis(data.expireTime);
        this.Authorization = buildAuthorization(this.account, rawToken);
        this.authToken = rawToken;
        this.saveAuthorizationRecord({ token: this.Authorization, refreshed: true, expiresAt });
        this.log(`-Authorization自动刷新成功: ${reason}`);
        this.log(`-Authorization有效期: ${$.time('yyyy-MM-dd HH:mm:ss', expiresAt)}`);
        return true;
    }

    syncTokenStorage() {
        const stored = this.getStorageRecord();
        const expiresAt = stored.expiresAt || Date.now() + TOKEN_VALID_TIME;
        const lastRefreshAt = stored.lastRefreshAt || 0;
        saveTokenInfo(this.account, this.Authorization, expiresAt, lastRefreshAt);
        if (this.marketDeviceId) saveDeviceId(this.marketDeviceId, this.account);
        this.saveAuthorizationRecord({ token: this.Authorization, userDomainId: this.userDomainId });
    }

    // ---------- 请求核心 ----------
    async sendRequest({ url, headers = {}, cookies = {}, data = null, params = null, method = 'GET', retries = 5 }) {
        const requestHeaders = Object.assign({}, headers);
        const jar = Object.assign({}, cookies);
        const cookieText = Object.keys(jar)
            .filter(key => jar[key] !== undefined && jar[key] !== null && jar[key] !== '')
            .map(key => `${key}=${jar[key]}`).join('; ');
        if (cookieText) requestHeaders['Cookie'] = cookieText;

        const options = {
            url: params ? appendParams(url, params) : url,
            headers: requestHeaders,
            _method: (method || 'GET').toLowerCase(),
            _respType: 'all',
            _timeout: 30000,
        };
        if (data !== null && data !== undefined) options.body = data;

        for (let attempt = 0; attempt < retries; attempt++) {
            const response = await Request(options);
            const status = Number(response && (response.status || response.statusCode)) || 0;
            if (response && (status === 0 || status < 400)) {
                if ($.is_debug === 'true') $.log(`\n【${url}】响应数据:\n${response.body || ''}`);
                return {
                    status: status || 200,
                    headers: ObjectKeys2LowerCase(response.headers || {}),
                    text: response.body === undefined ? '' : String(response.body),
                };
            }
            $.log(`请求异常: ${url}${status ? ` (status=${status})` : ''}`);
            if (attempt >= retries - 1) {
                $.log('达到最大重试次数。');
                return null;
            }
            await $.wait(1000);
        }
        return null;
    }

    async requestJson(opts) {
        const response = await this.sendRequest(opts);
        if (!response) return null;
        const data = $.toObj(response.text);
        if (data === null) {
            this.log(`响应解析失败: ${(response.text || '').slice(0, 120)}`);
            return null;
        }
        return data;
    }

    static getTodaySignState(result) {
        const todaySignIn = (result || {}).todaySignIn;
        if (typeof todaySignIn === 'boolean') return todaySignIn;
        for (const day of toArray(result && result.cal)) {
            if (day.t) return !!day.s;
        }
        return null;
    }

    static extractUserDomainId(jwtToken) {
        try {
            const payload = String(jwtToken).split('.')[1];
            const data = JSON.parse(Crypt('base64-decode', payload));
            let sub = data.sub || '';
            if (typeof sub === 'string') sub = JSON.parse(sub);
            return (sub && sub.userDomainId) || '';
        } catch (e) {
            return '';
        }
    }

    buildMarketContext(jwtToken) {
        this.userDomainId = YP.extractUserDomainId(jwtToken);
        this.marketHeaders = {
            'User-Agent': MARKET_UA,
            'Accept': '*/*',
            'jwtToken': jwtToken,
            'X-Requested-With': 'com.chinamobile.mcloud',
            'Referer': this.buildMarketPageUrl(),
        };
        this.marketCookies = { 'jwtToken': jwtToken };
        if (this.userDomainId) this.marketCookies['userDomainId'] = this.userDomainId;
        this.seedMarketDeviceCookie();
        this.syncTokenStorage();
    }

    buildMarketPageUrl(sourceId) {
        return `${MARKET_BASE_URL}/portal/mobilecloud/index.html?path=newsignin&sourceid=${sourceId || MARKET_SOURCE_ID}&enableShare=1&token=${this.ssoToken || ''}&targetSourceId=001005`;
    }

    getMarketDeviceId() {
        if (this.marketDeviceId) return this.marketDeviceId;
        for (const name of Object.keys(this.marketCookies)) {
            if (name.startsWith('.thumbcache_') && this.marketCookies[name]) {
                try {
                    return decodeURIComponent(this.marketCookies[name]);
                } catch (e) {
                    return this.marketCookies[name];
                }
            }
        }
        return '';
    }

    seedMarketDeviceCookie() {
        let deviceId = this.marketDeviceId;
        if (!deviceId) return;
        // 抓包请求头的 deviceId 带 "B" 前缀，Cookie .thumbcache_ 内存的是去前缀的原值
        if (deviceId.startsWith('B')) deviceId = deviceId.slice(1);
        for (const name of Object.keys(this.marketCookies)) {
            if (name.startsWith('.thumbcache_') && this.marketCookies[name] === deviceId) return;
        }
        this.marketCookies[`.thumbcache_${this.account}`] = deviceId;
    }

    buildMarketHeaders(extraHeaders, referer) {
        const headers = Object.assign({}, this.marketHeaders);
        headers['Referer'] = referer || headers['Referer'] || this.buildMarketPageUrl();
        const deviceId = this.getMarketDeviceId();
        if (deviceId) headers['deviceId'] = deviceId;
        if (this.marketXDeviceInfo) headers['x-DeviceInfo'] = this.marketXDeviceInfo;
        return Object.assign(headers, extraHeaders || {});
    }

    buildReceiveHeaders(sourceId) {
        return this.buildMarketHeaders({
            'showLoading': 'true',
            'appVersion': `${CLIENT_VERSION}.0`,
            'activityId': 'sign_in_3',
        }, this.buildMarketPageUrl(sourceId));
    }

    requestMarketJson(url, { params, data, method = 'GET', retries = 5, headers, cookies } = {}) {
        const requestCookies = Object.assign({}, this.marketCookies, cookies || {});
        return this.requestJson({
            url, headers: this.buildMarketHeaders(headers), cookies: requestCookies,
            data, params, method, retries,
        });
    }

    async postSigninJournaling(keyword, sourceId) {
        const currentSourceId = sourceId || MARKET_SOURCE_ID;
        const payload = `module=uservisit&optkeyword=${keyword}&sourceid=${currentSourceId}&marketName=sign_in_3`;
        const response = await this.sendRequest({
            url: `${MARKET_BASE_URL}/ycloud/visitlog/journaling`,
            headers: this.buildMarketHeaders({ 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, this.buildMarketPageUrl(currentSourceId)),
            cookies: this.marketCookies,
            data: payload,
            method: 'POST',
            retries: 1
        });
        return response !== null;
    }

    async prepareSigninCenterSession(forReceive = false, sourceId) {
        const currentSourceId = sourceId || MARKET_SOURCE_ID;
        const pageUrl = this.buildMarketPageUrl(currentSourceId);
        await this.sendRequest({
            url: pageUrl, headers: this.buildMarketHeaders(null, pageUrl),
            cookies: this.marketCookies, retries: 1,
        });
        for (const keyword of [
            'newsignin_index_pv',
            'newsignin_index_client',
            'newsignin_index_app_client',
            'newsignin_index_cookie_login',
            'newsignin_index_cookie',
            'newsignin_index_app_cookie_login',
        ]) {
            await this.postSigninJournaling(keyword, currentSourceId);
        }
        if (forReceive) await this.postSigninJournaling('newsignin_index_receive_type', currentSourceId);
        return true;
    }

    clickTask(taskId, key = 'task') {
        return this.requestMarketJson(`${MARKET_BASE_URL}/market/signin/task/click?key=${key}&id=${taskId}`);
    }

    // ---------- 算力大作战 ----------
    buildTokenpkPageUrl() {
        return `${MARKET_BASE_URL}/portal/yunClound/index.html?path=${TOKENPK_MARKET_NAME}&sourceid=${TOKENPK_SOURCE_ID}&enableShare=1`;
    }

    requestTokenpkJson(pathUrl, { params, data, method = 'GET', headers, retries = 3 } = {}) {
        const url = String(pathUrl).startsWith('http') ? pathUrl : `${MARKET_BASE_URL}${pathUrl}`;
        const requestHeaders = Object.assign({ 'Cache-Control': 'no-cache' }, headers || {});
        return this.requestJson({
            url,
            headers: this.buildMarketHeaders(requestHeaders, this.buildTokenpkPageUrl()),
            cookies: this.marketCookies,
            data, params, method, retries,
        });
    }

    static buildTokenpkTaskPayload(task) {
        const button = (task || {}).button || {};
        // 新版任务列表按平台下发按钮(ios/android/harmony/other)，旧版是 app；key 为空时 click 会被网关 404
        const platformButton = button.app || button.ios || button.android || button.harmony || button.other || {};
        return {
            marketName: TOKENPK_MARKET_NAME,
            taskId: task.id,
            key: platformButton.ext || '',
            source: 'app',
        };
    }

    async getTokenpkTaskList(logError = true) {
        const data = await this.requestTokenpkJson('/ycloud/tokenpk/task/list', {
            params: { marketName: TOKENPK_MARKET_NAME, platform: 'ios', sortState: 'true' },
        });
        if (!data) {
            if (logError) this.log('-获取算力大作战任务失败: 接口无响应');
            return null;
        }
        if (data.code !== 0) {
            if (logError) this.log(`-获取算力大作战任务失败: ${data.msg || '未知错误'}`);
            return null;
        }
        return toArray(data.result);
    }

    async getTokenpkTask(taskId) {
        const tasks = await this.getTokenpkTaskList(false);
        if (tasks === null) return null;
        return tasks.find(task => task.id === taskId) || null;
    }

    static getTokenpkTaskName(task) {
        return stripTags((task && (task.name || task.description)) || String((task && task.id) || ''));
    }

    logTokenpkPrizes(prizes, defaultMessage) {
        const list = toArray(prizes);
        const successful = list.filter(prize => prize.success).map(prize => prize.prizeName || '');
        if (successful.length) {
            this.log(`-${defaultMessage}: ${successful.filter(Boolean).join(' + ')}`);
            return true;
        }
        const errors = list.filter(prize => prize.errorMsg).map(prize => prize.errorMsg);
        this.log(`-${defaultMessage}: ${errors.length ? errors[0] : '成功'}`);
        return errors.length === 0;
    }

    async receiveTokenpkTaskPrize(task) {
        const taskName = YP.getTokenpkTaskName(task);
        const data = await this.requestTokenpkJson('/ycloud/tokenpk/task/step/receivePrize', {
            data: { marketName: TOKENPK_MARKET_NAME, taskId: task.id, source: 'app' },
            method: 'POST',
        });
        if (!data || data.code !== 0) {
            this.log(`-领取任务奖励失败: ${taskName} ${data ? (data.msg || '接口无响应') : '接口无响应'}`);
            return false;
        }
        this.logTokenpkPrizes(((data.result || {}).prizes), `已领取: ${taskName}`);
        return true;
    }

    async completeTokenpkUploadPhoto() {
        const uploadInfo = await this.createCloudFile('auto_tokenpk_photo_', 'jpg');
        if (!uploadInfo) {
            this.log('-上传照片失败: 接口无响应');
            return false;
        }
        this.log(`-已上传照片: ${uploadInfo.fileName || ''}`);
        await this.cleanupUploadedFiles(uploadInfo);
        return true;
    }

    async completeTokenpkAction(task) {
        const ext = YP.buildTokenpkTaskPayload(task).key;
        if (ext === 'uploadPhoto') return await this.completeTokenpkUploadPhoto();
        if (ext === 'aiCamera') return await this.completeAiCameraTask();
        if (ext === 'createNote') return await this.completeNoteTask();
        if (ext === 'shareFile') return (await this.shareCloudFile()) ? true : false;
        if (ext === 'inviteFriend') {
            const inviteData = (await this.requestTokenpkJson('/ycloud/tokenpk/invite/generateInviteCode')) || {};
            if (inviteData.code === 0 && inviteData.result) return true;
            this.log(`-生成活动邀请码失败: ${inviteData.msg || '接口无响应'}`);
            return false;
        }
        if (ext === 'openUrl' || ext === 'xhsLike') return true;
        if (ext === 'backup') {
            this.log('-需手动完成: 成功备份一次文件');
            return false;
        }
        if (ext === 'loginPc') {
            this.log('-需手动完成: 登录PC客户端上传文件');
            return false;
        }
        this.log(`-暂不支持自动完成: ${YP.getTokenpkTaskName(task)}`);
        return false;
    }

    async reserveTokenpkTask(task) {
        const taskName = YP.getTokenpkTaskName(task);
        const data = await this.requestTokenpkJson('/ycloud/tokenpk/task/step/reserve', {
            data: YP.buildTokenpkTaskPayload(task), method: 'POST',
        });
        if (!data || data.code !== 0) {
            this.log(`-预约失败: ${taskName} ${data ? (data.msg || '接口无响应') : '接口无响应'}`);
            return false;
        }
        const prizes = toArray((data.result || {}).prizes);
        if (prizes.length) this.logTokenpkPrizes(prizes, `已领取预约奖励: ${taskName}`);
        else this.log(`-预约成功: ${taskName}`);
        return true;
    }

    async handleTokenpkTask(task) {
        const taskName = YP.getTokenpkTaskName(task);
        const state = task.state;
        if (state === 'FINISH') {
            this.log(`-已完成: ${taskName}`);
            return;
        }
        if (state === 'SUCCESS') {
            if (task.taskType === 'RESERVE') this.log(`-已预约: ${taskName}`);
            else await this.receiveTokenpkTaskPrize(task);
            return;
        }
        if (state !== 'WAIT') {
            this.log(`-任务状态未知: ${taskName} (${state})`);
            return;
        }
        if (task.taskType === 'RESERVE') {
            await this.reserveTokenpkTask(task);
            return;
        }

        const payload = YP.buildTokenpkTaskPayload(task);
        if (!payload.key) {
            this.log(`-暂不支持自动完成: ${taskName}`);
            return;
        }

        this.log(`-去完成: ${taskName}`);
        const clickData = await this.requestTokenpkJson('/ycloud/tokenpk/task/step/click', {
            data: payload, method: 'POST',
        });
        if (!clickData || clickData.code !== 0) {
            this.log(`-任务登记失败: ${taskName} ${clickData ? (clickData.msg || '接口无响应') : '接口无响应'}`);
            return;
        }

        const actionCompleted = await this.completeTokenpkAction(task);
        await $.wait(1000);
        const refreshedTask = (await this.getTokenpkTask(task.id)) || task;
        const refreshedState = refreshedTask.state;
        if (refreshedState === 'SUCCESS') await this.receiveTokenpkTaskPrize(refreshedTask);
        else if (refreshedState === 'FINISH') this.log(`-已完成: ${taskName}`);
        else if (actionCompleted) this.log(`-已执行任务动作，等待状态更新: ${taskName}`);
    }

    async receivePendingTokenpkTaskPrizes() {
        const tasks = toArray(await this.getTokenpkTaskList(false));
        for (const task of tasks) {
            if (task.state === 'SUCCESS' && task.taskType !== 'RESERVE') {
                await this.receiveTokenpkTaskPrize(task);
            } else if (task.state === 'WAIT' && YP.buildTokenpkTaskPayload(task).key === 'shareFile') {
                this.log('-分享接口已执行但活动未记账，需在APP内分享一次文件');
            }
        }
    }

    async logTokenpkPrizeStatus() {
        const data = await this.requestTokenpkJson('/ycloud/prizeApi/checkPrize/getUserPrizeLogPageV2', {
            params: { marketName: TOKENPK_MARKET_NAME, currPage: 1, pageSize: 1000 },
        });
        if (!data || data.code !== 0) {
            this.log(`-查询算力大作战奖品失败: ${data ? (data.msg || '接口无响应') : '接口无响应'}`);
            return;
        }

        const records = toArray((data.result || {}).result);
        const pending = records.filter(record => record.flag === 1);
        if (pending.length) {
            this.log('\n🎁 算力大作战奖品');
            const expiryTimes = [];
            for (const record of pending) {
                const expiry = String(record.expireTime || '').replace('T', ' ').split('.')[0];
                if (expiry) {
                    expiryTimes.push(expiry);
                    this.log(`-待领取: ${record.prizeName || '奖品'} (${expiry} 到期)`);
                } else {
                    this.log(`-待领取: ${record.prizeName || '奖品'}`);
                }
            }
            if (expiryTimes.length) this.log(`-APP领奖 (最早 ${expiryTimes.sort()[0]} 到期): ${TOKENPK_PRIZE_PAGE_URL}`);
            else this.log(`-APP领奖: ${TOKENPK_PRIZE_PAGE_URL}`);
            return;
        }

        const claimed = records.filter(record => record.flag === 2);
        if (claimed.length) {
            this.log('\n🎁 算力大作战奖品');
            for (const record of claimed.slice(0, 5)) {
                this.log(`-已领取: ${record.prizeName || '奖品'}`);
            }
        }
    }

    async assistTokenpkTarget() {
        if (!TOKENPK_INVITE_CODE) return false;
        const currentMonth = bjMonth();
        const stored = getStorageInfo(this.account);
        if (stored.tokenpkAssistCode === TOKENPK_INVITE_CODE && stored.tokenpkAssistMonth === currentMonth) {
            this.log('-本月已完成目标好友助力');
            return false;
        }

        const ownCodeData = (await this.requestTokenpkJson('/ycloud/tokenpk/invite/generateInviteCode')) || {};
        if (ownCodeData.code !== 0 || !ownCodeData.result) {
            this.log(`-跳过好友助力: 无法确认本号邀请码 (${ownCodeData.msg || '接口无响应'})`);
            return false;
        }
        const ownCode = String(ownCodeData.result);
        if (ownCode === TOKENPK_INVITE_CODE) {
            this.log('-目标邀请码属于本号，跳过自助力');
            return false;
        }

        const assistData = await this.requestTokenpkJson('/ycloud/tokenpk/invite/acceptInvite', {
            data: `code=${TOKENPK_INVITE_CODE}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        });
        if (assistData && assistData.code === 0) {
            saveTokenpkAssistState(this.account, TOKENPK_INVITE_CODE, currentMonth);
            this.log('-好友助力成功');
            return true;
        }
        this.log(`-好友助力未成功: ${assistData ? (assistData.msg || '接口无响应') : '接口无响应'}`);
        return false;
    }

    async receiveTokenpkProgressRewards() {
        const homeData = await this.requestTokenpkJson('/ycloud/tokenpk/toplist/progress/queryHome');
        if (!homeData || homeData.code !== 0) {
            this.log(`-查询Token消耗进度失败: ${homeData ? (homeData.msg || '接口无响应') : '接口无响应'}`);
            return;
        }
        const result = homeData.result || {};
        this.log(`-本月已消耗Token: ${result.usedToken || 0}`);
        for (const stage of toArray(result.rewardStages)) {
            if (stage.status !== 1) continue;
            const rewardData = await this.requestTokenpkJson('/ycloud/tokenpk/toplist/progress/receiveReward', {
                data: { phaseNo: stage.phaseNo }, method: 'POST',
            });
            if (rewardData && rewardData.code === 0) {
                this.log(`-已领取Token阶段奖励: ${stage.rewardName || stage.phaseNo}`);
            } else {
                this.log(`-Token阶段奖励领取失败: ${stage.phaseNo} ${rewardData ? (rewardData.msg || '接口无响应') : '接口无响应'}`);
            }
        }
    }

    async drawTokenpkLottery() {
        const chanceData = await this.requestTokenpkJson('/ycloud/tokenpk/toplist/progress/queryRemainChance');
        if (!chanceData || chanceData.code !== 0) {
            this.log(`-查询算力抽奖机会失败: ${chanceData ? (chanceData.msg || '接口无响应') : '接口无响应'}`);
            return;
        }
        const chances = Math.max(0, parseInt(chanceData.result || 0, 10) || 0);
        this.log(`-当前算力抽奖机会: ${chances}`);
        for (let i = 0; i < chances; i++) {
            const drawData = await this.requestTokenpkJson('/ycloud/tokenpk/toplist/progress/lottery', { method: 'POST' });
            if (!drawData || drawData.code !== 0) {
                this.log(`-算力抽奖失败: ${drawData ? (drawData.msg || '接口无响应') : '接口无响应'}`);
                break;
            }
            const result = drawData.result || {};
            if (result.win) this.log(`-算力抽奖获得: ${result.prizeName || '奖品'}`);
            else this.log('-算力抽奖: 未中奖');
        }
    }

    async nationalTokenPk() {
        this.log('\n⚡ 算力大作战');
        const tasks = await this.getTokenpkTaskList();
        if (tasks === null) return;
        for (const task of tasks) {
            await this.handleTokenpkTask(task);
        }
        await $.wait(2000);
        await this.receivePendingTokenpkTaskPrizes();
        await this.assistTokenpkTarget();
        await this.receiveTokenpkProgressRewards();
        await this.drawTokenpkLottery();
        await this.logTokenpkPrizeStatus();
    }


    // ---------- 红包派对 ----------
    buildRedPacketHeaders(token = '') {
        const requestId = `${bjStamp(false)}${Date.now()}${randomString(8)}`;
        const timestamp = Date.now();
        const headers = {
            'requestId': requestId,
            'appId': RED_PACKET_APP_ID,
            'token': token || '',
        };
        const raw = Object.keys(headers).filter(key => headers[key] !== null && headers[key] !== undefined).map(key => String(headers[key])).join('');
        headers['sign'] = Crypt('md5', `${raw}${RED_PACKET_SIGN_KEY}${timestamp}`);
        headers['timestamp'] = String(timestamp);
        return Object.assign(headers, {
            'User-Agent': UA,
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json;charset=UTF-8',
            'Origin': 'https://cpactiv.buy.139.com',
            'Referer': RED_PACKET_PAGE_URL,
            'x-origin': RED_PACKET_PAGE_URL,
            'x-channelSrc': RED_PACKET_CHANNEL_SRC,
            'x-DeviceInfo': this.buildRedPacketDeviceInfo(),
        });
    }

    buildRedPacketDeviceInfo() {
        const screen = '390X844';
        const uuidValue = `${Date.now()}${randomString(10)}`;
        return ['wifi', 'h5', '1.0.0', 'v1.0.0', '', UA, uuidValue, '', '', screen, 'zh', '', ''].join('|');
    }

    requestRedPacketJson(pathUrl, { data, token, retries = 5 } = {}) {
        return this.requestJson({
            url: `${RED_PACKET_BASE_URL}${pathUrl}`,
            headers: this.buildRedPacketHeaders(token === undefined || token === null ? this.redPacketToken : token),
            data: data || {},
            method: 'POST',
            retries,
        });
    }

    async loginRedPacket() {
        if (this.redPacketToken) return true;
        const ssoToken = await this.querySpecToken(RED_PACKET_SOURCE_ID);
        if (!ssoToken) {
            this.log('-红包派对登录失败: SSO token获取失败');
            return false;
        }
        const loginData = await this.requestRedPacketJson('/user/tokenValidate', {
            data: { version: '1.0', pintype: 13, token: ssoToken, deviceId: '', loginConfig: '' },
            token: '',
        });
        if (!loginData) {
            this.log('-红包派对登录失败: 接口无响应');
            return false;
        }
        const header = loginData.header || {};
        const result = loginData.data || {};
        if (String(header.status) === '200' && result.token) {
            this.redPacketToken = result.token;
            this.redPacketMobile = result.account || result.mobile || result.phone || this.account;
            return true;
        }
        this.log(`-红包派对登录失败: ${header.errMsg || header.respMsg || result.errorMsg || '未知错误'}`);
        return false;
    }

    getRedPacketTaskList() {
        return this.requestRedPacketJson('/redpacket/configTaskLoginList', { data: { version: RED_PACKET_VERSION } });
    }

    getRedPacketAccountInfo() {
        return this.requestRedPacketJson('/redpacket/userAccountInfo', { data: { version: RED_PACKET_VERSION, platformType: 1 } });
    }

    getRedPacketToastInfo(taskCode) {
        const data = { version: RED_PACKET_VERSION };
        if (taskCode) data['configTaskCode'] = taskCode;
        return this.requestRedPacketJson('/redpacket/userToastInfo', { data });
    }

    static redPacketStatusText(status) {
        const map = { 0: '未完成', 1: '已完成', 3: '奖品已兑完', 4: '明天再来' };
        return map[status] !== undefined ? map[status] : String(status);
    }

    static getRedPacketTaskAmount(task) {
        let amount = (task || {}).prizeAmount;
        if (amount === undefined || amount === null) amount = (task || {}).taskAmount;
        if (amount === undefined || amount === null) return '';
        const value = parseFloat(amount) / 100;
        return isNaN(value) ? '' : `${value.toFixed(2)}元`;
    }

    completeRedPacketTask(task) {
        return this.requestRedPacketJson('/redpacket/userCompleteTask', {
            data: { version: RED_PACKET_VERSION, platformType: 1, taskId: task.id },
        });
    }

    browseRedPacketTask(taskCode) {
        return this.requestRedPacketJson('/redpacket/userBrowse', { data: { taskCode, version: RED_PACKET_VERSION } });
    }

    static redPacketData(data) {
        return (data || {}).data || {};
    }

    redPacketError(data, defaultMsg = '未知错误') {
        const header = (data || {}).header || {};
        const result = YP.redPacketData(data);
        return result.errorMsg || header.errMsg || header.respMsg || defaultMsg;
    }

    isRedPacketOk(data) {
        return !!data && String(((data || {}).header || {}).status) === '200';
    }

    async completeRedPacketAction(task) {
        const taskName = task.taskName || '';
        const data = await this.completeRedPacketTask(task);
        if (!data) {
            this.log(`-红包派对任务失败: ${taskName} 接口无响应`);
            return false;
        }
        const result = YP.redPacketData(data);
        if (result && result.status !== null && result.status !== undefined && result.status !== 1) {
            this.log(`-红包派对任务失败: ${taskName} ${this.redPacketError(data)}`);
            return false;
        }
        return true;
    }

    async userSignRedPacket() {
        const data = await this.requestRedPacketJson('/redpacket/userSign', { data: { version: RED_PACKET_VERSION, platformType: 1 } });
        if (!data) {
            this.log('-红包派对签到失败: 接口无响应');
            return false;
        }
        const result = YP.redPacketData(data);
        if (this.isRedPacketOk(data) && result.status === 1) {
            this.log('-已完成: 每日签到');
            await this.logRedPacketReward('SIGN_1', '每日签到');
            return true;
        }
        this.log(`-红包派对签到失败: ${this.redPacketError(data)}`);
        return false;
    }

    async getRedPacketTodaySign(taskList) {
        if (!taskList) {
            const data = await this.getRedPacketTaskList();
            if (!this.isRedPacketOk(data)) return null;
            taskList = YP.redPacketData(data);
        }
        for (const item of toArray((taskList || {}).configTaskSignList)) {
            if (item.isToday === 1) return item;
        }
        return null;
    }

    async getRedPacketCloudPhones() {
        const phones = [];
        for (const status of ['ACTIVE', 'PENDING']) {
            const data = await this.requestRedPacketJson('/thirdapi/huawei/thirdQueryUserRelationshipV2', {
                data: { pageNumber: 1, pageSize: 10, status },
            });
            const body = YP.redPacketData(data);
            const nested = (body && typeof body === 'object' && body.data) ? body.data : body;
            const detail = (nested && typeof nested === 'object') ? nested : body;
            phones.push(...toArray((detail || {}).subscribeDetails));
        }
        return phones;
    }

    async getRedPacketHwToken() {
        const data = await this.requestRedPacketJson('/user/gethwToken', { data: { token: this.redPacketToken } });
        const body = YP.redPacketData(data);
        return body.hwToken || ((body.data && typeof body.data === 'object') ? body.data.hwToken : '') || '';
    }

    async getRedPacketRcsToken(targetSourceId = '0') {
        const data = await this.requestRedPacketJson('/user/getRcsToken', { data: { token: this.redPacketToken, targetSourceId } });
        return YP.redPacketData(data).token || '';
    }

    async getRedPacketAppList() {
        const data = await this.requestRedPacketJson('/redpacket/configAppList', { data: { platformType: 1 } });
        if (!this.isRedPacketOk(data)) return [];
        return toArray(YP.redPacketData(data).list);
    }

    async getRedPacketInstallStatus(hwToken, instanceId, packageName) {
        const data = await this.requestRedPacketJson('/app/activity/instanceApkInstallStatus', {
            data: { hwToken, apkList: [packageName], instanceIdList: [instanceId] },
        });
        let items = YP.redPacketData(data);
        if (items && typeof items === 'object' && !Array.isArray(items)) items = items.data;
        if (items && typeof items === 'object' && !Array.isArray(items)) items = toArray(items.list);
        if (!items || !items.length) return null;
        const instanceList = toArray((items[0] || {}).instanceList);
        if (!instanceList.length) return null;
        return instanceList[0].installStatus;
    }

    async pollRedPacketInstallTask(hwToken, taskId) {
        for (let i = 0; i < 60; i++) {
            const data = await this.requestRedPacketJson('/app/activity/appInstallTaskStatus', { data: { taskId, hwToken } });
            const body = YP.redPacketData(data);
            const statusData = (body && typeof body === 'object' && body.data && typeof body.data === 'object') ? body.data : body;
            const status = (statusData || {}).taskStatus;
            if (status === 2) return true;
            if (status === 3) return false;
            await this.sleep(1, 1.2);
        }
        return false;
    }

    reportRedPacketInstallApp(task, app, existed) {
        const data = { taskId: task.id, appId: app.id, version: RED_PACKET_VERSION, platformType: 1 };
        if (existed !== undefined && existed !== null) data['existed'] = existed;
        return this.requestRedPacketJson('/redpacket/userInstallApp', { data });
    }

    async installRedPacketApp(task) {
        if (!await this.completeRedPacketAction(task)) return false;
        const phones = await this.getRedPacketCloudPhones();
        if (!phones.length) {
            this.log(`-需手动完成: ${task.taskName || ''} (无云手机)`);
            return false;
        }
        const phone = phones.find(item => ((item.subsProdInstances || [{}])[0] || {}).lockStatus !== 'Y') || phones[0];
        const instanceId = phone.instanceId;
        if (!instanceId || ((phone.subsProdInstances || [{}])[0] || {}).lockStatus === 'Y') {
            this.log(`-需手动完成: ${task.taskName || ''} (云机锁屏)`);
            return false;
        }
        const apps = await this.getRedPacketAppList();
        if (!apps.length) {
            this.log(`-红包派对任务失败: ${task.taskName || ''} 应用列表为空`);
            return false;
        }
        const hwToken = await this.getRedPacketHwToken();
        if (!hwToken) {
            this.log(`-红包派对任务失败: ${task.taskName || ''} hwToken获取失败`);
            return false;
        }
        for (const app of apps) {
            const packageName = app.packageName;
            if (!packageName) continue;
            if (await this.getRedPacketInstallStatus(hwToken, instanceId, packageName) === 2) {
                await this.reportRedPacketInstallApp(task, app, 1);
                const refreshed = (await this.refreshRedPacketTask(task.taskCode)) || {};
                if (refreshed.userStatus === 1) {
                    this.log(`-已完成: ${task.taskName || ''}`);
                    await this.logRedPacketReward(task.taskCode, task.taskName || '');
                    return true;
                }
                continue;
            }
            const installData = await this.requestRedPacketJson('/app/activity/apkInstall', {
                data: { instanceId, appId: app.packageId, hwToken },
            });
            const body = YP.redPacketData(installData);
            const installResult = (body && typeof body === 'object' && body.data && typeof body.data === 'object') ? body.data : body;
            if (!(installResult || {}).success) continue;
            if (await this.pollRedPacketInstallTask(hwToken, installResult.taskId)) {
                await this.reportRedPacketInstallApp(task, app);
                const refreshed = (await this.refreshRedPacketTask(task.taskCode)) || {};
                if (refreshed.userStatus === 1) {
                    this.log(`-已完成: ${task.taskName || ''}`);
                    await this.logRedPacketReward(task.taskCode, task.taskName || '');
                    return true;
                }
                this.log(`-已安装应用: ${app.apkName || packageName}`);
                return true;
            }
        }
        this.log(`-红包派对任务失败: ${task.taskName || ''} 未找到可安装应用`);
        return false;
    }

    async completeRedPacketCloudUse(task) {
        if (!await this.completeRedPacketAction(task)) return false;
        const phones = await this.getRedPacketCloudPhones();
        if (phones.length) await this.getRedPacketRcsToken();
        const refreshed = (await this.refreshRedPacketTask(task.taskCode)) || {};
        if (refreshed.userStatus === 1) {
            this.log(`-已完成: ${task.taskName || ''}`);
            await this.logRedPacketReward(task.taskCode, task.taskName || '');
            return true;
        }
        this.log(`-需手动完成: ${task.taskName || ''} (需云机内实际使用)`);
        return true;
    }

    async getRedPacketTopic() {
        const data = await this.requestRedPacketJson('/redpacket/configTopicList', { data: {} });
        const topics = toArray(YP.redPacketData(data).list);
        return topics.length ? topics[0] : null;
    }

    async answerRedPacketTopic(task) {
        if (!await this.completeRedPacketAction(task)) return false;
        let question = '';
        let topic = null;
        let options = [];
        let answered = false;
        for (let i = 0; i < 15; i++) {
            topic = await this.getRedPacketTopic();
            if (!topic) {
                this.log(`-红包派对任务失败: ${task.taskName || ''} 题库为空`);
                return false;
            }
            question = topic.topicContent || '';
            const answerText = RED_PACKET_KNOWN_ANSWERS[question];
            try {
                options = toArray($.toObj(topic.topicOption || '[]'));
            } catch (e) {
                options = [];
            }
            if (answerText && options.indexOf(answerText) !== -1) {
                answered = true;
                break;
            }
            await this.sleep(0.1, 0.2);
        }
        if (!answered) {
            this.log(`-需手动完成: ${task.taskName || ''} (未知题目: ${question})`);
            return false;
        }
        const answer = 'ABCD'.charAt(options.indexOf(RED_PACKET_KNOWN_ANSWERS[question]));
        const data = await this.requestRedPacketJson('/redpacket/userTopicAnswer', {
            data: { taskId: parseInt(task.id, 10), topicId: parseInt(topic.id, 10), answer, version: RED_PACKET_VERSION, platformType: 1 },
        });
        const result = YP.redPacketData(data);
        if (this.isRedPacketOk(data) && result.status === 1) {
            this.log(`-已完成: ${task.taskName || ''}`);
            await this.logRedPacketReward(task.taskCode, task.taskName || '');
            return true;
        }
        this.log(`-红包派对任务失败: ${task.taskName || ''} ${this.redPacketError(data)}`);
        return false;
    }

    async logRedPacketReward(taskCode, defaultName = '') {
        const data = await this.getRedPacketToastInfo(taskCode);
        if (!data || String((data.header || {}).status) !== '200') return;
        const prize = ((data.data || {}).lastUserPrize) || {};
        const amount = prize.prizeAmount;
        if (amount) {
            const value = parseFloat(amount) / 100;
            if (isNaN(value)) this.log(`-红包派对奖励: ${prize.prizeName || defaultName} +${amount}`);
            else this.log(`-红包派对奖励: ${prize.prizeName || defaultName} +${value.toFixed(2)}元`);
        }
    }

    async refreshRedPacketTask(taskCode) {
        const data = await this.getRedPacketTaskList();
        if (!data || String((data.header || {}).status) !== '200') return null;
        const taskList = data.data || {};
        for (const group of ['configTaskNoviceList', 'configTaskDailyList', 'configTaskMonthlyList']) {
            for (const task of toArray(taskList[group])) {
                if (task.taskCode === taskCode) return task;
            }
        }
        return null;
    }

    async finishRedPacketTask(task, browse = false) {
        const taskName = task.taskName || '';
        const taskCode = task.taskCode || '';
        const completeData = await this.completeRedPacketTask(task);
        if (!completeData) {
            this.log(`-红包派对任务失败: ${taskName} 接口无响应`);
            return false;
        }
        const result = completeData.data || {};
        if (result && result.status !== null && result.status !== undefined && result.status !== 1) {
            this.log(`-红包派对任务失败: ${taskName} ${result.errorMsg || '未知错误'}`);
            return false;
        }
        if (browse) {
            await this.sleep(15, 16);
            const browseData = await this.browseRedPacketTask(taskCode);
            if (!browseData || String((browseData.header || {}).status) !== '200') {
                const msg = ((browseData || {}).data || {}).errorMsg || '浏览确认失败';
                this.log(`-红包派对任务失败: ${taskName} ${msg}`);
                return false;
            }
        }
        const refreshed = (await this.refreshRedPacketTask(taskCode)) || {};
        const status = refreshed.userStatus !== undefined ? refreshed.userStatus : task.userStatus;
        if (status === 1) {
            this.log(`-已完成: ${taskName}`);
            await this.logRedPacketReward(taskCode, taskName);
            return true;
        }
        this.log(`-已登记: ${taskName} (${YP.redPacketStatusText(status)})`);
        return true;
    }

    async logRedPacketBalance() {
        const data = await this.getRedPacketAccountInfo();
        if (!data || String((data.header || {}).status) !== '200') {
            this.log('-红包派对余额查询失败');
            return;
        }
        const info = ((data.data || {}).info) || {};
        const canAmount = parseFloat(info.canAmount || 0) / 100;
        const totalAmount = parseFloat(info.totalAmount || 0) / 100;
        if (isNaN(canAmount) || isNaN(totalAmount)) {
            this.log('-红包派对余额查询失败: 响应异常');
            return;
        }
        this.log(`-红包派对余额: 可用${canAmount.toFixed(2)}元，累计${totalAmount.toFixed(2)}元`);
    }

    async handleRedPacketTask(task) {
        const taskName = task.taskName || '';
        const taskCode = task.taskCode || '';
        const status = parseInt(task.userStatus || 0, 10);
        const amount = YP.getRedPacketTaskAmount(task);
        const suffix = amount ? ` (${amount})` : '';
        if (status === 1) {
            this.log(`-已完成: ${taskName}${suffix}`);
            return;
        }
        if (status === 3 || status === 4) {
            this.log(`-暂不可做: ${taskName} (${YP.redPacketStatusText(status)})`);
            return;
        }
        if (RED_PACKET_BROWSE_TASKS.includes(taskCode)) {
            this.log(`-去完成: ${taskName}${suffix}`);
            await this.finishRedPacketTask(task, true);
            return;
        }
        if (RED_PACKET_DIRECT_TASKS.includes(taskCode)) {
            this.log(`-去完成: ${taskName}${suffix}`);
            await this.finishRedPacketTask(task);
            return;
        }
        if (taskCode === 'DAILY_1') {
            this.log(`-去完成: ${taskName}${suffix}`);
            await this.completeRedPacketCloudUse(task);
            return;
        }
        if (taskCode === 'MONTHLY_2') {
            this.log(`-去完成: ${taskName}${suffix}`);
            await this.installRedPacketApp(task);
            return;
        }
        if (taskCode === 'MONTHLY_3') {
            this.log(`-去完成: ${taskName}${suffix}`);
            await this.answerRedPacketTopic(task);
            return;
        }
        this.log(`-需手动完成: ${taskName}${suffix} (${RED_PACKET_MANUAL_TASKS[taskCode] || '未知任务'})`);
    }

    async handleRedPacketSign(taskList) {
        const today = await this.getRedPacketTodaySign(taskList);
        if (!today) return;
        const status = parseInt(today.status || 0, 10);
        const amount = today.signAmount;
        const suffix = amount ? ` (${(parseFloat(amount) / 100).toFixed(2)}元)` : '';
        if (status === 1) {
            this.log(`-已完成: 每日签到${suffix}`);
        } else if (status === 0) {
            this.log(`-去完成: 每日签到${suffix}`);
            await this.userSignRedPacket();
        } else {
            this.log(`-暂不可做: 每日签到 (${YP.redPacketStatusText(status)})`);
        }
    }

    redPacketTaskGroups() {
        return [
            ['configTaskNoviceList', '\n🧧 红包派对新手任务'],
            ['configTaskDailyList', '\n🧧 红包派对每日任务'],
            ['configTaskMonthlyList', '\n🧧 红包派对每月任务'],
        ];
    }

    async redEnvelopeParty() {
        this.log('\n🧧 红包派对任务');
        if (!await this.loginRedPacket()) return;
        const data = await this.getRedPacketTaskList();
        if (!data) {
            this.log('获取红包派对任务失败: 接口无响应');
            return;
        }
        const header = data.header || {};
        if (String(header.status) !== '200') {
            this.log(`获取红包派对任务失败: ${header.errMsg || header.respMsg || '未知错误'}`);
            return;
        }
        const taskList = data.data || {};
        await this.logRedPacketBalance();
        await this.handleRedPacketSign(taskList);
        for (const [group, title] of this.redPacketTaskGroups()) {
            const tasks = toArray(taskList[group]);
            if (!tasks.length) continue;
            this.log(title);
            for (const task of tasks) {
                await this.handleRedPacketTask(task);
            }
        }
        await this.logRedPacketBalance();
    }


    // ---------- 云盘文件 / 分享 / AI 相机 ----------
    buildCloudFileHeaders() {
        return {
            'x-yun-op-type': '1',
            'x-yun-sub-op-type': '100',
            'x-yun-api-version': 'v1',
            'x-yun-client-info': '6|127.0.0.1|1|12.1.0|realme|RMX5060|BCFF2BBA6881DD8E4971803C63DDB5E4|02-00-00-00-00-00|android 15|1264X2592|zh||||032|0|',
            'x-yun-app-channel': '10000023',
            'Authorization': this.Authorization,
            'Content-Type': 'application/json; charset=UTF-8',
            'User-Agent': 'okhttp/4.12.0',
            'Host': 'personal-kd-njs.yun.139.com',
            'Connection': 'Keep-Alive',
        };
    }

    buildShareHeaders() {
        return {
            'Authorization': this.Authorization,
            'x-yun-api-version': 'v1',
            'x-yun-app-channel': '10000023',
            'x-yun-client-info': `||9|${CLIENT_VERSION}|Chrome|143.0.7499.146|codextestshare||Windows 10||zh-CN|||Q2hyb21l||`,
            'x-yun-module-type': '100',
            'x-yun-svc-type': '1',
            'x-SvcType': '1',
            'x-yun-channel-source': '10000023',
            'x-huawei-channelSrc': '10000023',
            'Content-Type': 'application/json;charset=UTF-8',
            'CMS-DEVICE': 'default',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
            'Referer': 'https://yun.139.com/shareweb/',
            'Origin': 'https://yun.139.com',
        };
    }

    async createCloudFile(prefix, extension = 'txt') {
        const fileSize = 1;   // py cloud_file_dummy_content = b'0'
        const fileName = `${prefix}${bjStamp()}.${String(extension).replace(/^\.+/, '')}`;
        const payload = {
            'contentHash': CLOUD_FILE_DUMMY_HASH,
            'contentHashAlgorithm': 'SHA256',
            'contentType': 'application/oct-stream',
            'fileRenameMode': 'force_rename',
            'localCreatedAt': bjIsoMs(),
            'name': fileName,
            'parallelUpload': true,
            'parentFileId': '/',
            'partInfos': [{
                'end': fileSize,
                'partNumber': 1,
                'partSize': fileSize,
                'start': 0
            }],
            'size': fileSize,
            'type': 'file'
        };
        const response = await this.sendRequest({
            url: 'https://personal-kd-njs.yun.139.com/hcy/file/create',
            headers: this.buildCloudFileHeaders(),
            data: payload,
            method: 'POST',
        });
        if (!response || response.status !== 200) return null;
        const resJson = $.toObj(response.text);
        if (!resJson || !resJson.success) return null;
        const data = resJson.data || {};
        return { fileId: data.fileId, fileName: data.fileName || fileName };
    }

    async listCloudRootFiles() {
        const items = [];
        let pageCursor = '';
        while (true) {
            const response = await this.requestJson({
                url: 'https://personal-kd-njs.yun.139.com/hcy/file/list',
                headers: this.buildCloudFileHeaders(),
                data: {
                    'imageThumbnailStyleList': ['Small', 'Large'],
                    'orderBy': 'updated_at',
                    'orderDirection': 'DESC',
                    'pageInfo': { 'pageCursor': pageCursor, 'pageSize': 100 },
                    'parentFileId': '/',
                },
                method: 'POST',
            });
            if (!response) return items;
            if (!response.success) {
                this.log(`获取云盘文件列表失败: ${response.message || '未知错误'}`);
                return items;
            }
            const data = response.data || {};
            items.push(...toArray(data.items));
            pageCursor = data.nextPageCursor || '';
            if (!pageCursor) return items;
        }
    }

    static isCleanupUploadFile(item) {
        if (item.type !== 'file' || item.parentFileId !== '/') return false;
        const name = item.name || '';
        const txtMatch = name.endsWith('.txt') && (name.startsWith('auto_upload_') || name.startsWith('auto_share_'));
        const jpgMatch = name.endsWith('.jpg') && name.startsWith('auto_tokenpk_photo_');
        if (!txtMatch && !jpgMatch) return false;
        const size = item.size;
        return size === 0 || size === 1 || size === undefined || size === null || item.contentHash === CLOUD_FILE_DUMMY_HASH;
    }

    async trashCloudFiles(fileIds) {
        if (!fileIds || !fileIds.length) return true;
        const response = await this.requestJson({
            url: 'https://personal-kd-njs.yun.139.com/hcy/recyclebin/batchTrash',
            headers: this.buildCloudFileHeaders(),
            data: { fileIds },
            method: 'POST',
        });
        if (!response) {
            this.log('清理上传文件失败: 接口无响应');
            return false;
        }
        if (response.success) return true;
        this.log(`清理上传文件失败: ${response.message || '未知错误'}`);
        return false;
    }

    async cleanupUploadedFiles(currentFile) {
        const fileIds = [];
        if (currentFile && currentFile.fileId) fileIds.push(currentFile.fileId);
        for (const item of await this.listCloudRootFiles()) {
            if (YP.isCleanupUploadFile(item)) fileIds.push(item.fileId);
        }
        const uniqueFileIds = fileIds.filter((fileId, index) => fileId && fileIds.indexOf(fileId) === index);
        if (!uniqueFileIds.length) return true;
        if (await this.trashCloudFiles(uniqueFileIds)) {
            this.log(`-已清理上传文件: ${uniqueFileIds.length}个`);
            return true;
        }
        return false;
    }

    async shareCloudFile() {
        const shareFile = await this.createCloudFile('auto_share_');
        if (!shareFile) {
            this.log('分享文件失败: 创建临时文件失败');
            return null;
        }
        let response = null;
        try {
            response = await this.requestJson({
                url: 'https://yun.139.com/orchestration/personalCloud-rebuild/outlink/v1.0/getOutLink',
                headers: this.buildShareHeaders(),
                data: {
                    'getOutLinkReq': {
                        'subLinkType': 0,
                        'encrypt': 1,
                        'coIDLst': [shareFile.fileId],
                        'caIDLst': [],
                        'pubType': 1,
                        'dedicatedName': shareFile.fileName || '',
                        'period': 1,
                        'periodUnit': 1,
                        'viewerLst': [],
                        'extInfo': { 'isWatermark': 0, 'shareChannel': '3001' },
                        'commonAccountInfo': { 'account': this.account, 'accountType': 1 },
                    }
                },
                method: 'POST',
                retries: 1,
            });
        } finally {
            await this.trashCloudFiles([shareFile.fileId]);
        }
        const data = (response || {}).data || {};
        const result = data.result || data.getOutLinkRes || {};
        const outlinks = toArray(result.getOutLinkResSet);
        let success = false;
        if (response) {
            success = (response.success && result.resultCode === '0') || (String(response.code) === '0' && !!outlinks.length);
        }
        if (!success) {
            const msg = response ? (result.resultDesc || response.message || response.msg || '未知错误') : '接口无响应';
            this.log(`分享文件失败: ${msg}`);
            return null;
        }
        return true;
    }

    async completeShareFileTask(task) {
        if (!await this.shareCloudFile()) return null;
        return (await this.queryCloudTask((task || {}).id || 434, 'month')) || task;
    }

    buildAiHeaders(useClientInfo = false) {
        const deviceId = this.marketDeviceId || generateDeviceId();
        const headers = {
            'Connection': 'keep-alive',
            'sec-ch-ua-platform': '"iOS"',
            'Authorization': this.Authorization,
            'x-yun-api-version': 'v1',
            'x-yun-tid': uuid4(),
            'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="130", "Mobile Safari";v="130"',
            'sec-ch-ua-mobile': '?1',
            'X-Requested-With': 'com.chinamobile.mcloud',
            'Origin': 'https://frontend.mcloud.139.com',
            'Referer': 'https://frontend.mcloud.139.com/',
            'User-Agent': MARKET_UA,
            'Content-Type': 'application/json',
            'Sec-Fetch-Site': 'same-site',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Dest': 'empty',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Accept-Language': 'zh,zh-CN;q=0.9,en-US;q=0.8,en;q=0.7',
        };
        if (useClientInfo) {
            headers['Accept'] = 'text/event-stream';
            headers['x-yun-client-info'] = `4||1|${CLIENT_VERSION}|Apple|iPhone 16 Pro|${deviceId.replace(/^B/, '')}|iOS 18.7|||||`;
            headers['x-yun-app-channel'] = '101';
            return headers;
        }
        headers['Accept'] = '*/*';
        headers['x-DeviceInfo'] = `||36|${CLIENT_VERSION}|Apple|iPhone 16 Pro|${deviceId.replace(/^B/, '')}|iOS 18.7|||||`;
        return headers;
    }

    getAiCameraSampleBase64() {
        if (!AI_CAMERA_SAMPLE_BASE64) return '';
        return `data:image/png;base64,${AI_CAMERA_SAMPLE_BASE64}`;
    }

    static isAiChatSuccess(text) {
        const payloads = [];
        for (const line of String(text || '').split('\n')) {
            if (line.startsWith('data:')) payloads.push(line.slice(5).trim());
        }
        if (!payloads.length && text) payloads.push(String(text).trim());
        for (const payload of payloads) {
            if (!payload || payload === '[DONE]') continue;
            const data = $.toObj(payload);
            if (data === null) continue;
            if (data.success || data.code === '0000') return true;
        }
        return false;
    }

    async completeAiCameraTask() {
        if (!this.userDomainId) {
            this.log('AI相机任务失败: 缺少用户信息');
            return false;
        }
        const imageData = this.getAiCameraSampleBase64();
        if (!imageData) {
            this.log('AI相机任务失败: 缺少样图');
            return false;
        }
        const recognizePayload = JSON.stringify({
            'channelId': '101',
            'userId': this.userDomainId,
            'recognizeType': '1',
            'base64': imageData,
            'sendType': '2',
            'imageExt': 'png',
            'uploadToCloud': true,
            'timeout': 30000,
        });
        const recognizeData = await this.requestJson({
            url: 'https://ai.yun.139.com/api/image/aiRecognize',
            headers: this.buildAiHeaders(),
            data: recognizePayload,
            method: 'POST',
        });
        if (!recognizeData) {
            this.log('AI相机识图失败: 接口无响应');
            return false;
        }
        if (!recognizeData.success) {
            this.log(`AI相机识图失败: ${recognizeData.message || '未知错误'}`);
            return false;
        }
        const recognizeResult = recognizeData.data || {};
        const fileId = recognizeResult.fileId;
        if (!fileId) {
            this.log('AI相机识图失败: 缺少文件ID');
            return false;
        }
        const taskId = String(recognizeResult.taskId || Date.now());
        const fileName = /^\d+$/.test(taskId) ? `${parseInt(taskId, 10) + 1}.png` : `${taskId}.png`;
        const chatPayload = JSON.stringify({
            'userId': this.userDomainId,
            'sessionId': '',
            'applicationType': 'chat',
            'applicationId': '',
            'sourceChannel': '101',
            'dialogueInput': {
                'dialogue': '？',
                'prompt': '',
                'inputTime': bjIsoMs(),
                'enableForceLlm': false,
                'enableForceNetworkSearch': true,
                'enableModelThinking': false,
                'enableAllNetworkSearch': false,
                'enableKnowledgeAndNetworkSearch': false,
                'enableRegenerate': false,
                'versionInfo': { 'h5Version': '2.7.6' },
                'extInfo': '{}',
                'sortInfo': {},
                'toolSetting': { 'imageToolSetting': { 'enableLlmDescribe': true } },
                'attachment': {
                    'attachmentTypeList': [3],
                    'fileList': [{ 'fileId': fileId, 'name': fileName }],
                },
            },
        });
        const chatResponse = await this.sendRequest({
            url: 'https://ai.yun.139.com/api/outer/assistant/chat/v2/add',
            headers: this.buildAiHeaders(true),
            data: chatPayload,
            method: 'POST',
        });
        if (!chatResponse) {
            this.log('AI相机对话失败: 接口无响应');
            return false;
        }
        if (YP.isAiChatSuccess(chatResponse.text)) return true;
        const chatData = $.toObj(chatResponse.text);
        if (chatData && (chatData.success || chatData.code === '0000')) return true;
        if (chatData) {
            this.log(`AI相机对话失败: ${chatData.message || chatData.msg || '未知错误'}`);
            return false;
        }
        this.log('AI相机对话失败: 响应解析失败');
        return false;
    }

    // ---------- 云朵中心新版任务 ----------
    static getTaskProgress(task) {
        const progressParts = [];
        const currstep = (task || {}).currstep || 0;
        const process = (task || {}).process || 0;
        if (currstep) progressParts.push(`阶段${currstep}`);
        if (process) progressParts.push(`进度${process}`);
        if (!progressParts.length) return '';
        return ` (${progressParts.join('，')})`;
    }

    static getTaskStepTypes(task) {
        return toArray((task || {}).stepTypeSet);
    }

    getTaskClickKeys(task) {
        const taskId = task.id;
        const currstep = task.currstep || 0;
        const stepTypes = YP.getTaskStepTypes(task);
        if (taskId === 409) {
            if (currstep > 0) return ['task2'];
            return ['task', 'task2'];
        }
        if (stepTypes.includes('click') && currstep === 0) return ['task'];
        return [];
    }

    getCloudTaskGroups() {
        return [
            ['cloudEmail', '\n📮 联动任务'],
            ['time', '\n✨ 新版热门任务'],
            ['day', '\n📆 云盘每日任务'],
            ['month', '\n📆 云盘每月任务'],
        ];
    }

    async queryCloudTask(taskId, group = 'time') {
        const returnData = await this.requestMarketJson(`${MARKET_BASE_URL}/market/signin/task/taskListV2`, {
            data: { 'marketname': 'sign_in_3', 'clientVersion': CLIENT_VERSION, 'group': group },
            method: 'POST',
        });
        if (!returnData || returnData.code !== 0) return null;
        for (const task of toArray((returnData.result || {})[group])) {
            if (task.id === taskId) return task;
        }
        return null;
    }

    async completeMonthlyUploadTask(task) {
        const targetCount = 100;
        let currentProcess = parseInt(task.process || 0, 10);
        for (let attempt = 0; attempt < 3; attempt++) {
            const remaining = Math.max(0, targetCount - currentProcess);
            if (remaining === 0) return true;
            this.log(`-${attempt === 0 ? '开始' : '继续'}补上传进度: 当前${currentProcess}/${targetCount}，还需${remaining}次`);
            let success = 0;
            for (let i = 0; i < remaining; i++) {
                if (await this.createCloudFile('auto_upload_')) success += 1;
            }
            if (success) this.log(`-批量上传完成: ${success}次`);
            const refreshedTask = await this.queryCloudTask(task.id || 522, 'time');
            if (!refreshedTask) return false;
            const refreshedProcess = parseInt(refreshedTask.process || 0, 10);
            if (refreshedTask.state === 'FINISH' || refreshedProcess >= targetCount) return true;
            if (refreshedProcess <= currentProcess) {
                this.log(`-月上传任务进度: ${refreshedProcess}/${targetCount}`);
                return false;
            }
            currentProcess = refreshedProcess;
        }
        this.log(`-月上传任务进度: ${currentProcess}/${targetCount}`);
        return false;
    }

    async getCloudTasklistV2() {
        for (const [group, title] of this.getCloudTaskGroups()) {
            const returnData = await this.requestMarketJson(`${MARKET_BASE_URL}/market/signin/task/taskListV2`, {
                data: { 'marketname': 'sign_in_3', 'clientVersion': CLIENT_VERSION, 'group': group },
                method: 'POST',
            });
            if (!returnData) {
                this.log(`获取任务列表失败: ${group}`);
                continue;
            }
            if (returnData.code !== 0) {
                this.log(`获取任务列表失败: ${group} ${returnData.msg || '未知错误'}`);
                continue;
            }
            const tasks = toArray((returnData.result || {})[group]);
            if (!tasks.length) continue;
            this.log(title);
            for (const task of tasks) {
                await this.handleCloudV2Task(group, task);
            }
        }
        await this.cleanupUploadedFiles();
    }

    async handleCloudV2Task(group, task) {
        const taskId = task.id;
        const taskName = stripTags(task.name || '');
        const taskStatus = task.state || '';
        if (taskStatus === 'FINISH') {
            this.log(`-已完成: ${taskName}`);
            return;
        }
        if (group === 'day' && taskId === 106) {
            this.log(`-去完成: ${taskName}`);
            await this.doTask(taskId, 'day', 'cloud_app');
            return;
        }
        if (taskId === 522) {
            this.log(`-去完成: ${taskName}`);
            if (await this.completeMonthlyUploadTask(task)) {
                this.log(`-已完成: ${taskName}`);
                return;
            }
            const refreshedTask = (await this.queryCloudTask(taskId, group)) || task;
            this.log(`-需手动完成: ${taskName}${YP.getTaskProgress(refreshedTask)}`);
            return;
        }
        if (taskId === 434) {
            this.log(`-去完成: ${taskName}`);
            const refreshedTask = await this.completeShareFileTask(task);
            if (refreshedTask) {
                const refreshedName = stripTags(refreshedTask.name || '');
                if (refreshedTask.state === 'FINISH') {
                    this.log(`-已完成: ${refreshedName}`);
                    return;
                }
                this.log(`-分享成功: ${refreshedName}${YP.getTaskProgress(refreshedTask)}`);
                return;
            }
            this.log(`-需手动完成: ${taskName}${YP.getTaskProgress(task)}`);
            return;
        }
        if (taskId === 585) {
            this.log(`-去完成: ${taskName}`);
            if (YP.getTaskStepTypes(task).includes('click') && parseInt(task.currstep || 0, 10) === 0) {
                const clickData = await this.clickTask(taskId);
                if (!clickData || clickData.code !== 0) {
                    this.log(`-任务登记失败: ${taskName} ${clickData ? (clickData.msg || '未知错误') : '接口无响应'}`);
                    return;
                }
            }
            if (await this.completeAiCameraTask()) {
                const refreshedTask = (await this.queryCloudTask(taskId, group)) || task;
                const refreshedName = stripTags(refreshedTask.name || '');
                if (refreshedTask.state === 'FINISH') this.log(`-已完成: ${refreshedName}`);
                else this.log(`-AI相机已体验: ${refreshedName}${YP.getTaskProgress(refreshedTask)}`);
                return;
            }
            const refreshedTask2 = (await this.queryCloudTask(taskId, group)) || task;
            this.log(`-需手动完成: ${taskName}${YP.getTaskProgress(refreshedTask2)}`);
            return;
        }
        if (taskId === 406) {
            await this.completeNoticeTask(taskName);
            return;
        }
        const taskKeys = this.getTaskClickKeys(task);
        if (taskKeys.length) {
            this.log(`-去完成: ${taskName}`);
            for (const taskKey of taskKeys) {
                const clickData = await this.clickTask(taskId, taskKey);
                if (clickData && clickData.code === 0) continue;
                this.log(`-任务登记失败: ${taskName} ${clickData ? (clickData.msg || '未知错误') : '接口无响应'}`);
                return;
            }
            this.log(`-已登记任务: ${taskName}`);
            return;
        }
        this.log(`-需手动完成: ${taskName}${YP.getTaskProgress(task)}`);
    }


    // ---------- 通知任务 ----------
    async getNoticeStatus() {
        const sendData = (await this.requestJson({
            url: 'https://caiyun.feixin.10086.cn/market/msgPushOn/task/status',
            headers: this.jwtHeaders,
        })) || {};
        if (sendData.code !== 0) return {};
        return sendData.result || {};
    }

    async completeNoticeTask(taskName) {
        const noticeStatus = await this.getNoticeStatus();
        if (!noticeStatus || !Object.keys(noticeStatus).length) {
            this.log(`-需手动完成: ${taskName}`);
            return;
        }
        const pushOn = parseInt(noticeStatus.pushOn || 0, 10);
        const firstStatus = parseInt(noticeStatus.firstTaskStatus || 0, 10);
        const secondStatus = parseInt(noticeStatus.secondTaskStatus || 0, 10);
        const onDuration = parseInt(noticeStatus.onDuaration || 0, 10);
        const total = parseInt(noticeStatus.total || 31, 10);
        if (pushOn !== 1) {
            this.log(`-需手动完成: ${taskName} (通知未开启)`);
            return;
        }
        const rewardUrl = 'https://caiyun.feixin.10086.cn/market/msgPushOn/task/obtain';
        if (firstStatus !== 3) {
            const reward1Data = await this.requestJson({ url: rewardUrl, headers: this.jwtHeaders, data: { 'type': 1 }, method: 'POST' });
            if (reward1Data && reward1Data.code === 0) this.log(`-已领取: ${taskName} (首日奖励)`);
            else this.log(`-待领取: ${taskName} (首日奖励)`);
        }
        if (secondStatus === 2) {
            const reward2Data = await this.requestJson({ url: rewardUrl, headers: this.jwtHeaders, data: { 'type': 2 }, method: 'POST' });
            if (reward2Data && reward2Data.code === 0) this.log(`-已领取: ${taskName} (连续奖励，已开启${onDuration}/${total}天)`);
            else this.log(`-待领取: ${taskName} (已开启${onDuration}/${total}天)`);
        } else if (secondStatus === 3) {
            this.log(`-已完成: ${taskName}`);
        } else {
            this.log(`-进行中: ${taskName} (已开启${onDuration}/${total}天)`);
        }
    }

    // ---------- 登录链路 ----------
    async querySpecToken(sourceId) {
        const ssoData = await this.requestJson({
            url: 'https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken',
            headers: {
                'Authorization': this.Authorization,
                'User-Agent': UA,
                'Content-Type': 'application/json',
                'Accept': '*/*',
                'Host': 'orches.yun.139.com',
            },
            data: { 'account': this.account, 'toSourceId': sourceId },
            method: 'POST',
        });
        if (!ssoData) {
            this.log('刷新Token失败: 接口无响应');
            return null;
        }
        if (ssoData.success) return (ssoData.data || {}).token || null;
        this.log(`刷新Token失败: ${ssoData.message || '未知错误'}`);
        return null;
    }

    async sso() {
        const refreshToken = await this.querySpecToken('001005');
        if (refreshToken) {
            this.ssoToken = refreshToken;
            return refreshToken;
        }
        return null;
    }

    async jwt() {
        let token = await this.sso();
        if (token === null) {
            this.log('-尝试强制刷新Authorization后重试');
            await this.refreshAuthorizationToken(true);
            token = await this.sso();
        }
        if (token === null || token === undefined) {
            this.log('-ck可能失效了');
            return false;
        }

        const fetchJwt = (ssoToken) => this.requestJson({
            url: `https://caiyun.feixin.10086.cn:7071/portal/auth/tyrzLogin.action?ssoToken=${ssoToken}`,
            headers: this.jwtHeaders,
            method: 'POST',
        });

        let jwtData = await fetchJwt(token);
        if (!jwtData) {
            this.log('JWT获取失败: 接口无响应');
            return false;
        }
        if (jwtData.code !== 0) {
            this.log('-尝试强制刷新Authorization后重新获取JWT');
            await this.refreshAuthorizationToken(true);
            token = await this.sso();
            if (token === null || token === undefined) {
                this.log('-ck可能失效了');
                return false;
            }
            jwtData = await fetchJwt(token);
            if (!jwtData) {
                this.log('JWT获取失败: 接口无响应');
                return false;
            }
        }
        if (jwtData.code !== 0) {
            this.log(`JWT获取失败: ${jwtData.msg}`);
            return false;
        }
        const jwtToken = jwtData.result.token;
        this.jwtHeaders['jwtToken'] = jwtToken;
        this.cookies['jwtToken'] = jwtToken;
        this.buildMarketContext(jwtToken);
        this.saveAuthorizationRecord({ token: this.Authorization, userDomainId: this.userDomainId });
        return true;
    }

    // ---------- 签到 / 戳一戳 ----------
    async signinStatus() {
        await this.sleep();
        await this.prepareSigninCenterSession();
        const checkUrl = `${MARKET_BASE_URL}/market/signin/page/infoV3`;
        const checkData = await this.requestMarketJson(checkUrl, { params: { client: 'app' } });
        if (!checkData) {
            this.log('查询签到失败: 接口无响应');
            return;
        }
        if (checkData.code !== 0) {
            this.log(`查询签到失败: ${checkData.msg || '未知错误'}`);
            return;
        }
        if (YP.getTodaySignState(checkData.result || {})) {
            this.log('✅已签到');
            return;
        }
        const signinData = await this.requestMarketJson(`${MARKET_BASE_URL}/market/signin/page/startSignIn`, { params: { client: 'app' } });
        if (!signinData) {
            this.log('签到失败: 接口无响应');
            return;
        }
        if (signinData.code === 0 && YP.getTodaySignState(signinData.result || {})) {
            this.log('✅签到成功');
            return;
        }
        const latestData = await this.requestMarketJson(checkUrl, { params: { client: 'app' } });
        if (latestData && latestData.code === 0 && YP.getTodaySignState(latestData.result || {})) {
            this.log('✅签到成功');
            return;
        }
        this.log(`签到失败: ${signinData.msg || '未知错误'}`);
        if ([614, 615].includes(signinData.code) && !getEnvDeviceId() && !getDeviceId(this.account)) {
            this.log('-当前账号尚未填写 deviceId，请在 ydyp_data 账号项或 ydyp_device_id 变量中抓包补充');
        }
    }

    async getClickTaskStatus() {
        for (const [group] of this.getCloudTaskGroups()) {
            const task = await this.queryCloudTask(319, group);
            if (task) return task;
        }
        const returnData = await this.requestJson({
            url: 'https://caiyun.feixin.10086.cn/market/signin/task/taskList?marketname=sign_in_3',
            headers: this.jwtHeaders, cookies: this.cookies,
        });
        const taskList = (returnData && returnData.result) || {};
        for (const type of Object.keys(taskList)) {
            const task = toArray(taskList[type]).find(t => t && t.id === 319);
            if (task) return task;
        }
        return null;
    }

    async click() {
        let successfulClick = 0;
        let consecutiveFailCode = null;
        let consecutiveFailCount = 0;
        let noResultStreak = 0;
        let lastMsg = '';
        try {
            const before = await this.getClickTaskStatus();
            if (before && before.state === 'FINISH') {
                this.log('✅戳一戳: 今日已完成');
                return;
            }
            for (let i = 0; i < this.clickNum; i++) {
                const returnData = (await this.clickTask(319)) || {};
                await $.wait(200);
                if (returnData.result) {
                    this.log(`✅戳一戳: ${returnData.result}`);
                    successfulClick += 1;
                    consecutiveFailCode = null;
                    consecutiveFailCount = 0;
                    noResultStreak = 0;
                    continue;
                }
                const code = returnData.code === undefined ? '无响应' : String(returnData.code);
                lastMsg = returnData.msg || '未知错误';
                if (code === '0') {
                    // code=0 但无 result：服务端受理不再发奖，查任务状态确认是否已戳完
                    noResultStreak += 1;
                    if (noResultStreak >= 2) {
                        const cur = await this.getClickTaskStatus();
                        if (cur && cur.state === 'FINISH') {
                            this.log('✅戳一戳: 今日已完成');
                            break;
                        }
                        if (noResultStreak >= 3) break;
                    }
                    continue;
                }
                if (code === consecutiveFailCode) consecutiveFailCount += 1;
                else { consecutiveFailCode = code; consecutiveFailCount = 1; }
                if (consecutiveFailCount >= 3) break;
            }
            if (successfulClick === 0) $.log(`❌戳一戳: 未获得 x ${this.clickNum}${lastMsg && lastMsg !== 'success' ? ` (${lastMsg})` : ''}`);
        } catch (e) {
            $.log(`错误信息:${e.message || e}`);
        }
    }

    // ---------- 云笔记 ----------
    async refreshNotetoken() {
        const noteUrl = 'http://mnote.caiyun.feixin.10086.cn/noteServer/api/authTokenRefresh.do';
        const notePayload = { 'authToken': this.authToken, 'userPhone': this.account };
        const noteHeaders = {
            'X-Tingyun-Id': 'p35OnrDoP8k;c=2;r=1122634489;u=43ee994e8c3a6057970124db00b2442c::8B3D3F05462B6E4C',
            'Charset': 'UTF-8',
            'Connection': 'Keep-Alive',
            'User-Agent': 'mobile',
            'APP_CP': 'ios',
            'CP_VERSION': '3.2.0',
            'x-huawei-channelsrc': '10001400',
            'Host': 'mnote.caiyun.feixin.10086.cn',
            'Content-Type': 'application/json; charset=UTF-8',
            'Accept-Encoding': 'gzip',
        };
        const response = await this.sendRequest({ url: noteUrl, headers: noteHeaders, data: notePayload, method: 'POST' });
        if (!response) return;
        this.noteToken = response.headers['note_token'] || '';
        this.noteAuth = response.headers['app_auth'] || '';
    }

    async completeNoteTask() {
        await this.refreshNotetoken();
        if (!this.noteToken || !this.noteAuth) {
            this.log('-创建云笔记失败: 获取笔记凭证失败');
            return false;
        }
        const headers = {
            'X-Tingyun-Id': 'p35OnrDoP8k;c=2;r=1122634489;u=43ee994e8c3a6057970124db00b2442c::8B3D3F05462B6E4C',
            'Charset': 'UTF-8',
            'Connection': 'Keep-Alive',
            'User-Agent': 'mobile',
            'APP_CP': 'ios',
            'CP_VERSION': '3.2.0',
            'x-huawei-channelsrc': '10001400',
            'APP_NUMBER': this.account,
            'APP_AUTH': this.noteAuth,
            'NOTE_TOKEN': this.noteToken,
            'Host': 'mnote.caiyun.feixin.10086.cn',
            'Content-Type': 'application/json; charset=UTF-8',
            'Accept': '*/*',
        };
        const response = await this.sendRequest({
            url: 'http://mnote.caiyun.feixin.10086.cn/noteServer/api/syncNotebookV3.do',
            headers,
            data: { 'addNotebooks': [], 'delNotebooks': [], 'notebookRefs': [], 'updateNotebooks': [] },
            method: 'POST',
        });
        if (!response) {
            this.log('-创建云笔记失败: 获取默认笔记本失败');
            return false;
        }
        const resJson = $.toObj(response.text);
        const notebooks = toArray(resJson && resJson.notebooks);
        if (!notebooks.length || !notebooks[0].notebookId) {
            this.log('-创建云笔记失败: 缺少默认笔记本');
            return false;
        }
        this.notebookId = notebooks[0].notebookId;
        return await this.createNote(headers);
    }

    async createNote(headers) {
        const noteId = this.getNoteId(32);
        const createtime = String(Date.now());
        await $.wait(3000);
        const updatetime = String(Date.now());
        const payload = {
            'archived': 0,
            'attachmentdir': noteId,
            'attachmentdirid': '',
            'attachments': [],
            'audioInfo': { 'audioDuration': 0, 'audioSize': 0, 'audioStatus': 0 },
            'contentid': '',
            'contents': [{
                'contentid': 0,
                'data': '<font size="3">000000</font>',
                'noteId': noteId,
                'sortOrder': 0,
                'type': 'RICHTEXT'
            }],
            'cp': '',
            'createtime': createtime,
            'description': 'ios',
            'expands': { 'noteType': 0 },
            'latlng': '',
            'location': '',
            'noteid': noteId,
            'notestatus': 0,
            'remindtime': '',
            'remindtype': 1,
            'revision': '1',
            'sharecount': '0',
            'sharestatus': '0',
            'system': 'mobile',
            'tags': [{
                'id': this.notebookId,
                'orderIndex': '0',
                'text': '默认笔记本'
            }],
            'title': '00000',
            'topmost': '0',
            'updatetime': updatetime,
            'userphone': this.account,
            'version': '1.00',
            'visitTime': ''
        };
        const createNoteData = await this.sendRequest({
            url: 'http://mnote.caiyun.feixin.10086.cn/noteServer/api/createNote.do',
            headers,
            data: payload,
            method: 'POST',
        });
        if (createNoteData && createNoteData.status === 200) {
            this.log('-创建笔记成功');
            return true;
        }
        this.log('-创建失败');
        return false;
    }

    getNoteId(length) {
        const characters = '19f3a063d67e4694ca63a4227ec9a94a19088404f9a28084e3e486b928039a299bf756ebc77aa4f6bfa250308ec6a8be8b63b5271a00350d136d117b8a72f39c5bd15cdfd350cba4271dc797f15412d9f269e666aea5039f5049d00739b320bb9e8585a008b52c1cbd86970cae9476446f3e41871de8d9f6112db94b05e5dc7ea0a942a9daf145ac8e487d3d5cba7cea145680efc64794d43dd15c5062b81e1cda7bf278b9bc4e1b8955846e6bc4b6a61c28f831f81b2270289e5a8a677c3141ddc9868129060c0c3b5ef507fbd46c004f6de346332ef7f05c0094215eae1217ee7c13c8dca6d174cfb49c716dd42903bb4b02d823b5f1ff93c3f88768251b56cc';
        let noteId = '';
        for (let i = 0; i < length; i++) noteId += characters.charAt(Math.floor(Math.random() * characters.length));
        return noteId;
    }

    // ---------- 任务列表 / 领取 ----------
    async getTasklist(url, appType) {
        if (url === 'sign_in_3' && appType === 'cloud_app') {
            await this.getCloudTasklistV2();
            return;
        }
        const returnData = await this.requestJson({
            url: `https://caiyun.feixin.10086.cn/market/signin/task/taskList?marketname=${url}`,
            headers: this.jwtHeaders,
            cookies: this.cookies,
        });
        await this.sleep();
        const taskList = (returnData || {}).result || {};

        try {
            for (const taskType of Object.keys(taskList)) {
                const tasks = taskList[taskType];
                if (['new', 'hidden', 'hiddenabc'].includes(taskType)) continue;
                if (appType === 'cloud_app') {
                    if (taskType === 'month') {
                        this.log('\n📆 云盘每月任务');
                        for (const month of tasks) {
                            const taskId = month.id;
                            if ([110, 113, 417, 409].includes(taskId)) continue;
                            const taskName = stripTags(month.name || '');
                            if ((month.state || '') === 'FINISH') {
                                this.log(`-已完成: ${taskName}`);
                                continue;
                            }
                            this.log(`-去完成: ${taskName}`);
                            await this.doTask(taskId, 'month', 'cloud_app');
                            await $.wait(2000);
                        }
                    } else if (taskType === 'day') {
                        this.log('\n📆 云盘每日任务');
                        for (const day of tasks) {
                            const taskId = day.id;
                            if (taskId === 404) continue;
                            const taskName = stripTags(day.name || '');
                            if ((day.state || '') === 'FINISH') {
                                this.log(`-已完成: ${taskName}`);
                                continue;
                            }
                            this.log(`-去完成: ${taskName}`);
                            await this.doTask(taskId, 'day', 'cloud_app');
                        }
                    }
                } else if (appType === 'email_app') {
                    if (taskType === 'month') {
                        this.log('\n📆 139邮箱每月任务');
                        for (const month of tasks) {
                            const taskId = month.id;
                            const taskName = stripTags(month.name || '');
                            if ([1004, 1005, 1015, 1020].includes(taskId)) continue;
                            if ((month.state || '') === 'FINISH') {
                                this.log(`-已完成: ${taskName}`);
                                continue;
                            }
                            this.log(`-去完成: ${taskName}`);
                            await this.doTask(taskId, 'month', 'email_app');
                            await $.wait(2000);
                        }
                    }
                }
            }
        } catch (e) {
            this.log(`获取任务列表错误:${e.message || e}`);
        }
    }

    async doTask(taskId, taskType, appType) {
        await this.sleep();
        if (appType === 'cloud_app') {
            await this.clickTask(taskId);
        } else {
            await this.sendRequest({
                url: `https://caiyun.feixin.10086.cn/market/signin/task/click?key=task&id=${taskId}`,
                headers: this.jwtHeaders,
                cookies: this.cookies,
            });
        }

        if (appType === 'cloud_app' && taskType === 'day') {
            if (taskId === 106) {
                this.log('-开始上传文件，默认0kb');
                await this.updataFile();
            } else if (taskId === 107) {
                await this.completeNoteTask();
            }
        }
    }

    async updataFile() {
        const uploadInfo = await this.createCloudFile('auto_upload_');
        if (!uploadInfo) {
            this.log('-上传失败: 接口无响应');
            return;
        }
        this.log(`-上传文件成功，文件名: ${uploadInfo.fileName || ''}`);
        await this.cleanupUploadedFiles(uploadInfo);
    }

    async receive() {
        const prizeUrl = `https://caiyun.feixin.10086.cn/market/prizeApi/checkPrize/getUserPrizeLogPage?currPage=1&pageSize=15&_=${this.cookies['sensors_stay_time']}`;
        await this.prepareSigninCenterSession(true);
        const infoData = await this.requestMarketJson(`${MARKET_BASE_URL}/market/signin/page/infoV3`, { params: { client: 'app' } });
        if (!infoData) {
            this.log('查询云朵失败: 接口无响应');
            return;
        }
        if (infoData.code !== 0) {
            this.log(`查询云朵失败: ${infoData.msg || '未知错误'}`);
            return;
        }
        const infoResult = infoData.result || {};
        const pendingAmount = infoResult.toReceive || 0;
        let totalAmount = infoResult.total === undefined ? '' : infoResult.total;
        if (pendingAmount) {
            const receiveData = await this.requestJson({
                url: `${MARKET_BASE_URL}/market/signin/page/receiveV2`,
                params: { client: 'app' },
                headers: this.buildReceiveHeaders(),
                cookies: this.marketCookies,
            });
            if (!receiveData) {
                this.log('领取云朵失败: 接口无响应');
                this.log(`-当前待领取:${pendingAmount}云朵`);
            } else if (receiveData.code === 0) {
                const receiveResult = receiveData.result || {};
                this.log(`-领取云朵:${receiveResult.receive === undefined ? pendingAmount : receiveResult.receive}云朵`);
                if (receiveResult.total !== undefined) totalAmount = receiveResult.total;
            } else {
                const latestInfoData = await this.requestMarketJson(`${MARKET_BASE_URL}/market/signin/page/infoV3`, { params: { client: 'app' } });
                const latestResult = (latestInfoData && latestInfoData.code === 0) ? (latestInfoData.result || {}) : {};
                const latestPending = latestResult.toReceive === undefined ? pendingAmount : latestResult.toReceive;
                const latestTotal = latestResult.total === undefined ? totalAmount : latestResult.total;
                const pendingDelta = (typeof pendingAmount === 'number' && typeof latestPending === 'number') ? pendingAmount - latestPending : 0;
                const totalDelta = (typeof totalAmount === 'number' && typeof latestTotal === 'number') ? latestTotal - totalAmount : 0;
                const claimedAmount = totalDelta || pendingDelta || (latestPending === 0 ? pendingAmount : 0);
                if (claimedAmount > 0) {
                    this.log(`-领取云朵:${claimedAmount}云朵`);
                    totalAmount = latestTotal;
                } else {
                    this.log(`领取云朵失败: ${receiveData.msg || '未知错误'}`);
                    if ([614, 615].includes(receiveData.code) && !getEnvDeviceId() && !getDeviceId(this.account)) {
                        this.log('-当前账号尚未填写 deviceId，请在 ydyp_data 账号项或 ydyp_device_id 变量中抓包补充');
                    }
                    this.log(`-当前待领取:${pendingAmount}云朵`);
                }
            }
        } else {
            this.log('-当前待领取:0云朵');
        }
        await this.sleep();
        const prizeData = (await this.requestJson({ url: prizeUrl, headers: this.jwtHeaders, cookies: this.cookies })) || {};
        const result = toArray((prizeData.result || {}).result);
        let rewards = '';
        for (const value of result) {
            const marketId = value.marketid || value.marketId;
            if (value.flag === 1 && marketId !== TOKENPK_MARKET_NAME) {
                rewards += `待领取奖品: ${value.prizeName}\n`;
            }
        }
        this.log(`-当前云朵数量:${totalAmount}云朵`);
        if (rewards) this.log(rewards);
        $.user_amount += `用户【${this.encryptAccount}】:${totalAmount}云朵\n`;
    }

    async backupCloud() {
        const backupData = (await this.requestJson({ url: 'https://caiyun.feixin.10086.cn/market/backupgift/info', headers: this.jwtHeaders })) || {};
        const state = ((backupData.result || {}).state);
        if (state === -1) {
            this.log('本月未备份,暂无连续备份奖励');
        } else if (state === 0) {
            this.log('-领取本月连续备份奖励');
            const curData = (await this.requestJson({ url: 'https://caiyun.feixin.10086.cn/market/backupgift/receive', headers: this.jwtHeaders })) || {};
            this.log(`-获得云朵数量:${((curData.result || {}).result)}`);
        } else if (state === 1) {
            $.log('-已领取本月连续备份奖励');
        }
        await this.sleep();
        const expendData = (await this.requestJson({ url: 'https://caiyun.feixin.10086.cn/market/signin/page/taskExpansion', headers: this.jwtHeaders, cookies: this.cookies })) || {};
        const expend = expendData.result || {};
        const curMonthBackup = expend.curMonthBackup || '';
        const preMonthBackup = expend.preMonthBackup || '';
        const curMonthBackupTaskAccept = expend.curMonthBackupTaskAccept || '';
        const nextMonthTaskRecordCount = expend.nextMonthTaskRecordCount === undefined ? '' : expend.nextMonthTaskRecordCount;
        const acceptDate = expend.acceptDate || '';

        if (curMonthBackup) this.log(`- 本月已备份，下月可领取膨胀云朵: ${nextMonthTaskRecordCount}`);
        else this.log('- 本月还未备份，下月暂无膨胀云朵');

        if (preMonthBackup) {
            if (curMonthBackupTaskAccept) {
                $.log('- 上月已备份，膨胀云朵已领取');
            } else {
                const receiveData = (await this.requestJson({
                    url: `https://caiyun.feixin.10086.cn/market/signin/page/receiveTaskExpansion?acceptDate=${acceptDate}`,
                    headers: this.jwtHeaders,
                    cookies: this.cookies,
                })) || {};
                if (receiveData.code !== 0) this.log(`-领取失败:${receiveData.msg}`);
                else this.log(`- 膨胀云朵领取成功: ${((receiveData.result || {}).cloudCount) === undefined ? '' : receiveData.result.cloudCount}朵`);
            }
        } else {
            $.log('-上月未备份，本月无膨胀云朵领取');
        }
    }

    // ---------- 主流程 ----------
    async run() {
        await this.guard(() => this.refreshAuthorizationToken());
        if (await this.guard(() => this.jwt())) {
            await this.guard(() => this.signinStatus());
            await this.click();
            await this.guard(() => this.getTasklist('sign_in_3', 'cloud_app'));
            await this.guard(() => this.nationalTokenPk());
            this.log('\n🔥 热门任务');
            await this.guard(() => this.backupCloud());
            this.log('\n📧 139邮箱任务');
            await this.guard(() => this.getTasklist('newsign_139mail', 'email_app'));
            await this.guard(() => this.receive());
            await this.guard(() => this.redEnvelopeParty());
        } else {
            $.err_accounts += `${this.encryptAccount}\n`;
        }
    }
}


// ---------- 脚本主流程 (多账号循环) ----------
async function main() {
    if ($.userArr && $.userArr.length) {
        $.log(`移动云盘自动签到 v${SCRIPT_VERSION}`);
        $.log(`\n🌀 找到 ${$.userArr.length} 个 CK 变量`);
        if (getEnvDeviceId()) {
            $.log('已检测到 ydyp_device_id，将优先使用环境变量 deviceId');
        } else {
            const cached = loadStorage();
            const cachedAccounts = Object.keys(cached).filter(account => cached[account] && cached[account].deviceId);
            if (cachedAccounts.length) {
                $.log(`已发现缓存 deviceId ${cachedAccounts.length} 个账号；新账号将自动生成 deviceId 并写入 ${CACHE_KEY}`);
            } else {
                $.log(`未检测到 ydyp_device_id；脚本将优先读取 ${CACHE_KEY} 缓存，缓存为空时自动生成 deviceId`);
            }
        }

        $.taskLogs = [];
        for (let i = 0; i < $.userArr.length; i++) {
            $.log(`\n======== ▷ 第 ${i + 1} 个账号 ◁ ========`);
            const yp = new YP($.userArr[i]);
            if (!yp.Authorization) {
                $.log(`⛔️ 账号 ${i + 1} 无效，跳过执行`);
                continue;
            }

            await yp.guard(() => yp.run());
            if (yp.userLogLines.length) $.taskLogs.push(`【账号 ${i + 1} · ${yp.encryptAccount}】\n${yp.userLogLines.join('\n')}`);

            if (i < $.userArr.length - 1) {
                $.log('\n准备进行下一个账号');
                await sleep(1, 3);
            }
        }

        $.log('\n----- 所有账号执行完成 -----\n');

        if ($.err_accounts.trim()) $.Messages.push(`❌ 失效账号:\n${$.err_accounts}`);
        if ($.taskLogs.length) $.Messages.push(`任务详情:\n${$.taskLogs.join('\n\n')}`);
        if ($.user_amount.trim()) $.Messages.push(`☁️ 云朵汇总:\n${$.user_amount}`);
    } else {
        throw new Error('未找到 ydyp_data 变量 ❌');
    }
}

async function sleep(minDelay = 1, maxDelay = 1.5) {
    return $.wait((Math.random() * (maxDelay - minDelay) + minDelay) * 1000);
}

// ---------- 获取Cookie数据 (rewrite 抓取入口, 与头部抓取正则配套) ----------
function GetCookie() {
    try {
        if ($request && $request.method === 'OPTIONS') return;
        const header = ObjectKeys2LowerCase($request.headers || {});
        debug($request, '获取请求信息');

        const authorization = normalizeAuthorization(header.authorization);
        if (!authorization) throw new Error('请求头中没有 Authorization');

        // 手机号直接从 Basic 认证里解 (mobile:手机号:token)
        const parts = Crypt('base64-decode', authorization.slice(6)).split(':');
        const phone = parts.length >= 2 ? parts[1] : '';
        if (!phone) throw new Error('未获取到手机号');

        const existIndex = $.userArr.findIndex(user => user.phone === phone);
        if (existIndex !== -1 && $.userArr[existIndex].Authorization === authorization) {
            $.log(`♻️ [${phone}] Authorization 未变化`);
            return;
        }

        const newData = { 'Authorization': authorization, 'phone': phone, 'deviceId': '' };
        let msg = '';
        if (existIndex !== -1) {
            newData.deviceId = $.userArr[existIndex].deviceId || '';
            $.userArr[existIndex] = newData;
            msg = `♻️ 更新用户 [${phone}] 信息`;
        } else {
            $.userArr.push(newData);
            msg = `🆕 新增用户 [${phone}] 信息`;
        }

        $.setdata($.toStr($.userArr), 'ydyp_data');
        $.Messages.push(msg), $.log(msg);
    } catch (e) {
        $.log('❌ Cookie获取失败'), $.log(e.message || e);
    }
}

// ---------- 脚本执行入口 ----------
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


// ---------- 工具函数 ----------
function appendParams(url, params) {
    const keys = Object.keys(params || {});
    if (!keys.length) return url;
    const query = keys
        .filter(key => params[key] !== undefined && params[key] !== null && params[key] !== '')
        .map(key => `${key}=${encodeURIComponent(params[key])}`).join('&');
    return url + (url.indexOf('?') === -1 ? '?' : '&') + query;
}

function ObjectKeys2LowerCase(obj = {}) {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
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

// ---------- Env 类 (NE 通用) ----------
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }

// ---------- Crypt: md5 / sha256 / aes-ecb / base64 (Authorization 刷新与红包派对签名用) ----------

function Crypt(type, a, b, c) { function MD5(string) { function RotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); } function AddUnsigned(lX, lY) { var lX4, lY4, lX8, lY8, lResult; lX8 = (lX & 0x80000000); lY8 = (lY & 0x80000000); lX4 = (lX & 0x40000000); lY4 = (lY & 0x40000000); lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF); if (lX4 & lY4) { return (lResult ^ 0x80000000 ^ lX8 ^ lY8); } if (lX4 | lY4) { if (lResult & 0x40000000) { return (lResult ^ 0xC0000000 ^ lX8 ^ lY8); } else { return (lResult ^ 0x40000000 ^ lX8 ^ lY8); } } else { return (lResult ^ lX8 ^ lY8); } } function F(x, y, z) { return (x & y) | ((~x) & z); } function G(x, y, z) { return (x & z) | (y & (~z)); } function H(x, y, z) { return (x ^ y ^ z); } function I(x, y, z) { return (y ^ (x | (~z))); } function FF(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function GG(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function HH(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function II(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function ConvertToWordArray(string) { var lWordCount; var lMessageLength = string.length; var lNumberOfWords_temp1 = lMessageLength + 8; var lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64; var lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16; var lWordArray = Array(lNumberOfWords - 1); var lBytePosition = 0; var lByteCount = 0; while (lByteCount < lMessageLength) { lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8; lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition)); lByteCount++; } lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8; lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition); lWordArray[lNumberOfWords - 2] = lMessageLength << 3; lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29; return lWordArray; }; function WordToHex(lValue) { var WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount; for (lCount = 0; lCount <= 3; lCount++) { lByte = (lValue >>> (lCount * 8)) & 255; WordToHexValue_temp = "0" + lByte.toString(16); WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2); } return WordToHexValue; }; function Utf8Encode(string) { string = string.replace(/\r\n/g, "\n"); var utftext = ""; for (var n = 0; n < string.length; n++) { var c = string.charCodeAt(n); if (c < 128) { utftext += String.fromCharCode(c); } else if ((c > 127) && (c < 2048)) { utftext += String.fromCharCode((c >> 6) | 192); utftext += String.fromCharCode((c & 63) | 128); } else { utftext += String.fromCharCode((c >> 12) | 224); utftext += String.fromCharCode(((c >> 6) & 63) | 128); utftext += String.fromCharCode((c & 63) | 128); } } return utftext; }; var x = Array(); var k, AA, BB, CC, DD, a, b, c, d; var S11 = 7, S12 = 12, S13 = 17, S14 = 22; var S21 = 5, S22 = 9, S23 = 14, S24 = 20; var S31 = 4, S32 = 11, S33 = 16, S34 = 23; var S41 = 6, S42 = 10, S43 = 15, S44 = 21; string = Utf8Encode(string); x = ConvertToWordArray(string); a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476; for (k = 0; k < x.length; k += 16) { AA = a; BB = b; CC = c; DD = d; a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478); d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756); c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB); b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE); a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF); d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A); c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613); b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501); a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8); d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF); c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1); b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE); a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122); d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193); c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E); b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821); a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562); d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340); c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51); b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA); a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D); d = GG(d, a, b, c, x[k + 10], S22, 0x2441453); c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681); b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8); a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6); d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6); c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87); b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED); a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905); d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8); c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9); b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A); a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942); d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681); c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122); b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C); a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44); d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9); c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60); b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70); a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6); d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA); c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085); b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05); a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039); d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5); c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8); b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665); a = II(a, b, c, d, x[k + 0], S41, 0xF4292244); d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97); c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7); b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039); a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3); d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92); c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D); b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1); a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F); d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0); c = II(c, d, a, b, x[k + 6], S43, 0xA3014314); b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1); a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82); d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235); c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB); b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391); a = AddUnsigned(a, AA); b = AddUnsigned(b, BB); c = AddUnsigned(c, CC); d = AddUnsigned(d, DD); } var temp = WordToHex(a) + WordToHex(b) + WordToHex(c) + WordToHex(d); return temp.toLowerCase(); } function _rsa(pem, string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function BytesToBigInt(bytes) { let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); return n; } function BigIntToBytes(n, len) { const out = new Array(len).fill(0); for (let i = len - 1; i >= 0 && n > 0n; i--) { out[i] = Number(n & 0xffn); n >>= 8n; } return out; } function ModPow(base, exp, mod) { let r = 1n; base %= mod; while (exp > 0n) { if (exp & 1n) r = (r * base) % mod; base = (base * base) % mod; exp >>= 1n; } return r; } function DerRead(buf, off) { const tag = buf[off++]; let len = buf[off++]; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + i]; off += n; } return { tag, start: off, len }; } function DerChildren(buf, start, end) { const list = []; let off = start; while (off < end) { const t = DerRead(buf, off); list.push(t); off = t.start + t.len; } return list; } if (!_rsa._k || _rsa._kp !== pem) { try { const der = Base64ToBytes(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); let seqs = DerChildren(der, DerRead(der, 0).start, der.length); const inner = seqs.find(s => s.tag === 0x04); if (inner) { const seq2 = DerRead(der, inner.start); seqs = DerChildren(der, seq2.start, seq2.start + seq2.len); } const ints = seqs.filter(s => s.tag === 0x02); const n = BytesToBigInt(der.slice(ints[1].start, ints[1].start + ints[1].len)); const d = BytesToBigInt(der.slice(ints[3].start, ints[3].start + ints[3].len)); _rsa._k = { n, d, k: (n.toString(16).length + 1) >> 1 }; _rsa._kp = pem; } catch (e) { $.logErr('❌ [签名] 私钥解析失败: ' + (e.message || e)); return null; } } const key = _rsa._k; try { const digestInfo = [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20, ...SHA256(Utf8Encode(string))]; const padded = [0x00, 0x01, ...new Array(key.k - digestInfo.length - 3).fill(0xff), 0x00, ...digestInfo]; const sig = ModPow(BytesToBigInt(padded), key.d, key.n); return BytesToBase64(BigIntToBytes(sig, key.k)).replace(/\//g, '_').replace(/\+/g, '-'); } catch (e) { $.logErr('❌ [签名] 签名异常: ' + (e.message || e)); return null; } } function _rsaenc(b64Pub, string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function BytesToBigInt(bytes) { let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); return n; } function BigIntToBytes(n, len) { const out = new Array(len).fill(0); for (let i = len - 1; i >= 0 && n > 0n; i--) { out[i] = Number(n & 0xffn); n >>= 8n; } return out; } function ModPow(base, exp, mod) { let r = 1n; base %= mod; while (exp > 0n) { if (exp & 1n) r = (r * base) % mod; base = (base * base) % mod; exp >>= 1n; } return r; } function DerRead(buf, off) { const tag = buf[off++]; let len = buf[off++]; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + i]; off += n; } return { tag, start: off, len }; } function DerChildren(buf, start, end) { const list = []; let off = start; while (off < end) { const t = DerRead(buf, off); list.push(t); off = t.start + t.len; } return list; } if (!_rsaenc._k || _rsaenc._kp !== b64Pub) { try { let der = Base64ToBytes(String(b64Pub).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); if (der.length > 5 && der.slice(0, 5).map(b => String.fromCharCode(b)).join('') === '-----') { der = Base64ToBytes(der.map(b => String.fromCharCode(b)).join('').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); } const outer = DerRead(der, 0); const bitStr = DerChildren(der, outer.start, outer.start + outer.len).find(s => s.tag === 0x03); let ints; if (bitStr) { const seq = DerRead(der, bitStr.start + 1); ints = DerChildren(der, seq.start, seq.start + seq.len).filter(s => s.tag === 0x02); } else { ints = DerChildren(der, outer.start, outer.start + outer.len).filter(s => s.tag === 0x02); if (ints.length < 2) throw new Error('公钥解析失败(支持 SPKI/PKCS#1)'); } const n = BytesToBigInt(der.slice(ints[0].start, ints[0].start + ints[0].len)); const e = BytesToBigInt(der.slice(ints[1].start, ints[1].start + ints[1].len)); _rsaenc._k = { n, e, k: (n.toString(16).length + 1) >> 1 }; _rsaenc._kp = b64Pub; } catch (err) { $.logErr('❌ [加密] 公钥解析失败: ' + (err.message || err)); return null; } } const key = _rsaenc._k; try { const msg = Utf8Encode(string); const psLen = key.k - msg.length - 3; if (psLen < 8) { $.logErr('❌ [加密] 明文超出 RSA 长度上限'); return null; } const ps = new Array(psLen); for (let i = 0; i < psLen; i++) ps[i] = 1 + Math.floor(Math.random() * 255); const padded = [0x00, 0x02, ...ps, 0x00, ...msg]; return BytesToBase64(BigIntToBytes(ModPow(BytesToBigInt(padded), key.e, key.n), key.k)); } catch (err) { $.logErr('❌ [加密] RSA 加密异常: ' + (err.message || err)); return null; } } function _hmac(b64Key, msg) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } let key = Utf8Encode(b64Key); if (key.length > 64) key = SHA256(key); while (key.length < 64) key.push(0); const inner = SHA256(key.map(b => b ^ 0x36).concat(Utf8Encode(msg))); const outer = SHA256(key.map(b => b ^ 0x5c).concat(inner)); return outer.map(b => b.toString(16).padStart(2, '0')).join(''); } function _aes(plain, keyStr, ivStr, ecb, ivp) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } const SBOX = (function () { function gmul(a, b) { let p = 0; for (let i = 0; i < 8; i++) { if ((b >> i) & 1) p ^= a; a = ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; } return p; } const sbox = new Array(256); for (let x = 0; x < 256; x++) { let inv = 0; if (x !== 0) { inv = 1; while (gmul(inv, x) !== 1) inv++; } const r = (v, n) => ((v << n) | (v >> (8 - n))) & 0xff; sbox[x] = (inv ^ r(inv, 1) ^ r(inv, 2) ^ r(inv, 3) ^ r(inv, 4) ^ 0x63) & 0xff; } return sbox; })(); function expandKey(key) { const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]; const Nk = key.length >> 2, Nr = Nk + 6, tw = 4 * (Nr + 1); const w = []; for (let i = 0; i < Nk; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]); for (let i = Nk; i < tw; i++) { let t = w[i - 1].slice(); if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]].map(b => SBOX[b]); t[0] ^= RCON[i / Nk - 1]; } else if (Nk > 6 && i % Nk === 4) t = t.map(b => SBOX[b]); w.push([w[i - Nk][0] ^ t[0], w[i - Nk][1] ^ t[1], w[i - Nk][2] ^ t[2], w[i - Nk][3] ^ t[3]]); } const rk = []; for (let round = 0; round <= Nr; round++) { const blk = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) blk[4 * c + r] = w[4 * round + c][r]; rk.push(blk); } return { rk: rk, Nr: Nr }; } function encryptBlock(input, rk, Nr) { let s = input.slice(); const addRK = (round) => { for (let i = 0; i < 16; i++) s[i] ^= rk[round][i]; }; const xtime = (a) => ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; addRK(0); for (let round = 1; round <= Nr; round++) { for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]]; const t = s.slice(); for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) t[4 * c + r] = s[4 * ((c + r) % 4) + r]; s = t; if (round < Nr) { for (let c = 0; c < 4; c++) { const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3]; s[4 * c] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3; s[4 * c + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3; s[4 * c + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3); s[4 * c + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3); } } addRK(round); } return s; } const data = Utf8Encode(plain); const padLen = 16 - (data.length % 16); for (let i = 0; i < padLen; i++) data.push(padLen); const ks = expandKey(Utf8Encode(keyStr)); let prev = ecb ? null : Utf8Encode(ivStr).slice(0, 16); const out = ivp ? prev.slice() : []; for (let off = 0; off < data.length; off += 16) { const blk = new Array(16); for (let i = 0; i < 16; i++) blk[i] = data[off + i] ^ (ecb ? 0 : prev[i]); prev = encryptBlock(blk, ks.rk, ks.Nr); out.push(...prev); } return BytesToBase64(out); } function _aesdec(cipher, keyStr, ecb, hexIn) { function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function HexToBytes(h) { const s = String(h).replace(/[^0-9a-fA-F]/g, ''); const bytes = []; for (let i = 0; i + 1 < s.length; i += 2) bytes.push(parseInt(s.substr(i, 2), 16)); if (s.length % 2) bytes.push(parseInt(s.slice(-1), 16)); return bytes; } function BytesToUtf8(bytes) { let s = ''; for (let i = 0; i < bytes.length;) { const b = bytes[i]; if (b < 128) { s += String.fromCharCode(b); i += 1; } else if (b >= 240 && i + 3 < bytes.length) { const cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); const v = cp - 0x10000; s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)); i += 4; } else if (b >= 224 && i + 2 < bytes.length) { s += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3; } else if (b >= 192 && i + 1 < bytes.length) { s += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2; } else { s += String.fromCharCode(b); i += 1; } } return s; } const SBOX = (function () { function gmul(a, b) { let p = 0; for (let i = 0; i < 8; i++) { if ((b >> i) & 1) p ^= a; a = ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; } return p; } const sbox = new Array(256); for (let x = 0; x < 256; x++) { let inv = 0; if (x !== 0) { inv = 1; while (gmul(inv, x) !== 1) inv++; } const r = (v, n) => ((v << n) | (v >> (8 - n))) & 0xff; sbox[x] = (inv ^ r(inv, 1) ^ r(inv, 2) ^ r(inv, 3) ^ r(inv, 4) ^ 0x63) & 0xff; } return sbox; })(); const INV_SBOX = (function () { const inv = new Array(256); for (let i = 0; i < 256; i++) inv[SBOX[i]] = i; return inv; })(); function expandKey(key) { const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]; const Nk = key.length >> 2, Nr = Nk + 6, tw = 4 * (Nr + 1); const w = []; for (let i = 0; i < Nk; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]); for (let i = Nk; i < tw; i++) { let t = w[i - 1].slice(); if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]].map(b => SBOX[b]); t[0] ^= RCON[i / Nk - 1]; } else if (Nk > 6 && i % Nk === 4) t = t.map(b => SBOX[b]); w.push([w[i - Nk][0] ^ t[0], w[i - Nk][1] ^ t[1], w[i - Nk][2] ^ t[2], w[i - Nk][3] ^ t[3]]); } const rk = []; for (let round = 0; round <= Nr; round++) { const blk = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) blk[4 * c + r] = w[4 * round + c][r]; rk.push(blk); } return { rk: rk, Nr: Nr }; } function decryptBlock(input, rk, Nr) { let s = input.slice(); const addRK = (round) => { for (let i = 0; i < 16; i++) s[i] ^= rk[round][i]; }; const xtime = (a) => ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; const mul = (a, b) => { let p = 0; for (let i = 0; i < 8; i++) { if ((b >> i) & 1) p ^= a; a = xtime(a); } return p; }; const irows = () => { const t = s.slice(); for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) t[4 * c + r] = s[4 * (((c - r) % 4 + 4) % 4) + r]; s = t; }; addRK(Nr); for (let round = Nr - 1; round >= 1; round--) { irows(); for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]; addRK(round); for (let c = 0; c < 4; c++) { const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3]; s[4 * c] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9); s[4 * c + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13); s[4 * c + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11); s[4 * c + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14); } } irows(); for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]; addRK(0); return s; } const raw = hexIn ? HexToBytes(cipher) : Base64ToBytes(cipher); if (!raw.length || raw.length % 16) return ''; const ks = expandKey(function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; }(keyStr)); let prev = null, start = 0; if (!ecb) { prev = raw.slice(0, 16); start = 16; } const out = []; for (let off = start; off < raw.length; off += 16) { const blk = raw.slice(off, off + 16); const dec = decryptBlock(blk, ks.rk, ks.Nr); const plainBlk = ecb ? dec : dec.map((b, i) => b ^ prev[i]); out.push(...plainBlk); if (!ecb) prev = blk; } const padLen = out[out.length - 1]; if (padLen >= 1 && padLen <= 16 && out.length >= padLen) { let ok = true; for (let i = 0; i < padLen; i++) if (out[out.length - 1 - i] !== padLen) ok = false; if (ok) out.length -= padLen; } return BytesToUtf8(out); } function _sha256hex(string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } return SHA256(Utf8Encode(string)).map(b => b.toString(16).padStart(2, '0')).join(''); } function _b64(str) { const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const u = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) u.push(c); else if (c < 2048) u.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); u.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else u.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } let out = ''; for (let i = 0; i < u.length; i += 3) { const b0 = u[i], b1 = u[i + 1], b2 = u[i + 2]; out += B[b0 >> 2]; out += b1 === undefined ? B[(b0 & 3) << 4] + '==' : b2 === undefined ? B[((b0 & 3) << 4) | (b1 >> 4)] + B[(b1 & 15) << 2] + '=' : B[((b0 & 3) << 4) | (b1 >> 4)] + B[((b1 & 15) << 2) | (b2 >> 6)] + B[b2 & 63]; } return out; } function _b64d(b64) { const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CH[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } let s = ''; for (let i = 0; i < bytes.length;) { const b = bytes[i]; if (b < 128) { s += String.fromCharCode(b); i += 1; } else if (b >= 240 && i + 3 < bytes.length) { const cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); const v = cp - 0x10000; s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)); i += 4; } else if (b >= 224 && i + 2 < bytes.length) { s += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3; } else if (b >= 192 && i + 1 < bytes.length) { s += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2; } else { s += String.fromCharCode(b); i += 1; } } return s; }switch (type) { case 'sha256': return _sha256hex(a); case 'md5': return MD5(a); case 'rsa-sha256': return _rsa(a, b); case 'rsa-enc-pkcs1': return _rsaenc(a, b); case 'hmac-sha256': return _hmac(a, b); case 'aes-cbc': return _aes(a, b, c); case 'aes-ecb': return _aes(a, b, null, true); case 'aes-cbc-ivp': return _aes(a, b, c, false, 2); case 'aes-cbc-dec': return _aesdec(a, b, false); case 'aes-ecb-dec': return _aesdec(a, b, true); case 'aes-ecb-dec-hex': return _aesdec(a, b, true, true); case 'base64-encode': return _b64(String(a)); case 'base64-decode': return _b64d(a); default: return null; } }
