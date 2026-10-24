import { Button, Text, Widget } from "scripting";
import { cmcc } from "./util/cmcc";
import { ReloadIntent } from "./app_intents";
import { View as AccessoryCircular } from "./widget/circular";
import { View as SystemSmall } from "./widget/small";
import { View as SystemMedium } from "./widget/medium";
import { View as SystemLarge } from "./widget/large";

(async () => {
    const data = await cmcc.getData();
    switch (Widget.family) {
        case "accessoryCircular":
            return Widget.present(
                <Button intent={ReloadIntent(undefined)} buttonStyle={"plain"}>
                    <AccessoryCircular data={data} />
                </Button>,
            );
        case "systemSmall":
            return Widget.present(
                <Button intent={ReloadIntent(undefined)} buttonStyle={"plain"}>
                    <SystemSmall data={data} />
                </Button>,
            );
        case "systemMedium":
            return Widget.present(
                <Button intent={ReloadIntent(undefined)} buttonStyle={"plain"}>
                    <SystemMedium data={data} />
                </Button>,
            );
        case "systemLarge":
            return Widget.present(
                <Button intent={ReloadIntent(undefined)} buttonStyle={"plain"}>
                    <SystemLarge data={data} />
                </Button>,
            );
        default:
            throw new Error("未适配的 Widget 尺寸");
    }
})().catch((e) => Widget.present(<Text font={"footnote"}>{String(e)}</Text>));
