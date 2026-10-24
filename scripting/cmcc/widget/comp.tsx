import { Button, HStack, Image, Path, Rectangle, Script, Spacer, Text, VStack, ZStack } from "scripting";
import { ReloadIntent } from "../app_intents";
import { formatFlow, flowParts, clock, money } from "../util/format";
import type { CmccData } from "../util/cmcc_core";

export { formatFlow, clock, money };

// 配色沿用 ChinaMobile_2024（蓝=话费、绿=流量、橙=语音）
export const METRIC = {
    fee: "systemBlue",
    flow: "systemGreen",
    dir: "systemOrange",
    voice: "systemOrange",
    sms: "systemTeal",
    point: "systemPink",
};

export type RenderCfg = {
    showPercent: boolean;
    smallStyle: "摘要" | "紧凑清单" | "进度清单";
    showDir: boolean;
    mediumCards: "四卡" | "三卡";
};

// 用包里的移动图标，别用 SF Symbol
export function Logo({ size = 20 }: { size?: number }) {
    return (
        <Image
            filePath={Path.join(Script.directory, "image/cmcc.min.png")}
            resizable={true}
            scaleToFit={true}
            frame={{ width: size, height: size }}
        />
    );
}

// 点一下走 AppIntent 重跑 widget.tsx；intent 里会置 force 标记绕过数据缓存
export function RefreshIcon({ size = 12 }: { size?: number }) {
    return (
        <Button intent={ReloadIntent(undefined)} buttonStyle={"plain"}>
            <Image systemName={"arrow.clockwise"} font={{ name: "system", size }} foregroundStyle={"secondaryLabel"} />
        </Button>
    );
}

// 余额大数字：低于 10 元标红（和小程序「余额不足」阈值一致）
export function Balance({ data, size }: { data: CmccData; size: any }) {
    const low = Number(data.balance) < 10;
    return (
        <VStack alignment={"leading"} spacing={1}>
            <Text font={size} fontWeight={"bold"} monospacedDigit={true} foregroundStyle={low ? "systemRed" : "label"}>
                {money(data.balance)}
            </Text>
            <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>{"话费余额 · 元"}</Text>
        </VStack>
    );
}

export function UnitBadge({ text, color }: { text: string; color: any }) {
    return (
        <Text
            font={"caption2"}
            fontWeight={"semibold"}
            foregroundStyle={color}
            padding={{ leading: 4, trailing: 4, top: 1, bottom: 1 }}
            background={{ color, opacity: 0.15 }}
            clipShape={{ type: "rect", cornerRadius: 4 }}>
            {text}
        </Text>
    );
}

export function MetricRow({
    icon,
    title,
    value,
    unit,
    color,
    right,
    pad = 6,
}: {
    icon: string;
    title: string;
    value: string;
    unit: string;
    color: any;
    right?: any;
    pad?: number;
}) {
    return (
        <HStack
            spacing={8}
            padding={{ leading: 10, trailing: 10, top: pad, bottom: pad }}
            background={{ color, opacity: 0.12 }}
            clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}>
            <VStack alignment={"leading"} spacing={1}>
                <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>{title}</Text>
                <HStack spacing={4} alignment={"lastTextBaseline"}>
                    <Text font={"subheadline"} fontWeight={"bold"} monospacedDigit={true}>{value}</Text>
                    <UnitBadge text={unit} color={color} />
                </HStack>
            </VStack>
            <Spacer />
            {right ? right : <Image systemName={icon} font={{ name: "system", size: 18 }} foregroundStyle={color} />}
        </HStack>
    );
}

// 通用进度条：条长按「剩余占比」，<10% 或异常状态转红，可选显示百分比
export function PercentBar({
    label,
    text,
    ratio,
    color,
    showPercent,
    alert,
    height = 6,
}: {
    label: string;
    text: string;
    ratio: number;
    color: any;
    showPercent?: boolean;
    alert?: boolean;
    height?: number;
}) {
    const r = Math.min(Math.max(Number.isFinite(ratio) ? ratio : 0, 0), 1);
    const fill = alert || r < 0.1 ? "systemRed" : color;
    return (
        <VStack alignment={"leading"} spacing={4}>
            <HStack font={"caption"} fontWeight={"semibold"}>
                <Text foregroundStyle={"secondaryLabel"}>{label}</Text>
                <Spacer />
                <Text monospacedDigit={true}>{text}</Text>
                {showPercent ? <Text foregroundStyle={"tertiaryLabel"} monospacedDigit={true}>{`${Math.round(r * 100)}%`}</Text> : null}
            </HStack>
            <ZStack alignment={"leading"}>
                <Rectangle frame={{ height }} fill={"tertiarySystemFill"} clipShape={{ type: "capsule", style: "continuous" }} />
                <Rectangle
                    frame={{ height }}
                    fill={fill}
                    clipShape={{ type: "capsule", style: "continuous" }}
                    scaleEffect={{ x: r, y: 1, anchor: "leading" }}
                />
            </ZStack>
        </VStack>
    );
}

export function FlowBar({
    label,
    remainGB,
    totalGB,
    color,
    showTotal,
    showPercent,
    alert,
}: {
    label: string;
    remainGB: number;
    totalGB: number;
    color: any;
    showTotal?: boolean;
    showPercent?: boolean;
    alert?: boolean;
}) {
    const ratio = totalGB > 0 ? remainGB / totalGB : 0;
    const text = `${formatFlow(remainGB)}${showTotal ? `/${formatFlow(totalGB)}` : ""}`;
    return <PercentBar label={label} text={text} ratio={ratio} color={color} showPercent={showPercent} alert={alert} />;
}

export function Chip({ icon, label, value }: { icon: string; label: string; value: string }) {
    return (
        <HStack
            spacing={4}
            padding={{ leading: 8, trailing: 8, top: 5, bottom: 5 }}
            background={{ color: "tertiarySystemFill" }}
            clipShape={{ type: "capsule", style: "continuous" }}>
            <Image systemName={icon} font={{ name: "system", size: 11 }} foregroundStyle={"secondaryLabel"} />
            {label ? (
                <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>
                    {label}
                </Text>
            ) : null}
            <Text font={"caption2"} fontWeight={"semibold"} monospacedDigit={true}>{value}</Text>
        </HStack>
    );
}

// 流量/定向/语音/短信/积分：同一套行样式，按需挑要显示哪几个
export function MetricRows({ data, include }: { data: CmccData; include: string[] }) {
    const rows: any[] = [];
    if (include.includes("flow") && data.flow) {
        const p = flowParts(data.flow.commonGB);
        rows.push(
            <MetricRow
                key={"flow"}
                icon={"antenna.radiowaves.left.and.right"}
                title={data.flowTitle || "流量剩余"}
                value={p.value}
                unit={p.unit}
                color={METRIC.flow}
            />,
        );
    }
    if (include.includes("dir") && data.flow && data.flow.dirTotalGB > 0) {
        const p = flowParts(data.flow.dirGB);
        rows.push(
            <MetricRow key={"dir"} icon={"arrow.triangle.branch"} title={"定向剩余"} value={p.value} unit={p.unit} color={METRIC.dir} />,
        );
    }
    if (include.includes("voice") && data.voice) {
        rows.push(
            <MetricRow
                key={"voice"}
                icon={"phone.badge.waveform.fill"}
                title={data.voiceTitle || "语音剩余"}
                value={String(data.voice.remain)}
                unit={"分钟"}
                color={METRIC.voice}
            />,
        );
    }
    if (include.includes("sms") && data.sms) {
        rows.push(
            <MetricRow key={"sms"} icon={"message.fill"} title={"短信剩余"} value={String(data.sms.remain)} unit={"条"} color={METRIC.sms} />,
        );
    }
    if (include.includes("point") && data.points !== null) {
        rows.push(
            <MetricRow key={"point"} icon={"star.fill"} title={"积分"} value={String(data.points)} unit={"分"} color={METRIC.point} />,
        );
    }
    return <VStack alignment={"leading"} spacing={8}>{rows}</VStack>;
}

export function MonthLine({ data }: { data: CmccData }) {
    return (
        <Text font={"caption2"} foregroundStyle={"secondaryLabel"} monospacedDigit={true}>
            {data.monthFee ? `本月 ¥${money(data.monthFee)} · ${clock(data.updatedAtMs)}` : `更新于 ${clock(data.updatedAtMs)}`}
        </Text>
    );
}
