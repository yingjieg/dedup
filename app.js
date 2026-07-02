import { parseFclonesText } from './parser.js';

// ----- DOM 引用 -----
const $ = (id) => document.getElementById(id);
const fileInput = $('fileInput');
const clearFileBtn = $('clearFileBtn');
const fileNameDisplay = $('fileNameDisplay');
const container = $('fileGroupsContainer');
const statsDisplay = $('statsDisplay');
const selectedCountSpan = $('selectedCount');
const deleteBtn = $('deleteBtn');
const toast = $('toast');
const uploadArea = $('uploadArea');
const sortSelect = $('sortSelect');
const themeToggle = $('themeToggle');

// ----- 状态 -----
let groups = [];                 // 当前文件组 [{ hash, size, paths, _origIndex }]
const checkedSet = new Set();    // 已选中的路径集合（size 即选中数，O(1)）
let totalFiles = 0;              // 缓存的文件总数，仅在 groups 变化时更新
let io = null;                   // 虚拟滚动用的 IntersectionObserver

// ----- 加载数据 -----
function loadDataFromText(text) {
    const parsed = parseFclonesText(text);
    if (parsed.length === 0) {
        showToast('⚠️ 未能解析出有效文件组，请检查格式');
        return false;
    }
    // 记录原始顺序，供"默认顺序"恢复使用
    parsed.forEach((g, i) => { g._origIndex = i; });
    groups = parsed;
    // 重置选中状态（Set 空即全部未选，无需预填 22 万条）
    checkedSet.clear();
    totalFiles = groups.reduce((acc, g) => acc + g.paths.length, 0);
    applySort();
    render();
    showToast(`✅ 成功解析 ${groups.length} 个文件组，共 ${totalFiles} 个文件`);
    return true;
}

// ----- 排序 -----
// 按当前下拉框选择对 groups 就地排序（不改变选中状态，checkedSet 以路径为键）
const SORTERS = {
    'count-desc': (a, b) => b.paths.length - a.paths.length || a._origIndex - b._origIndex,
    'count-asc': (a, b) => a.paths.length - b.paths.length || a._origIndex - b._origIndex,
    default: (a, b) => a._origIndex - b._origIndex,
};
function applySort() {
    groups.sort(SORTERS[sortSelect.value] ?? SORTERS.default);
}

// ----- 渲染 -----
// 虚拟滚动：只为每个组创建一个空的占位卡片（带估算高度），
// 真正的内容（表头 + 文件列表）在滚动进入视口附近时才挂载，
// 离开视口后卸载，避免一次性生成数十万 DOM 节点。

// 估算某个组渲染后的高度（border-box），用于占位，减少滚动跳动
const estimateGroupHeight = (group) => 70 + group.paths.length * 41;

// 生成一个组的内部 HTML（不含外层 .file-group 容器）
// 路径在左、复选框靠右（每行右端对齐成竖列）；全选放在表头右侧、与之同列。
// 每行用 <label> 包裹，整行可点击。
function buildGroupInner(group, groupIndex) {
    const allChecked = group.paths.every((p) => checkedSet.has(p));
    const items = group.paths.map((path) => `
        <label class="file-item">
            <span class="file-path">${escapeHtml(path)}</span>
            <input type="checkbox" class="file-checkbox" data-path="${encodeURIComponent(path)}" ${checkedSet.has(path) ? 'checked' : ''} />
        </label>`).join('');

    return `
        <div class="group-header">
            <div class="hash-info">
                <span class="hash" title="${escapeHtml(group.hash)}">${escapeHtml(group.hash)}</span>
                <span class="meta">${group.paths.length} 个副本 · ${escapeHtml(group.size ?? 'unknown')}</span>
            </div>
            <label class="group-select" title="全选 / 取消本组">
                全选
                <input type="checkbox" class="select-all-checkbox" data-group-index="${groupIndex}" ${allChecked ? 'checked' : ''} />
            </label>
        </div>
        <div class="file-list">${items}</div>`;
}

function mountGroup(el) {
    if (el.dataset.mounted) return;
    const i = Number.parseInt(el.dataset.groupIndex, 10);
    el.innerHTML = buildGroupInner(groups[i], i);
    el.dataset.mounted = '1';
    el.style.minHeight = '';   // 让真实内容决定高度
    syncGroupSelectAll(el, groups[i]);   // indeterminate 无法用 HTML 属性表达，需 JS 设置
}

// 依据当前选中情况，同步表头"全选"复选框的 checked / indeterminate 状态
function syncGroupSelectAll(groupEl, group) {
    const box = groupEl.querySelector('.select-all-checkbox');
    if (!box) return;
    const selected = group.paths.reduce((n, p) => n + (checkedSet.has(p) ? 1 : 0), 0);
    box.checked = selected === group.paths.length;
    box.indeterminate = selected > 0 && selected < group.paths.length;
}

function unmountGroup(el) {
    if (!el.dataset.mounted) return;
    // 卸载前锁定当前高度，保证滚动条位置稳定
    el.style.minHeight = `${el.offsetHeight}px`;
    el.replaceChildren();
    delete el.dataset.mounted;
}

function onIntersect(entries) {
    for (const entry of entries) {
        if (entry.isIntersecting) mountGroup(entry.target);
        else unmountGroup(entry.target);
    }
}

function render() {
    io?.disconnect();
    io = null;

    if (groups.length === 0) {
        container.innerHTML = '<div class="card empty-message">暂无重复文件数据，请上传 fclones 结果</div>';
        updateStatsAndUI();
        return;
    }

    // 只创建占位卡片，内容延迟挂载
    const placeholders = groups.map((group, groupIndex) => {
        const el = document.createElement('div');
        el.className = 'card file-group';
        el.dataset.groupIndex = groupIndex;
        el.style.minHeight = `${estimateGroupHeight(group)}px`;
        return el;
    });
    container.replaceChildren(...placeholders);

    // 视口上下各预留 600px 提前挂载，滚动更顺滑
    io = new IntersectionObserver(onIntersect, { rootMargin: '600px 0px' });
    for (const el of placeholders) io.observe(el);

    updateStatsAndUI();
}

// ----- 事件委托 (绑定一次，render 重建 DOM 后无需重新绑定) -----
function bindContainerEvents() {
    container.addEventListener('change', (e) => {
        const cb = e.target;

        // 表头"全选"：切换本组所有文件
        if (cb.classList.contains('select-all-checkbox')) {
            const group = groups[Number.parseInt(cb.dataset.groupIndex, 10)];
            if (!group) return;
            for (const p of group.paths) {
                if (cb.checked) checkedSet.add(p);
                else checkedSet.delete(p);
            }
            for (const box of cb.closest('.file-group').querySelectorAll('.file-checkbox')) {
                box.checked = cb.checked;
            }
            cb.indeterminate = false;
            updateStatsAndUI();
            return;
        }

        // 单个文件复选框
        if (cb.classList.contains('file-checkbox')) {
            const path = decodeURIComponent(cb.dataset.path);
            if (cb.checked) checkedSet.add(path);
            else checkedSet.delete(path);
            const groupEl = cb.closest('.file-group');
            syncGroupSelectAll(groupEl, groups[Number.parseInt(groupEl.dataset.groupIndex, 10)]);
            updateStatsAndUI();
        }
    });
}

// ----- 更新统计 & 按钮 -----
function updateStatsAndUI() {
    const checkedCount = checkedSet.size;   // O(1)
    statsDisplay.textContent = `${groups.length} 个文件组 · ${totalFiles} 个文件`;
    selectedCountSpan.textContent = `已选 ${checkedCount} 个文件`;
    deleteBtn.disabled = checkedCount === 0;
}

// ----- 执行删除 (调用后端API) -----
async function executeDelete(filePaths) {
    if (!filePaths?.length) {
        showToast('没有文件需要删除');
        return;
    }

    showToast(`⏳ 正在删除 ${filePaths.length} 个文件...`);

    try {
        const res = await fetch('/api/delete-files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: filePaths }),
        });
        if (!res.ok) throw new Error(`服务器响应错误: ${res.status}`);

        const data = await res.json();
        if (data.success) {
            showToast(`✅ 成功删除 ${data.deletedCount ?? filePaths.length} 个文件`);
            removeDeletedPaths(filePaths);
            applySort();
            render();
        } else {
            showToast(`❌ 删除失败: ${data.message ?? '未知错误'}`);
            uncheckPaths(filePaths);   // 删除失败：取消这些路径的选中
        }
    } catch (err) {
        console.error('删除请求失败:', err);
        // 如果是本地测试（后端未启动），模拟删除成功
        if (err.message.includes('Failed to fetch')) {
            showToast(`⚠️ 后端服务未启动，模拟删除 ${filePaths.length} 个文件`);
            removeDeletedPaths(filePaths);
            applySort();
            render();
        } else {
            showToast(`❌ 请求失败: ${err.message}`);
            uncheckPaths(filePaths);
        }
    }
}

// 取消一组路径的选中（用于删除失败后重置状态）
function uncheckPaths(paths) {
    for (const p of paths) checkedSet.delete(p);
    render();
}

// ----- 执行 rm 删除 (底部按钮) -----
function executeRmDelete() {
    const selectedPaths = [...checkedSet];
    if (selectedPaths.length === 0) {
        showToast('没有选中任何文件');
        return;
    }
    if (confirm(`确定要删除选中的 ${selectedPaths.length} 个文件吗？`)) {
        executeDelete(selectedPaths);
    }
}

// 从 groups 和 checkedSet 中移除已删除路径，并同步 totalFiles
function removeDeletedPaths(deletedPaths) {
    const deleted = new Set(deletedPaths);
    let removed = 0;
    for (let i = groups.length - 1; i >= 0; i--) {
        const group = groups[i];
        group.paths = group.paths.filter((p) => {
            if (!deleted.has(p)) return true;
            checkedSet.delete(p);
            removed++;
            return false;
        });
        if (group.paths.length === 0) groups.splice(i, 1);
    }
    totalFiles -= removed;
}

// ----- 工具函数 -----
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeHtml = (unsafe) => unsafe.replace(/[&<>"]/g, (m) => HTML_ESCAPES[m]);

let toastTimer = null;
function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// ----- 上传处理 -----
async function handleFile(file) {
    if (!file) return;
    try {
        const text = await file.text();
        fileNameDisplay.textContent = loadDataFromText(text) ? file.name : '解析失败';
    } catch {
        showToast('读取文件失败');
    }
}

// ----- 清空数据 -----
function clearData() {
    groups = [];
    checkedSet.clear();
    totalFiles = 0;
    fileNameDisplay.textContent = '未上传';
    render();
    showToast('已清空数据');
}

// ----- 主题切换 -----
// 图标显示"切换后将进入的主题"：浅色时显示 🌙，深色时显示 ☀️
function updateThemeIcon() {
    const isDark = document.documentElement.dataset.theme === 'dark';
    themeToggle.textContent = isDark ? '☀️' : '🌙';
}

// ----- 事件绑定 -----
fileInput.addEventListener('change', (e) => {
    const [file] = e.target.files ?? [];
    if (file) handleFile(file);
    e.target.value = '';   // 允许重新选择同一文件
});

clearFileBtn.addEventListener('click', clearData);

themeToggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    updateThemeIcon();
});

sortSelect.addEventListener('change', () => {
    if (groups.length === 0) return;
    applySort();
    render();
});

// 拖拽上传
uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragging');
});
uploadArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragging');
});
uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragging');
    const [file] = e.dataTransfer.files ?? [];
    if (file) handleFile(file);
});

deleteBtn.addEventListener('click', executeRmDelete);

// ----- 初始化 (空状态) -----
bindContainerEvents();
updateThemeIcon();
render();

console.log('💡 删除请求将发送到 /api/delete-files');
