import { fetch } from "scripting";
import type { CmccData, Session } from "./cmcc_core";
import { APPID, BASE, ENDPOINTS, authedHeaders, baseHeaders, checkOk, normalize, parsePayload, shortMsg } from "./cmcc_core";

const CONFIG_KEY = "cmcc_balance_config"; // {address, token, ref}
const SESSION_KEY = "cmcc_balance_session"; // {ref: Session}
const CACHE_TTL = 2 * 3600 * 1000;
const TIMEOUT = 12000;

export type Config = {
    address: string;
    token: string;
    ref: string;
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
    config: Config = { address: "", token: "", ref: "" };
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
    }

    save() {
        Storage.set(CONFIG_KEY, this.config);
        Storage.set(SESSION_KEY, this.sessions);
    }

    cached() {
        const s = this.sessions[this.config.ref];
        return s && s.sessionId && Date.now() < s.expireTime ? s : null;
    }

    async getData(onStep?: (s: string) => void): Promise<CmccData> {
        const mark = (s: string) => { this.step = s; console.log("[cmcc]", s); onStep?.(s); };
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
        const [fee, margin, plan] = await Promise.all([
            fetchText("查询话费", BASE + ENDPOINTS.fee, { headers }),
            post("查询流量", ENDPOINTS.margin, {}),
            post("查询套餐", ENDPOINTS.plan, { operation: "queryMainPlanDetailedInfo" }),
        ]);
        const [feeData, marginData, planData] = [fee, margin, plan].map((r) => parsePayload(r.text));
        checkOk(feeData);
        checkOk(marginData);
        checkOk(planData);
        const data = normalize(feeData, marginData, planData);
        data.phone = session.phone;
        data.province = session.provinceCode;
        return data;
    }
}

export const cmcc = new CMCC();
