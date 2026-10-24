import { Button, HStack, Image, Path, Rectangle, Script, Spacer, Text, VStack, ZStack } from "scripting";
import { ReloadIntent } from "../app_intents";
import { formatFlow, clock, money } from "../util/format";
import type { CmccData } from "../util/cmcc_core";

export { formatFlow, clock, money };

// 小组件里的刷新按钮：点一下让系统重跑 widget.tsx（会重新请求数据）
export function RefreshIcon({ size = 12 }: { size?: number }) {
    return (
        <Button intent={ReloadIntent(undefined)} buttonStyle={"plain"}>
            <Image systemName={"arrow.clockwise"} font={{ name: "system", size }} foregroundStyle={"secondaryLabel"} />
        </Button>
    );
}

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

// 进度条按「剩余占比」画；剩余不足 10% 变红
export function FlowBar({
    label,
    remainGB,
    totalGB,
    color,
    showTotal,
}: {
    label: string;
    remainGB: number;
    totalGB: number;
    color: any;
    showTotal?: boolean;
}) {
    const ratio = totalGB > 0 ? Math.min(Math.max(remainGB / totalGB, 0), 1) : 0;
    const fill = ratio < 0.1 ? "systemRed" : color;
    return (
        <VStack alignment={"leading"} spacing={4}>
            <HStack font={"caption"} fontWeight={"semibold"}>
                <Text foregroundStyle={"secondaryLabel"}>{label}</Text>
                <Spacer />
                <Text monospacedDigit={true}>{formatFlow(remainGB)}</Text>
                {showTotal ? <Text foregroundStyle={"tertiaryLabel"} monospacedDigit={true}>{`/${formatFlow(totalGB)}`}</Text> : null}
            </HStack>
            <ZStack alignment={"leading"}>
                <Rectangle
                    frame={{ height: 6 }}
                    fill={"tertiarySystemFill"}
                    clipShape={{ type: "capsule", style: "continuous" }}
                />
                <Rectangle
                    frame={{ height: 6 }}
                    fill={fill}
                    clipShape={{ type: "capsule", style: "continuous" }}
                    scaleEffect={{ x: ratio, y: 1, anchor: "leading" }}
                />
            </ZStack>
        </VStack>
    );
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
            <Text font={"caption2"} fontWeight={"semibold"} monospacedDigit={true}>
                {value}
            </Text>
        </HStack>
    );
}

export function Chips({ data }: { data: CmccData }) {
    return (
        <VStack alignment={"leading"} spacing={6}>
            {data.voice ? <Chip icon={"phone.fill"} label={"语音"} value={`${data.voice.remain}分`} /> : null}
            {data.points !== null ? <Chip icon={"star.fill"} label={"积分"} value={String(data.points)} /> : null}
        </VStack>
    );
}

export function MonthLine({ data }: { data: CmccData }) {
    return (
        <Text font={"caption2"} foregroundStyle={"secondaryLabel"} monospacedDigit={true}>
            {`本月 ¥${money(data.monthFee)} · ${clock(data.updatedAtMs)}`}
        </Text>
    );
}
