export function formatGB(n: number): { value: number; unit: string } {
    const v = Number.isFinite(n) ? n : 0;
    if (v >= 10) return { value: Math.round(v * 10) / 10, unit: "GB" };
    return { value: Math.round(v * 100) / 100, unit: "GB" };
}

export function money(v: string | number): string {
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(2) : String(v ?? "");
}
