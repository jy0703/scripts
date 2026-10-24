// 10086+ 小程序的余额/套餐余量协议（与 Loon 版 scripts/cmcc_balance.js 同一套端点与密钥）。
// 本文件不依赖 scripting 模块，纯函数，方便在 Node 里用真实抓包对拍。
import { aesCbcDecrypt, base64ToBytes, bytesToUtf8, hexToBytes } from "./aes";

export const APPID = "wx43aab19a93a3a6f2";
export const BASE = "https://wx.online-cmcc.cn";
const PAGE_VERSION = "534";
const AES_KEY = "1234123412ABCDEF";
const AES_IV = "ABCDEF1234123412";
const LR = "ZS93dUFVa2kzaEpQSjM0SG55MUFDdz09";
const UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.79(0x18004f31) NetType/WIFI Language/zh_CN";
const ASK_CONFIG =
    "feeCard,callBalance,broadband,noReal,noPuk,fareLink,recommendCard,xmeFloatBar,showGrayUI,NBEJXHSN,commodityDisableProvince,txCooperateOffingPro,netAge,oneKeyLogin,miniSubscribePopup,wmhHideDetail,wmhHideDetailMarket,domainNameSelection,wmhHideDetailWeChat,hideStarProvince";

export type Session = {
    sessionId: string;
    provinceCode: string;
    phone: string;
    expireTime: number;
};

export type CmccData = {
    phone: string;
    province: string;
    balance: string;
    monthFee: string;
    oweFee: string;
    payType: string;
    planName: string;
    planPrice: string;
    points: number | null;
    flow: {
        remainGB: number;
        totalGB: number;
        usedGB: number;
        commonGB: number;
        commonTotalGB: number;
        dirGB: number;
        dirTotalGB: number;
    } | null;
    voice: { remain: number; total: number } | null;
    sms: { remain: number; total: number } | null;
    updatedAt: string;
    updatedAtMs: number;
    flowTitle?: string;   // App 数据源会返回「套外已用 / 国内已用」等标题
    voiceTitle?: string;
    flowAlert?: boolean;
    voiceAlert?: boolean;
};

export function baseHeaders() {
    return {
        "User-Agent": UA,
        Referer: `https://servicewechat.com/${APPID}/${PAGE_VERSION}/page-frame.html`,
        Accept: "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "X-EMERGENCY-NEW": "yes",
        "X-APPLET-ASK-CONFIG": ASK_CONFIG,
        Lrsbhbg8: LR,
        "content-type": "application/json;charset=utf-8",
    };
}

export function authedHeaders(session: Session) {
    const h: Record<string, string> = {
        ...baseHeaders(),
        "X-WECHAT86-APPLET-JWT": session.sessionId,
        "X-CORE-APPLET-TOKEN": session.sessionId,
        // 少这个头 /website/uniApi/* 会 302 到绑定页
        "X-CORE-APPLET-AUTHTYPE": "wechat_applet_auth",
    };
    if (session.provinceCode) h["X-EMERGENCY-PROVINCE"] = session.provinceCode;
    return h;
}

// uniApi 回 hex 串，newdirect 回 {encryptData: base64(base64(密文))}
export function parsePayload(raw: string) {
    const text = String(raw || "").trim();
    if (!text) return null;
    const key = new Uint8Array(Buffer16(AES_KEY));
    const iv = new Uint8Array(Buffer16(AES_IV));
    const dec = (bytes: Uint8Array) => JSON.parse(bytesToUtf8(aesCbcDecrypt(bytes, key, iv)));
    if (/^[0-9a-fA-F]{32,}$/.test(text)) return dec(hexToBytes(text));
    const outer = JSON.parse(text);
    if (outer && outer.encryptData) {
        const inner = bytesToUtf8(base64ToBytes(outer.encryptData));
        return dec(base64ToBytes(inner));
    }
    return outer;
}

// 纯 ASCII 的 key/iv 转字节
function Buffer16(s: string) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
}

export function checkOk(data: any) {
    const status = typeof data?.status === "number" ? data.status : null;
    const rc = data?.returnCode !== undefined ? data.returnCode : data?.resultStatus?.resultCode;
    const bad = [status, rc]
        .filter((v) => v !== null && v !== undefined)
        .some((v) => ["0", "0000"].indexOf(String(v).toUpperCase()) < 0);
    if (bad) {
        const msg = data?.returnMessage || data?.message || data?.resultStatus?.resultDesc || data?.resultDesc;
        throw new Error(shortMsg(msg || rc || status));
    }
    return data;
}

export function normalize(fee: any, margin: any, plan: any, points: any = null): CmccData {
    const f = fee?.object?.resultData || fee?.resultData || {};
    const m = margin?.data?.resultData || margin?.resultData || {};
    const p = plan?.data?.resultData || plan?.resultData || {};

    const flowInfo = m.planRemianFlowInfo || {};
    const total = flowInfo.totalInfo || {};
    const common = flowInfo.planRemian || {};
    const dir = flowInfo.directionalFlowInfo || {};
    const voiceInfo = m.planRemianVoiceInfo?.totalInfo;
    const smsInfo = m.planRemianMSGInfo?.totalInfo;

    // 单位码 03=MB 04=GB
    const toGB = (v: any, unit: string) => (unit === "03" ? num(v) / 1024 : num(v));
    const base = Number(total.sumNum) ? total : common;

    return {
        phone: "",
        province: "",
        balance: pick(f, ["curFee", "cashBalance", "userSpecBalance", "leftMoney"]),
        monthFee: f.realFee !== undefined ? String(f.realFee) : "",
        oweFee: f.oweFee !== undefined ? String(f.oweFee) : "",
        payType: f.payType || "",
        planName: p.curPlanName || "",
        planPrice: p.planPrice !== undefined ? String(p.planPrice) : "",
        points: points && points.totalPoint !== undefined ? Number(points.totalPoint) : null,
        flow: Number(base.sumNum)
            ? {
                  remainGB: toGB(base.remainNum, base.unit),
                  totalGB: toGB(base.sumNum, base.unit),
                  usedGB: toGB(base.usedNum, base.unit),
                  commonGB: toGB(common.remainNum, common.unit),
                  commonTotalGB: toGB(common.sumNum, common.unit),
                  dirGB: Number(dir.sumNum) > 0 ? toGB(dir.remainNum, dir.unit) : 0,
                  dirTotalGB: toGB(dir.sumNum, dir.unit),
              }
            : null,
        voice:
            voiceInfo && Number(voiceInfo.sumNum) > 0
                ? { remain: num(voiceInfo.remainNum), total: num(voiceInfo.sumNum) }
                : null,
        sms:
            smsInfo && Number(smsInfo.sumNum) > 0
                ? { remain: num(smsInfo.remainNum), total: num(smsInfo.sumNum) }
                : null,
        updatedAt: new Date().toLocaleString(),
        updatedAtMs: Date.now(),
    };
}

export function num(v: any) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function pick(obj: any, keys: string[]) {
    for (const k of keys) {
        if (obj[k] !== undefined && obj[k] !== "" && Number(obj[k]) !== 0) return String(obj[k]);
    }
    for (const k of keys) if (obj[k] !== undefined && obj[k] !== "") return String(obj[k]);
    return "";
}

export function shortMsg(v: any, max = 60) {
    const t = String(v || "").replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max) + "…" : t;
}

export const ENDPOINTS = {
    login: "/wmhnewcenter/wechat86-applet/login",
    fee: "/wmhnewcenter/wechat86-applet/newdirect/execute?channelMark=wechat&service=esb&operation=getRealFee",
    margin: "/website/uniApi/getNewMarginInfo",
    plan: "/website/uniApi/getMarginQueryInfo",
    points: "/wmhnewcenter/wechat86-applet/newdirect/execute?channelMark=wechat&service=esb&operation=getPoints",
};
