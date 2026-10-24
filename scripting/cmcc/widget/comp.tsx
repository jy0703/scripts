import { HStack, Image, Rectangle, Spacer, Text, VStack, ZStack } from "scripting";
import { formatFlow, clock, money } from "../util/format";
import type { CmccData } from "../util/cmcc_core";

export { formatFlow, clock, money };

export function Logo({ size = 20 }: { size?: number }) {
    return <Image systemName={"antenna.radiowaves.left.and.right"} font={{ name: "system", size }} foregroundStyle={"systemBlue"} />;
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
    const used = Math.max(totalGB - remainGB, 0);
    const frac = totalGB > 0 ? Math.min(used / totalGB, 1) : 0;
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
                    fill={color}
                    clipShape={{ type: "capsule", style: "continuous" }}
                    scaleEffect={{ x: frac, y: 1, anchor: "leading" }}
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
            <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>{label}</Text>
            <Text font={"caption2"} fontWeight={"semibold"} monospacedDigit={true}>{value}</Text>
        </HStack>
    );
}

export function Chips({ data }: { data: CmccData }) {
    return (
        <HStack spacing={6}>
            {data.voice ? <Chip icon={"phone.fill"} label={"语音"} value={`${data.voice.remain}分`} /> : null}
            {data.points !== null ? <Chip icon={"star.fill"} label={"积分"} value={String(data.points)} /> : null}
        </HStack>
    );
}

export function MonthLine({ data }: { data: CmccData }) {
    return (
        <Text font={"caption2"} foregroundStyle={"secondaryLabel"} monospacedDigit={true}>
            {`本月 ¥${money(data.monthFee)} · ${clock(data.updatedAtMs)}`}
        </Text>
    );
}
