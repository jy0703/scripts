import { HStack, Spacer, Text, VStack, Widget } from "scripting";
import type { CmccData } from "../util/cmcc_core";
import type { RenderCfg } from "./comp";
import { Balance, FlowBar, Logo, METRIC, MetricRow, MetricRows, PercentBar, RefreshIcon, clock, money } from "./comp";
import { flowParts } from "../util/format";

export function View({ data, cfg }: { data: CmccData; cfg: RenderCfg }) {
    const flow = data.flow;
    const header = (
        <HStack spacing={6}>
            <Logo size={18} />
            <Spacer />
            <Text font={"caption2"} foregroundStyle={"secondaryLabel"} monospacedDigit={true}>
                {clock(data.updatedAtMs)}
            </Text>
            <RefreshIcon />
        </HStack>
    );

    // 摘要：余额 + 一行关键余量
    if (cfg.smallStyle === "摘要") {
        const f = flow ? flowParts(flow.commonGB) : null;
        const d = flow && flow.dirTotalGB > 0 ? flowParts(flow.dirGB) : null;
        return (
            <VStack padding={8} frame={Widget.displaySize} spacing={0}>
                {header}
                <Spacer minLength={6} />
                <Balance data={data} size={"largeTitle"} />
                <Spacer />
                <HStack font={"caption"} fontWeight={"semibold"} spacing={8}>
                    {f ? <Text>{`通用 ${f.value}${f.unit}`}</Text> : null}
                    {cfg.showDir && d ? <Text>{`定向 ${d.value}${d.unit}`}</Text> : null}
                    <Spacer />
                    {data.voice ? <Text>{`${data.voice.remain}分`}</Text> : null}
                </HStack>
            </VStack>
        );
    }

    // 进度清单：通用 / 定向 / 语音 各一条进度
    if (cfg.smallStyle === "进度清单") {
        return (
            <VStack padding={8} frame={Widget.displaySize} spacing={0}>
                {header}
                <Spacer minLength={6} />
                {flow ? (
                    <FlowBar
                        label={data.flowTitle || "通用"}
                        remainGB={flow.commonGB}
                        totalGB={flow.commonTotalGB}
                        color={METRIC.flow}
                        showPercent={cfg.showPercent}
                        alert={data.flowAlert}
                    />
                ) : null}
                {cfg.showDir && flow && flow.dirTotalGB > 0 ? (
                    <VStack padding={{ top: 6 }}>
                        <FlowBar
                            label={"定向"}
                            remainGB={flow.dirGB}
                            totalGB={flow.dirTotalGB}
                            color={METRIC.dir}
                            showPercent={cfg.showPercent}
                        />
                    </VStack>
                ) : null}
                {data.voice ? (
                    <VStack padding={{ top: 6 }}>
                        <PercentBar
                            label={data.voiceTitle || "语音"}
                            text={`${data.voice.remain}分`}
                            ratio={data.voice.total > 0 ? data.voice.remain / data.voice.total : 0}
                            color={METRIC.voice}
                            showPercent={cfg.showPercent}
                        />
                    </VStack>
                ) : null}
            </VStack>
        );
    }

    // 紧凑清单（默认）：话费 / 流量（/定向）/ 语音，无进度条
    return (
        <VStack padding={8} frame={Widget.displaySize} spacing={4}>
            <MetricRow
                icon={"antenna.radiowaves.left.and.right"}
                title={"话费剩余"}
                value={money(data.balance)}
                unit={"元"}
                color={METRIC.fee}
                pad={5}
                right={
                    <HStack spacing={6}>
                        <Logo size={18} />
                        <RefreshIcon />
                    </HStack>
                }
            />
            <MetricRows data={data} include={cfg.showDir ? ["flow", "dir", "voice"] : ["flow", "voice"]} />
        </VStack>
    );
}
