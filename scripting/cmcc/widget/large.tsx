import { HStack, Spacer, Text, VStack, Widget } from "scripting";
import type { CmccData } from "../util/cmcc_core";
import type { RenderCfg } from "./comp";
import { Balance, Chip, FlowBar, Logo, METRIC, MetricRows, MonthLine, RefreshIcon, clock } from "./comp";

export function View({ data, cfg }: { data: CmccData; cfg: RenderCfg }) {
    const flow = data.flow;
    return (
        <VStack padding={true} frame={Widget.displaySize} spacing={0}>
            <HStack spacing={6}>
                <Logo size={20} />
                <Text font={"headline"} fontWeight={"semibold"}>{"中国移动"}</Text>
                <Spacer />
                <Text font={"caption2"} foregroundStyle={"secondaryLabel"} monospacedDigit={true}>
                    {clock(data.updatedAtMs)}
                </Text>
                <RefreshIcon />
            </HStack>
            <HStack spacing={14} alignment={"top"}>
                <VStack alignment={"leading"} spacing={0}>
                    <Spacer minLength={12} />
                    <Balance data={data} size={"largeTitle"} />
                    <Spacer minLength={12} />
                    <MonthLine data={data} />
                    <Spacer />
                    {data.planName ? <Chip icon={"simcard.fill"} label={""} value={data.planName} /> : null}
                </VStack>
                <VStack alignment={"leading"} spacing={0}>
                    <Spacer minLength={4} />
                    {flow ? (
                        <FlowBar
                            label={data.flowTitle || "通用"}
                            remainGB={flow.commonGB}
                            totalGB={flow.commonTotalGB}
                            color={METRIC.flow}
                            showTotal={true}
                            showPercent={cfg.showPercent}
                            alert={data.flowAlert}
                        />
                    ) : null}
                    {cfg.showDir && flow && flow.dirTotalGB > 0 ? (
                        <VStack padding={{ top: 8 }}>
                            <FlowBar
                                label={"定向"}
                                remainGB={flow.dirGB}
                                totalGB={flow.dirTotalGB}
                                color={METRIC.dir}
                                showTotal={true}
                                showPercent={cfg.showPercent}
                            />
                        </VStack>
                    ) : null}
                    <Spacer minLength={10} />
                    <MetricRows data={data} include={["voice", "sms", "point"]} />
                </VStack>
            </HStack>
        </VStack>
    );
}
