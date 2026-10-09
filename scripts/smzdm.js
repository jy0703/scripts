/**
 * 脚本名称：什么值得买 - 签到 + 每日任务
 * 脚本说明：参考 lhtj 的单文件框架，合并 smzdm_checkin 与 smzdm_task。
 * 环境变量：smzdm_debug
 *   1. smzdm_data：抓包保存的账号数组（推荐）
 *   2. SMZDM_COOKIE：Node/青龙可直接填 Cookie，多账号用 & 或换行分隔
 *   3. SMZDM_SK：可选，签到请求里的 sk，多账号与 Cookie 顺序一致；不填时按 Cookie 的 smzdm_id + device_id 自动计算
 *   4. SMZDM_COMMENT：可选，评论任务文案，需大于 10 个汉字
 *   5. SMZDM_CROWD_SILVER_5：可选，值 yes 时执行 5 碎银子抽奖任务
 *   6. SMZDM_CROWD_KEYWORD：可选，非免费抽奖时优先匹配的关键词
 * 更新时间：2026-10-09
 *
 * 抓包说明：
 *   1. 推荐拦截 https://user-api.smzdm.com/checkin
 *   2. 会自动保存 Cookie、User-Agent、sk 到 smzdm_data；sk 抓不到也没关系，签到时会自动计算
 *
 * ------------------ Surge 配置 ------------------
 *
 * [MITM]
 * hostname = user-api.smzdm.com
 *
 * [Script]
 * 什么值得买获取Cookie = type=http-request,pattern=^https?:\/\/user-api\.smzdm\.com\/(checkin|task\/list_v2),requires-body=1,max-size=0,timeout=60,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm.js,script-update-interval=0
 * 什么值得买 = type=cron,cronexp="10 8 * * *",timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm.js,script-update-interval=0
 *
 * ------------------- Loon 配置 -------------------
 *
 * [MITM]
 * hostname = user-api.smzdm.com
 *
 * [Script]
 * http-request ^https?:\/\/user-api\.smzdm\.com\/(checkin|task\/list_v2) tag=什么值得买获取Cookie,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm.js,requires-body=1
 * cron "10 8 * * *" script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm.js,tag=什么值得买,enable=true
 *
 * --------------- Quantumult X 配置 ---------------
 *
 * [MITM]
 * hostname = user-api.smzdm.com
 *
 * [rewrite_local]
 * ^https?:\/\/user-api\.smzdm\.com\/(checkin|task\/list_v2) url script-request-body https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm.js
 *
 * [task_local]
 * 10 8 * * * https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm.js, tag=什么值得买, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/smzdm.png, enabled=true
 */

const $ = new Env('什么值得买');
$.is_debug = getEnv('smzdm_debug', 'is_debug') || 'false';
$.Messages = [];

const APP_VERSION = '10.4.26';
const APP_VERSION_REV = '866';
const DEFAULT_USER_AGENT_APP = `smzdm_android_V${APP_VERSION} rv:${APP_VERSION_REV} (Redmi Note 3;Android10.0;zh)smzdmapp`;
const DEFAULT_USER_AGENT_WEB = `Mozilla/5.0 (Linux; Android 10.0; Redmi Build/Redmi Note 3; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/95.0.4638.74 Mobile Safari/537.36 smzdm_android_V${APP_VERSION} rv:${APP_VERSION_REV} (Redmi;Android10.0;zh) jsbv_1.0.0 webv_2.0 smzdmapp`;
const SIGN_KEY = 'apr1$AwP!wRRT$gJ/q.X24poeBInlUJC';
const SK_DES_KEY = 'geZm53XAspb02exN';
const RE_VERSION = /(smzdm_android_V|smzdm\s|iphone_smzdmapp\/)([\d.]+)/i;
const RE_REV = /rv:([\d.]+)/i;
const USER_STORAGE_KEY = 'smzdm_data';
const RUNTIME_ENV = {
    SMZDM_COMMENT: getEnv('SMZDM_COMMENT', 'smzdm_comment') || '',
    SMZDM_CROWD_SILVER_5: getEnv('SMZDM_CROWD_SILVER_5', 'smzdm_crowd_silver_5') || '',
    SMZDM_CROWD_KEYWORD: getEnv('SMZDM_CROWD_KEYWORD', 'smzdm_crowd_keyword') || ''
};

function randomStr(len = 18) {
    const char = '0123456789';
    let str = '';
    for (let i = 0; i < len; i += 1) {
        str += char.charAt(Math.floor(Math.random() * char.length));
    }
    return str;
}

function randomDecimal(min, max, decimal) {
    const rand = Math.random() * (max - min + 1) + min;
    return Math.floor(rand * decimal) / decimal;
}

function wait(minSecond, maxSecond) {
    const randomSecond = randomDecimal(minSecond, maxSecond, 1000);
    $.log(`等待 ${minSecond}-${maxSecond}(${randomSecond}) 秒`);
    return $.wait(randomSecond * 1000);
}

function parseJSON(str, fallback = {}) {
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}

function removeTags(str = '') {
    return String(str).replace(/<[^<]+?>/g, '');
}

function escapeRegex(str = '') {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCookieValue(cookie = '', name = '') {
    const re = new RegExp(`(?:^|;\\s*)${escapeRegex(name)}=([^;]*)`, 'i');
    const match = String(cookie).match(re);
    return match ? decodeURIComponent(match[1]) : '';
}

function random32() {
    const char = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let str = '';
    for (let i = 0; i < 32; i += 1) {
        str += char.charAt(Math.floor(Math.random() * char.length));
    }
    return str;
}

// 对齐上游 getSk：sk = DES-ECB(smzdm_id + device_id)，Cookie 里两个值按原样取用、不做 URL 解码
function getSk(cookie = '') {
    const userId = String((String(cookie).match(/smzdm_id=([^;]*)/) || [])[1] || '');
    if (!userId) return '';
    const deviceId = String((String(cookie).match(/device_id=([^;]*)/) || [])[1] || '') || random32();
    return Crypt('des-ecb', userId + deviceId, SK_DES_KEY);
}

function updateCookie(cookie = '', name = '', value = '') {
    if (!cookie) return `${name}=${encodeURIComponent(value)}`;
    const re = new RegExp(`(^|;\\s*)${escapeRegex(name)}=[^;]*`, 'i');
    if (re.test(cookie)) {
        return cookie.replace(re, `$1${name}=${encodeURIComponent(value)}`);
    }
    return `${cookie.replace(/;?\s*$/, '')}; ${name}=${encodeURIComponent(value)}`;
}

function splitMultiValue(value = '') {
    if (!value) return [];
    if (value.includes('&')) return value.split('&').map(item => item.trim()).filter(Boolean);
    if (value.includes('\n')) return value.split('\n').map(item => item.trim()).filter(Boolean);
    return [String(value).trim()].filter(Boolean);
}

function parseFormBody(body = '') {
    const result = {};
    String(body).split('&').forEach(item => {
        if (!item) return;
        const index = item.indexOf('=');
        const key = index >= 0 ? item.slice(0, index) : item;
        const value = index >= 0 ? item.slice(index + 1) : '';
        result[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
    });
    return result;
}

function stripWhitespace(value) {
    return String(value).replace(/\s+/g, '');
}

function trimUndefinedFields(data = {}) {
    Object.keys(data).forEach(key => data[key] === undefined && delete data[key]);
    return data;
}

function signFormData(data = {}) {
    const formData = {
        weixin: 1,
        basic_v: 0,
        f: 'android',
        v: APP_VERSION,
        time: `${Math.round(Date.now() / 1000)}000`,
        ...data
    };
    const signData = Object.keys(formData)
        .filter(key => formData[key] !== '')
        .sort()
        .map(key => `${key}=${stripWhitespace(formData[key])}`)
        .join('&');

    return {
        ...formData,
        sign: Crypt('md5', `${signData}&key=${SIGN_KEY}`).toUpperCase()
    };
}

function encodeFormData(data = {}) {
    return Object.keys(data)
        .filter(key => data[key] !== undefined && data[key] !== null)
        .map(key => {
            const value = typeof data[key] === 'object' ? JSON.stringify(data[key]) : String(data[key]);
            return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
        })
        .join('&');
}

async function requestApi(url, inputOptions = {}) {
    const options = {
        ...inputOptions,
        method: String(inputOptions.method || 'get').toLowerCase(),
        data: trimUndefinedFields({ ...(inputOptions.data || {}) })
    };

    if (options.sign !== false) {
        options.data = signFormData(options.data);
    }

    const requestOptions = {
        url,
        method: options.method,
        headers: {
            ...(options.headers || {})
        },
        _respType: 'all',
        _timeout: options.timeout || 30000
    };

    if (options.method === 'get') {
        const queryString = encodeFormData(options.data);
        requestOptions.url = queryString ? `${url}${url.includes('?') ? '&' : '?'}${queryString}` : url;
    } else {
        if (!requestOptions.headers['Content-Type'] && !requestOptions.headers['content-type']) {
            requestOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        }
        requestOptions.body = encodeFormData(options.data);
    }

    if (options.debug) {
        debug({ requestOptions, parseJSON: options.parseJSON !== false }, 'requestApi');
    }

    const response = await Request(requestOptions);
    const body = response?.body || '';
    const data = options.parseJSON === false ? body : parseJSON(body);
    const isHttpSuccess = Number(response?.statusCode || response?.status || 0) >= 200 && Number(response?.statusCode || response?.status || 0) < 400;
    const isSuccess = options.parseJSON === false ? isHttpSuccess : `${data?.error_code ?? ''}` === '0';

    if (options.debug) {
        debug({ status: response?.statusCode || response?.status, body: options.parseJSON === false ? body : data }, 'requestApi response');
    }

    return {
        isSuccess,
        response: options.parseJSON === false ? body : $.toStr(data),
        data
    };
}

function postApi(url, inputOptions = {}) {
    return requestApi(url, {
        ...inputOptions,
        method: 'post'
    });
}

function createBotContext(user = {}) {
    return normalizeBotContext({
        $env: $,
        user,
        cookie: user.cookie || '',
        userAgentApp: user.userAgentApp || '',
        userAgentWeb: user.userAgentWeb || '',
        sk: user.sk || getSk(user.cookie)
    });
}

function normalizeBotContext(inputCtx = {}) {
    const ctx = {
        $env: inputCtx.$env || $,
        user: inputCtx.user || {},
        cookie: String(inputCtx.cookie || '').trim(),
        token: '',
        userAgentApp: String(inputCtx.userAgentApp || '').trim(),
        userAgentWeb: String(inputCtx.userAgentWeb || '').trim(),
        sk: String(inputCtx.sk || '').trim(),
        androidCookie: ''
    };
    const match = ctx.cookie.match(/(?:^|;\s*)sess=([^;]*)/);
    ctx.token = match ? match[1] : '';

    ctx.androidCookie = ctx.cookie.replace(/iphone/ig, 'android').replace(/iPhone/g, 'Android');
    ctx.androidCookie = updateCookie(ctx.androidCookie, 'smzdm_version', APP_VERSION);
    ctx.androidCookie = updateCookie(ctx.androidCookie, 'device_smzdm_version', APP_VERSION);
    ctx.androidCookie = updateCookie(ctx.androidCookie, 'v', APP_VERSION);
    ctx.androidCookie = updateCookie(ctx.androidCookie, 'device_smzdm_version_code', APP_VERSION_REV);
    ctx.androidCookie = updateCookie(ctx.androidCookie, 'device_system_version', '10.0');
    ctx.androidCookie = updateCookie(ctx.androidCookie, 'apk_partner_name', 'smzdm_download');
    ctx.androidCookie = updateCookie(ctx.androidCookie, 'partner_name', 'smzdm_download');
    ctx.androidCookie = updateCookie(ctx.androidCookie, 'device_type', 'Android');
    ctx.androidCookie = updateCookie(ctx.androidCookie, 'device_smzdm', 'android');
    ctx.androidCookie = updateCookie(ctx.androidCookie, 'device_name', 'Android');
    return ctx;
}

function getHeaders(ctx) {
    let userAgent = ctx.userAgentApp || getEnv('SMZDM_USER_AGENT_APP') || DEFAULT_USER_AGENT_APP;
    userAgent = userAgent.replace(RE_VERSION, `$1${APP_VERSION}`).replace(RE_REV, `rv:${APP_VERSION_REV}`);
    return {
        Accept: '*/*',
        'Accept-Language': 'zh-Hans-CN;q=1',
        'Accept-Encoding': 'gzip, deflate, br',
        request_key: randomStr(18),
        'User-Agent': userAgent,
        Cookie: ctx.androidCookie
    };
}

function getHeadersForWeb(ctx) {
    let userAgent = ctx.userAgentWeb || getEnv('SMZDM_USER_AGENT_WEB') || DEFAULT_USER_AGENT_WEB;
    userAgent = userAgent.replace(RE_VERSION, `$1${APP_VERSION}`).replace(RE_REV, `rv:${APP_VERSION_REV}`);
    return {
        Accept: '*/*',
        'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': userAgent,
        Cookie: ctx.androidCookie
    };
}

function getOneByRandom(ctx, listing = []) {
    return listing[Math.floor(Math.random() * listing.length)];
}


function loadUsers() {
    const stored = getEnv(USER_STORAGE_KEY);
    const parsed = $.toObj(stored, null);
    let users = [];
    if (Array.isArray(parsed)) {
        users = parsed;
    } else if (parsed && typeof parsed === 'object') {
        users = [parsed];
    } else {
        const cookies = splitMultiValue(getEnv('SMZDM_COOKIE'));
        const sks = splitMultiValue(getEnv('SMZDM_SK'));
        const appUas = splitMultiValue(getEnv('SMZDM_USER_AGENT_APP'));
        const webUas = splitMultiValue(getEnv('SMZDM_USER_AGENT_WEB'));
        users = cookies.map((cookie, index) => ({
            cookie,
            sk: sks[index] || '',
            userAgentApp: appUas[index] || '',
            userAgentWeb: webUas[index] || ''
        }));
    }
    return users.map((user, index) => normalizeUser(user, index)).filter(Boolean);
}

function normalizeUser(user, index = 0) {
    if (!user) return null;
    const cookie = String(user.cookie || user.Cookie || '').trim();
    if (!cookie) return null;
    const uid = String(user.uid || user.userId || parseCookieValue(cookie, 'smzdm_id') || parseCookieValue(cookie, 'smzdm_id_usr') || '').trim();
    const sess = String(parseCookieValue(cookie, 'sess') || '').trim();
    const nickname = String(user.nickname || user.name || '').trim();
    return {
        cookie,
        uid,
        sess,
        nickname,
        sk: String(user.sk || '').trim(),
        userAgentApp: String(user.userAgentApp || user.ua || '').trim(),
        userAgentWeb: String(user.userAgentWeb || '').trim(),
        updateTime: user.updateTime || '',
        label: nickname || uid || sess || `账号${index + 1}`
    };
}

function saveUsers(users = []) {
    return $.setdata($.toStr(users), USER_STORAGE_KEY);
}

function upsertUser(currentUser) {
    const users = loadUsers();
    const index = users.findIndex(item => (currentUser.uid && item.uid === currentUser.uid) || (currentUser.sess && item.sess === currentUser.sess));
    if (index >= 0) {
        users[index] = {
            ...users[index],
            ...currentUser,
            label: currentUser.nickname || users[index].nickname || currentUser.uid || users[index].uid || currentUser.sess || users[index].sess || users[index].label || '账号'
        };
    } else {
        users.push(normalizeUser(currentUser, users.length));
    }
    saveUsers(users);
    return users;
}

function buildAccountTitle(user, index) {
    return user.nickname || user.uid || user.sess || `账号${index + 1}`;
}

function ObjectKeys2LowerCase(obj = {}) {
    return Object.keys(obj).reduce((result, key) => {
        result[String(key).toLowerCase()] = obj[key];
        return result;
    }, {});
}

function GetCookie() {
    try {
        if (typeof $request === 'undefined') return;
        if ($request.method === 'OPTIONS') return;
        const headers = ObjectKeys2LowerCase($request.headers || {});
        const cookie = String(headers.cookie || '').trim();
        if (!cookie) throw new Error('请求头中未找到 Cookie');
        const body = parseFormBody($request.body || '');
        const uid = parseCookieValue(cookie, 'smzdm_id') || parseCookieValue(cookie, 'smzdm_id_usr');
        const sess = parseCookieValue(cookie, 'sess');
        const user = normalizeUser({
            cookie,
            uid,
            sess,
            sk: body.sk || '',
            userAgentApp: headers['user-agent'] || '',
            updateTime: $.time('yyyy-MM-dd HH:mm:ss')
        });
        const users = upsertUser(user);
        const title = buildAccountTitle(user, users.length - 1);
        const msg = `获取Cookie: ✅ 已保存 ${title}${user.sk ? '，包含 sk' : ''}`;
        $.Messages.push(msg);
        $.log(msg);
    } catch (e) {
        const msg = `获取Cookie: ❌ ${e.message || e}`;
        $.Messages.push(msg);
        $.log(msg);
    }
}

// ------------------------------------

async function doTasks(ctx, tasks) {
    let notifyMsg = '';
    const taskHandlers = {
        'interactive.view.article': {
            handler: doViewTask
        },
        'interactive.share': {
            handler: doShareTask
        },
        'guide.crowd': {
            handler: doCrowdTask,
            shouldNotify: result => result.code !== 99
        },
        'interactive.follow.user': {
            handler: doFollowUserTask
        },
        'interactive.follow.tag': {
            handler: doFollowTagTask
        },
        'interactive.follow.brand': {
            handler: doFollowBrandTask
        },
        'interactive.favorite': {
            handler: doFavoriteTask
        },
        'interactive.rating': {
            handler: doRatingTask
        },
        'interactive.comment': {
            guard: () => RUNTIME_ENV.SMZDM_COMMENT && String(RUNTIME_ENV.SMZDM_COMMENT).length > 10,
            onGuardFail(currentCtx) {
                currentCtx.$env.log('\u{1F7E1}\u8BF7\u8BBE\u7F6E SMZDM_COMMENT \u73AF\u5883\u53D8\u91CF\u540E\u624D\u80FD\u505A\u8BC4\u8BBA\u4EFB\u52A1\uFF01');
            },
            handler: doCommentTask
        }
    };

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];

      // claimable task
      if (task.task_status == '3') {
        ctx.$env.log(`\u9886\u53D6[${task.task_name}]\u5956\u52B1:`);

        const { isSuccess } = await receiveReward(ctx, task.task_id);

        notifyMsg += `${isSuccess ? '🟢' : '❌'}\u9886\u53D6[${task.task_name}]\u5956\u52B1${isSuccess ? '\u6210\u529F' : '\u5931\u8D25\uFF01\u8BF7\u67E5\u770B\u65E5\u5FD7'}\n`;

        await wait(5, 15);
        continue;
      }

      // unfinished task
      if (task.task_status != '2') {
        continue;
      }

      const taskHandler = taskHandlers[task.task_event_type];
      if (!taskHandler) {
        continue;
      }

      if (taskHandler.guard && !taskHandler.guard(task, ctx)) {
        taskHandler.onGuardFail && taskHandler.onGuardFail(ctx, task);
        continue;
      }

      const result = await taskHandler.handler(ctx, task);
      if (!taskHandler.shouldNotify || taskHandler.shouldNotify(result, task, ctx)) {
        notifyMsg += getTaskNotifyMessage(ctx, result.isSuccess, task);
      }

      await wait(5, 15);
    }

    return notifyMsg;
}

function getTaskNotifyMessage(ctx, isSuccess, task) {
    return `${isSuccess ? '🟢' : '❌'}完成[${task.task_name}]任务${isSuccess ? '成功' : '失败！请查看日志'}\n`;
}

async function claimTaskReward(ctx, task, minSecond = 5, maxSecond = 15) {
    ctx.$env.log('\u9886\u53D6\u5956\u52B1');
    await wait(minSecond, maxSecond);
    return await receiveReward(ctx, task.task_id);
}

async function runActionSequence(ctx, steps = [], waitRange = [3, 10]) {
    if (!steps.length) {
      return;
    }

    await wait(waitRange[0], waitRange[1]);

    for (let i = 0; i < steps.length; i++) {
      await steps[i]();

      if (i < steps.length - 1) {
        await wait(waitRange[0], waitRange[1]);
      }
    }
}

async function getTaskArticles(ctx, task, num, repeatFixedArticle = false) {
    if (task.article_id == '0') {
      const articles = await getArticleList(ctx, num);

      await wait(3, 10);

      return articles;
    }

    const article = {
      article_id: task.article_id,
      article_channel_id: task.channel_id
    };

    return repeatFixedArticle ? Array.from({ length: num }, () => ({ ...article })) : [article];
}

async function openTaskArticle(ctx, task, article) {
    if (/detail_haojia/i.test(task.task_redirect_url.scheme_url)) {
      await getHaojiaDetail(ctx, article.article_id);
    }
    else {
      await getArticleDetail(ctx, article.article_id);
    }
}

async function doCommentTask(ctx, task) {
    ctx.$env.log(`开始任务: ${task.task_name}`);

    const articles = await getArticleList(ctx, 20);

    if (articles.length < 1) {
      return {
        isSuccess: false
      };
    }

    // 随机选一篇文章来评论
    const article = articles[Math.floor(Math.random() * articles.length)];

    await wait(3, 10);

    const {isSuccess, data } = await submitComment(ctx, {
      articleId: article.article_id,
      channelId: article.article_channel_id,
      content: RUNTIME_ENV.SMZDM_COMMENT
    });

    if (!isSuccess) {
      return {
        isSuccess
      };
    }

    ctx.$env.log('删除评论');
    await wait(20, 30);

    const {isSuccess: result } = await removeComment(ctx, data.data.comment_ID);

    if (!result) {
      ctx.$env.log('再试一次');
      await wait(10, 20);

      // 不成功再执行一次删除
      await removeComment(ctx, data.data.comment_ID);
    }
    return await claimTaskReward(ctx, task);
}

async function doRatingTask(ctx, task) {
    ctx.$env.log(`开始任务: ${task.task_name}`);

    let article;

    if (task.task_description.indexOf('任意') >= 0 || task.task_redirect_url.link_val == '0' || !task.task_redirect_url.link_val) {
      // 随机选一篇文章
      const articles = await getArticleList(ctx, 20);

      if (articles.length < 1) {
        return {
          isSuccess: false
        };
      }

      article = getOneByRandom(ctx, articles);
    }
    else if (task.task_redirect_url.link_type === 'lanmu') {
      // 从栏目获取文章
      const articles = await getArticleListFromLanmu(ctx, task.task_redirect_url.link_val, 20);

      if (articles.length < 1) {
        return {
          isSuccess: false
        };
      }

      article = getOneByRandom(ctx, articles);
    }
    else if (task.task_redirect_url.link != '' && task.task_redirect_url.link_val != '') {
      const channelId = await getArticleChannelIdForTesting(ctx, task.task_redirect_url.link);

      if (!channelId) {
        return {
          isSuccess: false
        };
      }

      article = {
        'article_id': task.task_redirect_url.link_val,
        'article_channel_id': channelId
      };
    }
    else {
      ctx.$env.log('尚未支持');

      return {
        isSuccess: false
      };
    }

    if (article.article_price) {
      // 点值
      await runActionSequence(ctx, [
        () => rating(ctx, {
          method: 'worth_cancel',
          type: 3,
          id: article.article_id,
          channelId: article.article_channel_id
        }),
        () => rating(ctx, {
          method: 'worth_create',
          type: 1,
          id: article.article_id,
          channelId: article.article_channel_id
        }),
        () => rating(ctx, {
          method: 'worth_cancel',
          type: 3,
          id: article.article_id,
          channelId: article.article_channel_id
        })
      ]);
    }
    else {
      // 点赞
      await runActionSequence(ctx, [
        () => rating(ctx, {
          method: 'like_cancel',
          id: article.article_id,
          channelId: article.article_channel_id
        }),
        () => rating(ctx, {
          method: 'like_create',
          id: article.article_id,
          channelId: article.article_channel_id
        }),
        () => rating(ctx, {
          method: 'like_cancel',
          id: article.article_id,
          channelId: article.article_channel_id
        }),
        () => rating(ctx, {
          method: 'like_create',
          id: article.article_id,
          channelId: article.article_channel_id
        }),
        () => rating(ctx, {
          method: 'like_cancel',
          id: article.article_id,
          channelId: article.article_channel_id
        })
      ]);
    }
    return await claimTaskReward(ctx, task);
}

async function doFavoriteTask(ctx, task) {
    ctx.$env.log(`开始任务: ${task.task_name}`);

    let articleId = '';
    let channelId = '';

    if (task.task_redirect_url.link_type === 'lanmu') {
      // 从栏目获取文章
      const articles = await getArticleListFromLanmu(ctx, task.task_redirect_url.link_val, 20);

      if (articles.length < 1) {
        return {
          isSuccess: false
        };
      }

      const article = getOneByRandom(ctx, articles);

      articleId = article.article_id;
      channelId = article.article_channel_id;
    }
    else if (task.task_redirect_url.link_type === 'tag') {
      // 从 Tag 获取文章
      const articles = await getArticleListFromTag(ctx, task.task_redirect_url.link_val, task.task_redirect_url.link_title, 20);

      if (articles.length < 1) {
        return {
          isSuccess: false
        };
      }

      const article = getOneByRandom(ctx, articles);

      articleId = article.article_id;
      channelId = article.article_channel_id;
    }
    else if (task.task_redirect_url.link_val == '0' || !task.task_redirect_url.link_val) {
      // 随机选一篇文章
      const articles = await getArticleList(ctx, 20);

      if (articles.length < 1) {
        return {
          isSuccess: false
        };
      }

      const article = getOneByRandom(ctx, articles);

      articleId = article.article_id;
      channelId = article.article_channel_id;
    }
    else {
      articleId = task.task_redirect_url.link_val;

      // 获取文章信息
      const articleDetail = await getArticleDetail(ctx, articleId);

      if (articleDetail === false) {
        return {
          isSuccess: false
        };
      }

      channelId = articleDetail.channel_id;
    }

    await runActionSequence(ctx, [
      () => favorite(ctx, {
        method: 'destroy',
        id: articleId,
        channelId
      }),
      () => favorite(ctx, {
        method: 'create',
        id: articleId,
        channelId
      }),
      () => favorite(ctx, {
        method: 'destroy',
        id: articleId,
        channelId
      })
    ]);
    return await claimTaskReward(ctx, task);
}

async function doFollowUserTask(ctx, task) {
    ctx.$env.log(`开始任务: ${task.task_name}`);

    // 随机选一个用户
    const user = await getUserByRandom(ctx);

    if (!user) {
      return {
        isSuccess: false
      };
    }

    await wait(3, 10);

    for (let i = 0; i < Number(task.task_even_num - task.task_finished_num); i++) {
      if (user.is_follow == '1') {
        await follow(ctx, {
          method: 'destroy',
          type: 'user',
          keyword: user.keyword
        });

        await wait(3, 10);
      }

      await follow(ctx, {
        method: 'create',
        type: 'user',
        keyword: user.keyword
      });

      await wait(3, 10);

      if (user.is_follow == '0') {
        await follow(ctx, {
          method: 'destroy',
          type: 'user',
          keyword: user.keyword
        });
      }

      await wait(3, 10);
    }
    return await claimTaskReward(ctx, task);
}

async function doFollowTagTask(ctx, task) {
    ctx.$env.log(`开始任务: ${task.task_name}`);

    let lanmuId = '';

    if (task.task_redirect_url.link_val == '0') {
      const tag = await getTagByRandom(ctx);

      if (tag === false) {
        return {
          isSuccess: false
        };
      }

      lanmuId = tag.lanmu_id;

      await wait(3, 10);
    }
    else {
      lanmuId = task.task_redirect_url.link_val;
    }

    // 获取栏目信息
    const tagDetail = await getTagDetail(ctx, lanmuId);

    if (!tagDetail.lanmu_id) {
      ctx.$env.log('获取栏目信息失败！');

      return {
        isSuccess: false
      };
    }

    await wait(3, 10);

    await follow(ctx, {
      method: 'destroy',
      type: 'tag',
      keywordId: tagDetail.lanmu_id,
      keyword: tagDetail.lanmu_info.lanmu_name
    });

    await wait(3, 10);

    await follow(ctx, {
      method: 'create',
      type: 'tag',
      keywordId: tagDetail.lanmu_id,
      keyword: tagDetail.lanmu_info.lanmu_name
    });

    await wait(3, 10);

    await follow(ctx, {
      method: 'destroy',
      type: 'tag',
      keywordId: tagDetail.lanmu_id,
      keyword: tagDetail.lanmu_info.lanmu_name
    });
    return await claimTaskReward(ctx, task);
}

async function doFollowBrandTask(ctx, task) {
    ctx.$env.log(`开始任务: ${task.task_name}`);

    // 获取品牌信息
    const brandDetail = await getBrandDetail(ctx, task.task_redirect_url.link_val);

    if (!brandDetail.id) {
      return {
        isSuccess: false
      };
    }

    await wait(3, 10);

    await followBrand(ctx, {
      method: 'dingyue_lanmu_del',
      keywordId: brandDetail.id,
      keyword: brandDetail.title
    });

    await wait(3, 10);

    await followBrand(ctx, {
      method: 'dingyue_lanmu_add',
      keywordId: brandDetail.id,
      keyword: brandDetail.title
    });

    await wait(3, 10);

    await followBrand(ctx, {
      method: 'dingyue_lanmu_del',
      keywordId: brandDetail.id,
      keyword: brandDetail.title
    });
    return await claimTaskReward(ctx, task);
}

async function doCrowdTask(ctx, task) {
    ctx.$env.log(`开始任务: ${task.task_name}`);

    let { isSuccess, data } = await getCrowd(ctx, '免费', 0);

    if (!isSuccess) {
      if (RUNTIME_ENV.SMZDM_CROWD_SILVER_5 == 'yes') {
        ({ isSuccess, data } = await getCrowd(ctx, '5碎银子', 5));

        if (!isSuccess) {
          return {
            isSuccess,
            code: 99
          };
        }
      }
      else {
        ctx.$env.log('🟡请设置 SMZDM_CROWD_SILVER_5 环境变量值为 yes 后才能进行5碎银子抽奖！');

        return {
          isSuccess,
          code: 99
        };
      }
    }

    await wait(5, 15);

    const result = await joinCrowd(ctx, data);

    if (!result.isSuccess) {
      return {
        isSuccess: result.isSuccess
      };
    }
    return await claimTaskReward(ctx, task);
}

async function doShareTask(ctx, task) {
    ctx.$env.log(`开始任务: ${task.task_name}`);

    const articles = await getTaskArticles(ctx, task, task.task_even_num - task.task_finished_num);

    for (let i = 0; i < articles.length; i++) {
      ctx.$env.log(`开始分享第 ${i + 1} 篇文章...`);

      const article = articles[i];

      if (task.task_redirect_url.link_type != 'other') {
        // 模拟打开文章
        await openTaskArticle(ctx, task, article);
        await wait(8, 20);
      }

      await shareArticleDone(ctx, article.article_id, article.article_channel_id);
      await shareDailyReward(ctx, article.article_channel_id);
      await shareCallback(ctx, article.article_id, article.article_channel_id);

      await wait(5, 15);
    }
    return await claimTaskReward(ctx, task, 3, 10);
}

async function doViewTask(ctx, task) {
    ctx.$env.log(`开始任务: ${task.task_name}`);

    const isRead = task.article_id == '0' || task.task_redirect_url.link_val != '';
    const articles = await getTaskArticles(ctx, task, task.task_even_num - task.task_finished_num, true);

    for (let i = 0; i < articles.length; i++) {
      ctx.$env.log(`开始阅读第 ${i + 1} 篇文章...`);

      const article = articles[i];

      if (isRead) {
        // 模拟打开文章
        await openTaskArticle(ctx, task, article);
      }

      ctx.$env.log('模拟阅读文章');
      await wait(20, 50);

      const { isSuccess, response } = await postApi('https://user-api.smzdm.com/task/event_view_article_sync', {
        headers: getHeaders(ctx),
        data: {
          article_id: article.article_id,
          channel_id: article.article_channel_id,
          task_id: task.task_id
        }
      });

      if (isSuccess) {
        ctx.$env.log('完成阅读成功。');
      }
      else {
        ctx.$env.log(`完成阅读失败！${response}`);
      }

      await wait(5, 15);
    }
    return await claimTaskReward(ctx, task, 3, 10);
}

async function follow(ctx, {keywordId, keyword, type, method}) {
    let touchstone = '';

    if (type === 'user') {
      touchstone = getTouchstoneEvent(ctx, {
        event_value: {
          cid: 'null',
          is_detail: false,
          p: '1'
        },
        sourceMode: '我的_我的任务页',
        sourcePage: 'Android/关注/达人/爆料榜',
        upperLevel_url: '关注/达人/推荐/'
      });
    }
    else if (type === 'tag') {
      touchstone = getTouchstoneEvent(ctx, {
        event_value: {
          cid: 'null',
          is_detail: false
        },
        sourceMode: '栏目页',
        sourcePage: `Android/栏目页/${keyword}/${keywordId}/`,
        source_page_type_id: String(keywordId),
        upperLevel_url: '个人中心/赚奖励/',
        source_area: {
          lanmu_id: String(keywordId),
          prev_source_scence: '我的_我的任务页'
        }
      });
    }

    const { isSuccess, response } = await postApi(`https://dingyue-api.smzdm.com/dingyue/${method}`, {
      headers: getHeaders(ctx),
      data: {
        touchstone_event: touchstone,
        refer: '',
        keyword_id: keywordId,
        keyword,
        type
      }
    });

    if (isSuccess) {
      ctx.$env.log(`${method} 关注成功: ${keyword}`);
    }
    else {
      ctx.$env.log(`${method} 关注失败！${response}`);
    }

    return {
      isSuccess,
      response
    };
}

async function getUserByRandom(ctx) {
    const { isSuccess, data, response } = await postApi('https://dingyue-api.smzdm.com/tuijian/search_result', {
      headers: getHeaders(ctx),
      data: {
        nav_id: 0,
        page: 1,
        type: 'user',
        time_code: ''
      }
    });

    if (isSuccess) {
      return data.data.rows[Math.floor(Math.random() * data.data.rows.length)];
    }
    else {
      ctx.$env.log(`获取用户列表失败！${response}`);

      return false;
    }
}

async function joinCrowd(ctx, id) {
    const { isSuccess, data, response } = await postApi('https://zhiyou.m.smzdm.com/user/crowd/ajax_participate', {
      sign: false,
      headers: {
        ...getHeadersForWeb(ctx),
        Origin: 'https://zhiyou.m.smzdm.com',
        Referer: `https://zhiyou.m.smzdm.com/user/crowd/p/${id}/`
      },
      data: {
        crowd_id: id,
        sourcePage: `https://zhiyou.m.smzdm.com/user/crowd/p/${id}/`,
        client_type: 'android',
        sourceRoot: '个人中心',
        sourceMode: '幸运屋抽奖',
        price_id: 1
      }
    });

    if (isSuccess) {
      ctx.$env.log(removeTags(data.data.msg));
    }
    else {
      ctx.$env.log(`参加免费抽奖失败: ${response}`);
    }

    return {
      isSuccess,
      response
    };
}

async function getCrowd(ctx, name, price) {
    const { isSuccess, data, response } = await requestApi('https://zhiyou.smzdm.com/user/crowd/', {
      sign: false,
      parseJSON: false,
      headers: getHeadersForWeb(ctx)
    });

    const re = new RegExp(`<button\\s+([^>]+?)>\\s+?<div\\s+[^>]+?>\\s*${name}(?:抽奖)?\\s*<\\/div>\\s+<span\\s+class="reduceNumber">-${price}<\\/span>[\\s\\S]+?<\\/button>`, 'ig');

    if (isSuccess) {
      const crowds = [];
      let match;

      while ((match = re.exec(data)) !== null) {
        crowds.push(match[1]);
      }

      if (crowds.length < 1) {
        ctx.$env.log(`未找到${name}抽奖`);

        return {
          isSuccess: false
        };
      }

      let crowd;

      if (price > 0 && RUNTIME_ENV.SMZDM_CROWD_KEYWORD) {
        crowd = crowds.find((item) => {
          const match = item.match(/data-title="([^"]+)"/i);

          return (match && match[1].indexOf(RUNTIME_ENV.SMZDM_CROWD_KEYWORD) >= 0);
        });

        if (!crowd) {
          ctx.$env.log('未找到符合关键词的抽奖，执行随机选取');
          crowd = getOneByRandom(ctx, crowds);
        }
      }
      else {
        crowd = getOneByRandom(ctx, crowds);
      }

      const matchCrowd = crowd.match(/data-crowd_id="(\d+)"/i);

      if (matchCrowd) {
        ctx.$env.log(`${name}抽奖ID: ${matchCrowd[1]}`);

        return {
          isSuccess: true,
          data: matchCrowd[1]
        };
      }
      else {
        ctx.$env.log(`未找到${name}抽奖ID`);

        return {
          isSuccess: false
        };
      }
    }
    else {
      ctx.$env.log(`获取${name}抽奖失败: ${response}`);

      return {
        isSuccess: false
      };
    }
}

async function shareArticleDone(ctx, articleId, channelId) {
    const { isSuccess, response } = await postApi('https://user-api.smzdm.com/share/complete_share_rule', {
      headers: getHeaders(ctx),
      data: {
        token: ctx.token,
        article_id: articleId,
        channel_id: channelId,
        tag_name: 'gerenzhongxin'
      }
    });

    if (isSuccess) {
      ctx.$env.log('完成分享成功。');

      return {
        isSuccess,
        msg: '完成分享成功。'
      };
    }
    else {
      ctx.$env.log(`完成分享失败！${response}`);

      return {
        isSuccess: false,
        msg: '完成分享失败！'
      };
    }
}

async function shareCallback(ctx, articleId, channelId) {
    const { isSuccess, response } = await postApi('https://user-api.smzdm.com/share/callback', {
      headers: getHeaders(ctx),
      data: {
        token: ctx.token,
        article_id: articleId,
        channel_id: channelId,
        touchstone_event: getTouchstoneEvent(ctx, {
          event_value: {
            aid: articleId,
            cid: channelId,
            is_detail: true,
            pid: '无'
          },
          sourceMode: '排行榜_社区_好文精选',
          sourcePage: `Android/长图文/P/${articleId}/`,
          upperLevel_url: '排行榜/社区/好文精选/文章_24H/'
        })
      }
    });

    if (isSuccess) {
      ctx.$env.log('分享回调完成。');

      return {
        isSuccess,
        msg: ''
      };
    }
    else {
      ctx.$env.log(`分享回调失败！${response}`);

      return {
        isSuccess,
        msg: '分享回调失败！'
      };
    }
}

async function shareDailyReward(ctx, channelId) {
    const { isSuccess, data, response } = await postApi('https://user-api.smzdm.com/share/daily_reward', {
      headers: getHeaders(ctx),
      data: {
        token: ctx.token,
        channel_id: channelId
      }
    });

    if (isSuccess) {
      ctx.$env.log(data.data.reward_desc);

      return {
        isSuccess,
        msg: data.data.reward_desc
      };
    }
    else {
      if (data) {
        ctx.$env.log(data.error_msg);

        return {
          isSuccess,
          msg: data.error_msg
        };
      }
      else {
        ctx.$env.log(`分享每日奖励请求失败！${response}`);

        return {
          isSuccess,
          msg: '分享每日奖励请求失败！'
        };
      }
    }
}

async function getArticleList(ctx, num = 1) {
    const { isSuccess, data, response } = await requestApi('https://article-api.smzdm.com/ranking_list/articles', {
      headers: getHeaders(ctx),
      data: {
        offset: 0,
        channel_id: 76,
        tab: 2,
        order: 0,
        limit: 20,
        exclude_article_ids: '',
        stream: 'a',
        ab_code: 'b'
      }
    });

    if (isSuccess) {
      // 取前 num 个做任务
      return data.data.rows.slice(0, num);
    }
    else {
      ctx.$env.log(`获取文章列表失败: ${response}`);
      return [];
    }
}

async function getRobotToken(ctx) {
    const { isSuccess, data, response } = await postApi('https://user-api.smzdm.com/robot/token', {
      headers: getHeaders(ctx)
    });

    if (isSuccess) {
      return data.data.token;
    }
    else {
      ctx.$env.log(`Robot Token 获取失败！${response}`);

      return false;
    }
}

async function getTagDetail(ctx, id) {
    const { isSuccess, data, response } = await requestApi('https://common-api.smzdm.com/lanmu/config_data', {
      headers: getHeaders(ctx),
      data: {
        middle_page: '',
        tab_selects: '',
        redirect_params: id
      }
    });

    if (isSuccess) {
      return data.data;
    }
    else {
      ctx.$env.log(`获取栏目信息失败！${response}`);

      return {};
    }
}

async function getTagByRandom(ctx) {
    const { isSuccess, data, response } = await requestApi('https://dingyue-api.smzdm.com/tuijian/search_result', {
      headers: getHeaders(ctx),
      data: {
        time_code: '',
        nav_id: '',
        type: 'tag',
        limit: 20
      }
    });

    if (isSuccess) {
      return data.data.rows[Math.floor(Math.random() * data.data.rows.length)];
    }
    else {
      ctx.$env.log(`获取栏目列表失败！${response}`);

      return false;
    }
}

async function getArticleDetail(ctx, id) {
    const { isSuccess, data, response } = await requestApi(`https://article-api.smzdm.com/article_detail/${id}`, {
      headers: getHeaders(ctx),
      data: {
        comment_flow: '',
        hashcode: '',
        lastest_update_time: '',
        uhome: 0,
        imgmode: 0,
        article_channel_id: 0,
        h5hash: ''
      }
    });

    if (isSuccess) {
      return data.data;
    }
    else {
      ctx.$env.log(`获取文章详情失败！${response}`);

      return false;
    }
}

async function getHaojiaDetail(ctx, id) {
    const { isSuccess, data, response } = await requestApi(`https://haojia-api.smzdm.com/detail/${id}`, {
      headers: getHeaders(ctx),
      data: {
        imgmode: 0,
        hashcode: '',
        h5hash: ''
      }
    });

    if (isSuccess) {
      return data.data;
    }
    else {
      ctx.$env.log(`获取好价详情失败！${response}`);

      return false;
    }
}

async function favorite(ctx, {id, channelId, method}) {
    const { isSuccess, response } = await postApi(`https://user-api.smzdm.com/favorites/${method}`, {
      headers: getHeaders(ctx),
      data: {
        touchstone_event: getTouchstoneEvent(ctx, {
          event_value: {
            aid: id,
            cid: channelId,
            is_detail: true
          },
          sourceMode: '我的_我的任务页',
          sourcePage: `Android/长图文/P/${id}/`,
          upperLevel_url: '个人中心/赚奖励/'
        }),
        token: ctx.token,
        id,
        channel_id: channelId
      }
    });

    if (isSuccess) {
      ctx.$env.log(`${method} 收藏成功: ${id}`);
    }
    else {
      ctx.$env.log(`${method} 收藏失败！${response}`);
    }

    return {
      isSuccess,
      response
    };
}

function getTouchstoneEvent(ctx, obj) {
    const defaultObj = {
      search_tv: 'f',
      sourceRoot: '个人中心',
      trafic_version: '113_a,115_b,116_e,118_b,131_b,132_b,134_b,136_b,139_a,144_a,150_b,153_a,179_a,183_b,185_b,188_b,189_b,193_a,196_b,201_a,204_a,205_a,208_b,222_b,226_a,228_a,22_b,230_b,232_b,239_b,254_a,255_b,256_b,258_b,260_b,265_a,267_a,269_a,270_c,273_b,276_a,278_a,27_a,280_a,281_a,283_b,286_a,287_a,290_a,291_b,295_a,302_a,306_b,308_b,312_b,314_a,317_a,318_a,322_b,325_a,326_a,329_b,32_c,332_b,337_c,341_a,347_a,349_b,34_a,351_a,353_b,355_a,357_b,366_b,373_B,376_b,378_b,380_b,388_b,391_b,401_d,403_b,405_b,407_b,416_a,421_a,424_b,425_b,427_a,436_b,43_j,440_a,442_a,444_b,448_a,450_b,451_b,454_b,455_a,458_c,460_a,463_c,464_b,466_b,467_b,46_a,470_b,471_b,474_b,475_a,484_b,489_a,494_b,496_b,498_a,500_a,503_b,507_b,510_bb,512_b,515_a,520_a,522_b,525_c,527_b,528_a,59_a,65_b,85_b,102_b,103_a,106_b,107_b,10_f,11_b,120_a,143_b,157_g,158_c,159_c,160_f,161_d,162_e,163_a,164_a,165_a,166_f,171_a,174_a,175_e,176_d,209_b,225_a,235_a,236_b,237_c,272_b,296_c,2_f,309_a,315_b,334_a,335_d,339_b,346_b,361_b,362_d,367_b,368_a,369_e,374_b,381_c,382_b,383_d,385_b,386_c,389_i,38_b,390_d,396_a,398_b,3_a,413_a,417_a,418_c,419_b,420_b,422_e,428_a,430_a,431_d,432_e,433_a,437_b,438_c,478_b,479_b,47_a,480_a,481_b,482_a,483_a,488_b,491_j,492_j,504_b,505_a,514_a,518_b,52_d,53_d,54_v,55_z1,56_z3,66_a,67_i,68_a1,69_i,74_i,77_d,93_a',
      tv: 'z1'
    };

    return JSON.stringify({...defaultObj, ...obj});
}

async function followBrand(ctx, {keywordId, keyword, method}) {
    const touchstone = getTouchstoneEvent(ctx, {
      event_value: {
        cid: '44',
        is_detail: true,
        aid: String(keywordId)
      },
      sourceMode: '百科_品牌详情页',
      sourcePage: `Android/其他/品牌详情页/${keyword}/${keywordId}/`,
      upperLevel_url: '个人中心/赚奖励/'
    });

    const { isSuccess, response } = await postApi(`https://dingyue-api.smzdm.com/dy/util/api/user_action`, {
      headers: getHeaders(ctx),
      data: {
        action: method,
        params: JSON.stringify({
          keyword: keywordId,
          keyword_id: keywordId,
          type: 'brand'
        }),
        refer: `Android/其他/品牌详情页/${keyword}/${keywordId}/`,
        touchstone_event: touchstone
      }
    });

    if (isSuccess) {
      ctx.$env.log(`${method} 关注成功: ${keyword}`);
    }
    else {
      ctx.$env.log(`${method} 关注失败！${response}`);
    }

    return {
      isSuccess,
      response
    };
}

async function getBrandDetail(ctx, id) {
    const { isSuccess, data, response } = await requestApi('https://brand-api.smzdm.com/brand/brand_basic', {
      headers: getHeaders(ctx),
      data: {
        brand_id: id
      }
    });

    if (isSuccess) {
      return data.data;
    }
    else {
      ctx.$env.log(`获取品牌信息失败！${response}`);

      return {};
    }
}

async function getArticleListFromLanmu(ctx, id, num = 1) {
    const lanmuDetail = await getTagDetail(ctx, id);

    if (!lanmuDetail.lanmu_id) {
      return [];
    }

    const { isSuccess, data, response } = await requestApi('https://common-api.smzdm.com/lanmu/list_data', {
      headers: getHeaders(ctx),
      data: {
        price_lt: '',
        order: '',
        category_ids: '',
        price_gt: '',
        referer_article: '',
        tag_params: '',
        mall_ids: '',
        time_sort: '',
        page: 1,
        params: id,
        limit: 20,
        tab_params: lanmuDetail.tab[0].params
      }
    });

    if (isSuccess) {
      // 取前 num 个做任务
      return data.data.rows.slice(0, num);
    }
    else {
      ctx.$env.log(`获取文章列表失败: ${response}`);
      return [];
    }
}

async function rating(ctx, {id, channelId, method, type}) {
    const { isSuccess, response } = await postApi(`https://user-api.smzdm.com/rating/${method}`, {
      headers: getHeaders(ctx),
      data: {
        touchstone_event: getTouchstoneEvent(ctx, {
          event_value: {
            aid: id,
            cid: channelId,
            is_detail: true
          },
          sourceMode: '栏目页',
          sourcePage: `Android//P/${id}/`,
          upperLevel_url: '栏目页///'
        }),
        token: ctx.token,
        id,
        channel_id: channelId,
        wtype: type
      }
    });

    if (isSuccess) {
      ctx.$env.log(`${method} 点赞成功: ${id}`);
    }
    else {
      ctx.$env.log(`${method} 点赞失败！${response}`);
    }

    return {
      isSuccess,
      response
    };
}

async function submitComment(ctx, { articleId, channelId, content }) {
    const { isSuccess, data, response } = await postApi('https://comment-api.smzdm.com/comments/submit', {
      headers: getHeaders(ctx),
      data: {
        touchstone_event: getTouchstoneEvent(ctx, {
          event_value: {
            aid: articleId,
            cid: channelId,
            is_detail: true
          },
          sourceMode: '好物社区_全部',
          sourcePage: `Android/长图文/${articleId}/评论页/`,
          upperLevel_url: '好物社区/首页/全部/',
          sourceRoot: '社区'
        }),
        is_like: 3,
        reply_from: 3,
        smiles: 0,
        atta: 0,
        parentid: 0,
        token: ctx.token,
        article_id: articleId,
        channel_id: channelId,
        content
      }
    });

    if (isSuccess) {
      ctx.$env.log(`评论发表成功: ${data.data.comment_ID}`);
    }
    else {
      ctx.$env.log(`评论发表失败！${response}`);
    }

    return {
      isSuccess,
      data,
      response
    };
}

async function removeComment(ctx, id) {
    const { isSuccess, response } = await postApi('https://comment-api.smzdm.com/comments/delete_comment', {
      headers: getHeaders(ctx),
      data: {
        comment_id: id
      }
    });

    if (isSuccess) {
      ctx.$env.log(`评论删除成功: ${id}`);
    }
    else {
      ctx.$env.log(`评论删除失败！${response}`);
    }

    return {
      isSuccess,
      response
    };
}

async function getDingyueStatus(ctx, name) {
    const { isSuccess, data, response } = await postApi('https://dingyue-api.smzdm.com/dingyue/follow_status', {
      headers: getHeaders(ctx),
      data: {
        rules: JSON.stringify([{
          type: 'tag',
          keyword: name
        }])
      }
    });

    if (isSuccess) {
      return data;
    }
    else {
      ctx.$env.log(`获取订阅状态失败: ${response}`);
      return {};
    }
}

async function getArticleListFromTag(ctx, id, name, num = 1) {
    const status = await getDingyueStatus(ctx, name);

    const { isSuccess, data, response } = await requestApi('https://tag-api.smzdm.com/theme/detail_feed', {
      headers: getHeaders(ctx),
      data: {
        article_source: 1,
        past_num: 0,
        feed_sort: 2,
        smzdm_id: status.smzdm_id,
        tag_id: id,
        name,
        time_sort: 0,
        page: 1,
        article_tab: 0,
        limit: 20
      }
    });

    if (isSuccess) {
      // 取前 num 个做任务
      return data.data.rows.slice(0, num);
    }
    else {
      ctx.$env.log(`获取文章列表失败: ${response}`);
      return [];
    }
}

async function getArticleChannelIdForTesting(ctx, url) {
    const { isSuccess, response } = await requestApi(url, {
      method: 'get',
      headers: getHeaders(ctx),
      parseJSON: false,
      sign: false
    });

    if (!isSuccess) {
      ctx.$env.log(`获取文章信息失败！${response}`);

      return false;
    }

    // 通过正则提取页面中的 channel_id
    const re = /'channel_id'\s*:\s*'(\d+)'/;
    const matchRet = response.match(re);

    if (!matchRet) {
      ctx.$env.log(`获取文章信息失败！${response}`);

      return false;
    }

    return matchRet[1];
}



async function runAccount(ctx) {
        let notifyMsg = '';

        const { msg: msg1 } = await checkin(ctx);
        notifyMsg += msg1 || '';

        await wait(2, 4);
        const { msg: msg2 } = await allReward(ctx);
        notifyMsg += msg2 || '';

        await wait(2, 4);
        const { msg: msg3 } = await extraReward(ctx);
        notifyMsg += msg3 || '';

        await wait(3, 5);
        notifyMsg += await runTasks(ctx);

        return notifyMsg.trim();
}

async function runTasks(ctx) {
        $.log('获取任务列表');
        const { tasks, detail } = await getTaskList(ctx);
        if (!tasks.length) {
            return '🟡 未获取到可执行任务\n';
        }

        await wait(3, 5);
        let notifyMsg = await doTasks(ctx, tasks);

        $.log('查询是否有限时累计活动阶段奖励');
        await wait(3, 5);
        if (detail?.cell_data && detail.cell_data.activity_reward_status == '1') {
            $.log('有奖励，领取奖励');
            await wait(3, 5);
            const { isSuccess } = await receiveActivity(ctx, detail.cell_data);
            notifyMsg += `${isSuccess ? '🟢' : '❌'}限时累计活动阶段奖励领取${isSuccess ? '成功' : '失败！请查看日志'}\n`;
        } else {
            $.log('无阶段奖励');
        }

        return notifyMsg || '无可执行任务\n';
}

async function checkin(ctx) {
        const { isSuccess, data, response } = await postApi('https://user-api.smzdm.com/checkin', {
            headers: getHeaders(ctx),
            data: {
                touchstone_event: '',
                sk: ctx.sk || '1',
                token: ctx.token,
                captcha: ''
            }
        });

        if (isSuccess) {
            let msg = `⭐ 签到成功 ${data.data.daily_num} 天\n🏅 金币: ${data.data.cgold}\n🏅 碎银: ${data.data.pre_re_silver}\n🏅 补签卡: ${data.data.cards}`;
            await wait(2, 4);
            const vip = await getVipInfo(ctx);
            if (vip?.vip) {
                msg += `\n🏅 经验: ${vip.vip.exp_current}\n🏅 值会员等级: ${vip.vip.exp_level}\n🏅 值会员经验: ${vip.vip.exp_current_level}\n🏅 值会员有效期至: ${vip.vip.exp_level_expire}`;
            }
            $.log(`${msg}\n`);
            return {
                isSuccess,
                msg: `${msg}\n\n`
            };
        }

        $.log(`签到失败！${response}`);
        return {
            isSuccess,
            msg: '❌ 签到失败！\n'
        };
}

async function allReward(ctx) {
        const { isSuccess, data, response } = await postApi('https://user-api.smzdm.com/checkin/all_reward', {
            headers: getHeaders(ctx),
            debug: $.is_debug === 'true'
        });

        if (isSuccess) {
            const msg1 = `${data.data.normal_reward.reward_add.title}: ${data.data.normal_reward.reward_add.content}`;
            const msg2 = data.data.normal_reward.gift.title ? `${data.data.normal_reward.gift.title}: ${data.data.normal_reward.gift.content_str}` : `${data.data.normal_reward.gift.sub_content}`;
            $.log(`${msg1}\n${msg2}\n`);
            return {
                isSuccess,
                msg: `${msg1}\n${msg2}\n\n`
            };
        }

        if (`${data?.error_code ?? ''}` !== '4') {
            $.log(`查询奖励失败！${response}`);
        }
        return {
            isSuccess,
            msg: ''
        };
}

async function extraReward(ctx) {
        const isContinue = await isContinueCheckin(ctx);
        if (!isContinue) {
            const msg = '今天没有额外奖励';
            $.log(`${msg}\n`);
            return {
                isSuccess: false,
                msg: `${msg}\n`
            };
        }

        await wait(3, 5);
        const { isSuccess, data, response } = await postApi('https://user-api.smzdm.com/checkin/extra_reward', {
            headers: getHeaders(ctx)
        });

        if (isSuccess) {
            const msg = `${data.data.title}: ${removeTags(data.data.gift.content)}`;
            $.log(msg);
            return {
                isSuccess: true,
                msg: `${msg}\n`
            };
        }

        $.log(`领取额外奖励失败！${response}`);
        return {
            isSuccess: false,
            msg: ''
        };
}

async function isContinueCheckin(ctx) {
        const { isSuccess, data, response } = await postApi('https://user-api.smzdm.com/checkin/show_view_v2', {
            headers: getHeaders(ctx)
        });

        if (isSuccess) {
            const result = (data.data.rows || []).find(item => item.cell_type == '18001');
            return Boolean(result?.cell_data?.checkin_continue?.continue_checkin_reward_show);
        }

        $.log(`查询是否有额外奖励失败！${response}`);
        return false;
}

async function getVipInfo(ctx) {
        const { isSuccess, data, response } = await postApi('https://user-api.smzdm.com/vip', {
            headers: getHeaders(ctx),
            data: {
                token: ctx.token
            }
        });

        if (isSuccess) {
            return data.data;
        }

        $.log(`查询信息失败！${response}`);
        return false;
}

async function getTaskList(ctx) {
        const { isSuccess, data, response } = await postApi('https://user-api.smzdm.com/task/list_v2', {
            headers: getHeaders(ctx)
        });

        if (isSuccess && data.data.rows[0]?.cell_data?.activity_task?.default_list_v2) {
            let tasks = [];
            data.data.rows[0].cell_data.activity_task.default_list_v2.forEach(item => {
                tasks = tasks.concat(item.task_list);
            });
            return {
                tasks,
                detail: data.data.rows[0]
            };
        }

        $.log(`任务列表获取失败！${response}`);
        return {
            tasks: [],
            detail: {}
        };
}

async function receiveActivity(ctx, activity) {
        $.log(`领取奖励: ${activity.activity_name}`);
        const { isSuccess, data, response } = await postApi('https://user-api.smzdm.com/task/activity_receive', {
            headers: getHeaders(ctx),
            data: {
                activity_id: activity.activity_id
            }
        });

        if (isSuccess) {
            $.log(removeTags(data.data.reward_msg));
            return { isSuccess };
        }

        $.log(`领取奖励失败！${response}`);
        return { isSuccess };
}

async function receiveReward(ctx, taskId) {
        const robotToken = await getRobotToken(ctx);
        if (robotToken === false) {
            return {
                isSuccess: false,
                msg: '领取任务奖励失败！'
            };
        }

        const { isSuccess, data, response } = await postApi('https://user-api.smzdm.com/task/activity_task_receive', {
            headers: getHeaders(ctx),
            data: {
                robot_token: robotToken,
                geetest_seccode: '',
                geetest_validate: '',
                geetest_challenge: '',
                captcha: '',
                task_id: taskId
            }
        });

        if (isSuccess) {
            const msg = removeTags(data.data.reward_msg);
            $.log(msg);
            return {
                isSuccess,
                msg
            };
        }

        $.log(`领取任务奖励失败！${response}`);
        return {
            isSuccess,
            msg: '领取任务奖励失败！'
        };
}


async function main() {
    const users = loadUsers();
    if (!users.length) {
        throw new Error('未找到 smzdm_data 或 SMZDM_COOKIE 变量 ❌');
    }

    $.log(`\n🌀 找到 ${users.length} 个账号`);
    for (let i = 0; i < users.length; i += 1) {
        const user = users[i];
        $.beforeMsgs = '';
        $.messages = [];
        $.log(`\n----- ${buildAccountTitle(user, i)} 开始执行 -----\n`);
        const ctx = createBotContext(user);
        const message = await runAccount(ctx);
        $.beforeMsgs = `账号: ${buildAccountTitle(user, i)}${user.updateTime ? `\n更新时间: ${user.updateTime}` : ''}`;
        $.messages.push(message || '无可执行结果');
        $.messages.splice(0, 0, $.beforeMsgs);
        $.Messages = $.Messages.concat($.messages.filter(Boolean));
    }
    $.log(`\n----- 所有账号执行完成 -----\n`);
}

// ??????
!(async () => {
    if (typeof $request !== 'undefined') {
        GetCookie();
    } else {
        await main();
    }
})()
    .catch((e) => $.Messages.push(e.message || e) && $.logErr(e))
    .finally(async () => {
        await sendMsg($.Messages.join('\n').trimStart().trimEnd());
        $.done();
    })

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

// ---------- Crypt: md5 (接口签名) / des-ecb (签到 sk 自动计算) ----------

function Crypt(type, a, b, c) { function MD5(string) { function RotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); } function AddUnsigned(lX, lY) { var lX4, lY4, lX8, lY8, lResult; lX8 = (lX & 0x80000000); lY8 = (lY & 0x80000000); lX4 = (lX & 0x40000000); lY4 = (lY & 0x40000000); lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF); if (lX4 & lY4) { return (lResult ^ 0x80000000 ^ lX8 ^ lY8); } if (lX4 | lY4) { if (lResult & 0x40000000) { return (lResult ^ 0xC0000000 ^ lX8 ^ lY8); } else { return (lResult ^ 0x40000000 ^ lX8 ^ lY8); } } else { return (lResult ^ lX8 ^ lY8); } } function F(x, y, z) { return (x & y) | ((~x) & z); } function G(x, y, z) { return (x & z) | (y & (~z)); } function H(x, y, z) { return (x ^ y ^ z); } function I(x, y, z) { return (y ^ (x | (~z))); } function FF(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function GG(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function HH(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function II(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function ConvertToWordArray(string) { var lWordCount; var lMessageLength = string.length; var lNumberOfWords_temp1 = lMessageLength + 8; var lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64; var lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16; var lWordArray = Array(lNumberOfWords - 1); var lBytePosition = 0; var lByteCount = 0; while (lByteCount < lMessageLength) { lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8; lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition)); lByteCount++; } lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8; lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition); lWordArray[lNumberOfWords - 2] = lMessageLength << 3; lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29; return lWordArray; }; function WordToHex(lValue) { var WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount; for (lCount = 0; lCount <= 3; lCount++) { lByte = (lValue >>> (lCount * 8)) & 255; WordToHexValue_temp = "0" + lByte.toString(16); WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2); } return WordToHexValue; }; function Utf8Encode(string) { string = string.replace(/\r\n/g, "\n"); var utftext = ""; for (var n = 0; n < string.length; n++) { var c = string.charCodeAt(n); if (c < 128) { utftext += String.fromCharCode(c); } else if ((c > 127) && (c < 2048)) { utftext += String.fromCharCode((c >> 6) | 192); utftext += String.fromCharCode((c & 63) | 128); } else { utftext += String.fromCharCode((c >> 12) | 224); utftext += String.fromCharCode(((c >> 6) & 63) | 128); utftext += String.fromCharCode((c & 63) | 128); } } return utftext; }; var x = Array(); var k, AA, BB, CC, DD, a, b, c, d; var S11 = 7, S12 = 12, S13 = 17, S14 = 22; var S21 = 5, S22 = 9, S23 = 14, S24 = 20; var S31 = 4, S32 = 11, S33 = 16, S34 = 23; var S41 = 6, S42 = 10, S43 = 15, S44 = 21; string = Utf8Encode(string); x = ConvertToWordArray(string); a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476; for (k = 0; k < x.length; k += 16) { AA = a; BB = b; CC = c; DD = d; a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478); d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756); c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB); b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE); a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF); d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A); c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613); b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501); a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8); d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF); c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1); b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE); a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122); d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193); c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E); b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821); a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562); d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340); c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51); b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA); a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D); d = GG(d, a, b, c, x[k + 10], S22, 0x2441453); c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681); b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8); a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6); d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6); c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87); b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED); a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905); d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8); c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9); b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A); a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942); d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681); c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122); b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C); a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44); d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9); c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60); b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70); a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6); d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA); c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085); b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05); a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039); d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5); c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8); b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665); a = II(a, b, c, d, x[k + 0], S41, 0xF4292244); d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97); c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7); b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039); a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3); d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92); c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D); b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1); a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F); d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0); c = II(c, d, a, b, x[k + 6], S43, 0xA3014314); b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1); a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82); d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235); c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB); b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391); a = AddUnsigned(a, AA); b = AddUnsigned(b, BB); c = AddUnsigned(c, CC); d = AddUnsigned(d, DD); } var temp = WordToHex(a) + WordToHex(b) + WordToHex(c) + WordToHex(d); return temp.toLowerCase(); } function _rsa(pem, string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function BytesToBigInt(bytes) { let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); return n; } function BigIntToBytes(n, len) { const out = new Array(len).fill(0); for (let i = len - 1; i >= 0 && n > 0n; i--) { out[i] = Number(n & 0xffn); n >>= 8n; } return out; } function ModPow(base, exp, mod) { let r = 1n; base %= mod; while (exp > 0n) { if (exp & 1n) r = (r * base) % mod; base = (base * base) % mod; exp >>= 1n; } return r; } function DerRead(buf, off) { const tag = buf[off++]; let len = buf[off++]; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + i]; off += n; } return { tag, start: off, len }; } function DerChildren(buf, start, end) { const list = []; let off = start; while (off < end) { const t = DerRead(buf, off); list.push(t); off = t.start + t.len; } return list; } if (!_rsa._k || _rsa._kp !== pem) { try { const der = Base64ToBytes(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); let seqs = DerChildren(der, DerRead(der, 0).start, der.length); const inner = seqs.find(s => s.tag === 0x04); if (inner) { const seq2 = DerRead(der, inner.start); seqs = DerChildren(der, seq2.start, seq2.start + seq2.len); } const ints = seqs.filter(s => s.tag === 0x02); const n = BytesToBigInt(der.slice(ints[1].start, ints[1].start + ints[1].len)); const d = BytesToBigInt(der.slice(ints[3].start, ints[3].start + ints[3].len)); _rsa._k = { n, d, k: (n.toString(16).length + 1) >> 1 }; _rsa._kp = pem; } catch (e) { $.logErr('❌ [签名] 私钥解析失败: ' + (e.message || e)); return null; } } const key = _rsa._k; try { const digestInfo = [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20, ...SHA256(Utf8Encode(string))]; const padded = [0x00, 0x01, ...new Array(key.k - digestInfo.length - 3).fill(0xff), 0x00, ...digestInfo]; const sig = ModPow(BytesToBigInt(padded), key.d, key.n); return BytesToBase64(BigIntToBytes(sig, key.k)).replace(/\//g, '_').replace(/\+/g, '-'); } catch (e) { $.logErr('❌ [签名] 签名异常: ' + (e.message || e)); return null; } } function _rsaenc(b64Pub, string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function BytesToBigInt(bytes) { let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); return n; } function BigIntToBytes(n, len) { const out = new Array(len).fill(0); for (let i = len - 1; i >= 0 && n > 0n; i--) { out[i] = Number(n & 0xffn); n >>= 8n; } return out; } function ModPow(base, exp, mod) { let r = 1n; base %= mod; while (exp > 0n) { if (exp & 1n) r = (r * base) % mod; base = (base * base) % mod; exp >>= 1n; } return r; } function DerRead(buf, off) { const tag = buf[off++]; let len = buf[off++]; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + i]; off += n; } return { tag, start: off, len }; } function DerChildren(buf, start, end) { const list = []; let off = start; while (off < end) { const t = DerRead(buf, off); list.push(t); off = t.start + t.len; } return list; } if (!_rsaenc._k || _rsaenc._kp !== b64Pub) { try { let der = Base64ToBytes(String(b64Pub).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); if (der.length > 5 && der.slice(0, 5).map(b => String.fromCharCode(b)).join('') === '-----') { der = Base64ToBytes(der.map(b => String.fromCharCode(b)).join('').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); } const outer = DerRead(der, 0); const bitStr = DerChildren(der, outer.start, outer.start + outer.len).find(s => s.tag === 0x03); let ints; if (bitStr) { const seq = DerRead(der, bitStr.start + 1); ints = DerChildren(der, seq.start, seq.start + seq.len).filter(s => s.tag === 0x02); } else { ints = DerChildren(der, outer.start, outer.start + outer.len).filter(s => s.tag === 0x02); if (ints.length < 2) throw new Error('公钥解析失败(支持 SPKI/PKCS#1)'); } const n = BytesToBigInt(der.slice(ints[0].start, ints[0].start + ints[0].len)); const e = BytesToBigInt(der.slice(ints[1].start, ints[1].start + ints[1].len)); _rsaenc._k = { n, e, k: (n.toString(16).length + 1) >> 1 }; _rsaenc._kp = b64Pub; } catch (err) { $.logErr('❌ [加密] 公钥解析失败: ' + (err.message || err)); return null; } } const key = _rsaenc._k; try { const msg = Utf8Encode(string); const psLen = key.k - msg.length - 3; if (psLen < 8) { $.logErr('❌ [加密] 明文超出 RSA 长度上限'); return null; } const ps = new Array(psLen); for (let i = 0; i < psLen; i++) ps[i] = 1 + Math.floor(Math.random() * 255); const padded = [0x00, 0x02, ...ps, 0x00, ...msg]; return BytesToBase64(BigIntToBytes(ModPow(BytesToBigInt(padded), key.e, key.n), key.k)); } catch (err) { $.logErr('❌ [加密] RSA 加密异常: ' + (err.message || err)); return null; } } function _hmac(b64Key, msg) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } let key = Utf8Encode(b64Key); if (key.length > 64) key = SHA256(key); while (key.length < 64) key.push(0); const inner = SHA256(key.map(b => b ^ 0x36).concat(Utf8Encode(msg))); const outer = SHA256(key.map(b => b ^ 0x5c).concat(inner)); return outer.map(b => b.toString(16).padStart(2, '0')).join(''); } function _aes(plain, keyStr, ivStr, ecb, ivp) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function BytesToBase64(bytes) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CHARS[b0 >> 2]; s += b1 === undefined ? CHARS[(b0 & 3) << 4] + '==' : b2 === undefined ? CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[(b1 & 15) << 2] + '=' : CHARS[((b0 & 3) << 4) | (b1 >> 4)] + CHARS[((b1 & 15) << 2) | (b2 >> 6)] + CHARS[b2 & 63]; } return s; } const SBOX = (function () { function gmul(a, b) { let p = 0; for (let i = 0; i < 8; i++) { if ((b >> i) & 1) p ^= a; a = ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; } return p; } const sbox = new Array(256); for (let x = 0; x < 256; x++) { let inv = 0; if (x !== 0) { inv = 1; while (gmul(inv, x) !== 1) inv++; } const r = (v, n) => ((v << n) | (v >> (8 - n))) & 0xff; sbox[x] = (inv ^ r(inv, 1) ^ r(inv, 2) ^ r(inv, 3) ^ r(inv, 4) ^ 0x63) & 0xff; } return sbox; })(); function expandKey(key) { const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]; const Nk = key.length >> 2, Nr = Nk + 6, tw = 4 * (Nr + 1); const w = []; for (let i = 0; i < Nk; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]); for (let i = Nk; i < tw; i++) { let t = w[i - 1].slice(); if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]].map(b => SBOX[b]); t[0] ^= RCON[i / Nk - 1]; } else if (Nk > 6 && i % Nk === 4) t = t.map(b => SBOX[b]); w.push([w[i - Nk][0] ^ t[0], w[i - Nk][1] ^ t[1], w[i - Nk][2] ^ t[2], w[i - Nk][3] ^ t[3]]); } const rk = []; for (let round = 0; round <= Nr; round++) { const blk = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) blk[4 * c + r] = w[4 * round + c][r]; rk.push(blk); } return { rk: rk, Nr: Nr }; } function encryptBlock(input, rk, Nr) { let s = input.slice(); const addRK = (round) => { for (let i = 0; i < 16; i++) s[i] ^= rk[round][i]; }; const xtime = (a) => ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; addRK(0); for (let round = 1; round <= Nr; round++) { for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]]; const t = s.slice(); for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) t[4 * c + r] = s[4 * ((c + r) % 4) + r]; s = t; if (round < Nr) { for (let c = 0; c < 4; c++) { const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3]; s[4 * c] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3; s[4 * c + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3; s[4 * c + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3); s[4 * c + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3); } } addRK(round); } return s; } const data = Utf8Encode(plain); const padLen = 16 - (data.length % 16); for (let i = 0; i < padLen; i++) data.push(padLen); const ks = expandKey(Utf8Encode(keyStr)); let prev = ecb ? null : Utf8Encode(ivStr).slice(0, 16); const out = ivp ? prev.slice() : []; for (let off = 0; off < data.length; off += 16) { const blk = new Array(16); for (let i = 0; i < 16; i++) blk[i] = data[off + i] ^ (ecb ? 0 : prev[i]); prev = encryptBlock(blk, ks.rk, ks.Nr); out.push(...prev); } return BytesToBase64(out); } function _aesdec(cipher, keyStr, ecb, hexIn) { function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } function HexToBytes(h) { const s = String(h).replace(/[^0-9a-fA-F]/g, ''); const bytes = []; for (let i = 0; i + 1 < s.length; i += 2) bytes.push(parseInt(s.substr(i, 2), 16)); if (s.length % 2) bytes.push(parseInt(s.slice(-1), 16)); return bytes; } function BytesToUtf8(bytes) { let s = ''; for (let i = 0; i < bytes.length;) { const b = bytes[i]; if (b < 128) { s += String.fromCharCode(b); i += 1; } else if (b >= 240 && i + 3 < bytes.length) { const cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); const v = cp - 0x10000; s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)); i += 4; } else if (b >= 224 && i + 2 < bytes.length) { s += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3; } else if (b >= 192 && i + 1 < bytes.length) { s += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2; } else { s += String.fromCharCode(b); i += 1; } } return s; } const SBOX = (function () { function gmul(a, b) { let p = 0; for (let i = 0; i < 8; i++) { if ((b >> i) & 1) p ^= a; a = ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; } return p; } const sbox = new Array(256); for (let x = 0; x < 256; x++) { let inv = 0; if (x !== 0) { inv = 1; while (gmul(inv, x) !== 1) inv++; } const r = (v, n) => ((v << n) | (v >> (8 - n))) & 0xff; sbox[x] = (inv ^ r(inv, 1) ^ r(inv, 2) ^ r(inv, 3) ^ r(inv, 4) ^ 0x63) & 0xff; } return sbox; })(); const INV_SBOX = (function () { const inv = new Array(256); for (let i = 0; i < 256; i++) inv[SBOX[i]] = i; return inv; })(); function expandKey(key) { const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]; const Nk = key.length >> 2, Nr = Nk + 6, tw = 4 * (Nr + 1); const w = []; for (let i = 0; i < Nk; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]); for (let i = Nk; i < tw; i++) { let t = w[i - 1].slice(); if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]].map(b => SBOX[b]); t[0] ^= RCON[i / Nk - 1]; } else if (Nk > 6 && i % Nk === 4) t = t.map(b => SBOX[b]); w.push([w[i - Nk][0] ^ t[0], w[i - Nk][1] ^ t[1], w[i - Nk][2] ^ t[2], w[i - Nk][3] ^ t[3]]); } const rk = []; for (let round = 0; round <= Nr; round++) { const blk = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) blk[4 * c + r] = w[4 * round + c][r]; rk.push(blk); } return { rk: rk, Nr: Nr }; } function decryptBlock(input, rk, Nr) { let s = input.slice(); const addRK = (round) => { for (let i = 0; i < 16; i++) s[i] ^= rk[round][i]; }; const xtime = (a) => ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; const mul = (a, b) => { let p = 0; for (let i = 0; i < 8; i++) { if ((b >> i) & 1) p ^= a; a = xtime(a); } return p; }; const irows = () => { const t = s.slice(); for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) t[4 * c + r] = s[4 * (((c - r) % 4 + 4) % 4) + r]; s = t; }; addRK(Nr); for (let round = Nr - 1; round >= 1; round--) { irows(); for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]; addRK(round); for (let c = 0; c < 4; c++) { const a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3]; s[4 * c] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9); s[4 * c + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13); s[4 * c + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11); s[4 * c + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14); } } irows(); for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]; addRK(0); return s; } const raw = hexIn ? HexToBytes(cipher) : Base64ToBytes(cipher); if (!raw.length || raw.length % 16) return ''; const ks = expandKey(function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; }(keyStr)); let prev = null, start = 0; if (!ecb) { prev = raw.slice(0, 16); start = 16; } const out = []; for (let off = start; off < raw.length; off += 16) { const blk = raw.slice(off, off + 16); const dec = decryptBlock(blk, ks.rk, ks.Nr); const plainBlk = ecb ? dec : dec.map((b, i) => b ^ prev[i]); out.push(...plainBlk); if (!ecb) prev = blk; } const padLen = out[out.length - 1]; if (padLen >= 1 && padLen <= 16 && out.length >= padLen) { let ok = true; for (let i = 0; i < padLen; i++) if (out[out.length - 1 - i] !== padLen) ok = false; if (ok) out.length -= padLen; } return BytesToUtf8(out); } function _sha256hex(string) { function Utf8Encode(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function SHA256(msg) { const K = [ 0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 ]; let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]; const rr = (x, n) => (x >>> n) | (x << (32 - n)); const data = msg.slice(); const bitLenHi = Math.floor(data.length / 536870912), bitLenLo = (data.length * 8) >>> 0; data.push(0x80); while (data.length % 64 !== 56) data.push(0); data.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255); data.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255); const w = new Array(64); for (let i = 0; i < data.length; i += 64) { for (let j = 0; j < 16; j++) { w[j] = ((data[i + j * 4] << 24) | (data[i + j * 4 + 1] << 16) | (data[i + j * 4 + 2] << 8) | data[i + j * 4 + 3]) >>> 0; } for (let j = 16; j < 64; j++) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3); const s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0; } let [a, b, c, d, e, f, g, h] = H; for (let j = 0; j < 64; j++) { const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0; const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; } H = H.map((v, idx) => (v + [a, b, c, d, e, f, g, h][idx]) >>> 0); } const out = []; for (const v of H) out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return out; } function Base64ToBytes(b64) { const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CHARS[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of b64.replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } return bytes; } return SHA256(Utf8Encode(string)).map(b => b.toString(16).padStart(2, '0')).join(''); } function _b64(str) { const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const u = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) u.push(c); else if (c < 2048) u.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); u.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else u.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } let out = ''; for (let i = 0; i < u.length; i += 3) { const b0 = u[i], b1 = u[i + 1], b2 = u[i + 2]; out += B[b0 >> 2]; out += b1 === undefined ? B[(b0 & 3) << 4] + '==' : b2 === undefined ? B[((b0 & 3) << 4) | (b1 >> 4)] + B[(b1 & 15) << 2] + '=' : B[((b0 & 3) << 4) | (b1 >> 4)] + B[((b1 & 15) << 2) | (b2 >> 6)] + B[b2 & 63]; } return out; } function _b64d(b64) { const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const map = {}; for (let i = 0; i < 64; i++) map[CH[i]] = i; const bytes = []; let acc = 0, bits = 0; for (const c of String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')) { acc = (acc << 6) | map[c]; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); } } let s = ''; for (let i = 0; i < bytes.length;) { const b = bytes[i]; if (b < 128) { s += String.fromCharCode(b); i += 1; } else if (b >= 240 && i + 3 < bytes.length) { const cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); const v = cp - 0x10000; s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)); i += 4; } else if (b >= 224 && i + 2 < bytes.length) { s += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3; } else if (b >= 192 && i + 1 < bytes.length) { s += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2; } else { s += String.fromCharCode(b); i += 1; } } return s; }function _des(data, keyStr) { const IP = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7]; const FP = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25]; const PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4]; const PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32]; const EX = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1]; const PP = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25]; const SB = [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13,15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9,10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12,7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14,2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3,12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13,4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12,13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11]; const SH = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]; function permute(bits, table) { const out = []; for (let i = 0; i < table.length; i++) out.push(bits[table[i] - 1]); return out; } function toBits(bytes) { const bits = []; for (let i = 0; i < bytes.length; i++) { for (let j = 7; j >= 0; j--) bits.push((bytes[i] >> j) & 1); } return bits; } function fromBits(bits) { const out = []; for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let b = 0; b < 8; b++) v = (v << 1) | bits[i + b]; out.push(v); } return out; } function utf8(str) { const out = []; for (let i = 0; i < str.length; i++) { let c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { const c2 = str.charCodeAt(++i); const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63)); } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; } function toBase64(bytes) { const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < bytes.length; i += 3) { const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]; s += CH[b0 >> 2]; s += b1 === undefined ? CH[(b0 & 3) << 4] + '==' : b2 === undefined ? CH[((b0 & 3) << 4) | (b1 >> 4)] + CH[(b1 & 15) << 2] + '=' : CH[((b0 & 3) << 4) | (b1 >> 4)] + CH[((b1 & 15) << 2) | (b2 >> 6)] + CH[b2 & 63]; } return s; } function subkeys(keyBytes) { const pc = permute(toBits(keyBytes), PC1); const C = pc.slice(0, 28); const D = pc.slice(28, 56); const keys = []; for (let r = 0; r < 16; r++) { for (let s = 0; s < SH[r]; s++) { C.push(C.shift()); D.push(D.shift()); } keys.push(permute(C.concat(D), PC2)); } return keys; } function encryptBlock(bytes8, keys) { const bits = permute(toBits(bytes8), IP); let L = bits.slice(0, 32); let R = bits.slice(32, 64); for (let r = 0; r < 16; r++) { const x = permute(R, EX).map((b, i) => b ^ keys[r][i]); const sres = []; for (let i = 0; i < 8; i++) { const e6 = x.slice(i * 6, i * 6 + 6); const row = (e6[0] << 1) | e6[5]; const col = (e6[1] << 3) | (e6[2] << 2) | (e6[3] << 1) | e6[4]; const v = SB[i * 64 + row * 16 + col]; for (let b = 3; b >= 0; b--) sres.push((v >> b) & 1); } const f = permute(sres, PP); const next = L.map((b, i) => b ^ f[i]); L = R; R = next; } return fromBits(permute(R.concat(L), FP)); } const keys = subkeys(utf8(String(keyStr)).slice(0, 8)); const bytes = utf8(String(data)); const pad = 8 - (bytes.length % 8); for (let i = 0; i < pad; i++) bytes.push(pad); const ct = []; for (let i = 0; i < bytes.length; i += 8) ct.push.apply(ct, encryptBlock(bytes.slice(i, i + 8), keys)); return toBase64(ct); } switch (type) { case 'sha256': return _sha256hex(a); case 'md5': return MD5(a); case 'rsa-sha256': return _rsa(a, b); case 'rsa-enc-pkcs1': return _rsaenc(a, b); case 'hmac-sha256': return _hmac(a, b); case 'aes-cbc': return _aes(a, b, c); case 'aes-ecb': return _aes(a, b, null, true); case 'aes-cbc-ivp': return _aes(a, b, c, false, 2); case 'aes-cbc-dec': return _aesdec(a, b, false); case 'aes-ecb-dec': return _aesdec(a, b, true); case 'aes-ecb-dec-hex': return _aesdec(a, b, true, true); case 'base64-encode': return _b64(String(a)); case 'base64-decode': return _b64d(a); case 'des-ecb': return _des(a, b); default: return null; } }

