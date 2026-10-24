import {
    Button,
    HStack,
    Image,
    List,
    Navigation,
    NavigationStack,
    Picker,
    ProgressView,
    Section,
    Spacer,
    Text,
    TextField,
    useEffect,
    useObservable,
    Widget,
} from "scripting";
import { cmcc } from "../util/cmcc";
import type { CmccData } from "../util/cmcc_core";
import { formatGB, money } from "../util/format";

const INTERVALS: Record<string, number> = {
    "15 分钟": 15,
    "30 分钟": 30,
    "1 小时": 60,
    "3 小时": 180,
    "6 小时": 360,
    "12 小时": 720,
    "24 小时": 1440,
};
const intervalLabel = (min: number) => Object.keys(INTERVALS).find((k) => INTERVALS[k] === min) || "3 小时";

export function View() {
    const dismiss = Navigation.useDismiss();
    const data = useObservable<CmccData | null>(null);
    const error = useObservable<string>("");
    const loading = useObservable<boolean>(false);
    const step = useObservable<string>("");
    const source = useObservable<string>(cmcc.config.source);
    const cfg = useObservable<any>({
        showPercent: cmcc.config.showPercent,
        smallStyle: cmcc.config.smallStyle,
        showDir: cmcc.config.showDir,
        mediumCards: cmcc.config.mediumCards,
        cacheEnabled: cmcc.config.cacheEnabled,
        intervalLabel: intervalLabel(cmcc.config.intervalMin),
    });
    const auth = useObservable<{ ok: boolean; at: string }>({ ok: false, at: "" });

    const setCfg = (patch: any) => {
        Object.assign(cmcc.config, patch);
        cmcc.save();
        cfg.setValue({ ...cfg.value, ...patch });
    };

    const checkAuth = () => {
        const raw = String(Storage.get("cmcc_autologin_data") || "");
        let at = "";
        if (raw) {
            try {
                at = String(JSON.parse(raw).capturedAt || "");
            } catch {}
        }
        auth.setValue({ ok: !!raw, at });
    };

    useEffect(() => {
        cmcc.config.source = source.value === "app" ? "app" : "wechat";
        cmcc.save();
    }, [source.value]);

    const refresh = async () => {
        loading.setValue(true);
        error.setValue("");
        step.setValue("准备");
        try {
            cmcc.save();
            data.setValue(await cmcc.getData((s) => step.setValue(s), true));
            try { Widget.reloadUserWidgets(); } catch {}
        } catch (e) {
            error.setValue(String(e));
        } finally {
            loading.setValue(false);
        }
    };

    useEffect(() => {
        checkAuth();
        refresh();
    }, []);

    return (
        <NavigationStack>
            <List
                navigationTitle={"移动余额套餐"}
                toolbar={{
                    topBarLeading: [<Button title={"关闭"} systemImage={"xmark"} action={dismiss} />],
                    topBarTrailing: [
                        <Button action={refresh}>
                            {loading.value ? <ProgressView /> : <Image systemName={"arrow.clockwise"} />}
                        </Button>,
                    ],
                }}>
                <Section title={"数据"}>
                    <DataRows data={data} error={error} loading={loading} step={step} />
                </Section>

                <Section
                    title={"数据来源"}
                    footer={
                        <Text font={"footnote"}>
                            小程序：code 服务取 sessionId 查 uniApi；App：内置 10086.js 直接跑（自动重放 autoLogin、签名、解密）。App 方式每次刷新都会重放一次 autoLogin，会顶掉手机 App 的登录态。
                        </Text>
                    }>
                    <SourceRow label={"小程序（code 服务）"} active={source.value !== "app"} onTap={() => source.setValue("wechat")} />
                    <SourceRow label={"App（10086 模块）"} active={source.value === "app"} onTap={() => source.setValue("app")} />
                    {source.value === "app" ? (
                        <ConfigField
                            title={"autoLogin 传参（留空则用抓取的）"}
                            field={"autologin"}
                            placeholder={'{"url":"https://client.app.coc.10086.cn/...","body":"...","x_qen":"14"}'}
                        />
                    ) : null}
                </Section>

                <Section
                    title={"autoLogin 抓参状态"}
                    footer={
                        <Text font={"footnote"}>
                            由重写抓 client.app.coc.10086.cn 的 autoLogin 请求，写入 cmcc_autologin_data（与本仓库的中国移动签到脚本共用）。抓不到时确认：① 重写已启用；② 开启 MITM 并信任证书；③ 重新打开中国移动 App 登录一次。
                        </Text>
                    }>
                    <HStack spacing={8}>
                        <Text foregroundStyle={auth.value.ok ? "systemGreen" : "systemOrange"}>
                            {auth.value.ok ? "✅ 已抓到 autoLogin 传参" : "⚠️ 尚未抓到 autoLogin 传参，请先重新登录一次中国移动 App"}
                        </Text>
                    </HStack>
                    {auth.value.ok && auth.value.at ? (
                        <Row icon={"clock"} title={"抓取时间"} value={new Date(auth.value.at).toLocaleString()} />
                    ) : null}
                    <Button action={checkAuth}>
                        <HStack spacing={8}>
                            <Image systemName={"arrow.clockwise"} />
                            <Text>刷新抓参状态</Text>
                        </HStack>
                    </Button>
                </Section>

                <Section
                    title={"渲染配置"}
                    footer={
                        <Text font={"footnote"}>
                            百分比作用于进度条；小号「摘要」不显示进度条，「进度清单」显示条形进度；中号四卡显示定向，三卡隐藏定向卡。刷新间隔也是数据缓存有效期，点小组件上的刷新按钮会强制重新取数。
                        </Text>
                    }>
                    <PickerRow
                        label={"显示剩余百分比"}
                        value={cfg.value.showPercent ? "开" : "关"}
                        options={["关", "开"]}
                        onChange={(v) => setCfg({ showPercent: v === "开" })}
                    />
                    <PickerRow
                        label={"小号组件样式"}
                        value={cfg.value.smallStyle}
                        options={["摘要", "紧凑清单", "进度清单"]}
                        onChange={(v) => setCfg({ smallStyle: v })}
                    />
                    <PickerRow
                        label={"显示定向流量"}
                        value={cfg.value.showDir ? "开" : "关"}
                        options={["开", "关"]}
                        onChange={(v) => setCfg({ showDir: v === "开" })}
                    />
                    <PickerRow
                        label={"中号组件布局"}
                        value={cfg.value.mediumCards}
                        options={["四卡", "三卡"]}
                        onChange={(v) => setCfg({ mediumCards: v })}
                    />
                    <PickerRow
                        label={"刷新间隔 / 缓存有效期"}
                        value={cfg.value.intervalLabel}
                        options={Object.keys(INTERVALS)}
                        onChange={(v) => setCfg({ intervalLabel: v, intervalMin: INTERVALS[v] })}
                    />
                    <PickerRow
                        label={"启用缓存"}
                        value={cfg.value.cacheEnabled ? "开" : "关"}
                        options={["开", "关"]}
                        onChange={(v) => setCfg({ cacheEnabled: v === "开" })}
                    />
                </Section>

                <Section
                    title={"小程序配置"}
                    footer={
                        <Text font={"footnote"}>
                            ref 是 code 服务里的账号；token 对应服务端 YYB_PROTOCOL_TOKEN。登录会话缓存 2 小时，失效会自动重取 code。选 App 方式时这里是备用的。
                        </Text>
                    }>
                    <ConfigField title={"服务器地址"} field={"address"} placeholder={"http://192.168.2.5:8000"} />
                    <ConfigField title={"token"} field={"token"} placeholder={"YYB_PROTOCOL_TOKEN"} />
                    <ConfigField title={"账号 ref"} field={"ref"} placeholder={"1"} />
                </Section>
            </List>
        </NavigationStack>
    );
}

function PickerRow({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
    return (
        <Picker label={<Text>{label}</Text>} pickerStyle={"menu"} value={value} onChanged={onChange}>
            {options.map((o) => (
                <Text tag={o} key={o}>
                    {o}
                </Text>
            ))}
        </Picker>
    );
}

function SourceRow({ label, active, onTap }: { label: string; active: boolean; onTap: () => void }) {
    return (
        <Button action={onTap}>
            <HStack spacing={8}>
                <Text>{label}</Text>
                <Spacer />
                {active ? <Image systemName={"checkmark"} foregroundStyle={"systemBlue"} /> : null}
            </HStack>
        </Button>
    );
}

function ConfigField({ title, field, placeholder }: { title: string; field: string; placeholder: string }) {
    const value = useObservable<string>((cmcc.config as any)[field] || "");
    useEffect(() => {
        (cmcc.config as any)[field] = value.value;
        cmcc.save();
    }, [value.value]);
    return <TextField title={title} value={value} placeholder={placeholder} />;
}

function DataRows({ data, error, loading, step }: { data: any; error: any; loading: any; step: any }) {
    if (error.value) return <Text foregroundStyle={"systemRed"}>{error.value}</Text>;
    const d: CmccData | null = data.value;
    if (!d) {
        return loading.value
            ? <Text foregroundStyle={"secondaryLabel"}>正在获取…{step.value ? `（${step.value}）` : ""}</Text>
            : <Text foregroundStyle={"secondaryLabel"}>还没有数据，点右上角刷新</Text>;
    }
    const flow = d.flow ? formatGB(d.flow.remainGB) : null;
    const total = d.flow ? formatGB(d.flow.totalGB) : null;
    const flowText =
        flow && total
            ? `${flow.value}${flow.unit} / ${total.value}${total.unit}${
                  d.flow!.dirGB > 0 ? `（通用 ${formatGB(d.flow!.commonGB).value} · 定向 ${formatGB(d.flow!.dirGB).value}）` : ""
              }`
            : "-";
    return (
        <>
            <Row icon={"phone.fill"} title={"账号"} value={d.phone ? `尾号 ${d.phone.slice(-4)}${d.province ? ` · ${d.province}` : ""}` : "-"} />
            <Row icon={"yensign.circle.fill"} title={"话费余额"} value={`${money(d.balance)} 元`} />
            <Row
                icon={"calendar"}
                title={"本月话费"}
                value={`${money(d.monthFee)} 元${Number(d.oweFee) > 0 ? ` · 欠费 ${money(d.oweFee)} 元` : ""}`}
            />
            <Row
                icon={"simcard.fill"}
                title={"主套餐"}
                value={d.planName ? `${d.planName}${d.planPrice ? ` ${money(d.planPrice)} 元/月` : ""}` : "-"}
            />
            <Row icon={"star.fill"} title={"积分"} value={d.points !== null ? String(d.points) : "-"} />
            <Row icon={"antenna.radiowaves.left.and.right"} title={"流量"} value={flowText} />
            <Row icon={"phone.arrow.up.right"} title={"语音"} value={d.voice ? `${d.voice.remain} / ${d.voice.total} 分钟` : "-"} />
            <Row icon={"message.fill"} title={"短信"} value={d.sms ? `${d.sms.remain} / ${d.sms.total} 条` : "-"} />
            <Row icon={"clock"} title={"更新于"} value={d.updatedAt} />
        </>
    );
}

function Row({ icon, title, value }: { icon: string; title: string; value: string }) {
    return (
        <HStack spacing={12}>
            <Image systemName={icon} foregroundStyle={"systemBlue"} />
            <Text>{title}</Text>
            <Spacer />
            <Text foregroundStyle={"secondaryLabel"}>{value}</Text>
        </HStack>
    );
}
