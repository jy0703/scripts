import { HStack, Spacer, Text, VStack, Widget } from "scripting";
import type { CmccData } from "../util/cmcc_core";
import { Balance, Chips, FlowBar, Logo, MonthLine, RefreshIcon, clock } from "./comp";

export function View({ data }: { data: CmccData }) {
    const flow = data.flow;
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
            <HStack spacing={14} alignment={"top"}>
                <VStack alignment={"leading"} spacing={0}>
                    <Spacer minLength={8} />
                    <Balance data={data} size={"title"} />
                    <Spacer minLength={6} />
                    <MonthLine data={data} />
                </VStack>
                <VStack alignment={"leading"} spacing={8}>
                    <Spacer minLength={4} />
                    {flow ? (
                        <FlowBar label={"通用"} remainGB={flow.commonGB} totalGB={flow.commonTotalGB} color={"systemGreen"} />
                    ) : null}
                    <Spacer />
                    <Chips data={data} />
                </VStack>
            </HStack>
        </VStack>
    );
}
