// fclones 报告解析（纯函数，无副作用，便于独立测试）

const HEADER_RE = /^([a-fA-F0-9]+),\s*(.+?)\s*\*\s*(\d+):/;

/** 是否看起来像一条文件路径 */
const looksLikePath = (line) =>
    line.startsWith('/') || line.startsWith('.') || line.includes('/');

/**
 * 将 fclones 分组报告解析为 [{ hash, size, paths }]。
 * @param {string} text 报告全文
 * @returns {Array<{ hash: string, size: string, paths: string[] }>}
 */
export function parseFclonesText(text) {
    const groups = [];
    let current = null; // { hash, size, paths }

    const flush = () => {
        if (current?.paths.length) groups.push(current);
    };

    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;

        // 组头：  "hash, size * count:"  例如 "93d65bf…, 15292278 B (15.3 MB) * 9:"
        const header = line.match(HEADER_RE);
        if (header) {
            flush();
            const [, hash, size] = header;
            current = { hash: hash.trim(), size: size.trim() || 'unknown', paths: [] };
            continue;
        }

        if (!current) continue;

        // 路径行
        if (looksLikePath(line)) {
            current.paths.push(line);
            continue;
        }

        // 以 "-" 或 "*" 起头的路径（部分导出格式）
        if (line.startsWith('-') || line.startsWith('*')) {
            const path = line.replace(/^[\s\-*]+/, '').trim();
            if (path && looksLikePath(path)) current.paths.push(path);
        }
    }
    flush();

    return groups.filter((g) => g.paths.length > 0);
}
