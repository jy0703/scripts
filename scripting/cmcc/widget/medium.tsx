import { HStack, Spacer, Text, VStack, Widget } from "scripting";
import type { CmccData } from "../util/cmcc_core";
import { Balance, Chips, FlowBar, Logo, MonthLine } from "./comp";

export function View({ data }: { data: CmccData }) {
    const flow = data.flow;
    return (
        <HStack padding={true} frame={Widget.displaySize} spacing={16} alignment={"top"}>
            <VStack alignment={"leading"} spacing={0}>
                <HStack spacing={6}>
                    <Logo size={18} />
                    <Text font={"footnote"} fontWeight={"semibold"}>{"中国移动"}</Text>
                </HStack>
                <Spacer minLength={8} />
                <Balance data={data} size={"title"} />
                <Spacer minLength={6} />
                <MonthLine data={data} />
            </VStack>
            <VStack spacing={10}>
                <Spacer minLength={4} />
                {flow ? (
                    <FlowBar label={"通用"} remainGB={flow.commonGB} totalGB={flow.commonTotalGB} color={"systemGreen"} />
                ) : null}
                <Spacer />
                <Chips data={data} />
            </VStack>
        </HStack>
    );
}
