/*
 * ProxyPin 取号脚本：中国移动 cmcc_sign
 * 抓取 https://wx.10086.cn/qwhdsso/appTokenLogin 的登录请求，整理成 cmcc_sign 需要的 cmcc_data JSON，
 * 抓到后通过 Bark 推送到 iPhone。推送同时是"脚本到底有没有被执行"的判据：连诊断推送都没有，
 * 就说明脚本根本没被调用（生效地址 / 开关问题），而不是抓取逻辑的问题。
 *
 * Bark 配置（ProxyPin「环境」里只加这两条，无默认值，不配就不推送）：
 *   bark_url   自建 bark-server 的推送地址，例 https://bark.example.com/push
 *   bark_key   Bark App 首页那串设备 key
 *   推送带 autoCopy=1：点一下通知，完整 JSON 就进剪贴板，直接贴进 boxjs 的 cmcc_data。
 *   提示音写死 shake（Bark 内置音），要改就动 send() 里的 sound 字段。
 *   ⚠ 安全：通知正文就是账号票据，会经 APNs 与你的 Bark 服务器落地。抓完记得关掉脚本，
 *     并清掉 Bark 的历史消息。
 *
 * 用法：
 *   1. iPhone 连上 ProxyPin 代理并装好信任证书（中国移动 App 的流量能被解密即可）；
 *   2. 「脚本」新增一条，生效地址填：appTokenLogin
 *      （匹配规则拿「域名+路径」wx.10086.cn/qwhdsso/appTokenLogin 做包含式正则比对，`*` 会展开成 `.*`；
 *        若写成带协议的 https://... 就永远匹配不上，脚本一次都不会执行）
 *      粘贴本文件全部内容并启用，同时确认「脚本」总开关是开着的；
 *   3. 打开中国移动 App →「我」→「签到」进入活动页触发登录；多账号逐个登录会自动合并成一条 JSON；
 *   4. 内容有变化就推一条 Bark（标题 cmcc_data，正文完整 JSON）；同一份内容不重复推
 *      （去重记在 ProxyPin 进程内，重启 ProxyPin 后第一次抓必推）；
 *   5. 结果同时写进「环境」变量 cmcc_data（桌面版工具栏的环境入口 / 移动端设置-环境），
 *      并在脚本日志里打印命中行与结果；抓完请禁用本脚本，避免每次进签到页都覆盖凭证、重复推送。
 *
 * 关于 ProxyPin 脚本运行时（这几个坑都实测踩过）：
 *   - JS runtime 池化复用，同一个上下文每次命中都把整段脚本重新执行一遍：顶层写 const/let，
 *     第二次就报 "Can't create duplicate variable"；
 *   - 且旧版本声明过的全局词法绑定不会从上下文里消失，之后改成同名 var 也照样冲突 —— 只把 const
 *     换成 var 修不好，必须让这个文件名不再出现在顶层；
 *   - 所以本脚本顶层只有 `var onRequest, onResponse;`，其余名字全收进 IIFE 的函数作用域，
 *     即使上下文残留旧版同名绑定也能直接跑通，不必重启 ProxyPin；
 *   - 改完脚本仍无反应：把这条脚本关掉再打开（丢弃旧 runtime）。直接改磁盘上的 <home>/scripts/*.js
 *     不会立刻生效，脚本正文有 15 分钟缓存，只有在 UI 里编辑才会同步刷新；
 *   - fetch 走 XHR 桥，响应状态码被写死成 200，所以推送成功与否看 Bark 回的业务 code。
 *
 * 其他说明：
 *   - 「环境」功能关闭时读不到 bark_url / bark_key，此时既无法落库也无法推送（只能靠脚本日志）；
 *   - jwt 取请求体里 App 自己的缓存值，与 cmcc_sign 的 GetCookie 行为一致，后续由 cmcc_sign 续期回写；
 *   - token 是 App 票据（会过期），jwt 有效时 cmcc_sign 用不到它，仅作兜底。
 */

var onRequest, onResponse;

(function () {
    var ENV_KEY = 'cmcc_data';
    var API = 'appTokenLogin';
    var PUSHED_KEY = '__cmcc_pushed';
    var DIAG_KEY = '__cmcc_diag';
    var MAX_BODY = 3500;                                  // APNs 载荷约 4KB，留出 JSON 转义余量

    onRequest = async function (context, request) {
        var where = String((request && (request.path || request.url)) || '');
        if (where.indexOf(API) === -1) return request;    // 生效地址填宽了也不刷屏
        console.log('[cmcc] 命中 ' + String(request.method) + ' ' + where
            + ' | body ' + String(request.body === undefined ? '(未取到)' : request.body).length + ' 字节'
            + ' | env ' + (context && context.env ? '可用' : '不可用'));

        var res;
        try {
            res = grab(context, request);
        } catch (e) {
            res = { ok: false, why: '抓取异常 ' + e };
        }
        try {
            if (res.ok) await pushBark(context, res);
            else await pushDiag(context, res.why);
        } catch (e) {
            console.log('[cmcc] Bark 推送失败: ' + e);
        }
        // 原样返回：脚本没改动请求时 ProxyPin 保留原始字节，不会重排头 / 重编码 query
        return request;
    };

    onResponse = async function (context, request, response) {
        // 命中脚本后 ProxyPin 会用脚本返回的对象重建响应，并按原 content-length 发出。
        // 实测 appTokenLogin 不压缩（长度天然一致）；这里只在文本 body 的字节数与头不符时纠正，
        // 避免压缩接口让 App 读到截断响应。二进制 body 不动，防止误改。
        if (typeof response.body === 'string') {
            var len = String(utf8Bytes(response.body));
            var headers = response.headers || {};
            Object.keys(headers).forEach(function (key) {
                if (key.toLowerCase() === 'content-length') headers[key] = len;
            });
        }
        return response;
    };

    // 从登录请求体里取凭证，按 userCheckId 合并进 context.env.cmcc_data
    function grab(context, request) {
        var method = String(request.method || '');
        if (method.toUpperCase() !== 'POST') return { ok: false, why: 'method=' + (method || '(空)') + ' 不是 POST' };

        var body = null;
        try {
            body = JSON.parse(request.body || '{}');
        } catch (e) { }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return { ok: false, why: '请求体不是 JSON 对象: ' + String(request.body).slice(0, 60) };
        }
        if (!Object.keys(body).length) return { ok: false, why: '请求体为空（ProxyPin 未取到 body）' };
        // App 票据与 userCheckId 缺一不可，缺了抓进去也没法登录
        if (!body.token || !body.userCheckId) {
            return { ok: false, why: '请求体缺 token/userCheckId，只有: ' + Object.keys(body).join(',') };
        }

        var env = context.env;
        var persist = !!env;
        if (!env) env = {};                               // 老版本不注入 env：不入库，但仍然推送
        var list = readList(env[ENV_KEY]);
        var old = findUser(list, body.userCheckId) || {};
        var jwt = body.jwtToken || old.jwt || '';

        var item = {
            userName: '尾号 ' + phoneTail(body.userCheckId),
            token: body.token,
            userCheckId: body.userCheckId,
            userAgent: header(request.headers, 'user-agent'),
            provinceCode: body.provinceCode || '',
            cityCode: body.cityCode || '',
            carrierOperator: body.carrierOperator || '',
            appVersionCode: body.appVersionCode || '',
            jwt: jwt,
            // jwt 换了就重记凭证链起点，cmcc_sign 日志里的"凭证链已 X 天"才是真值
            jwt_first: (old.jwt && old.jwt === jwt) ? (old.jwt_first || Date.now()) : Date.now(),
            // 别把当天"已签到"标记冲掉，否则同日会再签一次
            signDay: old.signDay || '',
        };

        var idx = indexOfUser(list, body.userCheckId);
        if (idx === -1) list.push(item); else list[idx] = item;
        var text = JSON.stringify(list);
        if (persist) env[ENV_KEY] = text;

        console.log('[cmcc] ' + (idx === -1 ? '新增' : '更新') + ' 账号 ' + item.userName
            + '，jwt ' + (jwt ? '有' : '无') + '，共 ' + list.length + ' 个账号'
            + (persist ? '' : '（未入库，context.env 不可用）'));
        console.log('[cmcc] ' + ENV_KEY + ' = ' + text);
        return { all: text, one: JSON.stringify([item]), count: list.length, name: item.userName, ok: true };
    }

    // 正文即可直接复制的 cmcc_data JSON；与上次内容一致就不重复打扰
    async function pushBark(context, res) {
        var session = context.session;
        if (session && session[PUSHED_KEY] === res.all) {
            console.log('[cmcc] 与上次推送内容一致，跳过');
            return;
        }
        var body = res.all;
        var note = '';
        if (utf8Bytes(body) > MAX_BODY) {
            // 账号多到一条推送装不下时只推刚抓到的这个（仍是数组，可直接粘），完整值落「环境」
            body = res.one;
            note = '｜' + res.count + ' 个账号合并后超出单条推送长度，本条只含 ' + res.name;
        }
        var sent = await send(context, 'cmcc_data ' + res.count + ' 个账号', body);
        if (sent) {
            if (session) session[PUSHED_KEY] = res.all;
            console.log('[cmcc] Bark 已推送，正文 ' + utf8Bytes(body) + ' 字节' + note);
        }
    }

    // 抓不到内容时也要有反馈，否则无法区分"脚本没跑"和"跑了但跳过"；同一原因只发一次
    async function pushDiag(context, why) {
        console.log('[cmcc] ' + why + '，已跳过');
        var session = context.session;
        if (session && session[DIAG_KEY] === why) return;
        if (await send(context, 'cmcc 抓取跳过', '[cmcc] ' + why)) {
            if (session) session[DIAG_KEY] = why;
        }
    }

    // POST 到 bark_url，成功判据是 Bark 回的业务 code=200（HTTP 状态码被 XHR 桥写死，不可信）
    async function send(context, title, body) {
        var env = context.env || {};
        var url = String(env.bark_url || ''), key = String(env.bark_key || '');
        if (!url || !key) {
            console.log('[cmcc] 未配置「环境」变量 bark_url / bark_key，跳过推送');
            return false;
        }
        if (/\/$/.test(url)) url = url.slice(0, -1);       // 只填到服务器根地址时也认，且不拼出双斜杠
        if (url.slice(-5) !== '/push') url += '/push';
        var payload = { device_key: key, title: title, body: body, group: 'cmcc', sound: 'shake', autoCopy: '1' };

        var r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(payload),
        });
        var text = String(await r.text());
        var j = null;
        try { j = JSON.parse(text); } catch (e) { }
        if (j && Number(j.code) === 200) return true;
        console.log('[cmcc] Bark 未受理: ' + text.slice(0, 200));
        return false;
    }

    function readList(val) {
        if (!val) return [];
        try {
            var arr = JSON.parse(val);
            return Array.isArray(arr) ? arr : [];
        } catch (e) {
            return [];
        }
    }

    // userCheckId 是手机号十六进制，大小写不敏感去重
    function indexOfUser(list, ucid) {
        for (var i = 0; i < list.length; i++) {
            if (list[i] && String(list[i].userCheckId).toLowerCase() === String(ucid).toLowerCase()) return i;
        }
        return -1;
    }

    function findUser(list, ucid) {
        var i = indexOfUser(list, ucid);
        return i === -1 ? null : list[i];
    }

    // 手机号十六进制 -> 尾号（与 cmcc_sign 的 phoneTail 同算法）
    function phoneTail(ucid) {
        var num = Number('0x' + ucid);
        return isNaN(num) ? '????' : String(num).slice(-4);
    }

    // ProxyPin 的 headers 来自 HttpHeaders.toMap：单值是字符串，多值是数组
    function header(headers, name) {
        var all = headers || {};
        var found = '';
        Object.keys(all).some(function (key) {
            if (key.toLowerCase() !== name) return false;
            var val = all[key];
            found = Array.isArray(val) ? (val[0] || '') : String(val || '');
            return true;
        });
        return found;
    }

    function utf8Bytes(str) {
        var n = 0;
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            if (c < 0x80) n += 1;
            else if (c < 0x800) n += 2;
            else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
            else n += 3;
        }
        return n;
    }
})();
