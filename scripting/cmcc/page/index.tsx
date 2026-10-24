import {
    Button,
    HStack,
    Image,
    List,
    Navigation,
    NavigationStack,
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

export function View() {
    const dismiss = Navigation.useDismiss();
    const data = useObservable<CmccData | null>(null);
    const error = useObservable<string>("");
    const loading = useObservable<boolean>(false);
    const step = useObservable<string>("");

    const refresh = async () => {
        loading.setValue(true);
        error.setValue("");
        step.setValue("准备");
        try {
            cmcc.save();
            data.setValue(await cmcc.getData((s) => step.setValue(s)));
            try { Widget.reloadUserWidgets(); } catch {}
        } catch (e) {
            error.setValue(String(e));
        } finally {
            loading.setValue(false);
        }
    };

    useEffect(() => {
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
                    title={"配置"}
                    footer={
                        <Text font={"footnote"}>
                            ref 是 code 服务里的账号；token 对应服务端 YYB_PROTOCOL_TOKEN。登录会话缓存 2 小时，失效会自动重取 code。
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
