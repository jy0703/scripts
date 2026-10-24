import { Text, Widget } from "scripting";
import { cmcc } from "./util/cmcc";
import type { RenderCfg } from "./widget/comp";
import { View as AccessoryCircular } from "./widget/circular";
import { View as SystemSmall } from "./widget/small";
import { View as SystemMedium } from "./widget/medium";
import { View as SystemLarge } from "./widget/large";

// 刷新按钮在各自视图右上角：intent 里会置 force 标记，这里读掉并绕过数据缓存
(async () => {
    const force = String(Storage.get("cmcc_balance_force") || "") === "1";
    if (force) Storage.set("cmcc_balance_force", "0");
    const data = await cmcc.getData(undefined, force);
    const cfg: RenderCfg = {
        showPercent: cmcc.config.showPercent,
        smallStyle: cmcc.config.smallStyle,
        showDir: cmcc.config.showDir,
        mediumCards: cmcc.config.mediumCards,
    };
    switch (Widget.family) {
        case "accessoryCircular":
            return Widget.present(<AccessoryCircular data={data} />);
        case "systemSmall":
            return Widget.present(<SystemSmall data={data} cfg={cfg} />);
        case "systemMedium":
            return Widget.present(<SystemMedium data={data} cfg={cfg} />);
        case "systemLarge":
            return Widget.present(<SystemLarge data={data} cfg={cfg} />);
        default:
            throw new Error("未适配的 Widget 尺寸");
    }
})().catch((e) => Widget.present(<Text font={"footnote"}>{String(e)}</Text>));
