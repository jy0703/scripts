import { Navigation, Script } from "scripting";
import { View } from "./page";

(async () => {
  await Navigation.present(<View />);
})()
  .catch((e) => console.log(e))
  .finally(Script.exit);
