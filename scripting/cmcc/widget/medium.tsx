import { HStack, Spacer, Text, VStack, Widget } from "scripting";
import type { CmccData } from "../util/cmcc_core";
import type { RenderCfg } from "./comp";
import { Balance, Logo, METRIC, MonthLine, RefreshIcon, clock } from "./comp";
import { flowParts } from "../util/format";

function MiniCard({ title, value, unit, color }: { title: string; value: string; unit: string; color: any }) {
    return (
        <VStack
            alignment={"leading"}
            spacing={1}
            padding={{ leading: 8, trailing: 8, top: 5, bottom: 5 }}
            frame={{ width: 84 }}
            background={{ color, opacity: 0.12 }}
            clipShape={{ type: "rect", cornerRadius: 10, style: "continuous" }}>
            <Text font={"caption2"} foregroundStyle={"secondaryLabel"}>{title}</Text>
            <HStack spacing={3} alignment={"lastTextBaseline"}>
                <Text font={"subheadline"} fontWeight={"bold"} monospacedDigit={true}>{value}</Text>
                <Text font={"caption2"} fontWeight={"semibold"} foregroundStyle={color}>{unit}</Text>
            </HStack>
        </VStack>
    );
}

export function View({ data, cfg }: { data: CmccData; cfg: RenderCfg }) {
    const flow = data.flow;
    const f = flow ? flowParts(flow.commonGB) : null;
    const d = flow && flow.dirTotalGB > 0 ? flowParts(flow.dirGB) : null;
    return (
        <VStack padding={true} frame={Widget.displaySize} spacing={0}>
            <HStack spacing={6}>
                <Logo size={18} />
                <Text font={"footnote"} fontWeight={"semibold"}>{"中国移动"}</Text>
                <Spacer />
                <Text font={"caption2"} foregroundStyle={"secondaryLabel"} monospacedDigit={true}>
                    {clock(data.updatedAtMs)}
                </Text>
                <RefreshIcon />
            </HStack>
            <HStack spacing={12} alignment={"top"}>
                <VStack alignment={"leading"} spacing={0}>
                    <Spacer minLength={8} />
                    <Balance data={data} size={"title"} />
                    <Spacer minLength={6} />
                    <MonthLine data={data} />
                </VStack>
                <VStack spacing={6}>
                    <Spacer minLength={2} />
                    <HStack spacing={6}>
                        {f ? <MiniCard title={data.flowTitle || "通用"} value={f.value} unit={f.unit} color={METRIC.flow} /> : null}
                        {cfg.showDir && cfg.mediumCards === "四卡" && d ? (
                            <MiniCard title={"定向"} value={d.value} unit={d.unit} color={METRIC.dir} />
                        ) : data.voice ? (
                            <MiniCard title={data.voiceTitle || "语音"} value={String(data.voice.remain)} unit={"分"} color={METRIC.voice} />
                        ) : null}
                    </HStack>
                    <HStack spacing={6}>
                        {cfg.showDir && cfg.mediumCards === "四卡" && data.voice ? (
                            <MiniCard title={data.voiceTitle || "语音"} value={String(data.voice.remain)} unit={"分"} color={METRIC.voice} />
                        ) : null}
                        {data.points !== null ? (
                            <MiniCard title={"积分"} value={String(data.points)} unit={"分"} color={METRIC.point} />
                        ) : null}
                    </HStack>
                </VStack>
            </HStack>
        </VStack>
    );
}
