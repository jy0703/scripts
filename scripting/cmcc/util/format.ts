export function formatGB(n: number): { value: number; unit: string } {
    const v = Number.isFinite(n) ? n : 0;
    if (v >= 10) return { value: Math.round(v * 10) / 10, unit: "GB" };
    return { value: Math.round(v * 100) / 100, unit: "GB" };
}

export function money(v: string | number): string {
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(2) : String(v ?? "");
}

// 小组件里的流量写法：>=1G 用 G（两位小数），不足 1G 用整数 M
export function formatFlow(gb: number): string {
    const v = Number.isFinite(gb) ? gb : 0;
    if (v >= 1) return `${v.toFixed(2)}G`;
    return `${Math.round(v * 1024)}M`;
}

export function clock(ms: number): string {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 拆成「数值 + 单位」，给单位徽章用
export function flowParts(gb: number): { value: string; unit: string } {
    const v = Number.isFinite(gb) ? gb : 0;
    if (v >= 1) return { value: v.toFixed(2), unit: "GB" };
    return { value: String(Math.round(v * 1024)), unit: "MB" };
}
