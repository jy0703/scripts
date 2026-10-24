import { fetch } from "scripting";
import type { CmccData, Session } from "./cmcc_core";
import { APPID, BASE, ENDPOINTS, authedHeaders, baseHeaders, checkOk, normalize, parsePayload, shortMsg } from "./cmcc_core";

const CONFIG_KEY = "cmcc_balance_config"; // {address, token, ref}
const SESSION_KEY = "cmcc_balance_session"; // {ref: Session}
const CACHE_TTL = 2 * 3600 * 1000;

export type Config = {
    address: string;
    token: string;
    ref: string;
};

class CMCC {
    config: Config = { address: "", token: "", ref: "" };
    sessions: Record<string, Session> = {};
    lastPhone = "";

    constructor() {
        const c = Storage.get(CONFIG_KEY);
        if (c) Object.assign(this.config, typeof c === "string" ? JSON.parse(c) : c);
        const s = Storage.get(SESSION_KEY);
        if (s) this.sessions = typeof s === "string" ? JSON.parse(s) : s;
    }

    save() {
        Storage.set(CONFIG_KEY, this.config);
        Storage.set(SESSION_KEY, this.sessions);
    }

    cached() {
        const s = this.sessions[this.config.ref];
        return s && s.sessionId && Date.now() < s.expireTime ? s : null;
    }

    async getData(): Promise<CmccData> {
        if (!this.config.address) throw new Error("未配置服务器地址：先运行脚本，在页面里填好地址/token/ref");
        if (!this.config.ref) throw new Error("未配置账号 ref：先运行脚本，在页面里填好");
        let session = this.cached();
        if (!session) session = await this.login();
        try {
            return await this.query(session);
        } catch (e) {
            // 会话可能被顶掉：重登一次
            session = await this.login();
            return await this.query(session);
        }
    }

    private async login(): Promise<Session> {
        const code = await this.getCode();
        const resp = await fetch(BASE + ENDPOINTS.login, {
            headers: { ...baseHeaders(), "X-WX-Code": code },
        });
        const data = parsePayload(await resp.text());
        const payload = (data && data.data) || data || {};
        if (!payload.sessionId) {
            const msg = data?.message || data?.msg || data?.returnMessage || `HTTP ${resp.status}`;
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
        const addr = this.config.address.replace(/\/+$/, "");
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (this.config.token) headers.Authorization = `Bearer ${this.config.token}`;
        const resp = await fetch(`${addr}/wxapp/getCode`, {
            method: "POST",
            headers,
            body: JSON.stringify({ ref: this.config.ref, app_id: APPID }),
        });
        const j = JSON.parse(await resp.text());
        const code = j?.data?.result?.code;
        if (!code) throw new Error(`code 获取失败：${shortMsg(j?.msg || JSON.stringify(j).slice(0, 80))}`);
        return String(code);
    }

    private async query(session: Session): Promise<CmccData> {
        const headers = authedHeaders(session);
        const post = (path: string, body: any) => fetch(BASE + path, { method: "POST", headers, body: JSON.stringify(body) });
        const get = (path: string) => fetch(BASE + path, { headers });
        const [feeResp, marginResp, planResp] = await Promise.all([
            get(ENDPOINTS.fee),
            post(ENDPOINTS.margin, {}),
            post(ENDPOINTS.plan, { operation: "queryMainPlanDetailedInfo" }),
        ]);
        const [fee, margin, plan] = await Promise.all([
            feeResp.text().then(parsePayload),
            marginResp.text().then(parsePayload),
            planResp.text().then(parsePayload),
        ]);
        checkOk(fee);
        checkOk(margin);
        checkOk(plan);
        const data = normalize(fee, margin, plan);
        data.phone = session.phone;
        data.province = session.provinceCode;
        return data;
    }
}

export const cmcc = new CMCC();
