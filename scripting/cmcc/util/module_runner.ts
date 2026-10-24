// 在 Scripting 里跑内嵌的 10086.js（Surge/QX 脚本），把它当「Scriptable 服务模式」调用：
//   $request = https://api.example.com/10086/query → $done({response:{body: "{plan,fee}"}})
// 需要先有 autoLogin 传参（url/body/x_qen），模块自己负责重放登录 + 签名 + 解密。
import { fetch } from "scripting";
import { aesCbcDecrypt, base64ToBytes, bytesToUtf8 } from "./aes";
import { MODULE_B64 } from "./vendor/10086";

const QUERY_URL = "https://api.example.com/10086/query";
const PARAMS_KEY = "china_mobile_params";
const URL_KEY = "china_mobile_url";
const QEN_KEY = "china_mobile_x_qen";

export type AutoLogin = { url: string; body: string; x_qen?: string; phone?: string };

const Q14_KEY = "tVkdaRWRY0ZkV1Vr";
const Q14_IV = "VjFSQ1ZtVkQxRTlQ";

function ascii(s: string) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
}

// autoLogin 的 q14 密文里带 tel，模块要求 $argument 必须有手机号
function phoneOf(auth: AutoLogin): string {
    if (auth.phone) return String(auth.phone);
    try {
        const plain = bytesToUtf8(aesCbcDecrypt(base64ToBytes(String(auth.body).trim()), ascii(Q14_KEY), ascii(Q14_IV)));
        const j = JSON.parse(plain);
        return String(j.tel || j.telephone || "");
    } catch {
        return "";
    }
}

let moduleCode: string | null = null;
function code() {
    if (!moduleCode) moduleCode = bytesToUtf8(base64ToBytes(MODULE_B64));
    return moduleCode;
}

// 校验粘贴进来的传参：解 q14 密文拿手机号/抓取时间，给页面展示用
export function inspectAutoLogin(raw: string): { ok: boolean; phone: string; capturedAt: string; error: string } {
    try {
        let j = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (typeof j === "string") j = JSON.parse(j);   // BoxJS 里偶尔是二次编码的字符串
        if (!j || !j.body || !j.url) return { ok: false, phone: "", capturedAt: "", error: "缺少 url 或 body" };
        const phone = String(j.phone || "");
        let tel = phone;
        if (!tel) {
            const plain = bytesToUtf8(aesCbcDecrypt(base64ToBytes(String(j.body).trim()), ascii(Q14_KEY), ascii(Q14_IV)));
            tel = String(JSON.parse(plain).tel || "");
        }
        if (!tel) return { ok: false, phone: "", capturedAt: "", error: "密文里没解出手机号" };
        return { ok: true, phone: tel, capturedAt: String(j.capturedAt || ""), error: "" };
    } catch (e: any) {
        return { ok: false, phone: "", capturedAt: "", error: String(e && e.message ? e.message : e) };
    }
}

export async function runModule(auth: AutoLogin, timeoutMs = 25000): Promise<any> {
    if (!auth || !auth.body || !auth.url) throw new Error("缺少 autoLogin 传参（url/body）");
    const phone = phoneOf(auth);
    if (!phone) throw new Error("autoLogin 传参里没解析出手机号，App 方式没法查（重新抓一次传参）");
    Storage.set(PARAMS_KEY, auth.body);
    Storage.set(URL_KEY, auth.url);
    Storage.set(QEN_KEY, String(auth.x_qen || "14"));

    const g: any = globalThis;
    const saved: Record<string, any> = {};
    const keys = ["$environment", "$script", "$persistentStore", "$httpClient", "$notification", "$done", "$request", "$argument"];
    for (const k of keys) saved[k] = g[k];

    let done: any = null;
    let fail: string | null = null;

    const http = (method: string) => (opts: any, cb: (err: any, resp?: any, data?: any) => void) => {
        const headers: Record<string, string> = {};
        for (const k of Object.keys(opts.headers || {})) {
            const v = opts.headers[k];
            if (v !== null && v !== undefined && v !== "null") headers[k] = String(v);
        }
        const init: any = { method, headers };
        if (method === "POST" && opts.body) init.body = opts.body;
        fetch(opts.url, init)
            .then(async (r) => {
                const text = await r.text();
                const setCookie = (r.headers as any).getSetCookie ? (r.headers as any).getSetCookie() : [];
                const h: Record<string, any> = {};
                (r.headers as any).forEach((v: string, k: string) => { h[k] = v; });
                if (setCookie.length) h["set-cookie"] = setCookie;
                cb(null, { status: r.status, statusCode: r.status, headers: h }, text);
            })
            .catch((e) => cb(String(e)));
    };

    try {
        g.$environment = { "surge-version": "5.9.0" };
        g.$script = { name: "10086", startTime: Date.now() };
        g.$persistentStore = {
            read: (k: string) => { const v = Storage.get(k); return v === undefined ? null : v; },
            write: (v: any, k: string) => { Storage.set(k, v); return true; },
        };
        g.$httpClient = { get: http("GET"), post: http("POST") };
        g.$notification = { post: () => {} };
        g.$done = (v: any) => { done = v; };
        g.$request = { url: QUERY_URL, method: "GET", headers: { Accept: "application/json" } };
        g.$argument = `phonenumber=${phone}&service=1`;

        const run = new Function(code());
        run();
    } catch (e: any) {
        fail = String(e && e.message ? e.message : e);
    }

    // 模块是异步跑的，全局桩要等它把 $done 交回来之后再撤（否则中途 $httpClient 就没了）
    const started = Date.now();
    while (!done && !fail && Date.now() - started < timeoutMs) await new Promise((r) => setTimeout(r, 120));
    for (const k of keys) {
        if (saved[k] === undefined) delete g[k];
        else g[k] = saved[k];
    }

    if (fail) throw new Error(`10086 模块运行异常：${fail}`);
    if (!done) throw new Error(`10086 模块超时（${Math.round(timeoutMs / 1000)}s）：autoLogin 可能已失效，重新抓一次传参`);

    const resp = done.response || done;
    const body = resp.body;
    if (!body) throw new Error("10086 模块没有返回数据");
    const json = typeof body === "string" ? JSON.parse(body) : body;
    if (!json.fee && !json.plan) throw new Error("10086 模块返回缺少 fee/plan");
    return json;
}
