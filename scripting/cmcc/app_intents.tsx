import { AppIntentManager, AppIntentProtocol, Script, Widget } from "scripting";

export const ReloadIntent = AppIntentManager.register({
  name: Script.name,
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
    // 手动刷新：让 widget 下次运行跳过数据缓存
    Storage.set("cmcc_balance_force", "1");
    Widget.reloadUserWidgets();
  },
});
