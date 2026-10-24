import { HStack, Spacer, Text, VStack, Widget } from "scripting";
import type { CmccData } from "../util/cmcc_core";
import { Balance, Chip, FlowBar, Logo, MonthLine } from "./comp";

export function View({ data }: { data: CmccData }) {
    const flow = data.flow;
    return (
        <HStack padding={true} frame={Widget.displaySize} spacing={16} alignment={"top"}>
            <VStack alignment={"leading"} spacing={0}>
                <HStack spacing={6}>
                    <Logo size={20} />
                    <Text font={"headline"} fontWeight={"semibold"}>{"中国移动"}</Text>
                </HStack>
                <Spacer minLength={12} />
                <Balance data={data} size={"largeTitle"} />
                <Spacer minLength={12} />
                <MonthLine data={data} />
            </VStack>
            <VStack spacing={12}>
                <Spacer minLength={4} />
                {flow ? (
                    <FlowBar label={"通用"} remainGB={flow.commonGB} totalGB={flow.commonTotalGB} color={"systemGreen"} showTotal={true} />
                ) : null}
                {flow && flow.dirTotalGB > 0 ? (
                    <FlowBar label={"定向"} remainGB={flow.dirGB} totalGB={flow.dirTotalGB} color={"systemOrange"} showTotal={true} />
                ) : null}
                <Spacer />
                <HStack spacing={6}>
                    {data.planName ? <Chip icon={"simcard.fill"} label={""} value={data.planName} /> : null}
                    {data.points !== null ? <Chip icon={"star.fill"} label={"积分"} value={String(data.points)} /> : null}
                </HStack>
            </VStack>
        </HStack>
    );
}
