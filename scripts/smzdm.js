/**
 * 脚本名称：什么值得买 - 签到 + 每日任务
 * 脚本说明：参考 lhtj_new 的单文件框架，合并 smzdm_checkin 与 smzdm_task。
 * 环境变量：
 *   1. smzdm_data：抓包保存的账号数组（推荐）
 *   2. SMZDM_COOKIE：Node/青龙可直接填 Cookie，多账号用 & 或换行分隔
 *   3. SMZDM_SK：可选，签到请求里的 sk，多账号与 Cookie 顺序一致
 *   4. SMZDM_COMMENT：可选，评论任务文案，需大于 10 个汉字
 *   5. SMZDM_CROWD_SILVER_5：可选，值 yes 时执行 5 碎银子抽奖任务
 *   6. SMZDM_CROWD_KEYWORD：可选，非免费抽奖时优先匹配的关键词
 * 更新时间：2026-03-20
 *
 * 抓包说明：
 *   1. 推荐拦截 https://user-api.smzdm.com/checkin
 *   2. 会自动保存 Cookie、User-Agent、sk 到 smzdm_data
 *
 * ------------------ Surge 配置 ------------------
 *
 * [MITM]
 * hostname = user-api.smzdm.com
 *
 * [Script]
 * 什么值得买获取Cookie = type=http-request,pattern=https?:\/\/user-api\.smzdm\.com\/(checkin|task\/list_v2),requires-body=1,max-size=0,timeout=60,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm.js,script-update-interval=0
 * 什么值得买 = type=cron,cronexp="10 8 * * *",timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm.js,script-update-interval=0
 *
 * ------------------- Loon 配置 -------------------
 *
 * [MITM]
 * hostname = user-api.smzdm.com
 *
 * [Script]
 * http-request https?:\/\/user-api\.smzdm\.com\/(checkin|task\/list_v2) tag=什么值得买获取Cookie,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm.js,requires-body=1
 * cron "10 8 * * *" script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm.js,tag=什么值得买,enable=true
 *
 * --------------- Quantumult X 配置 ---------------
 *
 * [MITM]
 * hostname = user-api.smzdm.com
 *
 * [rewrite_local]
 * https?:\/\/user-api\.smzdm\.com\/(checkin|task\/list_v2) url script-request-body https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm.js
 *
 * [task_local]
 * 10 8 * * * https://raw.githubusercontent.com/jy0703/scripts/main/scripts/smzdm.js, tag=什么值得买, enabled=true
 */

const $ = new Env('什么值得买');
$.is_debug = getEnv('is_debug') || 'false';
$.Messages = [];

const APP_VERSION = '10.4.26';
const APP_VERSION_REV = '866';
const DEFAULT_USER_AGENT_APP = `smzdm_android_V${APP_VERSION} rv:${APP_VERSION_REV} (Redmi Note 3;Android10.0;zh)smzdmapp`;
const DEFAULT_USER_AGENT_WEB = `Mozilla/5.0 (Linux; Android 10.0; Redmi Build/Redmi Note 3; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/95.0.4638.74 Mobile Safari/537.36 smzdm_android_V${APP_VERSION} rv:${APP_VERSION_REV} (Redmi;Android10.0;zh) jsbv_1.0.0 webv_2.0 smzdmapp`;
const SIGN_KEY = 'apr1$AwP!wRRT$gJ/q.X24poeBInlUJC';
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
        sign: MD5(`${signData}&key=${SIGN_KEY}`).toUpperCase()
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

function createBotContext(user = {}) {
    return normalizeBotContext({
        $env: $,
        user,
        cookie: user.cookie || '',
        userAgentApp: user.userAgentApp || '',
        userAgentWeb: user.userAgentWeb || '',
        sk: user.sk || ''
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

    await wait(3, 10);

    if (article.article_price) {
      // 点值
      await rating(ctx, {
        method: 'worth_cancel',
        type: 3,
        id: article.article_id,
        channelId: article.article_channel_id
      });

      await wait(3, 10);

      await rating(ctx, {
        method: 'worth_create',
        type: 1,
        id: article.article_id,
        channelId: article.article_channel_id
      });

      await wait(3, 10);

      await rating(ctx, {
        method: 'worth_cancel',
        type: 3,
        id: article.article_id,
        channelId: article.article_channel_id
      });
    }
    else {
      // 点赞
      await rating(ctx, {
        method: 'like_cancel',
        id: article.article_id,
        channelId: article.article_channel_id
      });

      await wait(3, 10);

      await rating(ctx, {
        method: 'like_create',
        id: article.article_id,
        channelId: article.article_channel_id
      });

      await wait(3, 10);

      await rating(ctx, {
        method: 'like_cancel',
        id: article.article_id,
        channelId: article.article_channel_id
      });

      await wait(3, 10);

      await rating(ctx, {
        method: 'like_create',
        id: article.article_id,
        channelId: article.article_channel_id
      });

      await wait(3, 10);

      await rating(ctx, {
        method: 'like_cancel',
        id: article.article_id,
        channelId: article.article_channel_id
      });
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

    await wait(3, 10);

    await favorite(ctx, {
      method: 'destroy',
      id: articleId,
      channelId
    });

    await wait(3, 10);

    await favorite(ctx, {
      method: 'create',
      id: articleId,
      channelId
    });

    await wait(3, 10);

    await favorite(ctx, {
      method: 'destroy',
      id: articleId,
      channelId
    });
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

    let articles = [];

    if (task.article_id == '0') {
      articles = await getArticleList(ctx, task.task_even_num - task.task_finished_num);

      await wait(3, 10);
    }
    else {
      articles = [{
        article_id: task.article_id,
        article_channel_id: task.channel_id
      }];
    }

    for (let i = 0; i < articles.length; i++) {
      ctx.$env.log(`开始分享第 ${i + 1} 篇文章...`);

      const article = articles[i];

      if (task.task_redirect_url.link_type != 'other') {
        // 模拟打开文章
        if (/detail_haojia/i.test(task.task_redirect_url.scheme_url)) {
          await getHaojiaDetail(ctx, article.article_id);
        }
        else {
          await getArticleDetail(ctx, article.article_id);
        }

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

    let articles = [];
    let isRead = true;

    if (task.article_id == '0') {
      isRead = true;
      articles = await getArticleList(ctx, task.task_even_num - task.task_finished_num);

      await wait(3, 10);
    }
    else {
      for (let i = 0; i < task.task_even_num - task.task_finished_num; i++) {
        articles.push({
          article_id: task.article_id,
          article_channel_id: task.channel_id
        });
      }

      isRead = task.task_redirect_url.link_val != '';
    }

    for (let i = 0; i < articles.length; i++) {
      ctx.$env.log(`开始阅读第 ${i + 1} 篇文章...`);

      const article = articles[i];

      if (isRead) {
        // 模拟打开文章
        if (/detail_haojia/i.test(task.task_redirect_url.scheme_url)) {
          await getHaojiaDetail(ctx, article.article_id);
        }
        else {
          await getArticleDetail(ctx, article.article_id);
        }
      }

      ctx.$env.log('模拟阅读文章');
      await wait(20, 50);

      const { isSuccess, response } = await requestApi('https://user-api.smzdm.com/task/event_view_article_sync', {
        method: 'post',
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

    const { isSuccess, response } = await requestApi(`https://dingyue-api.smzdm.com/dingyue/${method}`, {
      method: 'post',
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
    const { isSuccess, data, response } = await requestApi('https://dingyue-api.smzdm.com/tuijian/search_result', {
      method: 'post',
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
    const { isSuccess, data, response } = await requestApi('https://zhiyou.m.smzdm.com/user/crowd/ajax_participate', {
      method: 'post',
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
    const { isSuccess, response } = await requestApi('https://user-api.smzdm.com/share/complete_share_rule', {
      method: 'post',
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
    const { isSuccess, response } = await requestApi('https://user-api.smzdm.com/share/callback', {
      method: 'post',
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
    const { isSuccess, data, response } = await requestApi('https://user-api.smzdm.com/share/daily_reward', {
      method: 'post',
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
    const { isSuccess, data, response } = await requestApi('https://user-api.smzdm.com/robot/token', {
      method: 'post',
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
    const { isSuccess, response } = await requestApi(`https://user-api.smzdm.com/favorites/${method}`, {
      method: 'post',
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

    const { isSuccess, response } = await requestApi(`https://dingyue-api.smzdm.com/dy/util/api/user_action`, {
      method: 'post',
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
    const { isSuccess, response } = await requestApi(`https://user-api.smzdm.com/rating/${method}`, {
      method: 'post',
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
    const { isSuccess, data, response } = await requestApi('https://comment-api.smzdm.com/comments/submit', {
      method: 'post',
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
    const { isSuccess, response } = await requestApi('https://comment-api.smzdm.com/comments/delete_comment', {
      method: 'post',
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
    const { isSuccess, data, response } = await requestApi('https://dingyue-api.smzdm.com/dingyue/follow_status', {
      method: 'post',
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
    const status = getDingyueStatus(ctx, name);

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
        const { isSuccess, data, response } = await requestApi('https://user-api.smzdm.com/checkin', {
            method: 'post',
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
        const { isSuccess, data, response } = await requestApi('https://user-api.smzdm.com/checkin/all_reward', {
            method: 'post',
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
        const { isSuccess, data, response } = await requestApi('https://user-api.smzdm.com/checkin/extra_reward', {
            method: 'post',
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
        const { isSuccess, data, response } = await requestApi('https://user-api.smzdm.com/checkin/show_view_v2', {
            method: 'post',
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
        const { isSuccess, data, response } = await requestApi('https://user-api.smzdm.com/vip', {
            method: 'post',
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
        const { isSuccess, data, response } = await requestApi('https://user-api.smzdm.com/task/list_v2', {
            method: 'post',
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
        const { isSuccess, data, response } = await requestApi('https://user-api.smzdm.com/task/activity_receive', {
            method: 'post',
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

        const { isSuccess, data, response } = await requestApi('https://user-api.smzdm.com/task/activity_task_receive', {
            method: 'post',
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

//MD5加密
function MD5(string) { function RotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); } function AddUnsigned(lX, lY) { var lX4, lY4, lX8, lY8, lResult; lX8 = (lX & 0x80000000); lY8 = (lY & 0x80000000); lX4 = (lX & 0x40000000); lY4 = (lY & 0x40000000); lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF); if (lX4 & lY4) { return (lResult ^ 0x80000000 ^ lX8 ^ lY8); } if (lX4 | lY4) { if (lResult & 0x40000000) { return (lResult ^ 0xC0000000 ^ lX8 ^ lY8); } else { return (lResult ^ 0x40000000 ^ lX8 ^ lY8); } } else { return (lResult ^ lX8 ^ lY8); } } function F(x, y, z) { return (x & y) | ((~x) & z); } function G(x, y, z) { return (x & z) | (y & (~z)); } function H(x, y, z) { return (x ^ y ^ z); } function I(x, y, z) { return (y ^ (x | (~z))); } function FF(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function GG(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function HH(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function II(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }; function ConvertToWordArray(string) { var lWordCount; var lMessageLength = string.length; var lNumberOfWords_temp1 = lMessageLength + 8; var lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64; var lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16; var lWordArray = Array(lNumberOfWords - 1); var lBytePosition = 0; var lByteCount = 0; while (lByteCount < lMessageLength) { lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8; lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition)); lByteCount++; } lWordCount = (lByteCount - (lByteCount % 4)) / 4; lBytePosition = (lByteCount % 4) * 8; lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition); lWordArray[lNumberOfWords - 2] = lMessageLength << 3; lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29; return lWordArray; }; function WordToHex(lValue) { var WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount; for (lCount = 0; lCount <= 3; lCount++) { lByte = (lValue >>> (lCount * 8)) & 255; WordToHexValue_temp = "0" + lByte.toString(16); WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2); } return WordToHexValue; }; function Utf8Encode(string) { string = string.replace(/\r\n/g, "\n"); var utftext = ""; for (var n = 0; n < string.length; n++) { var c = string.charCodeAt(n); if (c < 128) { utftext += String.fromCharCode(c); } else if ((c > 127) && (c < 2048)) { utftext += String.fromCharCode((c >> 6) | 192); utftext += String.fromCharCode((c & 63) | 128); } else { utftext += String.fromCharCode((c >> 12) | 224); utftext += String.fromCharCode(((c >> 6) & 63) | 128); utftext += String.fromCharCode((c & 63) | 128); } } return utftext; }; var x = Array(); var k, AA, BB, CC, DD, a, b, c, d; var S11 = 7, S12 = 12, S13 = 17, S14 = 22; var S21 = 5, S22 = 9, S23 = 14, S24 = 20; var S31 = 4, S32 = 11, S33 = 16, S34 = 23; var S41 = 6, S42 = 10, S43 = 15, S44 = 21; string = Utf8Encode(string); x = ConvertToWordArray(string); a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476; for (k = 0; k < x.length; k += 16) { AA = a; BB = b; CC = c; DD = d; a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478); d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756); c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB); b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE); a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF); d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A); c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613); b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501); a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8); d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF); c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1); b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE); a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122); d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193); c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E); b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821); a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562); d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340); c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51); b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA); a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D); d = GG(d, a, b, c, x[k + 10], S22, 0x2441453); c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681); b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8); a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6); d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6); c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87); b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED); a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905); d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8); c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9); b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A); a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942); d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681); c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122); b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C); a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44); d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9); c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60); b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70); a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6); d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA); c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085); b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05); a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039); d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5); c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8); b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665); a = II(a, b, c, d, x[k + 0], S41, 0xF4292244); d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97); c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7); b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039); a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3); d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92); c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D); b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1); a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F); d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0); c = II(c, d, a, b, x[k + 6], S43, 0xA3014314); b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1); a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82); d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235); c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB); b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391); a = AddUnsigned(a, AA); b = AddUnsigned(b, BB); c = AddUnsigned(c, CC); d = AddUnsigned(d, DD); } var temp = WordToHex(a) + WordToHex(b) + WordToHex(c) + WordToHex(d); return temp.toLowerCase(); }

// prettier-ignore
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }
