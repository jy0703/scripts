/**
 * 脚本名称：微信读书任务
 * 活动规则：每周兑换阅读达标奖励（书币/体验卡）、每周翻牌抽奖、每周限免好书入架（可配小号自动助力）
 * 脚本说明：支持多账号，支持 NE / Node.js 环境。账号凭证由本脚本 GetCookie 抓取微信读书 APP 的 /login 请求与响应后写入 weread_data（vid/skey/accessToken 取自响应，refreshToken/deviceId 取自请求体）；只要凭证里有 refreshToken+deviceId，此后 skey 过期由脚本自行调用 /login 脱机换票，无需再抓包
 * 环境变量：weread_data、weread_helper、weread_claim、weread_flip、weread_free、weread_award、weread_free_mode、weread_exclude_keywords、weread_cache、weread_debug
 * 更新时间：2026-10-10

------------------ Surge 配置 ------------------

[Script]
微信读书获取Cookie = type=http-response,pattern=^https?:\/\/i\.weread\.qq\.com\/login(\?|$),requires-body=1,max-size=0,timeout=600,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/weread_sign.js,script-update-interval=0

微信读书任务 = type=cron,cronexp="0 23 * * 0",wake-system=1,script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/weread_sign.js,timeout=600,script-update-interval=0

[MITM]
hostname = i.weread.qq.com

------------------- Loon 配置 -------------------

[Script]
http-response ^https?:\/\/i\.weread\.qq\.com\/login(\?|$) script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/weread_sign.js, requires-body=true, timeout=600, tag=微信读书获取Cookie

cron "0 23 * * 0", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/weread_sign.js, timeout=600, tag=微信读书任务

[MITM]
hostname = i.weread.qq.com

--------------- Quantumult X 配置 ---------------

[rewrite_local]
^https?:\/\/i\.weread\.qq\.com\/login(\?|$) url script-response-body https://raw.githubusercontent.com/jy0703/scripts/main/scripts/weread_sign.js

[task_local]
"0 23 * * 0", script-path=https://raw.githubusercontent.com/jy0703/scripts/main/scripts/weread_sign.js, tag=微信读书任务, img-url=https://raw.githubusercontent.com/jy0703/scripts/main/icons/weread.png, enabled=true

[MITM]
hostname = i.weread.qq.com

 */

const $ = new Env('微信读书');
$.is_debug = getEnv('weread_debug', 'is_debug') || 'false';  // 调试模式
$.userArr = parseAccounts(getEnv('weread_data'));  // 主账号数组，抓取或手填
$.Messages = [];

// 业务常量 (照微信读书 APP 抓包搬运)
const API = 'https://i.weread.qq.com';                       // App 端接口
const FLIP_API = 'https://weread.qq.com/flip-card-game/api'; // 翻牌 H5 接口
const WEB_LOGIN = 'https://weread.qq.com/web/login/renewal';  // 小号 Web Cookie 续期
const SHARE_API = 'https://weread.qq.com/book-detail/api/activities'; // 限免助力(好友分享页)
const PF = 'weread_wx-2001-iap-2001-iphone';
const DATA_KEY = 'weread_data';
const HELPER_KEY = 'weread_helper';
const CACHE_KEY = 'weread_cache';
const CAPTURE_REGEX = /^https?:\/\/i\.weread\.qq\.com\/login(\?|$)/;
const APP_UA = 'WeRead/8.2.6 (iPhone; iOS 26.6.2; Scale/3.00)';
const APP_VER = '8.2.6.20';
const FLIP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;WeRead/10.2.1 (iPhone; iOS 26.6.1; Scale/3.00)';
const CACHE_DAYS = 30;  // 限免周度锁定缓存保留天数

// 主函数
async function main() {
    if ($.userArr.length) {
        $.log(`\n🌀 找到 ${$.userArr.length} 个账号`);
        const canClaim = enabled('weread_claim'), canFlip = enabled('weread_flip'), canFree = enabled('weread_free');
        $.log(`⚙️ 任务队列: [阅读达标: ${canClaim ? '执行' : '跳过'}] [翻牌: ${canFlip ? '执行' : '跳过'}] [限免: ${canFree ? '执行' : '跳过'}]`);
        let helpers = parseHelpers(getEnv(HELPER_KEY));
        if (helpers.length) $.log(`🌀 找到 ${helpers.length} 个助力小号`);

        for (let i = 0; i < $.userArr.length; i++) {
            $.log(`\n----- 账号 [${i + 1}/${$.userArr.length}] 开始执行 -----\n`);

            const acc = $.userArr[i];
            $.Messages.push(`🔹 账号${i + 1}: ${maskVid(acc.vid)}`);

            if (!acc.vid || !acc.skey) {
                $.Messages.push('❌ 凭证不完整（缺 vid 或 skey），请在抓取开关打开时退出重登一次');
                continue;
            }

            // 未配小号但填了多个主账号时，其余账号互为助力小号（照上游行为）
            const myHelpers = helpers.length ? helpers : $.userArr.filter((_, idx) => idx !== i).map(toHelper);

            if (canClaim) await runClaimTask(acc);
            if (canFlip) await runFlipTask(acc);
            if (canFree) await runFreeTask(acc, myHelpers);
        }
        $.log(`\n----- 所有账号执行完成 -----\n`);
    } else {
        throw new Error('未找到 weread_data 变量 ❌');
    }
}

// 任务开关：boxjs 布尔项未配置时默认执行
function enabled(key) {
    const v = getEnv(key);
    return !v || String(v) !== 'false';
}

// ---------- 任务一：每周阅读达标奖励 ----------
async function runClaimTask(acc) {
    const choiceType = getEnv('weread_award') === 'card' ? 1 : 2;  // 2=书币(默认), 1=体验卡

    const probe = await authRequest(acc, a => ({
        url: `${API}/weekly/exchange`, method: 'post', headers: appHeaders(a), _respType: 'all',
        body: { awardLevelId: 0, unread: 1, isExchangeAward: 0, pf: PF, awardChoiceType: 0 }
    }));
    if (!probe || probe.statusCode !== 200) {
        return say(`📖 阅读达标: ❌ 鉴权失败 ${probe ? 'HTTP ' + probe.statusCode : '请求异常'}`);
    }

    const data = $.toObj(probe.body, null) || {};
    const readingMin = Math.floor((data.readingTime || 0) / 60);
    const readingDay = data.readingDay || 0;
    const awards = [
        ...(data.readtimeAwards || []).map(x => Object.assign(x, { _type: '时长' })),
        ...(data.readdayAwards || []).map(x => Object.assign(x, { _type: '天数' })),
    ];

    let gainedCard = 0, gainedCoin = 0, failed = 0;
    for (const item of awards) {
        if (item.awardStatus !== 1) continue;   // 1 = 可领取
        const levelDesc = item.awardLevelDesc || ('档位' + item.awardLevelId);
        const choice = (item.awardChoices || []).find(c => c.choiceType === choiceType) || (item.awardChoices || [])[0];
        const num = choice ? choice.awardNum : 1;
        const type = choice ? choice.choiceType : choiceType;
        const name = type === 1 ? `${num} 天体验卡` : `${num} 书币`;
        $.log(`[微信读书] 待领奖励 ${item._type}[${levelDesc}]，正在兑换 ${name}...`);

        const ex = await Request({
            url: `${API}/weekly/exchange`, method: 'post', headers: appHeaders(acc), _respType: 'all',
            body: { unread: 1, awardChoiceType: choiceType, awardLevelId: item.awardLevelId, isExchangeAward: 1, pf: PF }
        });
        const exData = $.toObj(ex && ex.body, null);
        const ok = ex && ex.statusCode === 200 && (!exData || (!exData.errcode && !exData.errCode && exData.succ !== 0));
        if (ok) {
            if (type === 1) gainedCard += num; else gainedCoin += num;
            $.log(`[微信读书] 🎉 领取成功: ${item._type}[${levelDesc}] (+${name})`);
        } else {
            failed++;
            $.log(`[微信读书] ❌ 领取 ${item._type}[${levelDesc}] 失败: ${(exData && (exData.errmsg || exData.errMsg)) || 'HTTP ' + (ex && ex.statusCode)}`);
        }
    }

    // 本周累计 = 本次领取 + 此前已领档位(awardStatus=2)
    let weekCard = gainedCard, weekCoin = gainedCoin;
    for (const item of awards) {
        if (item.awardStatus !== 2) continue;
        const type = item.awardChooseType || 1;
        const list = item.awardChoices || [];
        const choice = list.find(c => c.choiceType === item.awardChooseType) || list[0];
        const num = choice ? choice.awardNum : 1;
        if (type === 1) weekCard += num; else weekCoin += num;
    }

    const account = await readAccountBalance(acc);
    const parts = [];
    if (gainedCard) parts.push(`本次 +${gainedCard} 天体验卡`);
    if (gainedCoin) parts.push(`本次 +${gainedCoin} 书币`);
    if (failed) parts.push(`另有 ${failed} 个档位领取失败`);
    say(`📖 阅读达标: ${parts.length ? parts.join(' · ') : '本周暂无可领档位'} (本周已读 ${readingMin} 分钟/${readingDay} 天)`);
    say(`📊 奖励汇总: 本周累计 体验卡 ${weekCard} 天 · 书币 ${weekCoin} 个${account}`);
}

// 账户总余（体验卡剩余天数 / 书币余额），仅用于汇总行
async function readAccountBalance(acc) {
    let days = null, coins = null;
    try {
        const card = await Request({ url: `${API}/pay/memberCardSummary?pf=${PF}&sn=1&source=profile`, headers: appHeaders(acc), _respType: 'all' });
        const cardData = $.toObj(card && card.body, null);
        if (cardData && typeof cardData.remainTime === 'number') days = Math.ceil(cardData.remainTime / 86400);
        const bal = await Request({
            url: `${API}/pay/balance`, method: 'post', headers: appHeaders(acc), _respType: 'all',
            body: { release: 1, requireExpiry: 1, noSnapshot: 0, pf: PF, zoneid: 1 }
        });
        const balData = $.toObj(bal && bal.body, null);
        if (balData) {
            const v = balData.giftBalance !== undefined ? balData.giftBalance : balData.balance;
            if (typeof v === 'number') coins = v;
        }
    } catch (e) {
        $.log(`[微信读书] 余额查询异常: ${e.message || e}`);
    }
    if (days === null && coins === null) return '';
    return ` · 账户余 ${days === null ? '?' : days + ' 天卡'}${coins === null ? '' : ` · ${coins} 书币`}`;
}

// ---------- 任务二：每周翻牌抽奖 ----------
async function runFlipTask(acc) {
    const FLIP_CARD_ORDER = [2, 5, 4, 7, 8, 6, 0, 1, 3];

    const listResp = await authRequest(acc, a => ({ url: `${FLIP_API}/flipCardList?pf=ios&platform=ios_html`, headers: flipHeaders(a), _respType: 'all' }));
    if (!listResp || listResp.statusCode !== 200) {
        return say(`🃏 翻牌: ❌ 查询翻牌列表失败 ${listResp ? 'HTTP ' + listResp.statusCode : '请求异常'}`);
    }
    const listData = $.toObj(listResp.body, null) || {};
    const remaining = typeof listData.remainingCount === 'number' ? listData.remainingCount : 0;
    const flipList = Array.isArray(listData.flipList) ? listData.flipList : [];
    const flipped = getFlippedCards(listData);

    // 本周已翻出的卡片先计入战果（只统计 flipList / cardIndex>=0，整份奖池 cardList 不算）
    let weekCard = 0, weekCoin = 0, weekBooks = [];
    for (const c of flipped) {
        const q = parsePrizeQuantity(describeCardPrize(c));
        weekCard += q.cardDays; weekCoin += q.coins;
        if (q.books.length) weekBooks = weekBooks.concat(q.books);
    }
    $.log(`[微信读书] 翻牌列表: 可用次数 ${remaining}, 本周已翻 ${flipped.length || flipList.length} 张`);

    if (remaining <= 0) {
        return say(weekCard || weekCoin || weekBooks.length
            ? `🃏 翻牌: 本周已翻 ${flipped.length} 次 (${prizeText(weekCard, weekCoin, weekBooks)})，无剩余次数`
            : (flipList.length >= 6 ? '🃏 翻牌: 本周 6 次已全部翻完' : '🃏 翻牌: 本周尚未获得翻牌额度'));
    }

    let state = listData, gained = [], failed = 0;
    const maxFlips = Math.min(6, remaining);
    for (let n = 0; n < maxFlips; n++) {
        const target = pickNextFlip(state, FLIP_CARD_ORDER);
        if (!target) { $.log('[微信读书] 翻牌: 没有未翻开的卡片'); break; }

        const flipUrl = `${FLIP_API}/flipCardFlip?cardIndex=${target.cardIndex}&giftIndex=${target.giftIndex}&pf=ios&platform=ios_html`;
        $.log(`[微信读书] 翻牌 第 ${n + 1}/${maxFlips} 次: cardIndex=${target.cardIndex}`);
        const draw = await authRequest(acc, a => ({ url: flipUrl, headers: flipHeaders(a), _respType: 'all' }));
        if (!draw || draw.statusCode !== 200) {
            failed++;
            $.log(`[微信读书] ❌ 翻牌第 ${n + 1} 次失败: ${draw ? 'HTTP ' + draw.statusCode : '请求异常'} ${(draw && draw.body || '').slice(0, 80)}`);
            break;
        }
        const flipData = $.toObj(draw.body, null) || state;
        state = flipData;
        const prize = describeFlipResult(flipData, target.cardIndex);
        gained.push(prize);
        $.log(`[微信读书] 🎯 翻中: ${prize}`);
        if (typeof flipData.remainingCount === 'number' && flipData.remainingCount <= 0) break;
        if (n < maxFlips - 1) await sleep(1500);
    }

    for (const p of gained) {
        const q = parsePrizeQuantity(p);
        weekCard += q.cardDays; weekCoin += q.coins;
        if (q.books.length) weekBooks = weekBooks.concat(q.books);
    }

    if (gained.length) {
        say(`🃏 翻牌: 本次翻中 ${gained.length} 次 [${gained.join('、')}]${failed ? `，另有 ${failed} 次失败` : ''}`);
        say(`📊 奖励汇总: 本周累计 ${prizeText(weekCard, weekCoin, weekBooks)}`);
    } else if (weekCard || weekCoin || weekBooks.length) {
        say(`🃏 翻牌: 本次未翻开新卡片，本周累计 ${prizeText(weekCard, weekCoin, weekBooks)}`);
    } else {
        say(`🃏 翻牌: ❌ 本次未翻出奖励${failed ? ` (${failed} 次失败)` : ''}`);
    }
}

function prizeText(card, coin, books) {
    const p = [];
    if (card) p.push(`体验卡 ${card} 天`);
    if (coin) p.push(`书币 ${coin} 个`);
    if (books && books.length) p.push(books.join('、'));
    return p.length ? p.join(' · ') : '无奖励';
}

// 抓包确认: flipList 是本周已翻出的卡片对象数组; cardList 里 cardIndex>=0 才是本周翻出的牌
function getFlippedCards(data) {
    const flipList = Array.isArray(data.flipList) ? data.flipList : [];
    const objects = flipList.filter(c => c && typeof c === 'object' && !Array.isArray(c));
    if (objects.length) return objects;

    const cards = Array.isArray(data.cardList) ? data.cardList : [];
    const indexes = flipList.filter(i => typeof i === 'number');
    if (indexes.length) {
        const source = cards.length ? cards : (Array.isArray(data.initialList) ? data.initialList : []);
        return indexes.map(i => findCardByIndex(source, i) || source[i]).filter(Boolean);
    }
    return cards.filter(c => typeof c.cardIndex === 'number' && c.cardIndex >= 0);
}

function getCardIndex(card, fallbackIndex) {
    return card && typeof card.cardIndex === 'number' ? card.cardIndex : fallbackIndex;
}

function findCardByIndex(cards, cardIndex) {
    if (!Array.isArray(cards)) return null;
    for (let i = 0; i < cards.length; i++) if (getCardIndex(cards[i], i) === cardIndex) return cards[i];
    return null;
}

function pickNextFlip(data, order) {
    const cards = Array.isArray(data.cardList) ? data.cardList : [];
    const used = {};
    cards.forEach(c => { if (typeof c.cardIndex === 'number' && c.cardIndex >= 0) used[c.cardIndex] = true; });

    const candidates = [], seen = {};
    (Array.isArray(data.initialList) ? data.initialList : []).forEach((c, i) => {
        if (c.status === 0 && !used[i] && !seen[i]) { candidates.push(i); seen[i] = true; }
    });
    cards.forEach((c, i) => {
        if (c.status === 0 && !used[i] && !seen[i]) { candidates.push(i); seen[i] = true; }
    });
    if (!candidates.length) {
        for (const idx of order) if (!used[idx] && !seen[idx]) candidates.push(idx);
    }
    if (!candidates.length) return null;
    return { cardIndex: candidates[0], giftIndex: Array.isArray(data.flipList) ? data.flipList.length : 0 };
}

function describeCardPrize(card) {
    if (!card) return '未知奖励';
    if (card.bookInfo && card.bookInfo.title) return `《${card.bookInfo.title}》`;
    if (card.cardType === 'money' || card.type === 'money') {
        // 抓包确认: money 单位为「分」(money=100 → 书币 +1)
        const coins = typeof card.money === 'number' ? card.money / 100 : Number(card.count || card.amount || card.coins || 1);
        const v = Math.round(coins) || 1;
        return v > 1 ? `${v} 书币` : '书币';
    }
    if (card.cardType === 'infinite' || card.type === 'infinite') {
        // 抓包确认: infinite 单位为「天」(infinite=1 → 体验卡 +86400 秒)
        const days = Number(card.infinite || card.count || card.amount || card.days || 1) || 1;
        return days > 1 ? `体验卡${days}天` : '体验卡';
    }
    if (card.cardType === 'book') return card.bookInfo && card.bookInfo.title ? `《${card.bookInfo.title}》` : '书籍';
    return '未知奖励';
}

function describeFlipResult(data, flippedIndex) {
    if (!data) return '未知奖励';
    if (data.prizeName) return data.prizeName;
    if (data.reward) return data.reward;
    if (data.giftName) return data.giftName;

    const cards = Array.isArray(data.cardList) && data.cardList.length ? data.cardList : (Array.isArray(data.initialList) ? data.initialList : []);
    if (typeof flippedIndex === 'number') {
        for (let i = 0; i < cards.length; i++) {
            if (cards[i] && cards[i].cardIndex === flippedIndex) return describeCardPrize(cards[i]);
        }
        if (cards[flippedIndex]) return describeCardPrize(cards[flippedIndex]);
    }
    for (let i = 0; i < cards.length; i++) {
        const s = cards[i] && cards[i].status;
        if (s === 1 || s === 2 || s === 3 || s === 4) return describeCardPrize(cards[i]);
    }
    return '未知奖励';
}

function parsePrizeQuantity(prizeStr) {
    let cardDays = 0, coins = 0, books = [];
    if (!prizeStr) return { cardDays, coins, books };
    if (prizeStr.includes('体验卡') || prizeStr.includes('无限卡')) {
        const m = prizeStr.match(/(\d+)\s*天/);
        cardDays += m ? parseInt(m[1], 10) : 1;
    } else if (prizeStr.includes('书币')) {
        const m = prizeStr.match(/(\d+)\s*(?:个|书币)/);
        coins += m ? parseInt(m[1], 10) : 1;
    } else if (prizeStr.includes('《') || prizeStr.includes('书')) {
        books.push(prizeStr);
    }
    return { cardDays, coins, books };
}

// ---------- 任务三：每周限免好书入架 ----------
async function runFreeTask(acc, helpers) {
    let currentVol = getFreeVol();
    const locked = readFreeLock(acc.vid, currentVol);
    if (locked) {
        $.log(`[微信读书] 本周(期数 ${currentVol})已锁定领取结果: ${locked.addedBooks.join('、')}`);
        return say(`📚 限免: 本周已领 ${locked.addedBooks.join('、')}`);
    }

    // 1. 领书资格（每期最多 2 本）
    let reachedMax = false;
    const qualify = await authRequest(acc, a => ({ url: `${API}/checkfreequalify?type=book&vid=${a.vid}`, headers: appHeaders(a), _respType: 'all' }));
    const qData = $.toObj(qualify && qualify.body, null);
    if (qData && qData.reachedMax === 1) reachedMax = true;

    // 2. 书架现有图书，避免重复入架
    const shelfBookIds = {};
    const shelf = await authRequest(acc, a => ({ url: `${API}/shelf/sync?synckey=0&onlyBookid=1`, headers: appHeaders(a), _respType: 'all' }));
    const sData = $.toObj(shelf && shelf.body, null) || {};
    (sData.books || sData.bookIds || []).forEach(item => {
        const bid = typeof item === 'object' ? (item.bookId || item.id) : item;
        if (bid) shelfBookIds[String(bid)] = true;
    });

    // 3. 多通道聚合官方限免书单（18/50/120 三档列表并集）
    const libraryUrls = [
        `${API}/free/library/list?count=18&receiveStatus=1&type=book&vol=${currentVol}`,
        `${API}/free/library/list?count=50&receiveStatus=1&type=book&vol=${currentVol}`,
        `${API}/free/library/list?count=120&receiveStatus=1&type=book&v=2&vol=${currentVol}`,
        `${API}/free/library/list?count=120&receiveStatus=1&type=book&vol=${currentVol}`,
    ];
    const booksMap = new Map();
    let freeTimestamp = Math.floor(Date.now() / 1000);

    for (const u of libraryUrls) {
        const res = await authRequest(acc, a => ({ url: u, headers: appHeaders(a), _respType: 'all' }));
        if (!res || res.statusCode !== 200) continue;
        const data = $.toObj(res.body, null) || {};
        if (data.vol) currentVol = data.vol;
        if (data.timestamp) freeTimestamp = data.timestamp;
        (data.books || data.data || data.items || []).forEach(b => {
            const info = b.bookInfo || b.book || b;
            const bid = String(info.bookId || info.id || '');
            if (!bid) return;
            const title = String(info.title || info.name || '图书');
            const received = typeof b.received !== 'undefined' ? Number(b.received) : (typeof info.received !== 'undefined' ? Number(info.received) : 0);
            const deepLink = info.deepLink || '';
            const v = (deepLink.match(/[?&]v=([^&]+)/) || [])[1] || '';
            const sn = b.sn || '';
            const rawPrice = Number(info.originalPrice || info.price || info.centPrice || (info.priceInfo && info.priceInfo.price) || 0);
            const price = rawPrice > 100 ? rawPrice / 100 : rawPrice;   // 分转书币
            let rating = Number(info.newRating || 0);
            if (!rating && info.star) {
                const s = Number(info.star);
                rating = s <= 5 ? s * 200 : (s <= 100 ? s * 10 : s);
            }
            if (!rating && info.rating) {
                const r = Number(info.rating);
                rating = r <= 1 ? r * 1000 : (r <= 10 ? r * 100 : (r <= 100 ? r * 10 : r));
            }
            const newRating = Math.round(rating);
            const newRatingCount = Number(info.newRatingCount || info.ratingCount || info.commentCount || 0);

            let badgesStr = '';
            for (const key of ['badge', 'badges', 'cardTags']) {
                if (Array.isArray(info[key])) badgesStr += ' ' + info[key].map(x => (x && typeof x === 'object' ? (x.text || x.name || '') : String(x))).join(' ');
            }
            const rawTips = String((info.newRatingDetail && (info.newRatingDetail.title || info.newRatingDetail.word)) || info.ratingTips || info.starText || '');
            const allTagText = `${rawTips} ${badgesStr} ${String(info.rankingTitle || info.rankingTips || '')}`;
            // 官方「神作」判定: 显式标注，或 好评率>=92%且>=200 人，或 >=90%且>=1000 人
            const isGodTier = allTagText.includes('神作') || (newRating >= 920 && newRatingCount >= 200) || (newRating >= 900 && newRatingCount >= 1000);
            const ratingTitle = isGodTier ? '神作' : rawTips;

            const item = { bookId: bid, title, received, v, sn, price, newRating, newRatingCount, ratingTitle };
            const exist = booksMap.get(bid);
            if (!exist) booksMap.set(bid, item);
            else {
                if (received === 1) exist.received = 1;
                if (!exist.v && v) exist.v = v;
                if (!exist.sn && sn) exist.sn = sn;
                if (price > exist.price) exist.price = price;
                if (newRating > exist.newRating) exist.newRating = newRating;
                if (newRatingCount > exist.newRatingCount) exist.newRatingCount = newRatingCount;
                if (ratingTitle && !exist.ratingTitle) exist.ratingTitle = ratingTitle;
            }
        });
    }

    const books = Array.from(booksMap.values());
    if (!books.length) return say('📚 限免: 本期限免书库暂无新书');

    // 4. 分批查验已付费历史（单次 bookIds 过长会被截断）
    const paidEver = {}, paidThisVol = {};
    const volStart = getVolStartTime(currentVol);
    for (let i = 0; i < books.length; i += 30) {
        const chunk = books.slice(i, i + 30).map(b => b.bookId);
        const pay = await authRequest(acc, a => ({ url: `${API}/book/paytime?bookIds=${encodeURIComponent(chunk.join(','))}`, headers: appHeaders(a), _respType: 'all' }));
        const payData = $.toObj(pay && pay.body, null) || {};
        (payData.data || []).forEach(x => {
            if (x.bookId && x.time > 0) {
                paidEver[String(x.bookId)] = true;
                if (volStart > 0 && x.time >= volStart) paidThisVol[String(x.bookId)] = true;
            }
        });
    }

    // 5. 本期已拥有的书（官方 received 或本期付费），并同步进书架
    const claimedBooks = books.filter(b => b.received === 1 || paidThisVol[String(b.bookId)]);
    const claimedTitles = claimedBooks.map(b => `《${b.title}》`);
    if (claimedBooks.length) {
        await Request({
            url: `${API}/shelf/syncbook`, method: 'post', headers: appHeaders(acc), _respType: 'all',
            body: { bookIds: claimedBooks.map(b => String(b.bookId)), albumIds: [] }
        });
    }
    if (claimedTitles.length >= 2 || (reachedMax && claimedTitles.length > 0)) {
        writeFreeLock(acc.vid, currentVol, claimedTitles.slice(0, 2));
        return say(`📚 限免: 本周已领 ${claimedTitles.slice(0, 2).join('、')}`);
    }

    // 6. 候选过滤 + 智能打分
    let candidates = books.filter(b => b.received !== 1 && !paidEver[String(b.bookId)] && !shelfBookIds[String(b.bookId)] && b.v && b.sn);
    if (!candidates.length) {
        return say(claimedTitles.length ? `📚 限免: 本周已领 ${claimedTitles.join('、')}` : '📚 限免: 本期限免书库暂无可领新书');
    }

    const excludeRaw = (getEnv('weread_exclude_keywords') || '').trim();
    if (excludeRaw) {
        const kws = excludeRaw.split(/[,|，\s]+/).filter(Boolean);
        const filtered = candidates.filter(b => !kws.some(kw => b.title.includes(kw)));
        // 过滤后不足名额则回退全量候选，避免空手
        if (filtered.length >= 2 - claimedTitles.length) {
            candidates = filtered;
            $.log(`[微信读书] 已排除关键词 [${kws.join('|')}]，剩余 ${candidates.length} 本`);
        } else if (filtered.length) {
            candidates = filtered;
            $.log(`[微信读书] 排除关键词后仅剩 ${candidates.length} 本`);
        } else {
            $.log('[微信读书] 排除关键词后无可用新书，回退全量候选');
        }
    }

    const mode = (getEnv('weread_free_mode') || 'balanced').toLowerCase().trim();
    candidates.sort((a, b) => bookScore(b, mode) - bookScore(a, mode));
    $.log(`[微信读书] 限免优选（模式: ${modeName(mode)}，已排除已购/在架）:`);
    candidates.slice(0, 3).forEach((c, idx) => $.log(`  ${idx + 1}. 《${c.title}》 评分 ${c.newRating} 人评 ${c.newRatingCount} 售价 ${c.price} 书币`));

    const needCount = 2 - claimedTitles.length;
    const targetBooks = candidates.slice(0, needCount);
    const added = [...claimedTitles];
    const unclaimed = [];

    // 7. 小号助力兑换（每个小号每周限助力 1 本，故支持多号轮替）
    const list = (Array.isArray(helpers) ? helpers : (helpers ? [helpers] : [])).filter(h => h && h.vid);
    if (!list.length) {
        targetBooks.forEach(b => unclaimed.push({ title: b.title, url: shareLink(acc.vid, b, currentVol, freeTimestamp) }));
        return freeSummary(added, unclaimed, '未配置助力小号');
    }

    let helperIdx = 0;
    for (const b of targetBooks) {
        let done = false;
        const link = shareLink(acc.vid, b, currentVol, freeTimestamp);
        const actUrl = `${SHARE_API}?${shareQuery(acc.vid, b, currentVol, freeTimestamp)}`;
        while (helperIdx < list.length && !done) {
            const helper = list[helperIdx];
            const mask = maskVid(helper.vid);
            $.log(`[微信读书] 用小号 [${mask}] (第 ${helperIdx + 1}/${list.length} 个) 助力领取《${b.title}》...`);
            const res = await helperRequest(helper, h => ({ url: actUrl, headers: webCookieHeaders(h, link), _respType: 'all' }));
            const data = $.toObj(res && res.body, null) || {};
            const errMsg = data.errMsg || data.errmsg || '';

            if (res && res.statusCode === 200 && data.succ === 1 && !errMsg) {
                added.push(`《${b.title}》`);
                $.log(`[微信读书] 🎉 小号 [${mask}] 助力成功: 《${b.title}》`);
                done = true;
                helperIdx++;    // 该小号本周配额已用掉
            } else {
                $.log(`[微信读书] ❌ 小号 [${mask}] 助力《${b.title}》失败: ${errMsg || 'HTTP ' + (res && res.statusCode)}`);
                if (String(errMsg) === '-2057' || data.errCode === -2057) {
                    // 官方配额保护: 主账号本周已达 2 本上限
                    if (added.length) writeFreeLock(acc.vid, currentVol, added);
                    return say(`📚 限免: 本周名额已满（2 本），已领 ${added.join('、') || '无'}`);
                }
                helperIdx++;
                await sleep(1000);
            }
        }
        if (!done) unclaimed.push({ title: b.title, url: link });
    }

    if (added.length > claimedTitles.length) {
        writeFreeLock(acc.vid, currentVol, added);
        await Request({ url: `${API}/shelf/sync?album=1&onlyBookid=1`, headers: appHeaders(acc), _respType: 'all' });
    }
    return freeSummary(added, unclaimed, '小号助力未完成自动入架');
}

function freeSummary(added, unclaimed, fallback) {
    const lines = [];
    lines.push(`📚 限免: ${added.length ? `已入架 ${added.join('、')}` : fallback}`);
    if (unclaimed.length) {
        lines.push(`🔗 另 ${unclaimed.length} 本未自动入架，微信点开链接可秒领:`);
        unclaimed.forEach((b, idx) => lines.push(`  ${idx + 1}. 《${b.title}》 ${b.url}`));
    }
    lines.forEach(l => say(l));
}

// 助力分享参数: v/sn/timestamp 由限免书单下发，缺一个官方就不认这次助力
function shareQuery(vid, b, vol, timestamp) {
    return `type=1&senderVid=${vid}&v=${b.v}&wtype=shareOneGetOne2&scene=freeBooks&timestamp=${timestamp}&sn=${b.sn}&vol=${vol}`;
}

function shareLink(vid, b, vol, timestamp) {
    return `https://weread.qq.com/book-detail?${shareQuery(vid, b, vol, timestamp)}`;
}

function modeName(mode) {
    return mode === 'price' ? '最贵白嫖' : (mode === 'hot' ? '热门畅销' : '智能综合');
}

// 智能权重: 神作/好评如潮分级优先，同梯队内比售价，无评分绝对垫底
function bookScore(b, mode) {
    const hasRating = b.newRating > 0 && b.newRatingCount > 0;
    const isGodTier = (b.ratingTitle || '').includes('神作') || (b.newRating >= 920 && b.newRatingCount >= 200) || (b.newRating >= 900 && b.newRatingCount >= 1000);
    const isOverwhelming = (b.ratingTitle || '').includes('好评如潮') || (b.newRating >= 900 && b.newRatingCount >= 20);
    const isVeryGood = (b.ratingTitle || '').includes('特别好评') || (b.newRating >= 850 && b.newRatingCount >= 10);
    const price = b.price || 0;
    const count = Math.min(b.newRatingCount || 0, mode === 'hot' ? 50000 : 10000);

    if (mode === 'price') return price * 100000 + (hasRating ? b.newRating * 100 : 0) + (isGodTier ? 50000 : 0) + count * 10;
    if (mode === 'hot') return count * 100 + (hasRating ? b.newRating * 2000 : 0) + (isGodTier ? 5000000 : (isOverwhelming ? 2000000 : (isVeryGood ? 1000000 : 0))) + price * 100;

    let tier = 0;
    if (isGodTier) tier = 5000000;
    else if (isOverwhelming) tier = 3000000;
    else if (isVeryGood) tier = 2000000;
    else if (b.newRating >= 750) tier = 1000000;
    else if (hasRating) tier = b.newRating * 1000;
    return tier + price * (hasRating ? 2000 : 1000) + count * 10;
}

// 限免周度锁定: 单键存全部账号的本期结果，超过 CACHE_DAYS 天的条目随写入剔除
function readFreeLock(vid, vol) {
    const cache = $.toObj($.getdata(CACHE_KEY), null) || {};
    const one = cache[String(vid)];
    if (one && one.vol === vol && Array.isArray(one.addedBooks) && one.addedBooks.length >= 2) return one;
    return null;
}

function writeFreeLock(vid, vol, addedBooks) {
    const cache = $.toObj($.getdata(CACHE_KEY), null) || {};
    const deadline = Date.now() - CACHE_DAYS * 86400 * 1000;
    for (const k of Object.keys(cache)) if (!cache[k] || (cache[k].time && cache[k].time < deadline)) delete cache[k];
    cache[String(vid)] = { vol, addedBooks, time: Date.now() };
    $.setdata($.toStr(cache), CACHE_KEY);
}

// 当期期数标识: 北京时间周四更新，格式 YYYYMMDD
function getFreeVol() {
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - (day >= 4 ? day - 4 : day + 3));
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

// 指定期数的起始时间戳（北京时间周四 00:00:00，秒级）
function getVolStartTime(volStr) {
    if (volStr && /^\d{8}$/.test(volStr)) {
        return Math.floor(Date.UTC(+volStr.slice(0, 4), +volStr.slice(4, 6) - 1, +volStr.slice(6, 8)) / 1000) - 8 * 3600;
    }
    return 0;
}

// ---------- 凭证与请求头 ----------

function maskVid(vid) {
    const s = String(vid || '');
    return s.length > 4 ? s.slice(0, 4) + '****' : (s || '未知');
}

function appHeaders(acc) {
    return {
        'User-Agent': APP_UA,
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'basever': APP_VER,
        'channelid': 'AppStore',
        'v': APP_VER,
        'vid': String(acc.vid || ''),
        'skey': acc.skey || ''
    };
}

function flipHeaders(acc) {
    return {
        'User-Agent': FLIP_UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
        'Referer': 'https://weread.qq.com/flip-card-game?isAnimateNavBarBackground=1&isShowNavBarShadow=0&isStatusbarLight=1',
        'Cookie': `wr_skey=${acc.accessToken || acc.skey || ''}; wr_vid=${acc.vid || ''}`
    };
}

function webCookieHeaders(helper, referer) {
    return {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.78(0x18004e31) NetType/WIFI Language/zh_CN',
        'Referer': referer,
        'Cookie': helper.cookie
    };
}

// 业务请求: 命中 401/403/499 时脱机换票并重试一次
async function authRequest(acc, build) {
    const first = await Request(build(acc));
    const st = first && first.statusCode;
    if (st === 401 || st === 403 || st === 499) {
        $.log(`[微信读书] HTTP ${st}，尝试 /login 脱机换票...`);
        if (await refreshLogin(acc)) return (await Request(build(acc))) || first;
    }
    return first;
}

// 助力小号请求: 先走 wr_rt 续期，再退到 /login 换票
async function helperRequest(helper, build) {
    let res = await Request(build(helper));
    if (res && res.statusCode === 401) {
        if (helper.rt) {
            $.log(`[微信读书] 小号 [${maskVid(helper.vid)}] skey 过期，正在 /web/login/renewal 续期...`);
            if (await renewWebCookie(helper)) res = await Request(build(helper));
        }
        if ((!res || res.statusCode === 401) && helper.refreshToken && helper.deviceId && await refreshLogin(helper, false)) {
            // 换票后要把新的 accessToken 写回 Cookie 串，否则下一次助力仍带旧 skey
            helper.skey = helper.accessToken || helper.skey;
            helper.cookie = setCookieValue(helper.cookie, 'wr_skey', helper.skey);
            $.log(`[微信读书] 小号 [${maskVid(helper.vid)}] 改用 /login 换票重试`);
            res = await Request(build(helper));
        }
    }
    return res;
}

// 脱机换票: 用 refreshToken+deviceId 自算 signature 换新 skey
async function refreshLogin(acc, persist = true) {
    if (!acc.refreshToken || !acc.deviceId) {
        $.log('[微信读书] 缺少 refreshToken 或 deviceId，跳过脱机换票（需开启抓取后退出重登一次以捕获长效种子）');
        return null;
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const random = Math.floor(Math.random() * 900000000) + 100000000;
    const signature = computeLoginSignature(acc.refreshToken, acc.deviceId, { random, timestamp });
    const res = await Request({
        url: `${API}/login`, method: 'post', _respType: 'all',
        headers: {
            'User-Agent': APP_UA, 'Content-Type': 'application/json',
            'basever': APP_VER, 'channelid': 'AppStore', 'v': APP_VER, 'vid': String(acc.vid || '')
        },
        body: {
            random, deviceId: acc.deviceId, refCgi: '', deviceName: 'iPhone', signature,
            refreshToken: acc.refreshToken, wxToken: 1, timestamp, inBackground: 0, deviceToken: ''
        }
    });
    if (!res || res.statusCode !== 200) {
        $.log(`[微信读书] ❌ /login 换票失败 HTTP ${(res && res.statusCode) || '请求异常'}: ${String((res && res.body) || '').slice(0, 100)}`);
        return null;
    }
    const data = $.toObj(res.body, null);
    if (!data || !data.vid || !data.skey) {
        $.log(`[微信读书] ❌ /login 响应异常: ${String(res.body || '').slice(0, 120)}`);
        return null;
    }
    acc.vid = String(data.vid);
    acc.skey = data.skey;
    if (data.accessToken) acc.accessToken = data.accessToken;
    if (data.refreshToken) acc.refreshToken = data.refreshToken;
    if (persist) persistAccounts();
    $.log(`[微信读书] 🎉 脱机换票成功: 新 skey=${String(acc.skey).slice(0, 8)}****`);
    return acc;
}

// 小号 Web Cookie 续期（wr_rt 种子）
async function renewWebCookie(helper) {
    const res = await Request({
        url: WEB_LOGIN, method: 'post', _respType: 'all',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'Origin': 'https://weread.qq.com',
            'Referer': 'https://weread.qq.com/web/book/read',
            'Cookie': helper.cookie
        },
        body: { rq: '%2Fweb%2Fbook%2Fread', ql: false }
    });
    const data = $.toObj(res && res.body, null) || {};
    const renewed = pickCookie(res && res.headers);
    if (res && res.statusCode === 200 && (data.succ === 1 || renewed.wr_skey)) {
        if (renewed.wr_skey) helper.cookie = setCookieValue(helper.cookie, 'wr_skey', renewed.wr_skey);
        if (renewed.wr_rt) helper.cookie = setCookieValue(helper.cookie, 'wr_rt', renewed.wr_rt);
        helper.skey = renewed.wr_skey || helper.skey;
        helper.rt = renewed.wr_rt || helper.rt;
        $.log(`[微信读书] 🎉 小号 [${maskVid(helper.vid)}] Web Cookie 续期成功`);
        return helper;
    }
    $.log(`[微信读书] ⚠️ 小号 Web Cookie 续期失败: ${data.errMsg || ('HTTP ' + (res && res.statusCode))}`);
    return null;
}

// ---------- 账号解析与抓取 ----------

// weread_data 只认抓取写入的对象数组格式: [{vid,skey,accessToken,refreshToken,deviceId}]
function parseAccounts(raw) {
    if (!raw) return [];
    const obj = typeof raw === 'object' ? raw : $.toObj(raw, null);
    const list = Array.isArray(obj) ? obj : (obj && typeof obj === 'object' ? [obj] : []);
    const out = [];
    for (const e of list) {
        if (!e || typeof e !== 'object') continue;
        const vid = String(e.vid || '').trim();
        if (!vid) continue;
        const acc = {
            vid,
            skey: String(e.skey || '').trim(),
            accessToken: String(e.accessToken || '').trim(),
            refreshToken: String(e.refreshToken || '').trim(),
            deviceId: String(e.deviceId || '').trim()
        };
        const i = out.findIndex(u => u.vid === vid);
        if (i === -1) out.push(acc); else out[i] = acc;
    }
    return out;
}

function toHelper(acc) {
    const skey = acc.accessToken || acc.skey || '';
    return {
        vid: acc.vid, skey, rt: '',
        cookie: `wr_vid=${acc.vid}; wr_skey=${skey}; wr_loggedIn=1;`,
        refreshToken: acc.refreshToken || '', deviceId: acc.deviceId || ''
    };
}

// 助力小号: 支持微信里抓到的完整 Cookie / JSON 数组 / 「VID#SKEY#RT」每行一个
function parseHelpers(raw) {
    if (!raw) return [];
    const text = String(raw).replace(/\\([_@])/g, '$1').trim();
    let list = [];
    if (text.startsWith('[')) {
        const arr = $.toObj(text, null);
        if (Array.isArray(arr)) list = arr;
    } else if (text.startsWith('{')) {
        list = [text];
    } else {
        list = text.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
    }
    const out = [];
    for (const item of list) {
        const h = parseOneHelper(item);
        if (h && !out.some(e => e.vid === h.vid)) out.push(h);
    }
    return out;
}

function parseOneHelper(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') {
        const vid = String(raw.vid || raw.wrVid || '').trim();
        const skey = String(raw.wrSkey || raw.skey || raw.accessToken || '').trim();
        if (!vid && !skey) return null;
        return buildHelper(vid, skey, String(raw.wrRt || raw.wr_rt || ''), raw.cookie || raw.rawCookie || '', raw);
    }
    const s = String(raw).trim();
    if (!s) return null;
    if (s.startsWith('{')) {
        const obj = $.toObj(s, null);
        return obj ? parseOneHelper(obj) : null;
    }
    if (s.includes('wr_vid') || s.includes('wr_skey')) {
        const picked = pickCookieString(s);
        return buildHelper(picked.wr_vid || '', picked.wr_skey || '', picked.wr_rt || '', s);
    }
    const parts = s.split(/[#@]/).map(x => x.trim()).filter(Boolean);
    if (parts.length >= 2) return buildHelper(parts[0], parts[1], parts[2] || '');
    return null;
}

function buildHelper(vid, skey, rt, cookie, seed) {
    if (!vid && !skey) return null;
    return {
        vid,
        skey,
        rt,
        cookie: cookie || `wr_vid=${vid}; wr_skey=${skey};${rt ? ` wr_rt=${rt};` : ''} wr_loggedIn=1;`,
        refreshToken: (seed && seed.refreshToken) || '',
        deviceId: (seed && seed.deviceId) || ''
    };
}

// 从 cookie 串里挑微信读书需要的三项
function pickCookieString(text) {
    const out = {};
    for (const part of String(text).split(/;\s*/)) {
        const m = /^\s*([A-Za-z0-9_.-]+)=([^;]*)/.exec(part);
        if (m) out[m[1]] = m[2].trim();
    }
    return out;
}

// 替换 cookie 串里某一项的值（没有则追加）
function setCookieValue(cookie, key, value) {
    const text = String(cookie || '');
    if (!new RegExp(key + '=').test(text)) return `${text}${text ? '; ' : ''}${key}=${value};`;
    return text.replace(new RegExp(key + '=[^;,]*'), `${key}=${value}`);
}

// 收集响应里的 Set-Cookie（数组与逗号拼接串两种形态，键名大小写不定）
function pickCookie(headers) {
    const out = {};
    const raw = ObjectKeys2LowerCase(headers || {})['set-cookie'];
    if (!raw) return out;
    for (const item of Array.isArray(raw) ? raw : [raw]) {
        for (const part of String(item).split(/,(?=\s*[A-Za-z0-9_.-]+=)/)) {
            const m = /^\s*([A-Za-z0-9_.-]+)=([^;]*)/.exec(part);
            if (m) out[m[1]] = m[2].trim();
        }
    }
    return out;
}

// 获取账号数据 (rewrite 抓取入口: 响应体取 vid/skey/accessToken，请求体取 refreshToken/deviceId)
// 未命中属正常不匹配，静默返回，避免同一次登录多条报文刷屏
function GetCookie() {
    try {
        const url = ($request && $request.url) || '';
        if ($request && $request.method === 'OPTIONS') return;
        if (!CAPTURE_REGEX.test(url)) return;
        if (typeof $response === 'undefined') return;

        const body = $response && typeof $response.body === 'string' ? $response.body : $.toStr($response && $response.body, '') || '';
        const data = $.toObj(body, null);
        if (!data || !data.vid || !data.skey) {
            debug(`登录响应里没有 vid/skey: ${body.slice(0, 80) || '(空)'}`, '抓取');
            return;
        }

        const reqBody = (() => {
            const b = $request && $request.body;
            if (typeof b === 'string') return $.toObj(b, null) || {};
            return b && typeof b === 'object' ? b : {};
        })();
        const refreshToken = String(data.refreshToken || reqBody.refreshToken || '').trim();
        const deviceId = String(reqBody.deviceId || data.deviceId || '').trim();
        if (!refreshToken || !deviceId) {
            debug('登录报文未带 refreshToken/deviceId 种子，仅保存短期凭证', '抓取');
        }

        const acc = {
            vid: String(data.vid),
            skey: String(data.skey),
            accessToken: String(data.accessToken || ''),
            refreshToken,
            deviceId
        };
        const old = $.userArr.find(e => e.vid === acc.vid);
        if (old) {
            const changed = ['skey', 'accessToken', 'refreshToken', 'deviceId'].some(k => String(old[k] || '') !== acc[k]);
            if (!changed) {
                $.log(`[微信读书] 账号 ${maskVid(acc.vid)} 无变化，不重复写入`);
                return;
            }
            Object.assign(old, acc);
            persistAccounts();
            $.Messages.push(`🎉微信读书凭证已更新: ${maskVid(acc.vid)}`);
            $.log(`[微信读书] 🎉 账号 ${maskVid(acc.vid)} 凭证已更新`);
        } else {
            $.userArr.push(acc);
            persistAccounts();
            $.Messages.push(`🎉获取微信读书账号成功: ${maskVid(acc.vid)}${refreshToken && deviceId ? '（已含脱机换票种子）' : '（缺 refreshToken/deviceId，过期需重抓）'}`);
            $.log(`[微信读书] 🎉 新账号 ${maskVid(acc.vid)} 已写入 ${DATA_KEY}`);
        }
    } catch (e) {
        debug(`抓取异常: ${e.message || e}`, '抓取');
    }
}

function persistAccounts() {
    $.setdata($.toStr($.userArr), DATA_KEY);
}

// 同步输出：日志逐条即时，通知按账号累加
function say(msg) {
    $.log(msg);
    $.Messages.push(msg);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ---------- 工具函数 ----------

// key 转小写 (抓包头大小写不定)
function ObjectKeys2LowerCase(obj = {}) { return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v])); }

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

// ============================================================
// 微信读书 /login signature: S-box 置换 + 异或轮转 + 双轮 SHA256
// (逆向还原自 WeRead 10.2.0 ARM64 sub_1004d7878, 已用 Node crypto 逐字节比对)
// ============================================================
const WE_READ_TABLE_HEX = "34ca55401db693c63130293532a7b811c2b516fa8bb124a4109004e908f83b8a9c8c44f9bc5c69e2a1dad2d37589f71e2d5056d77253bf22fb200f012e45876e6648f2e0cdfe67a943f49451cea54aee13268eccaa33145d0e39bbcf912b814dea99ec1a2c85c5d936744b18e1f13d9d419fb4170dd64cbedcaf972877f062ff71c1c8278f6c68a89be6591c1b1209984e3f063700ba1f0a192fc9d5d057496ffd25e4610c42cb96645fdbad60238d9a6dc3c45e3eb9926abd5b077f7695ed4fab847a80e778c7e5eb73836bfc38467d4765b352633a05d1efa3a6de9e3c02aeb27ba0f6f32ac0ac86035a540bf582d47ee3dfb0d8dd21e87c88a2795870b715";
const WE_READ_TABLE = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
    WE_READ_TABLE[i] = parseInt(WE_READ_TABLE_HEX.substr(i * 2, 2), 16);
}

const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function sha256Uint8(bytes) {
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const n = bytes.length;
    const bitLen = n * 8;
    const padLen = (n % 64 < 56) ? (56 - n % 64) : (120 - n % 64);
    const padded = new Uint8Array(n + padLen + 8);
    padded.set(bytes);
    padded[n] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 4, bitLen >>> 0, false);
    dv.setUint32(padded.length - 8, (bitLen / 4294967296) >>> 0, false);

    const W = new Uint32Array(64);
    for (let off = 0; off < padded.length; off += 64) {
        const block = padded.subarray(off, off + 64);
        const bdv = new DataView(block.buffer, block.byteOffset, block.byteLength);
        for (let i = 0; i < 16; i++) W[i] = bdv.getUint32(i * 4, false);
        for (let i = 16; i < 64; i++) {
            const s0 = (W[i - 15] >>> 7 | W[i - 15] << 25) ^ (W[i - 15] >>> 18 | W[i - 15] << 14) ^ (W[i - 15] >>> 3);
            const s1 = (W[i - 2] >>> 17 | W[i - 2] << 15) ^ (W[i - 2] >>> 19 | W[i - 2] << 13) ^ (W[i - 2] >>> 10);
            W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
        }

        let [a, b, c, d, e, f, g, h] = H;
        for (let i = 0; i < 64; i++) {
            const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
            const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) >>> 0;
            h = g; g = f; f = e; e = (d + t1) >>> 0;
            d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
        H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }

    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i], false);
    return out;
}

function strToBytes(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) { out.push(0xc0 | c >> 6, 0x80 | c & 0x3f); }
        else { out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 0x3f, 0x80 | c & 0x3f); }
    }
    return new Uint8Array(out);
}

function bytesToHex(bytes) {
    const hex = "0123456789abcdef";
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += hex[bytes[i] >> 4] + hex[bytes[i] & 0xf];
    return s;
}

function subBytes(str) {
    const b = strToBytes(str);
    const out = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = WE_READ_TABLE[b[i]];
    return out;
}

function simRotateBytes(arr, shift) {
    const L = arr.length;
    if (L === 0) return new Uint8Array(0);
    const dest = new Uint8Array(L);
    let curr = shift;
    for (let i = 0; i < L; i++) {
        dest[curr % L] = arr[i];
        curr++;
    }
    return dest;
}

function xorSumBytes(arr) {
    let res = 0;
    for (let i = 0; i < arr.length; i++) res ^= arr[i];
    return res;
}

function compareByteArrays(a, b) {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return a.length - b.length;
}

function computeLoginSignature(refreshToken, deviceId, body) {
    let random = body.random;
    let ts = body.timestamp;
    let logoToken = "5ecdcfd7f";

    const s0 = subBytes(String(ts));
    const s1 = subBytes(String(random));
    const s2 = subBytes(logoToken);
    const s3 = subBytes(deviceId);
    const s4 = strToBytes("5a6f1");
    const s5 = subBytes(refreshToken);

    const list = [s0, s1, s2, s3, s4, s5];
    list.sort(compareByteArrays);

    let totalLen = 0;
    for (let i = 0; i < list.length; i++) totalLen += list[i].length;
    const concat = new Uint8Array(totalLen);
    let off = 0;
    for (let i = 0; i < list.length; i++) {
        concat.set(list[i], off);
        off += list[i].length;
    }

    const shift1 = xorSumBytes(concat) % 11;
    const rot1 = simRotateBytes(concat, shift1);

    const hash1Hex = bytesToHex(sha256Uint8(rot1));
    const hex1Ascii = strToBytes(hash1Hex);

    const shift2 = xorSumBytes(hex1Ascii) % 11;
    const rot2 = simRotateBytes(hex1Ascii, shift2);

    return bytesToHex(sha256Uint8(rot2));
}

// 脚本执行入口: $request 存在 → 抓取模式, 否则 → 定时任务模式
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
    });

function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, r) => { s.call(this, t, ((t, s, a) => { t ? r(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, r) => e(r))) })) } runScript(t, e) { return new Promise((s => { let r = this.getdata("@chavy_boxjs_userCfgs.httpapi"); r = r ? r.replace(/\n/g, "").trim() : r; let a = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); a = a ? 1 * a : 20, a = e && e.timeout ? e.timeout : a; const [i, o] = r.split("@"), n = { url: `http://${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: a }, headers: { "X-Key": i, Accept: "*/*" }, timeout: a }; this.post(n, ((t, e, r) => s(r))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e); if (!s && !r) return {}; { const r = s ? t : e; try { return JSON.parse(this.fs.readFileSync(r)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), r = !s && this.fs.existsSync(e), a = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, a) : r ? this.fs.writeFileSync(e, a) : this.fs.writeFileSync(t, a) } } lodash_get(t, e, s = void 0) { const r = e.replace(/\[(\d+)\]/g, ".$1").split("."); let a = t; for (const t of r) if (a = Object(a)[t], void 0 === a) return s; return a } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, r) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[r + 1]) >> 0 == +e[r + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, r] = /^@(.*?)\.(.*?)$/.exec(t), a = s ? this.getval(s) : ""; if (a) try { const t = JSON.parse(a); e = t ? this.lodash_get(t, r, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, r, a] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(r), o = r ? "null" === i ? null : i || "{}" : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, a, t), s = this.setval(JSON.stringify(e), r) } catch (e) { const i = {}; this.lodash_set(i, a, t), s = this.setval(JSON.stringify(i), r) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: r, statusCode: a, headers: i, rawBody: o } = t, n = s.decode(o, this.encoding); e(null, { status: r, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: r, response: a } = t; e(r, a, a && s.decode(a.rawBody, this.encoding)) })) } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, r) => { !t && s && (s.body = r, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, r) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: r, headers: a, body: i, bodyBytes: o } = t; e(null, { status: s, statusCode: r, headers: a, body: i, bodyBytes: o }, i, o) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let r = require("iconv-lite"); this.initGotEnv(t); const { url: a, ...i } = t; this.got[s](a, i).then((t => { const { statusCode: s, statusCode: a, headers: i, rawBody: o } = t, n = r.decode(o, this.encoding); e(null, { status: s, statusCode: a, headers: i, rawBody: o, body: n }, n) }), (t => { const { message: s, response: a } = t; e(s, a, a && r.decode(a.rawBody, this.encoding)) })) } } time(t, e = null) { const s = e ? new Date(e) : new Date; let r = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in r) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? r[e] : ("00" + r[e]).substr(("" + r[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let r = t[s]; null != r && "" !== r && ("object" == typeof r && (r = JSON.stringify(r)), e += `${s}=${r}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", r = "", a) { const i = t => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: return { url: t.url || t.openUrl || t["open-url"] }; case "Loon": return { openUrl: t.openUrl || t.url || t["open-url"], mediaUrl: t.mediaUrl || t["media-url"] }; case "Quantumult X": return { "open-url": t["open-url"] || t.url || t.openUrl, "media-url": t["media-url"] || t.mediaUrl, "update-pasteboard": t["update-pasteboard"] || t.updatePasteboard }; case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, r, i(a)); break; case "Quantumult X": $notify(e, s, r, i(a)); case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), r && t.push(r), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, t.stack) } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }
