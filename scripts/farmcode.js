const url = $request.url;
const urlObj = new URL(url);
const code = urlObj.searchParams.get('code');

if (code) {
    console.log('farmcode:', code);
    $notification.post('farmcode', '', code);
}

const redirectUrl = 'http://127.0.0.1';
$done({
    url: redirectUrl
});