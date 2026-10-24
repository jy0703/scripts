import { Divider, HStack, Image, Path, Rectangle, Script, Spacer, Text, VStack, ZStack, Color } from "scripting";
import type { CmccData } from "../util/cmcc_core";
import { formatGB, money } from "../util/format";

export function View({ data }: { data: CmccData }) {
    const flow = data.flow ? formatGB(data.flow.remainGB) : null;
    const flowTotal = data.flow ? formatGB(data.flow.totalGB) : null;
    const iconSize = 21;
    return (
        <VStack padding={true}>
            <HStack alignment="top">
                <Image
                    filePath={Path.join(Script.directory, "image/cmcc.min.png")}
                    resizable={true}
                    scaleToFit={true}
                    frame={{ width: iconSize, height: iconSize }}
                />
                <Text font={"caption2"} foregroundStyle={"secondaryLabel"} padding={{ leading: 4, top: 4 }}>
                    {data.phone ? `尾号 ${data.phone.slice(-4)}` : "中国移动"}
                </Text>
                <Spacer />
                <HStack spacing={4} alignment={"lastTextBaseline"} padding={{ top: -3 }}>
                    <Text font={"title2"} fontWeight={"semibold"}>{money(data.balance)}</Text>
                    <Text font={"caption2"} foregroundStyle={"secondaryLabel"} fontWeight={"semibold"}>{"元"}</Text>
                </HStack>
            </HStack>
            <Divider offset={{ x: 0, y: -7 }} />
            {flow && flowTotal ? (
                <InfoBlock
                    icon="antenna.radiowaves.left.and.right"
                    used={data.flow!.usedGB}
                    max={data.flow!.totalGB}
                    current={flow.value}
                    unit={flow.unit}
                    color={"systemGreen"}
                />
            ) : null}
            {data.voice ? (
                <InfoBlock
                    icon="phone.fill"
                    used={data.voice.total - data.voice.remain}
                    max={data.voice.total}
                    current={data.voice.remain}
                    unit={"MIN"}
                    color={"systemBlue"}
                />
            ) : null}
        </VStack>
    );
}

function InfoBlock({ icon, used, max, current, unit, color }: { icon: string; used: number; max: number; current: number; unit: string; color: Color }) {
    const cornerRadius = 13;
    return (
        <ZStack alignment={"trailing"}>
            <Rectangle
                fill={"tertiarySystemFill"}
                clipShape={{ type: "rect", cornerRadius: cornerRadius }}
                overlay={
                    <Rectangle
                        fill={{ gradient: true, color: color }}
                        scaleEffect={{ x: max > 0 ? Math.min(used / max, 1) : 0, y: 1, anchor: "leading" }}
                        clipShape={{ type: "rect", cornerRadius: cornerRadius }}
                    />
                }
            />
            <HStack padding={{ leading: 7, trailing: 5 }} fontWeight={"semibold"}>
                <Image systemName={icon} />
                <Spacer />
                <Text font={"footnote"} monospacedDigit={true}>{current}</Text>
                <Text font={"footnote"} padding={{ leading: -4, trailing: 2 }} monospacedDigit={true} foregroundStyle={"secondaryLabel"}>
                    {unit}
                </Text>
            </HStack>
        </ZStack>
    );
}
