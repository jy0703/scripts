// 纯 JS 的 AES-128-CBC 解密（PKCS7）+ base64/hex/UTF-8 转换。
// 10086+ 小程序的两套响应都用同一把 key/iv：
//   /website/uniApi/*        → 整段 hex
//   newdirect/execute        → {encryptData: base64(base64(密文))}
// 这里只做解密，不做加密；Scripting 运行在 iOS JavaScriptCore，没有 Node crypto。

function buildSBox() {
    const sbox = new Uint8Array(256);
    const inv = new Uint8Array(256);
    let p = 1, q = 1;
    do {
        // p 乘以 3（生成元），q 乘以 3 的逆
        p = (p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
        q ^= q << 1;
        q ^= q << 2;
        q ^= q << 4;
        q &= 0xff;
        if (q & 0x80) q ^= 0x09;
        // q 此时是 p 的乘法逆元
        let x = q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4);
        x = (x ^ 0x63) & 0xff;
        sbox[p] = x;
        inv[x] = p;
    } while (p !== 1);
    sbox[0] = 0x63;
    inv[0x63] = 0;
    return { sbox, inv };
}

function rotl8(x, shift) {
    return ((x << shift) | (x >>> (8 - shift))) & 0xff;
}

const { sbox: SBOX, inv: INV_SBOX } = buildSBox();

function xtime(a) {
    return ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
}

function mul(a, b) {
    let r = 0;
    for (let i = 0; i < 8; i++) {
        if (b & 1) r ^= a;
        a = xtime(a);
        b >>= 1;
    }
    return r & 0xff;
}

function expandKey(key) {
    const w = new Uint8Array(176);
    w.set(key);
    let rc = 1;
    for (let i = 16; i < 176; i += 4) {
        let t0 = w[i - 4], t1 = w[i - 3], t2 = w[i - 2], t3 = w[i - 1];
        if (i % 16 === 0) {
            const tmp = t0;
            t0 = SBOX[t1] ^ rc;
            t1 = SBOX[t2];
            t2 = SBOX[t3];
            t3 = SBOX[tmp];
            rc = xtime(rc);
        }
        w[i] = w[i - 16] ^ t0;
        w[i + 1] = w[i - 15] ^ t1;
        w[i + 2] = w[i - 14] ^ t2;
        w[i + 3] = w[i - 13] ^ t3;
    }
    return w;
}

function addRoundKey(state, w, round) {
    const off = round * 16;
    for (let i = 0; i < 16; i++) state[i] ^= w[off + i];
}

function invSubBytes(state) {
    for (let i = 0; i < 16; i++) state[i] = INV_SBOX[state[i]];
}

function invShiftRows(s) {
    // s[row + 4*col]，逆向循环左移 row 位 = 循环右移 row 位
    let t;
    t = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;   // row1 右移 1
    t = s[2]; s[2] = s[10]; s[10] = t;                            // row2 右移 2 = 对换两对
    t = s[6]; s[6] = s[14]; s[14] = t;
    t = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t; // row3 右移 3
}

function invMixColumns(s) {
    for (let c = 0; c < 16; c += 4) {
        const a0 = s[c], a1 = s[c + 1], a2 = s[c + 2], a3 = s[c + 3];
        s[c] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9);
        s[c + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13);
        s[c + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11);
        s[c + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14);
    }
}

function decryptBlock(block, w) {
    const s = Uint8Array.from(block);
    addRoundKey(s, w, 10);
    for (let round = 9; round >= 1; round--) {
        invShiftRows(s);
        invSubBytes(s);
        addRoundKey(s, w, round);
        invMixColumns(s);
    }
    invShiftRows(s);
    invSubBytes(s);
    addRoundKey(s, w, 0);
    return s;
}

export function aesCbcDecrypt(cipher, key, iv) {
    if (cipher.length === 0 || cipher.length % 16 !== 0) throw new Error("密文长度不是 16 的倍数");
    const w = expandKey(key);
    const out = new Uint8Array(cipher.length);
    let prev = iv;
    for (let off = 0; off < cipher.length; off += 16) {
        const block = cipher.slice(off, off + 16);
        const plain = decryptBlock(block, w);
        for (let i = 0; i < 16; i++) out[off + i] = plain[i] ^ prev[i];
        prev = block;
    }
    // PKCS7 去填充
    const pad = out[out.length - 1];
    if (pad >= 1 && pad <= 16 && out.length >= pad) return out.slice(0, out.length - pad);
    return out;
}

export function bytesToUtf8(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; ) {
        const b = bytes[i];
        if (b < 0x80) {
            s += String.fromCharCode(b);
            i += 1;
        } else if (b >= 0xf0 && i + 3 < bytes.length) {
            const cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63);
            const v = cp - 0x10000;
            s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
            i += 4;
        } else if (b >= 0xe0 && i + 2 < bytes.length) {
            s += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63));
            i += 3;
        } else if (b >= 0xc0 && i + 1 < bytes.length) {
            s += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63));
            i += 2;
        } else {
            s += "\ufffd";
            i += 1;
        }
    }
    return s;
}

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64ToBytes(b64) {
    const clean = String(b64).replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
    const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
    let acc = 0, bits = 0, j = 0;
    for (let i = 0; i < clean.length; i++) {
        acc = (acc << 6) | B64_CHARS.indexOf(clean[i]);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[j++] = (acc >> bits) & 0xff;
        }
    }
    return out.slice(0, j);
}

export function hexToBytes(hex) {
    const clean = String(hex).replace(/[^0-9a-fA-F]/g, "");
    const out = new Uint8Array(Math.floor(clean.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
}
