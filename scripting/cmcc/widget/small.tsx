import { HStack, Spacer, Text, VStack, Widget } from "scripting";
import type { CmccData } from "../util/cmcc_core";
import { Balance, FlowBar, Logo, RefreshIcon, clock } from "./comp";

export function View({ data }: { data: CmccData }) {
    const flow = data.flow;
    return (
        <VStack padding={true} frame={Widget.displaySize} spacing={0}>
            <HStack spacing={6}>
                <Logo size={18} />
                <Spacer />
                <Text font={"caption2"} foregroundStyle={"secondaryLabel"} monospacedDigit={true}>
                    {clock(data.updatedAtMs)}
                </Text>
                <RefreshIcon />
            </HStack>
            <Spacer minLength={6} />
            <Balance data={data} size={"largeTitle"} />
            <Spacer minLength={8} />
            {flow ? (
                <FlowBar label={"通用"} remainGB={flow.commonGB} totalGB={flow.commonTotalGB} color={"systemGreen"} />
            ) : null}
        </VStack>
    );
}
