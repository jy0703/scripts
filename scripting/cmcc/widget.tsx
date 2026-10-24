import { Text, Widget } from "scripting";
import { cmcc } from "./util/cmcc";
import { View as AccessoryCircular } from "./widget/circular";
import { View as SystemSmall } from "./widget/small";
import { View as SystemMedium } from "./widget/medium";
import { View as SystemLarge } from "./widget/large";

// 刷新按钮在各自视图的右上角（点一下系统会重跑本文件并重新请求数据）
(async () => {
    const data = await cmcc.getData();
    switch (Widget.family) {
        case "accessoryCircular":
            return Widget.present(<AccessoryCircular data={data} />);
        case "systemSmall":
            return Widget.present(<SystemSmall data={data} />);
        case "systemMedium":
            return Widget.present(<SystemMedium data={data} />);
        case "systemLarge":
            return Widget.present(<SystemLarge data={data} />);
        default:
            throw new Error("未适配的 Widget 尺寸");
    }
})().catch((e) => Widget.present(<Text font={"footnote"}>{String(e)}</Text>));
