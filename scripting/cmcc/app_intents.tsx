import { AppIntentManager, AppIntentProtocol, Script, Widget } from "scripting";

export const ReloadIntent = AppIntentManager.register({
  name: Script.name,
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
    Widget.reloadUserWidgets();
  },
});
