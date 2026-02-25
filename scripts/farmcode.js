// Surge Script for Extracting Code and Blocking Request

// 全局变量，用于跟踪最后一次请求的时间戳
let lastRequestTime = 0;

// 1. 获取请求信息
let url = $request.url;
let currentTime = Date.now();

// 2. 检查 URL 是否包含目标路径
if (!url.includes('gate-obt.nqf.qq.com/prod/ws')) {
    // 不匹配，直接放行
    $done({});
} else {
    // 3. 检查是否为最新的请求
    if (currentTime - lastRequestTime < 1000) { // 1秒内的请求视为重复请求
        // 不是最新的请求，直接放行
        $done({});
        return;
    }
    
    // 更新最后一次请求的时间戳
    lastRequestTime = currentTime;
    
    // 4. 提取 URL 中的参数
    // 创建一个 URL 对象来解析查询参数
    let parsedUrl = new URL(url);
    let code = parsedUrl.searchParams.get('code');
    let platform = parsedUrl.searchParams.get('platform') || 'default'; // 默认值防止 null

    // 5. 判断是否获取到 code
    if (!code) {
        // 未获取到 code，发送通知并放行（或阻断，根据需求）
        console.log("获取失败：未拿到 code");
        $notification.post("获取失败", "", "未拿到 code");
        $done({}); // 这里选择放行，也可以改为阻断
    } else {
        // 6. 发送通知
        console.log("已获取 code: " + code);
        $notification.post("已获取 code", "已获取", code);

        // 7. 阻断请求
        $done({ reject: true });
    }
}