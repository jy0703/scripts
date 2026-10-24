import { fetch } from "scripting";
import type { CmccData, Session } from "./cmcc_core";
import { APPID, BASE, ENDPOINTS, authedHeaders, baseHeaders, checkOk, normalize, parsePayload, shortMsg } from "./cmcc_core";
import { normalizeApp } from "./app_source";
import { runModule } from "./module_runner";

const CONFIG_KEY = "cmcc_balance_config"; // {address, token, ref}
const SESSION_KEY = "cmcc_balance_session"; // {ref: Session}
const DATA_CACHE_KEY = "cmcc_balance_data_cache"; // {t, data}
const CACHE_TTL = 2 * 3600 * 1000;
const TIMEOUT = 12000;

export type Config = {
    address: string;
    token: string;
    ref: string;
    source: "wechat" | "app";   // 数据来源：小程序 / App(10086 模块)
    autologin: string;          // App 方式的 autoLogin 传参 JSON（url/body/x_qen）
    // 渲染配置
    showPercent: boolean;       // 条形图右侧显示剩余百分比
    smallStyle: "摘要" | "紧凑清单" | "进度清单";
    showDir: boolean;           // 是否显示定向流量
    mediumCards: "四卡" | "三卡";
    // 缓存
    cacheEnabled: boolean;
    intervalMin: number;        // 数据缓存/刷新间隔（分钟）
};

// fetch 没超时：网络不通会一直 pending（iOS 默认等 60s），每步都限时并把失败原因写清楚
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`超时（${ms / 1000}s）`)), ms);
        p.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); },
        );
    });
}

async function fetchText(label: string, url: string, init?: any): Promise<{ text: string; status: number }> {
    let resp: any;
    try {
        resp = await withTimeout(fetch(url, init), TIMEOUT, label);
    } catch (e) {
        const msg = String(e);
        const hint = /超时|timeout/i.test(msg) ? "" : "（手机与服务器是否同网段？代理是否放行？）";
        throw new Error(`${label} 失败：${shortMsg(msg, 60)}${hint}`);
    }
    try {
        const text = await withTimeout(resp.text(), TIMEOUT, `${label} 读取响应`);
        return { text, status: resp.status };
    } catch (e) {
        throw new Error(`${label} 读取响应失败：${shortMsg(String(e), 60)}`);
    }
}

class CMCC {
    config: Config = {
        address: "", token: "", ref: "", source: "wechat", autologin: "",
        showPercent: false, smallStyle: "紧凑清单", showDir: true, mediumCards: "四卡",
        cacheEnabled: true, intervalMin: 180,
    };
    sessions: Record<string, Session> = {};
    lastPhone = "";
    step = "";

    constructor() {
        const c = Storage.get(CONFIG_KEY);
        if (c) Object.assign(this.config, typeof c === "string" ? JSON.parse(c) : c);
        const s = Storage.get(SESSION_KEY);
        if (s) this.sessions = typeof s === "string" ? JSON.parse(s) : s;
        this.config.address = String(this.config.address || "").trim().replace(/\/+$/, "");
        this.config.ref = String(this.config.ref || "").trim();
        this.config.token = String(this.config.token || "").trim();
        this.config.source = this.config.source === "app" ? "app" : "wechat";
        this.config.autologin = String(this.config.autologin || "").trim();
        this.config.showPercent = !!this.config.showPercent;
        this.config.showDir = this.config.showDir !== false;
        this.config.cacheEnabled = this.config.cacheEnabled !== false;
        this.config.intervalMin = Number(this.config.intervalMin) > 0 ? Number(this.config.intervalMin) : 180;
        if (["摘要", "紧凑清单", "进度清单"].indexOf(this.config.smallStyle) < 0) this.config.smallStyle = "紧凑清单";
        if (["四卡", "三卡"].indexOf(this.config.mediumCards) < 0) this.config.mediumCards = "四卡";
    }

    save() {
        Storage.set(CONFIG_KEY, this.config);
        Storage.set(SESSION_KEY, this.sessions);
    }

    cached() {
        const s = this.sessions[this.config.ref];
        return s && s.sessionId && Date.now() < s.expireTime ? s : null;
    }

    async getData(onStep?: (s: string) => void, force = false): Promise<CmccData> {
        const mark = (s: string) => { this.step = s; console.log("[cmcc]", s); onStep?.(s); };
        if (!force && this.config.cacheEnabled) {
            let obj: any = null;
            try {
                const c = Storage.get(DATA_CACHE_KEY);
                obj = typeof c === "string" ? JSON.parse(c) : c;
            } catch {
                obj = null;
            }
            if (obj && obj.t && Date.now() - obj.t < this.config.intervalMin * 60000) {
                mark(`用缓存（${Math.round((Date.now() - obj.t) / 60000)} 分钟前）`);
                return obj.data;
            }
        }
        const data = this.config.source === "app" ? await this.getAppData(mark) : await this.getWechatData(mark);
        Storage.set(DATA_CACHE_KEY, { t: Date.now(), data });
        return data;
    }

    private async getWechatData(mark: (s: string) => void): Promise<CmccData> {
        if (!this.config.address) throw new Error("未配置服务器地址：在下方「配置」里填好后再刷新");
        if (!this.config.ref) throw new Error("未配置账号 ref：在下方「配置」里填好后再刷新");
        let session = this.cached();
        if (!session) session = await this.login(mark);
        try {
            return await this.query(session, mark);
        } catch (e) {
            // 网络/超时类错误重登也没用，直接报给用户
            if (/超时|fetch failed|Network|offline/i.test(String(e))) throw e;
            mark("会话可能失效，重新登录");
            session = await this.login(mark);
            return await this.query(session, mark);
        }
    }

    // App 方式：跑内置的 10086.js（自动重放 autoLogin + 签名 + 解密）
    private async getAppData(mark: (s: string) => void): Promise<CmccData> {
        const raw = this.config.autologin || String(Storage.get("cmcc_autologin_data") || "");
        if (!raw) throw new Error("还没抓到 autoLogin 传参：先装重写模块登录一次 App，或在页面里粘贴 {url,body,x_qen}");
        let auth: any = null;
        try {
            auth = typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch {
            throw new Error("autoLogin 传参不是合法 JSON（应为 {url,body,x_qen}）");
        }
        if (!auth.body) throw new Error("autoLogin 传参缺少 body");
        auth = { url: auth.url, body: auth.body, x_qen: String(auth.x_qen || auth.x_qen || 14) };
        mark("跑 10086 模块");
        const json = await runModule(auth);
        return normalizeApp(json);
    }

    private async login(mark: (s: string) => void): Promise<Session> {
        mark("取 code");
        const code = await this.getCode();
        mark("登录小程序");
        const { text, status } = await fetchText("登录小程序", BASE + ENDPOINTS.login, {
            headers: { ...baseHeaders(), "X-WX-Code": code },
        });
        const data = parsePayload(text);
        const payload = (data && data.data) || data || {};
        if (!payload.sessionId) {
            const msg = data?.message || data?.msg || data?.returnMessage || `HTTP ${status}`;
            throw new Error(`登录失败：${shortMsg(msg)}`);
        }
        const user = payload.appletUser || {};
        const session: Session = {
            sessionId: String(payload.sessionId),
            provinceCode: String(user.provinceCode || ""),
            phone: String(user.telephone || ""),
            expireTime: Date.now() + CACHE_TTL,
        };
        this.lastPhone = session.phone;
        this.sessions[this.config.ref] = session;
        this.save();
        return session;
    }

    private async getCode(): Promise<string> {
        const addr = this.config.address;
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (this.config.token) headers.Authorization = `Bearer ${this.config.token}`;
        const { text } = await fetchText(`取 code（${addr}）`, `${addr}/wxapp/getCode`, {
            method: "POST",
            headers,
            body: JSON.stringify({ ref: this.config.ref, app_id: APPID }),
        });
        let j: any = null;
        try {
            j = JSON.parse(text);
        } catch {
            throw new Error(`code 服务返回的不是 JSON：${shortMsg(text, 80)}`);
        }
        const code = j?.data?.result?.code;
        if (!code) throw new Error(`code 获取失败：${shortMsg(j?.msg || text, 80)}`);
        return String(code);
    }

    private async query(session: Session, mark: (s: string) => void): Promise<CmccData> {
        mark("查询话费/流量/套餐");
        const headers = authedHeaders(session);
        const post = (label: string, path: string, body: any) =>
            fetchText(label, BASE + path, { method: "POST", headers, body: JSON.stringify(body) });
        const [fee, margin, plan, points] = await Promise.all([
            fetchText("查询话费", BASE + ENDPOINTS.fee, { headers }),
            post("查询流量", ENDPOINTS.margin, {}),
            post("查询套餐", ENDPOINTS.plan, { operation: "queryMainPlanDetailedInfo" }),
            // 积分拿不到不影响主数据
            fetchText("查询积分", BASE + ENDPOINTS.points, { headers }).catch(() => null),
        ]);
        const [feeData, marginData, planData] = [fee, margin, plan].map((r) => parsePayload(r.text));
        checkOk(feeData);
        checkOk(marginData);
        checkOk(planData);
        let pointsData: any = null;
        try {
            pointsData = points ? parsePayload(points.text)?.object?.resultData : null;
        } catch {
            pointsData = null;
        }
        const data = normalize(feeData, marginData, planData, pointsData);
        data.phone = session.phone;
        data.province = session.provinceCode;
        return data;
    }
}

export const cmcc = new CMCC();
