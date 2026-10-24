import { Gauge, Text } from "scripting";
import type { CmccData } from "../util/cmcc_core";
import { formatGB } from "../util/format";

export function View({ data }: { data: CmccData }) {
    if (!data.flow) return <Gauge gaugeStyle="accessoryCircular" min={0} max={1} value={0} currentValueLabel={<Text>-</Text>} />;
    const { value, unit } = formatGB(data.flow.remainGB);
    return (
        <Gauge
            gaugeStyle="accessoryCircular"
            min={0}
            max={data.flow.totalGB || 1}
            value={Math.min(data.flow.usedGB, data.flow.totalGB)}
            tint={"tertiaryLabel"}
            label={<Text foregroundStyle="secondaryLabel">{unit}</Text>}
            currentValueLabel={<Text>{value < 10 ? (Math.trunc(value * 10) / 10).toFixed(1) : Math.floor(value)}</Text>}
        />
    );
}
