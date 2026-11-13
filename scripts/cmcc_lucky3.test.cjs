'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 只读取源码；绝不 require 主脚本，也不执行其顶层初始化。
const source = fs.readFileSync(path.join(__dirname, '../scripts/cmcc_sign.js'), 'utf8');
const TODAY = '2026-11-13';
const INFO = '/cmpp-manage/task/getTaskSignInfo';
const SIGN = '/cmpp-manage/task/accumulateSign';
const cfg = { taskId: 3157, channelCode: 'test', wtAc: 'test', referer: 'offline-page', countAsSigned: false, infoBody: { taskId: 3157, needLimit: 0 } };
const info = n => ({ resultCode: 0, data: { accumulateCount: n } });
const plain = value => JSON.parse(JSON.stringify(value));
const forbidden = () => { throw new Error('禁止未注入的外部调用'); };

function extract(name) {
    const match = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(source);
    assert.ok(match, `缺少函数 ${name}`);
    // 指定函数均使用列首闭合大括号；提前校验边界，避免把顶层带入 vm。
    const end = source.indexOf('\n}', match.index);
    assert.ok(end > match.index, `缺少函数结束边界 ${name}`);
    const text = source.slice(match.index, end + 2);
    assert.equal((text.match(/^(?:async )?function /gm) || []).length, 1);
    return text;
}

function load(names, bindings = {}) {
    const context = vm.createContext({
        Request: forbidden, fetch: forbidden,
        $: { log() {}, wait: async () => {}, toObj: (s, fallback) => {
            try { return JSON.parse(s); } catch { return fallback; }
        } },
        coc3Uuid: () => 'offline-uuid',
        ...bindings,
    }, { codeGeneration: { strings: false, wasm: false } });
    const api = new vm.Script(`${names.map(extract).join('\n')}\n;({${names.join(',')}});`, {
        filename: 'cmcc_sign.extracted.vm.js',
    }).runInContext(context, { timeout: 1000 });
    return { api, context };
}

function signHarness(reads, response = { resultCode: 0, data: [] }, state = {}) {
    const calls = [];
    const queue = [...reads];
    const { api } = load(['l3SignCount', 'l3Sign', 'coc3Sign'], {
        coc3Post: async (cred, endpoint, body, referer) => {
            calls.push({ cred, endpoint, body: plain(body), referer });
            if (endpoint === SIGN) {
                if (response instanceof Error) throw response;
                return response;
            }
            assert.equal(endpoint, INFO);
            assert.ok(queue.length, '不允许超出预设的回查次数');
            const value = queue.shift();
            if (value instanceof Error) throw value;
            return value;
        },
    });
    return { state, calls, api, queue, run: () => api.coc3Sign('offline-cred', state, TODAY, cfg) };
}

function confirmed(h, result, n) {
    assert.equal(result.status, 'confirmed');
    assert.equal(result.count, n);
    assert.equal(h.state.signDate, TODAY);
    assert.equal(h.state.confirmedDate, TODAY);
    assert.equal(h.state.signCount, n);
    assert.equal(h.state.pendingSign, undefined);
}

function pending(h, result, before) {
    assert.equal(result.status, 'pending');
    assert.equal(h.state.signDate, undefined);
    assert.equal(h.state.confirmedDate, undefined);
    assert.equal(h.state.signCount, undefined);
    assert.deepEqual(plain(h.state.pendingSign), { d: TODAY, before });
}

const { api: counters } = load(['l3SignCount']);
for (const n of [0, 1, 12, '0', '12', Number.MAX_SAFE_INTEGER]) {
    test(`l3SignCount 接受有效次数 ${JSON.stringify(n)}`, () => {
        assert.equal(counters.l3SignCount(info(n)), Number(n));
    });
}
for (const [label, value] of [
    ['null', null], ['undefined', undefined], ['空串', ''], ['负数', -1],
    ['小数', 1.5], ['NaN', NaN], ['Infinity', Infinity], ['非数字', 'abc'],
    ['true', true], ['false', false], ['超安全整数', Number.MAX_SAFE_INTEGER + 1],
]) {
    test(`l3SignCount 拒绝 ${label}`, () => assert.equal(counters.l3SignCount(info(value)), null));
}
for (const [label, response] of [
    ['无响应', null], ['空对象', {}], ['无 data', { resultCode: 0 }],
    ['无次数', { resultCode: 0, data: {} }], ['错误码', { resultCode: 500, data: { accumulateCount: 5 } }],
    ['字符串成功码', { resultCode: '0', data: { accumulateCount: 5 } }],
]) {
    test(`l3SignCount 拒绝响应 ${label}`, () => assert.equal(counters.l3SignCount(response), null));
}

for (const [label, awards] of [['有奖励', [{ awardName: '测试奖励' }]], ['空奖励', []]]) {
    test(`l3Sign ${label}且服务端递增才确认`, async () => {
        const h = signHarness([info(2), info(3)], { resultCode: 0, data: awards });
        confirmed(h, await h.run(), 3);
        assert.deepEqual(h.calls.map(c => c.endpoint), [INFO, SIGN, INFO]);
        assert.deepEqual(h.calls[1].body, { taskId: 3157, channelCode: 'test', needLimit: 0, wtAc: 'test', wtAcId: 'offline-uuid' });
        assert.equal(h.calls[1].referer, cfg.referer);
        assert.deepEqual(plain(h.state.countSeen), { d: TODAY, c: 3 });
    });
}
test('l3Sign 延迟至第三次回查递增', async () => {
    const h = signHarness([info(2), info(2), info(2), info(3)]);
    confirmed(h, await h.run(), 3);
    assert.equal(h.calls.length, 5);
});
test('l3Sign 奖励数组不替代落账，清除旧 signDate', async () => {
    const h = signHarness([info(2), info(2), info(2), info(2)], { resultCode: 0, data: [{ awardName: '奖励' }] }, { signDate: TODAY, signCount: 99 });
    pending(h, await h.run(), 2);
});
for (const response of [
    { resultCode: 500 }, { resultCode: 502 },
    { resultCode: 500, msg: '重复请求' }, { resultCode: 502, msg: '请求重复，请稍后重试' },
    { resultCode: -1, msg: '未签到' }, { resultCode: -1, msg: '查询已签到记录失败' },
]) {
    test(`l3Sign 不泛认已签 ${JSON.stringify(response)}`, async () => {
        const h = signHarness([info(2), info(2), info(2), info(2)], response);
        pending(h, await h.run(), 2);
    });
}
for (const msg of ['本日已签到,次日再来签到吧', '今日已签到', '今天您已签到！', '已签到']) {
    test(`l3Sign 明确服务端语义 ${msg}`, async () => {
        const h = signHarness([info(2), info(2), info(2), info(2)], { resultCode: -9014, msg });
        confirmed(h, await h.run(), 2);
    });
}
test('l3Sign 旧 signDate 和昨天 countSeen 不阻断写入', async () => {
    const h = signHarness([info(8), info(9)], undefined, { signDate: TODAY, signCount: 8, countSeen: { d: '2026-11-12', c: 7 } });
    confirmed(h, await h.run(), 9);
    assert.equal(h.calls.filter(c => c.endpoint === SIGN).length, 1);
});
test('l3Sign 已确认今天仍读取服务端次数且不写', async () => {
    const h = signHarness([info(9)], undefined, { confirmedDate: TODAY, signDate: TODAY, signCount: 8 });
    confirmed(h, await h.run(), 9);
    assert.deepEqual(h.calls.map(c => c.endpoint), [INFO]);
});
test('l3Sign pending 后续落账直接回查，不再写入', async () => {
    const h = signHarness([info(2), info(2), info(2), info(2), info(3)]);
    pending(h, await h.run(), 2);
    confirmed(h, await h.run(), 3);
    assert.equal(h.calls.filter(c => c.endpoint === SIGN).length, 1);
    assert.equal(h.queue.length, 0);
});
test('l3Sign 网络异常后 pending，重跑未落账可再次写入并确认', async () => {
    let writes = 0;
    const reads = [2, 2, 2, 2, 2, 3];
    const state = {};
    const { api } = load(['l3SignCount', 'l3Sign'], {
        coc3Post: async (_, endpoint) => {
            if (endpoint === INFO) return info(reads.shift());
            assert.equal(endpoint, SIGN);
            if (++writes === 1) throw new Error('离线模拟连接中断');
            return { resultCode: 0, data: [] };
        },
    });
    pending({ state }, await api.l3Sign('cred', state, TODAY, cfg), 2);
    confirmed({ state }, await api.l3Sign('cred', state, TODAY, cfg), 3);
    assert.equal(writes, 2);
    assert.equal(reads.length, 0);
});
for (const bad of [null, '', -1, 'bad', true]) {
    test(`l3Sign 初始次数非法不写 ${JSON.stringify(bad)}`, async () => {
        const h = signHarness([info(bad)]);
        const result = await h.run();
        assert.equal(result.status, 'unknown');
        assert.equal(result.count, null);
        assert.deepEqual(h.state, {});
        assert.deepEqual(h.calls.map(c => c.endpoint), [INFO]);
    });
}
test('l3Sign 初始查询抛错不写', async () => {
    const h = signHarness([new Error('离线读失败')]);
    assert.equal((await h.run()).status, 'unknown');
    assert.equal(h.calls.length, 1);
});
test('l3Sign 后续查询无效保留 pending，不虚增', async () => {
    const h = signHarness([info(2), null, info('bad'), new Error('离线读失败')]);
    const result = await h.run();
    pending(h, result, 2);
    assert.equal(result.count, 2);
});

function postHarness(request) {
    const requests = [], waits = [];
    const { api } = load(['coc3Post'], {
        SEED_BASE: 'https://offline.invalid', SEED_PAGE_URL: 'offline-default',
        coc3Headers: (cred, referer) => ({ phone: cred, referer }),
        Request: async options => { requests.push(options); return request(options, requests.length); },
        $: { wait: async n => waits.push(n), toObj: (s, fallback) => {
            try { return JSON.parse(s); } catch { return fallback; }
        } },
    });
    return { requests, waits, post: api.coc3Post };
}
for (const endpoint of [SIGN, '/cmpp-manage/lottery/lottery']) {
    for (const wantResp of [false, true]) {
        test(`coc3Post 写请求异常不重放 ${endpoint} all=${wantResp}`, async () => {
            const h = postHarness(() => { throw new Error('离线网络失败'); });
            const result = await h.post('cred', endpoint, {}, undefined, null, wantResp);
            assert.equal((wantResp ? result.json : result).resultCode, 'NETWORK_ERROR');
            if (wantResp) assert.equal(result.resp, null);
            assert.equal(h.requests.length, 1);
            assert.deepEqual(h.waits, []);
        });
    }
}
test('coc3Post 查询异常只重试一次', async () => {
    const h = postHarness((_, n) => { if (n === 1) throw new Error('离线抖动'); return info(4); });
    assert.equal((await h.post('cred', INFO, {})).data.accumulateCount, 4);
    assert.equal(h.requests.length, 2);
    assert.deepEqual(h.waits, [1000]);
});
test('coc3Post 查询连续失败返回错误', async () => {
    const h = postHarness(() => { throw new Error('离线失败'); });
    assert.equal((await h.post('cred', INFO, {})).resultCode, 'NETWORK_ERROR');
    assert.equal(h.requests.length, 2);
});
test('coc3Post 保留完整响应并合并头部', async () => {
    const response = { body: '{"code":"60000"}', headers: { marker: 'test' } };
    const h = postHarness(() => response);
    const result = await h.post('cred', SIGN, { a: 1 }, 'offline-ref', { marker: 'extra' }, true);
    assert.equal(result.resp, response);
    assert.equal(result.json.code, '60000');
    assert.deepEqual(plain(h.requests[0].headers), { phone: 'cred', referer: 'offline-ref', marker: 'extra' });
    assert.equal(h.requests[0]._respType, 'all');
});
for (const wantResp of [false, true]) {
    test(`coc3Post 空响应不重放 all=${wantResp}`, async () => {
        const h = postHarness(() => null);
        const result = await h.post('cred', SIGN, {}, undefined, null, wantResp);
        assert.equal((wantResp ? result.json : result).resultCode, 'NO_RESP');
        assert.equal(h.requests.length, 1);
    });
}

const user = { userCheckId: 'offline-user', userName: '离线账号' };
function runHarness(options = {}) {
    let stored = JSON.stringify(options.initial || {});
    const signs = [], draws = [], saves = [], poolQueries = [];
    const pools = options.pools || [{ id: 1, name: '池一' }, { id: 2, name: '池二' }, { id: 3, name: '池三' }];
    const bindings = {
        L3_STATE_KEY: 'offline-state', L3_TASK_ID: 3157, L3_PAGE_URL: 'offline-page', L3_SIGN_CFG: cfg,
        L3_POOLS: pools, L3_DRAW_MAX: 8, RUN_LUCKY3_DRAW: true,
        coc3Cred: async () => ({ token: 'offline-token' }), l3GdpCookie: () => 'offline-cookie', randomInt: () => 0,
        coc3Sign: async (_, state) => {
            signs.push(plain(state));
            state.confirmedDate = TODAY;
            return options.signResult || { count: 30, line: '签到成功', status: 'confirmed' };
        },
        l3PoolCount: async (_, id) => {
            poolQueries.push(id);
            return (options.counts || {})[id] || { ok: true, n: 0 };
        },
        l3Draw: async (_, pool) => {
            draws.push(pool.id);
            return options.drawResult || { ok: true, won: false, code: 'test' };
        },
        $: {
            log() {}, wait: async () => {}, time: () => options.today || TODAY,
            toObj: (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } },
            toStr: JSON.stringify, getdata: () => stored,
            setdata: (value, key) => { saves.push({ value, key }); stored = value; return options.saveOk !== false; },
        },
        ...options.bindings,
    };
    const { api, context } = load(['runLucky3'], bindings);
    return { signs, draws, saves, poolQueries, context, run: () => api.runLucky3(user), stored: () => JSON.parse(stored) };
}
test('runLucky3 只按服务端奖池次数抽，不从累计天数推算', async () => {
    const h = runHarness({ counts: { 1: { ok: true, n: 2 }, 2: { ok: true, n: 0 }, 3: { ok: true, n: 1 } } });
    const lines = await h.run();
    assert.deepEqual(h.poolQueries, [1, 2, 3]);
    assert.deepEqual(h.draws, [1, 1, 3]);
    assert.match(lines.join('\n'), /抽奖请求返回 3 次/);
});
test('runLucky3 高累计天数但奖池零次数时不抽', async () => {
    const h = runHarness();
    await h.run();
    assert.deepEqual(h.draws, []);
});
test('runLucky3 抽奖总次数遵守单轮上限', async () => {
    const h = runHarness({ counts: { 1: { ok: true, n: 6 }, 2: { ok: true, n: 6 } } });
    await h.run();
    assert.deepEqual(h.draws, [1, 1, 1, 1, 1, 1, 2, 2]);
});
test('runLucky3 抽奖失败中断后续请求', async () => {
    const h = runHarness({ counts: { 1: { ok: true, n: 3 }, 2: { ok: true, n: 1 } }, drawResult: { ok: false, why: '离线模拟失败' } });
    assert.match((await h.run()).join('\n'), /代抽没走通/);
    assert.deepEqual(h.draws, [1]);
});
test('runLucky3 setdata 返回 false 提示保存失败', async () => {
    const h = runHarness({ saveOk: false });
    assert.match((await h.run()).join('\n'), /本地签到记录保存失败/);
    assert.equal(h.saves.length, 1);
});
test('runLucky3 签到次数未知时不查询或抽奖', async () => {
    const h = runHarness({ signResult: { count: null, line: '信息获取失败' } });
    assert.match((await h.run()).join('\n'), /信息获取失败/);
    assert.deepEqual(h.poolQueries, []);
    assert.deepEqual(h.draws, []);
});
for (const [label, oldScope] of [
    ['换月', '3157:offline-page:2026-10'], ['换任务', '9999:offline-page:2026-11'],
    ['换页面', '3157:old-page:2026-11'],
]) {
    test(`runLucky3 scope ${label}隔离旧确认和 pending`, async () => {
        const h = runHarness({ initial: { [user.userCheckId]: { scope: oldScope, confirmedDate: TODAY, signDate: TODAY, pendingSign: { d: TODAY, before: 3 } } } });
        await h.run();
        assert.deepEqual(h.signs[0], { scope: '3157:offline-page:2026-11' });
        assert.equal(h.stored()[user.userCheckId].scope, '3157:offline-page:2026-11');
    });
}
test('runLucky3 同 scope 保留 pending，账号之间隔离', async () => {
    const state = { scope: '3157:offline-page:2026-11', pendingSign: { d: TODAY, before: 3 } };
    const h = runHarness({ initial: { [user.userCheckId]: state, other: { marker: '保留' } } });
    await h.run();
    assert.deepEqual(h.signs[0], state);
    assert.deepEqual(h.stored().other, { marker: '保留' });
});

const { api: poolApi, context: poolContext } = load(['l3PoolCount'], { L3_PAGE_URL: 'offline-page', coc3Post: forbidden });
for (const [label, value] of [
    ['空串', ''], ['null', null], ['undefined', undefined], ['布尔', false],
    ['负数', -1], ['小数', 1.2], ['非数字', 'bad'], ['无限', Infinity], ['不安全整数', Number.MAX_SAFE_INTEGER + 1],
]) {
    test(`l3PoolCount ${label}不当作零次数`, async () => {
        poolContext.coc3Post = async () => ({ code: '200', data: value });
        assert.equal((await poolApi.l3PoolCount('cred', 1)).ok, false);
    });
}
for (const n of [0, '0', 2, '2']) {
    test(`l3PoolCount 有效次数 ${JSON.stringify(n)}`, async () => {
        poolContext.coc3Post = async () => ({ code: '200', data: n });
        assert.deepEqual(plain(await poolApi.l3PoolCount('cred', 1)), { ok: true, n: Number(n) });
    });
}
test('runLucky3 非法奖池次数显示查询失败，不当作零资格', async () => {
    const { api } = load(['l3PoolCount'], { L3_PAGE_URL: 'offline-page', coc3Post: async () => ({ code: '200', data: 'bad' }) });
    const h = runHarness({ bindings: { l3PoolCount: api.l3PoolCount } });
    assert.match((await h.run()).join('\n'), /3 个奖池次数查询失败，资格待确认/);
    assert.deepEqual(h.draws, []);
});

for (const branch of ['本地已签', '主站服务端已签']) {
    test(`doSign ${branch}仍可达真实 runLucky3`, async () => {
        const h = runHarness();
        const mainUser = { ...user, signDay: branch === '本地已签' ? '20261113' : '20261112' };
        const { api } = load(['doSign'], {
            RUN_LUCKY3: true, SECKILL: false, WED_SECKILL: false, CLAIM_AWARD: false,
            runLucky3: h.run,
            runGoldAct: async () => [],
            runExtraActs: async () => h.run(),
            openCtx: async () => ({ ctx: {}, statusData: { userinfo: { accumulateTimes: 10 }, markstatus: [{ date: '20261113', status: '1' }] } }),
            doMark: forbidden, saveUsers() {}, markLine: () => '主站已签',
            $: { time: () => '20261113', log() {}, messages: [] },
        });
        await api.doSign(mainUser);
        assert.equal(h.signs.length, 1);
        assert.deepEqual(h.poolQueries, [1, 2, 3]);
    });
}

// 这些断言保留期望的输入边界；若失败，说明主脚本仍有数值强制转换缺口。
for (const [label, value] of [['纯空白', '   '], ['空数组', []], ['单元素数组', [2]]]) {
    test(`边界回归 l3SignCount 必须拒绝${label}`, () => {
        assert.equal(counters.l3SignCount(info(value)), null);
    });
    test(`边界回归 l3PoolCount 必须拒绝${label}`, async () => {
        poolContext.coc3Post = async () => ({ code: '200', data: value });
        assert.equal((await poolApi.l3PoolCount('cred', 1)).ok, false);
    });
}
