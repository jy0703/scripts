// “App 方式”数据源：与 ChinaMobile_2024.js 同一套逻辑
// 小组件请求一个 URL（默认 https://api.example.com/10086/query），
// 该地址由用户的 10086 模块（Loon/Surge 重写 + Scriptable 服务模式）返回，
// 返回体形如 { fee: { curFee }, plan: { planRemianFlowListRes, planRemianVoiceListRes } }。
import type { CmccData } from "./cmcc_core";

function num(v: any) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

// 03=MB 04=GB（与小程序一致）
function toGB(value: any, unit: string) {
    const n = num(value);
    return unit === "04" ? n : n / 1024;
}

type FlowParsed = { title: string; remainGB: number; totalGB: number; alert: boolean };
type VoiceParsed = { title: string; remain: number; total: number; alert: boolean };

// 照搬 2024 脚本 handleFlow：按 limitType/state 判断是「剩余」还是「套外/国内已用」
export function handleFlow(input: any = {}): FlowParsed {
    const plan = input.planRemianFlowRes ? input.planRemianFlowRes.filter((x: any) => x.flowtype === "0") : [];
    const out = input.outPlanInfoRes || [];
    let title = "流量剩余";
    let remain = "";
    let total = "";
    let unit = "";
    let alert = false;

    const first = plan[0] || {};
    if (input.limitType === "01" && plan.length > 0) {
        if (
            (input.state === "00" && parseFloat(first.flowRemainNum) > 0 && first.unit === "03") ||
            (Number(first.flowRemainNum) < 9999 && first.unit === "04" && parseFloat(first.flowRemainNum) > 0)
        ) {
            remain = first.flowRemainNum;
            total = first.flowSumNum;
            unit = first.unit;
        } else if (input.state === "00" && parseFloat(first.flowRemainNum) === 0) {
            title = "套外已用";
            alert = true;
            remain = out[0] && parseFloat(out[0].usageAmount) > 0 ? out[0].usageAmount : 0;
            unit = (out[0] && out[0].unit) || first.unit;
        } else if (["05", "07"].includes(input.state)) {
            title = "国内已用";
            alert = true;
            remain = input.usedtotal;
            unit = input.unit || first.unit;
        } else if (["04", "06"].includes(input.state)) {
            title = "套外已用";
            alert = true;
            remain = out[0] && parseFloat(out[0].usageAmount) > 0 ? out[0].usageAmount : 0;
            unit = (out[0] && out[0].unit) || first.unit;
        } else if ((Number(first.flowRemainNum) >= 9999 && first.unit === "04") || first.flowRemainNum === "N") {
            title = "通用已用";
            alert = true;
            remain = first.flowUsdNum;
            unit = first.unit;
        }
    } else if (input.limitType === "02" && plan.length > 0) {
        if (input.state === "00") {
            remain = first.flowRemainNum;
            total = first.flowSumNum;
            unit = first.unit;
        } else if (input.state === "01" || input.state === "03") {
            title = input.state === "01" ? "通用已用" : "国内已用";
            alert = true;
            remain = first.flowUsdNum;
            unit = first.unit;
        } else if (["05", "07"].includes(input.state)) {
            title = "国内已用";
            alert = true;
            remain = input.usedtotal;
            unit = input.unit || first.unit;
        } else if (["04", "06"].includes(input.state)) {
            title = "套外已用";
            alert = true;
            remain = out[0] && parseFloat(out[0].usageAmount) > 0 ? out[0].usageAmount : 0;
            unit = (out[0] && out[0].unit) || first.unit;
        }
    } else if (input.limitType === "03" && plan.length > 0) {
        title = "通用已用";
        alert = true;
        remain = first.flowUsdNum;
        unit = first.unit;
    }

    if (plan.length === 0 && out.length !== 0) {
        title = "套外已用";
        alert = true;
        remain = out[0].usageAmount;
        unit = out[0].unit;
    }

    return { title, remainGB: toGB(remain, unit), totalGB: toGB(total, unit), alert };
}

// 照搬 2024 脚本 handleVoice：voicetype=0 的那条，0 剩余时看套外用量
export function handleVoice(input: any = {}): VoiceParsed {
    const all = input.planRemianVoiceInfoRes || [];
    // 2024 脚本只认 voicetype=0；实测模块回的是 1，这里 0 优先、没有就退回全部
    const list = all.filter((x: any) => x.voicetype === "0");
    const use = list.length ? list : all;
    const out = input.outPlanInfoRes || [];
    if (use.length === 0) return { title: "语音剩余", remain: 0, total: 0, alert: false };
    const v = use[0];
    if (Number(v.voiceRemainNum) === 0 && out.length > 0) {
        return { title: "套外已用", remain: num(out[0].usageAmount), total: 0, alert: true };
    }
    if (Number(v.voiceRemainNum) >= 9999 || v.voiceRemainNum === "N") {
        return { title: "通话已用", remain: num(v.voiceUsdNum), total: 0, alert: true };
    }
    return { title: "语音剩余", remain: num(v.voiceRemainNum), total: num(v.voiceSumNum), alert: false };
}

export function normalizeApp(json: any): CmccData {
    const fee = json?.fee || {};
    const plan = json?.plan || {};
    const flow = handleFlow(plan.planRemianFlowListRes);
    // 模块不同版本这里叫 planRemianVoiceListRes / planRemianVoiceInfoRes 都见过
    const voice = handleVoice(plan.planRemianVoiceListRes || plan.planRemianVoiceInfoRes);
    return {
        phone: String(json?.phone || json?.phonenumber || ""),
        province: String(json?.provinceCode || ""),
        balance: fee.curFee !== undefined ? String(fee.curFee) : "",
        monthFee: fee.realFee !== undefined ? String(fee.realFee) : "",
        oweFee: fee.oweFee !== undefined ? String(fee.oweFee) : "",
        payType: fee.payType || "",
        planName: plan.planName || plan.planNameRes || "",
        planPrice: plan.planPrice !== undefined ? String(plan.planPrice) : "",
        points: json?.point?.totalPoint !== undefined ? Number(json.point.totalPoint) : null,
        flow: {
            remainGB: flow.remainGB,
            totalGB: flow.totalGB,
            usedGB: Math.max(flow.totalGB - flow.remainGB, 0),
            commonGB: flow.remainGB,
            commonTotalGB: flow.totalGB,
            dirGB: 0,
            dirTotalGB: 0,
        },
        voice: { remain: voice.remain, total: voice.total },
        sms: null,
        updatedAt: new Date().toLocaleString(),
        updatedAtMs: Date.now(),
        flowTitle: flow.title,
        voiceTitle: voice.title,
        flowAlert: flow.alert,
        voiceAlert: voice.alert,
    };
}
