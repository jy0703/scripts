// 从代理 App（Surge/Loon/Stash…）的 HTTP API 读取持久化键：POST /v1/scripting/evaluate
// 参数格式同 Env: "key@ip:port"（Surge 设置里开启 HTTP API 后给的那个值）
// 在代理侧执行一小段脚本读 $persistentStore，再从响应里把 JSON 抠出来。
import { fetch } from "scripting";

const KEY = "cmcc_autologin_data";

const SCRIPT = `(function () {
  var v = "";
  try {
    if (typeof $persistentStore !== "undefined") v = $persistentStore.read("${KEY}") || "";
    else if (typeof $prefs !== "undefined") v = $prefs.valueForKey("${KEY}") || "";
  } catch (e) { v = ""; }
  console.log(v);
  if (typeof $done === "function") $done(v);
})();`;

function unescapeJson(s: string) {
    return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/\\n/g, "\n");
}

// 响应可能是 {result:"..."}、{data:"..."}、纯文本，或带转义的字符串；统一校验成合法 JSON 再返回
function valid(json: string): string | null {
    try {
        const o = JSON.parse(json);
        if (o && o.url && o.body) return json;
    } catch {}
    return null;
}

function extract(raw: string): string {
    const text = String(raw || "").trim();
    if (!text) return "";
    const direct = valid(text);
    if (direct) return direct;

    // 候选字段本身可能还是「JSON 字符串字面量」，要再解一层
    const fromString = (v: string) => {
        const hit = valid(v) || valid(unescapeJson(v));
        if (hit) return hit;
        try {
            const inner = JSON.parse(v);
            if (typeof inner === "string") return valid(inner) || valid(unescapeJson(inner));
        } catch {}
        return null;
    };
    try {
        const o = JSON.parse(text);
        for (const k of ["result", "data", "body", "value"]) {
            const c = o[k];
            if (typeof c !== "string") continue;
            const hit = fromString(c);
            if (hit) return hit;
        }
    } catch {}

    const un = unescapeJson(text);
    const m = un.match(/{[sS]*?"url"[sS]*?"body"[sS]*?}/);
    if (m) {
        const hit = valid(m[0]);
        if (hit) return hit;
    }
    return "";
}

export async function readAutologinFromProxy(spec: string): Promise<string> {
    const s = String(spec || "").trim();
    if (!s) throw new Error("没填 HTTP API 地址（格式 key@ip:port）");
    let key = "";
    let host = s;
    const at = s.indexOf("@");
    if (at > 0) {
        key = s.slice(0, at);
        host = s.slice(at + 1);
    }
    if (!/^https?:\/\//.test(host)) host = `http://${host}`;
    const url = `${host.replace(/\/+$/, "")}/v1/scripting/evaluate`;

    let resp: any;
    try {
        resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Key": key, Accept: "*/*" },
            body: JSON.stringify({ script_text: SCRIPT, mock_type: "cron", timeout: 10 }),
        });
    } catch (e) {
        throw new Error(`连不上代理 HTTP API（${url}）：${String(e)}。确认 Surge/Loon 已开启 HTTP API，且地址用本机 127.0.0.1 或可达的局域网 IP`);
    }
    const text = await resp.text();
    if (!resp.ok) {
        throw new Error(`代理返回 HTTP ${resp.status}：${text.slice(0, 120)}。多半是 X-Key 不对或 HTTP API 未开启`);
    }
    const found = extract(text);
    if (!found) throw new Error(`代理里没读到 ${KEY}（响应：${text.slice(0, 120)}）。先在重写模块里登录一次中国移动 App`);
    return found;
}
