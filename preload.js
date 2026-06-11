const { contextBridge, ipcRenderer } = require('electron');

const api = {
  changeDownloadFolder: () => ipcRenderer.invoke('change-download-folder'),
  getDownloadFolder: () => ipcRenderer.invoke('get-download-folder'),
  armDownload: (payload) => ipcRenderer.invoke('arm-download', payload),
  onDownloadCompleted: (callback) => {
    const listener = (event, arg) => callback(arg);
    ipcRenderer.on('download-completed', listener);
    return () => {
      ipcRenderer.removeListener('download-completed', listener);
    };
  }
};

// Expose API cho trình duyệt nội bộ
contextBridge.exposeInMainWorld('electronAPI', api);
window.electronAPI = api;

let isAppInitialized = false;
function initApp() {
  if (isAppInitialized) return;
  if (!window.location.href.includes('hoadondientu.gdt.gov.vn')) return;
  isAppInitialized = true;

  class OverlayUI {
    constructor(onStart, onStop, onSkip, onChangeFolder, initialFolder) {
      this.onStart = onStart;
      this.onStop = onStop;
      this.onSkip = onSkip;
      this.onChangeFolder = onChangeFolder;

      this.container = document.createElement('div');
      this.container.id = 'electron-batch-dl-root';
      this.container.style.position = 'fixed';
      this.container.style.bottom = '20px';
      this.container.style.right = '20px';
      this.container.style.zIndex = '999999';

      this.shadow = this.container.attachShadow({ mode: 'closed' });
      this.render(initialFolder);
      document.body.appendChild(this.container);
      this.makeDraggable();
    }

    render(initialFolder) {
      this.shadow.innerHTML = `
        <style>
          .panel {
            width: 320px;
            background: linear-gradient(135deg, #ffffff 0%, #f4f6fc 100%);
            border: 1px solid #dcdfe6;
            border-radius: 12px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #2c3e50;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            transition: all 0.3s ease;
          }
          .header {
            background: linear-gradient(90deg, #0052cc 0%, #007aff 100%);
            color: white;
            padding: 12px 15px;
            font-weight: 600;
            font-size: 14px;
            cursor: move;
            display: flex;
            justify-content: space-between;
            align-items: center;
            user-select: none;
          }
          .body {
            padding: 15px;
          }
          .folder-section {
            margin-bottom: 12px;
            font-size: 12px;
            background: #eef2fe;
            padding: 8px 10px;
            border-radius: 6px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .folder-text {
            font-weight: 600;
            color: #0052cc;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 200px;
          }
          .btn-small {
            font-size: 11px;
            background: #0052cc;
            color: white;
            border: none;
            padding: 3px 8px;
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.2s;
          }
          .btn-small:hover {
            background: #0040a3;
          }
          .stats-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
            margin-bottom: 12px;
            font-size: 12px;
          }
          .stat-card {
            background: white;
            padding: 8px;
            border-radius: 6px;
            border: 1px solid #e4e7ed;
          }
          .stat-label {
            color: #909399;
            font-size: 10px;
            text-transform: uppercase;
            margin-bottom: 2px;
          }
          .stat-value {
            font-weight: bold;
            font-size: 13px;
          }
          .actions {
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
          }
          button.btn-action {
            flex: 1;
            padding: 10px 8px;
            font-size: 12px;
            font-weight: 600;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .btn-start {
            background: #28c76f;
            color: white;
          }
          .btn-start:hover:not(:disabled) {
            background: #20a65b;
          }
          .btn-skip {
            background: #ff9f43;
            color: white;
          }
          .btn-skip:hover:not(:disabled) {
            background: #e0852b;
          }
          .btn-stop {
            background: #ea5455;
            color: white;
          }
          .btn-stop:hover:not(:disabled) {
            background: #d63b3b;
          }
          button:disabled {
            background: #c0c4cc;
            cursor: not-allowed;
            opacity: 0.6;
          }
          .log-panel {
            height: 110px;
            overflow-y: auto;
            background: #1e1e1e;
            color: #39ff14;
            font-family: "Courier New", Courier, monospace;
            font-size: 11px;
            padding: 8px;
            border-radius: 6px;
            box-shadow: inset 0 2px 8px rgba(0,0,0,0.5);
          }
          .log-item {
            margin-bottom: 3px;
            line-height: 1.3;
          }
        </style>
        <div class="panel">
          <div class="header">
            <span>Công Cụ Tải Hóa Đơn</span>
          </div>
          <div class="body">
            <div class="folder-section">
              <span class="folder-text" id="folder-path" title="${initialFolder}">${initialFolder}</span>
              <button class="btn-small" id="btn-change-folder">Đổi</button>
            </div>
            
            <div class="stats-grid">
              <div class="stat-card" style="grid-column: span 2;">
                <div class="stat-label">Trạng thái</div>
                <div class="stat-value" id="lbl-status" style="color: #0052cc;">Sẵn sàng</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Tiến trình</div>
                <div class="stat-value" id="lbl-progress">0 / 0</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Trang</div>
                <div class="stat-value" id="lbl-page">1</div>
              </div>
              <div class="stat-card">
                <div class="stat-label" style="color: #28c76f;">Thành công</div>
                <div class="stat-value" id="lbl-success" style="color: #28c76f;">0</div>
              </div>
              <div class="stat-card">
                <div class="stat-label" style="color: #ea5455;">Thất bại / Bỏ qua</div>
                <div class="stat-value" id="lbl-failure" style="color: #ea5455;">0</div>
              </div>
            </div>

            <div class="actions">
              <button class="btn-action btn-start" id="btn-start">Tải toàn bộ</button>
              <button class="btn-action btn-skip" id="btn-skip" disabled>Bỏ qua dòng</button>
              <button class="btn-action btn-stop" id="btn-stop" disabled>Dừng</button>
            </div>

            <div class="log-panel" id="log-container">
              <div class="log-item">[Hệ thống] Sẵn sàng tải hóa đơn.</div>
            </div>
          </div>
        </div>
      `;

      this.folderEl = this.shadow.getElementById('folder-path');
      this.statusEl = this.shadow.getElementById('lbl-status');
      this.progressEl = this.shadow.getElementById('lbl-progress');
      this.pageEl = this.shadow.getElementById('lbl-page');
      this.successEl = this.shadow.getElementById('lbl-success');
      this.failureEl = this.shadow.getElementById('lbl-failure');
      this.logContainer = this.shadow.getElementById('log-container');

      this.btnStart = this.shadow.getElementById('btn-start');
      this.btnSkip = this.shadow.getElementById('btn-skip');
      this.btnStop = this.shadow.getElementById('btn-stop');
      this.btnChangeFolder = this.shadow.getElementById('btn-change-folder');

      this.btnStart.addEventListener('click', () => this.onStart());
      this.btnSkip.addEventListener('click', () => this.onSkip());
      this.btnStop.addEventListener('click', () => this.onStop());
      this.btnChangeFolder.addEventListener('click', () => this.onChangeFolder());
    }

    updateFolder(folder) {
      this.folderEl.textContent = folder;
      this.folderEl.title = folder;
    }

    updateState(state) {
      this.statusEl.textContent = this.translateState(state);
      if (state === 'IDLE' || state === 'COMPLETED' || state === 'FAILED' || state === 'STOPPED') {
        this.btnStart.disabled = false;
        this.btnSkip.disabled = true;
        this.btnStop.disabled = true;
      } else {
        this.btnStart.disabled = true;
        this.btnSkip.disabled = false;
        this.btnStop.disabled = false;
      }
    }

    translateState(state) {
      switch (state) {
        case 'IDLE': return 'Sẵn sàng';
        case 'WAITING_FOR_TABLE': return 'Đợi bảng dữ liệu...';
        case 'READING_ROWS': return 'Đang đọc danh sách...';
        case 'SELECTING_ROW': return 'Chọn dòng...';
        case 'WAITING_FOR_DOWNLOAD_BUTTON': return 'Tìm nút tải...';
        case 'DOWNLOADING': return 'Đang tải xuống...';
        case 'MOVING_TO_NEXT_PAGE': return 'Chuyển trang...';
        case 'COMPLETED': return 'Hoàn tất';
        case 'FAILED': return 'Lỗi';
        case 'STOPPED': return 'Đã dừng';
        default: return state;
      }
    }

    updateStats(done, total, success, failure, page) {
      this.progressEl.textContent = `${done} / ${total}`;
      this.successEl.textContent = success;
      this.failureEl.textContent = failure;
      this.pageEl.textContent = page;
    }

    log(msg) {
      const el = document.createElement('div');
      el.className = 'log-item';
      el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
      this.logContainer.appendChild(el);
      this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }

    makeDraggable() {
      const header = this.shadow.querySelector('.header');
      let isDragging = false;
      let offsetX = 0, offsetY = 0;

      header.addEventListener('mousedown', (e) => {
        isDragging = true;
        offsetX = e.clientX - this.container.getBoundingClientRect().left;
        offsetY = e.clientY - this.container.getBoundingClientRect().top;
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        this.container.style.left = `${e.clientX - offsetX}px`;
        this.container.style.top = `${e.clientY - offsetY}px`;
        this.container.style.right = 'auto';
        this.container.style.bottom = 'auto';
      });

      document.addEventListener('mouseup', () => {
        isDragging = false;
      });
    }
  }

  class InvoiceRunner {
    constructor() {
      this.state = 'IDLE';
      this.abortController = null;
      this.skipController = null;
      this.currentPage = 1;
      this.successCount = 0;
      this.failureCount = 0;

      // Cấu hình selectors & timings đồng bộ với Chrome extension
      this.selectors = {
        resultTable: 'table',
        invoiceRows: 'tbody tr',
        nextPageButton: '.ant-pagination-next button, button.next-page'
      };

      this.behavior = {
        selectionDelayMs: 100,
        downloadTimeoutMs: 15000 // 15s timeout cho server chậm
      };

      // Đọc thư mục tải ban đầu
      window.electronAPI.getDownloadFolder().then(folder => {
        this.ui = new OverlayUI(
          this.start.bind(this),
          this.stop.bind(this),
          this.skipRow.bind(this),
          this.changeFolder.bind(this),
          folder
        );
      });
    }

    async changeFolder() {
      const folder = await window.electronAPI.changeDownloadFolder();
      if (folder) {
        this.ui.updateFolder(folder);
        this.ui.log(`Đã đổi thư mục lưu: ${folder}`);
      }
    }

    skipRow() {
      if (this.skipController) {
        this.skipController.abort('Người dùng bấm Bỏ qua');
        this.ui.log('Đã yêu cầu bỏ qua dòng hiện tại.');
      }
    }

    setState(newState) {
      this.state = newState;
      this.ui.updateState(newState);
    }

    async start() {
      if (this.state !== 'IDLE' && this.state !== 'COMPLETED' && this.state !== 'FAILED' && this.state !== 'STOPPED') return;

      this.abortController = new AbortController();
      const signal = this.abortController.signal;
      this.ui.log('Bắt đầu quy trình tải siêu tốc...');

      this.currentPage = 1;
      this.successCount = 0;
      this.failureCount = 0;

      try {
        this.setState('WAITING_FOR_TABLE');
        const table = document.querySelector(this.selectors.resultTable);
        if (!table) {
          throw new Error('Không tìm thấy bảng kết quả. Vui lòng bấm Tìm kiếm trên web trước.');
        }

        while (!signal.aborted) {
          await this.processCurrentPage(signal);
          if (signal.aborted) break;

          const hasNext = await this.goToNextPage(signal);
          if (!hasNext) {
            this.ui.log('Đã tải hết trang.');
            break;
          }
          this.currentPage++;
        }

        if (!signal.aborted) {
          this.setState('COMPLETED');
          this.ui.log('Hoàn tất tải toàn bộ hóa đơn!');
        }
      } catch (e) {
        if (e.name === 'AbortError') {
          this.setState('STOPPED');
          this.ui.log('Đã dừng bởi người dùng.');
        } else {
          this.setState('FAILED');
          this.ui.log(`Lỗi: ${e.message}`);
        }
      }
    }

    stop() {
      if (this.abortController) {
        this.abortController.abort();
      }
      if (this.skipController) {
        this.skipController.abort();
      }
      this.setState('STOPPED');
    }

    wait(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    isElementVisibleAndEnabled(el) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;

      if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') {
        return false;
      }
      if (el.classList.contains('disabled')) return false;

      return true;
    }

    async processCurrentPage(signal) {
      this.setState('READING_ROWS');
      const rows = Array.from(document.querySelectorAll(this.selectors.invoiceRows));
      const totalRows = rows.length;

      if (totalRows === 0) {
        this.ui.log(`Trang này không có hóa đơn nào.`);
        return;
      }

      this.ui.log(`Trang ${this.currentPage}: Phát hiện ${totalRows} dòng.`);

      for (let i = 0; i < totalRows; i++) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        this.ui.updateStats(i, totalRows, this.successCount, this.failureCount, this.currentPage);

        const currentRows = Array.from(document.querySelectorAll(this.selectors.invoiceRows));
        const currentRow = currentRows[i];
        if (!currentRow) {
          this.ui.log(`Cảnh báo: Dòng ${i} không tồn tại (DOM thay đổi)`);
          continue;
        }

        this.skipController = new AbortController();

        try {
          await this.downloadRow(currentRow, i, signal, this.skipController.signal);
          this.successCount++;
        } catch (e) {
          if (e.name === 'AbortError' && e.message !== 'Người dùng bấm Bỏ qua') {
            throw e;
          }
          this.failureCount++;
          this.ui.log(`Lỗi dòng ${i + 1}: ${e.message}`);
        } finally {
          this.skipController = null;
          this.ui.updateStats(i + 1, totalRows, this.successCount, this.failureCount, this.currentPage);
        }

        await this.wait(0); // delayBetweenDownloadsMs
      }
    }

    async downloadRow(row, index, signal, skipSignal) {
      this.setState('SELECTING_ROW');
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.click();

      // Chờ chọn dòng
      await new Promise((r, reject) => {
        const t = setTimeout(r, this.behavior.selectionDelayMs);
        signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); });
        skipSignal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Người dùng bấm Bỏ qua', 'AbortError')); });
      });

      this.setState('WAITING_FOR_DOWNLOAD_BUTTON');
      let dlBtn = null;

      // Tìm nút tải xuống siêu tốc qua icon g#icon_ketxuat hoặc đường dẫn path của SVG tải xuống
      const icons = Array.from(document.querySelectorAll('g#icon_ketxuat, svg path[d^="M10.54"]'));
      if (icons.length > 0) {
        dlBtn = icons[icons.length - 1].closest('button');
      }

      if (!dlBtn) {
        // Fallback tìm nút cuối cùng cạnh phân trang
        const fallbackBtns = Array.from(document.querySelectorAll('.ant-pagination-options ~ button:last-of-type'));
        if (fallbackBtns.length > 0) {
          dlBtn = fallbackBtns[fallbackBtns.length - 1];
        }
      }

      if (!dlBtn) {
        throw new Error('Không tìm thấy nút Tải xuống.');
      }

      const operationId = `${this.currentPage}-${index}-${Date.now()}`;

      // Kích hoạt tiến trình tải xuống và chờ IPC phản hồi từ Main Process
      this.setState('DOWNLOADING');

      // Đăng ký phiên tải với Backend trước khi click
      await window.electronAPI.armDownload({ operationId });
      dlBtn.click();

      return new Promise((resolve, reject) => {
        let cleanup = () => { };

        // Kiểm tra thông báo lỗi từ web (VD: .ant-message-error) để next ngay lập tức thay vì chờ 15s
        const errorCheckInterval = setInterval(() => {
          const errorMsg = document.querySelector('.ant-message-error, .ant-message-notice-error, .ant-notification-notice-error, .ant-message-custom-content.ant-message-error');
          if (errorMsg && errorMsg.innerText) {
            const errorText = errorMsg.innerText;
            // Cố gắng đóng thông báo để không ảnh hưởng dòng sau
            const closeBtn = document.querySelector('.ant-message-notice-close, .ant-notification-notice-close');
            if (closeBtn) closeBtn.click();
            else errorMsg.remove(); // Fallback xóa khỏi DOM

            cleanup();
            reject(new Error(`Hệ thống web báo lỗi: ${errorText}`));
          }
        }, 500);

        const timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error('Quá 15 giây chờ file tải về'));
        }, this.behavior.downloadTimeoutMs);

        // Đăng ký nhận sự kiện hoàn tất tải từ Electron Main Process
        const unsubscribe = window.electronAPI.onDownloadCompleted((result) => {
          if (result.operationId !== operationId) return; // Bỏ qua nếu không đúng dòng đang đợi
          cleanup();
          if (result.status === 'success') {
            resolve();
          } else {
            reject(new Error(`Tải lỗi: ${result.reason || 'không rõ'}`));
          }
        });

        cleanup = () => {
          clearTimeout(timeoutId);
          clearInterval(errorCheckInterval);
          unsubscribe();
        };

        // Bỏ qua hoặc dừng giữa chừng
        signal.addEventListener('abort', () => {
          cleanup();
          reject(new DOMException('Aborted', 'AbortError'));
        });

        skipSignal.addEventListener('abort', () => {
          cleanup();
          reject(new DOMException('Người dùng bấm Bỏ qua', 'AbortError'));
        });
      });
    }

    async goToNextPage(signal) {
      this.setState('MOVING_TO_NEXT_PAGE');
      const nextBtn = document.querySelector(this.selectors.nextPageButton);

      // Kiểm tra nút Next có hợp lệ không
      if (!nextBtn || !this.isElementVisibleAndEnabled(nextBtn)) {
        return false;
      }

      const oldFirstRowText = document.querySelector(this.selectors.invoiceRows)?.textContent || '';
      nextBtn.click();

      // Chờ tối thiểu 1s cho loading hoặc React xử lý
      await this.wait(1000);

      const startTime = Date.now();
      const pageChangeTimeoutMs = 15000;

      while (Date.now() - startTime < pageChangeTimeoutMs) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const newFirstRowText = document.querySelector(this.selectors.invoiceRows)?.textContent || '';
        if (newFirstRowText !== oldFirstRowText) {
          // Chờ thêm 1s cho ổn định
          await this.wait(1000);
          return true;
        }
        await this.wait(500);
      }

      return false;
    }
  }

  // Khởi chạy runner
  const runner = new InvoiceRunner();

  // Đảm bảo UI luôn hiển thị và không bị React xóa/ghi đè trong quá trình chuyển trang
  setInterval(() => {
    if (runner.ui && runner.ui.container && document.body && !document.getElementById('electron-batch-dl-root')) {
      document.body.appendChild(runner.ui.container);
    }
  }, 1000);
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initApp();
} else {
  window.addEventListener('DOMContentLoaded', initApp);
  window.addEventListener('load', initApp);
}

// Theo dõi thay đổi URL (SPA)
let lastUrl = location.href;

const checkUrlChange = () => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    if (url.includes('hoadondientu.gdt.gov.vn') && !isAppInitialized) {
      initApp();
    }
  }
};

const originalPushState = history.pushState;
history.pushState = function() {
  originalPushState.apply(this, arguments);
  checkUrlChange();
};

const originalReplaceState = history.replaceState;
history.replaceState = function() {
  originalReplaceState.apply(this, arguments);
  checkUrlChange();
};

window.addEventListener('popstate', checkUrlChange);
window.addEventListener('hashchange', checkUrlChange);


