const { contextBridge, ipcRenderer } = require('electron');

const api = {
  changeDownloadFolder: () => ipcRenderer.invoke('change-download-folder'),
  getDownloadFolder: () => ipcRenderer.invoke('get-download-folder'),
  armDownload: (payload) => ipcRenderer.invoke('arm-download', payload),
  getWidgetIcon: () => ipcRenderer.invoke('get-widget-icon'),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  onDownloadCompleted: (callback) => {
    const listener = (event, arg) => callback(arg);
    ipcRenderer.on('download-completed', listener);
    return () => {
      ipcRenderer.removeListener('download-completed', listener);
    };
  },
  // Auto-update APIs
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateStatus: (callback) => {
    const listener = (event, arg) => callback(arg);
    ipcRenderer.on('update-status', listener);
    return () => {
      ipcRenderer.removeListener('update-status', listener);
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
          .panel.minimized { display: none; }
          .widget-btn {
            display: none;
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background-color: #007aff;
            background-size: cover;
            background-position: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            cursor: pointer;
            transition: transform 0.2s;
            border: 2px solid white;
          }
          .widget-btn:hover {
            transform: scale(1.05);
          }
          .widget-btn.minimized {
            display: block;
          }
          .btn-minimize {
            background: transparent;
            border: none;
            color: white;
            font-weight: bold;
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
            padding: 0 5px;
          }
          .btn-minimize:hover {
            opacity: 0.8;
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
          .folder-title {
            font-size: 11px;
            font-weight: 600;
            color: #5a6a85;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
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
          /* Toast notification */
          .toast-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10;
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: none;
          }
          .toast {
            pointer-events: auto;
            display: flex;
            align-items: center;
            gap: 10px;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #e0e0e0;
            padding: 12px 16px;
            border-radius: 10px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.08);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 13px;
            min-width: 280px;
            max-width: 380px;
            animation: toastSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            backdrop-filter: blur(12px);
            border-left: 3px solid #28c76f;
          }
          .toast.toast-hiding {
            animation: toastSlideOut 0.35s cubic-bezier(0.55, 0, 1, 0.45) forwards;
          }
          .toast-icon {
            font-size: 20px;
            flex-shrink: 0;
          }
          .toast-body {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          .toast-msg {
            font-weight: 500;
            line-height: 1.3;
          }
          .toast-actions {
            display: flex;
            gap: 8px;
          }
          .toast-btn {
            padding: 5px 12px;
            border-radius: 6px;
            border: none;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .toast-btn-primary {
            background: linear-gradient(135deg, #28c76f 0%, #1fa85c 100%);
            color: white;
          }
          .toast-btn-primary:hover {
            background: linear-gradient(135deg, #34d87b 0%, #28c76f 100%);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(40, 199, 111, 0.35);
          }
          .toast-btn-dismiss {
            background: rgba(255,255,255,0.08);
            color: #a0a0a0;
          }
          .toast-btn-dismiss:hover {
            background: rgba(255,255,255,0.15);
            color: #e0e0e0;
          }
          @keyframes toastSlideIn {
            from {
              transform: translateX(120%);
              opacity: 0;
            }
            to {
              transform: translateX(0);
              opacity: 1;
            }
          }
          @keyframes toastSlideOut {
            from {
              transform: translateX(0);
              opacity: 1;
            }
            to {
              transform: translateX(120%);
              opacity: 0;
            }
          }

          /* Update notification banner */
          .update-banner {
            display: none;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            padding: 10px 12px;
            font-size: 12px;
            color: #e0e0e0;
            border-top: 1px solid rgba(255,255,255,0.06);
            animation: updateSlideDown 0.3s ease;
          }
          .update-banner.visible {
            display: block;
          }
          .update-banner-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 6px;
          }
          .update-banner-title {
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 600;
            color: #60a5fa;
          }
          .update-banner-title .update-icon {
            font-size: 14px;
          }
          .update-banner-close {
            background: transparent;
            border: none;
            color: #8899a6;
            cursor: pointer;
            font-size: 14px;
            padding: 2px 4px;
            border-radius: 4px;
          }
          .update-banner-close:hover {
            background: rgba(255,255,255,0.1);
            color: #e0e0e0;
          }
          .update-banner-msg {
            font-size: 11px;
            color: #a0b0c0;
            margin-bottom: 8px;
            line-height: 1.4;
          }
          .update-banner-actions {
            display: flex;
            gap: 6px;
          }
          .update-btn {
            flex: 1;
            padding: 7px 10px;
            border: none;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .update-btn-primary {
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            color: white;
          }
          .update-btn-primary:hover {
            background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.35);
          }
          .update-btn-secondary {
            background: rgba(255,255,255,0.08);
            color: #a0b0c0;
          }
          .update-btn-secondary:hover {
            background: rgba(255,255,255,0.15);
            color: #e0e0e0;
          }
          .update-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none !important;
            box-shadow: none !important;
          }
          .update-progress {
            margin-top: 8px;
          }
          .update-progress-bar-bg {
            width: 100%;
            height: 6px;
            background: rgba(255,255,255,0.1);
            border-radius: 3px;
            overflow: hidden;
          }
          .update-progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #3b82f6, #60a5fa);
            border-radius: 3px;
            transition: width 0.3s ease;
            width: 0%;
          }
          .update-progress-text {
            font-size: 10px;
            color: #8899a6;
            margin-top: 4px;
            text-align: center;
          }
          .version-badge {
            font-size: 10px;
            background: rgba(255,255,255,0.2);
            padding: 2px 6px;
            border-radius: 8px;
            font-weight: 500;
            margin-left: 6px;
          }
          .header-left {
            display: flex;
            align-items: center;
          }
          @keyframes updateSlideDown {
            from {
              opacity: 0;
              max-height: 0;
            }
            to {
              opacity: 1;
              max-height: 200px;
            }
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          .spinner {
            display: inline-block;
            width: 12px;
            height: 12px;
            border: 2px solid rgba(255,255,255,0.3);
            border-top-color: #60a5fa;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
          }
        </style>
        <div class="panel" id="main-panel">
          <div class="header">
            <div class="header-left">
              <span>Công Cụ Tải Hóa Đơn</span>
              <span class="version-badge" id="version-badge">v--</span>
            </div>
            <button class="btn-minimize" id="btn-minimize" title="Thu nhỏ">_</button>
          </div>
          <div id="update-banner" class="update-banner">
            <div class="update-banner-header">
              <div class="update-banner-title">
                <span class="update-icon">🔄</span>
                <span id="update-title">Có bản cập nhật mới!</span>
              </div>
              <button class="update-banner-close" id="update-dismiss" title="Đóng">✕</button>
            </div>
            <div class="update-banner-msg" id="update-msg">Phiên bản mới đã sẵn sàng.</div>
            <div class="update-banner-actions" id="update-actions">
              <button class="update-btn update-btn-primary" id="update-download-btn">⬇ Tải cập nhật</button>
              <button class="update-btn update-btn-secondary" id="update-later-btn">Để sau</button>
            </div>
            <div class="update-progress" id="update-progress" style="display:none">
              <div class="update-progress-bar-bg">
                <div class="update-progress-bar" id="update-progress-bar"></div>
              </div>
              <div class="update-progress-text" id="update-progress-text">0%</div>
            </div>
          </div>
          <div class="body">
            <div class="folder-title">Thư mục lưu hóa đơn</div>
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
        <div class="widget-btn" id="widget-btn" title="Mở công cụ tải hóa đơn"></div>
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

      // Update UI elements
      this.updateBanner = this.shadow.getElementById('update-banner');
      this.updateTitle = this.shadow.getElementById('update-title');
      this.updateMsg = this.shadow.getElementById('update-msg');
      this.updateActions = this.shadow.getElementById('update-actions');
      this.updateDownloadBtn = this.shadow.getElementById('update-download-btn');
      this.updateLaterBtn = this.shadow.getElementById('update-later-btn');
      this.updateProgress = this.shadow.getElementById('update-progress');
      this.updateProgressBar = this.shadow.getElementById('update-progress-bar');
      this.updateProgressText = this.shadow.getElementById('update-progress-text');
      this.versionBadge = this.shadow.getElementById('version-badge');

      this.btnStart.addEventListener('click', () => this.onStart());
      this.btnSkip.addEventListener('click', () => this.onSkip());
      this.btnStop.addEventListener('click', () => this.onStop());
      this.btnChangeFolder.addEventListener('click', () => this.onChangeFolder());

      this.shadow.getElementById('btn-minimize').addEventListener('click', () => {
        this.shadow.getElementById('main-panel').classList.add('minimized');
        this.shadow.getElementById('widget-btn').classList.add('minimized');
      });

      this.shadow.getElementById('widget-btn').addEventListener('click', () => {
        this.shadow.getElementById('main-panel').classList.remove('minimized');
        this.shadow.getElementById('widget-btn').classList.remove('minimized');
      });

      // Load icon asynchronously
      window.electronAPI.getWidgetIcon().then(base64 => {
        if (base64) {
          this.shadow.getElementById('widget-btn').style.backgroundImage = `url('${base64}')`;
        }
      });

      // Load version badge
      window.electronAPI.getAppVersion().then(version => {
        this.versionBadge.textContent = `v${version}`;
      });

      // Update button event listeners
      this.updateDownloadBtn.addEventListener('click', () => {
        this.updateDownloadBtn.disabled = true;
        this.updateDownloadBtn.innerHTML = '<span class="spinner"></span> Đang tải...';
        window.electronAPI.downloadUpdate();
      });

      this.updateLaterBtn.addEventListener('click', () => {
        this.updateBanner.classList.remove('visible');
      });

      this.shadow.getElementById('update-dismiss').addEventListener('click', () => {
        this.updateBanner.classList.remove('visible');
      });
    }

    handleUpdateStatus(data) {
      switch (data.status) {
        case 'checking':
          // Silently checking — no UI change
          break;

        case 'available':
          this.updateBanner.classList.add('visible');
          this.updateTitle.textContent = `Có bản cập nhật v${data.version}!`;
          this.updateMsg.textContent = data.releaseNotes
            ? `${data.releaseNotes}`
            : `Phiên bản ${data.version} đã sẵn sàng. Nhấn "Tải cập nhật" để nâng cấp.`;
          this.updateActions.style.display = 'flex';
          this.updateProgress.style.display = 'none';
          this.updateDownloadBtn.disabled = false;
          this.updateDownloadBtn.innerHTML = '⬇ Tải cập nhật';
          this.log(`🔄 Phát hiện bản cập nhật v${data.version}`);
          break;

        case 'not-available':
          // No update — do nothing (silent)
          break;

        case 'downloading':
          this.updateBanner.classList.add('visible');
          this.updateTitle.textContent = 'Đang tải cập nhật...';
          this.updateActions.style.display = 'none';
          this.updateProgress.style.display = 'block';
          const pct = Math.round(data.percent || 0);
          this.updateProgressBar.style.width = `${pct}%`;
          const mbTransferred = (data.transferred / 1024 / 1024).toFixed(1);
          const mbTotal = (data.total / 1024 / 1024).toFixed(1);
          const speed = (data.bytesPerSecond / 1024).toFixed(0);
          this.updateProgressText.textContent = `${pct}% — ${mbTransferred}/${mbTotal} MB (${speed} KB/s)`;
          this.updateMsg.textContent = 'Đang tải phiên bản mới. Vui lòng chờ...';
          break;

        case 'downloaded':
          this.updateBanner.classList.add('visible');
          this.updateTitle.textContent = '✅ Đã tải xong cập nhật!';
          this.updateMsg.textContent = `Phiên bản v${data.version} đã sẵn sàng cài đặt. Ứng dụng sẽ khởi động lại.`;
          this.updateProgress.style.display = 'none';
          this.updateActions.style.display = 'flex';
          this.updateDownloadBtn.disabled = false;
          this.updateDownloadBtn.innerHTML = '🚀 Cài đặt và khởi động lại';
          this.updateDownloadBtn.onclick = () => {
            window.electronAPI.installUpdate();
          };
          this.updateLaterBtn.textContent = 'Để sau';
          this.log(`✅ Tải cập nhật v${data.version} hoàn tất. Sẵn sàng cài đặt.`);
          break;

        case 'error':
          // Show error briefly then hide
          this.updateBanner.classList.add('visible');
          this.updateTitle.textContent = '⚠ Lỗi cập nhật';
          this.updateMsg.textContent = data.message || 'Không thể kiểm tra cập nhật.';
          this.updateActions.style.display = 'flex';
          this.updateDownloadBtn.style.display = 'none';
          this.updateLaterBtn.textContent = 'Đóng';
          this.updateProgress.style.display = 'none';
          setTimeout(() => {
            this.updateBanner.classList.remove('visible');
            this.updateDownloadBtn.style.display = '';
            this.updateLaterBtn.textContent = 'Để sau';
          }, 8000);
          break;
      }
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

    showToast(message, { actionLabel, onAction, autoDismissMs = 8000 } = {}) {
      // Ensure toast container exists
      let toastContainer = this.shadow.querySelector('.toast-container');
      if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        this.shadow.appendChild(toastContainer);
      }

      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.innerHTML = `
        <span class="toast-icon">✅</span>
        <div class="toast-body">
          <div class="toast-msg">${message}</div>
          <div class="toast-actions">
            ${actionLabel ? `<button class="toast-btn toast-btn-primary" id="toast-action">${actionLabel}</button>` : ''}
            <button class="toast-btn toast-btn-dismiss" id="toast-dismiss">Đóng</button>
          </div>
        </div>
      `;

      toastContainer.appendChild(toast);

      const dismiss = () => {
        toast.classList.add('toast-hiding');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
      };

      toast.querySelector('#toast-dismiss').addEventListener('click', dismiss);

      if (actionLabel && onAction) {
        toast.querySelector('#toast-action').addEventListener('click', () => {
          onAction();
          dismiss();
        });
      }

      if (autoDismissMs > 0) {
        setTimeout(dismiss, autoDismissMs);
      }
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
        downloadTimeoutMs: 5000 // 5s timeout — main process phát hiện "không có file" sau 2s
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

        // Listen for update events and forward to UI
        window.electronAPI.onUpdateStatus((data) => {
          if (this.ui) {
            this.ui.handleUpdateStatus(data);
          }
        });
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

          // Show toast to open the download folder
          const folder = await window.electronAPI.getDownloadFolder();
          this.ui.showToast(
            `Đã tải xong ${this.successCount} hóa đơn thành công!`,
            {
              actionLabel: '📂 Mở thư mục',
              onAction: () => window.electronAPI.openFolder(folder),
              autoDismissMs: 15000
            }
          );
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
          this.ui.log(`✓ Dòng ${i + 1}: Tải thành công.`);
        } catch (e) {
          if (e.name === 'AbortError' && e.message !== 'Người dùng bấm Bỏ qua') {
            throw e;
          }
          this.failureCount++;
          if (e.message === 'Người dùng bấm Bỏ qua') {
            this.ui.log(`⏭ Dòng ${i + 1}: Bỏ qua (người dùng).`);
          } else if (e.message.includes('không có file') || e.message.includes('Không có file') || e.message.includes('server không trả file')) {
            this.ui.log(`⏭ Dòng ${i + 1}: Bỏ qua — server không trả file.`);
          } else {
            this.ui.log(`✗ Dòng ${i + 1}: ${e.message}`);
          }
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
        let cleaned = false;
        let cleanup = () => { };

        // Kiểm tra thông báo lỗi từ web (VD: .ant-message-error) để skip ngay lập tức
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

        // Timeout dự phòng — main process sẽ gửi lỗi sau 2s nếu không có file,
        // timer này là safety net cuối cùng
        const timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error('Quá thời gian chờ file tải về — bỏ qua'));
        }, this.behavior.downloadTimeoutMs);

        // Đăng ký nhận sự kiện hoàn tất tải từ Electron Main Process
        // (bao gồm cả event "no file" do main process timeout gửi)
        const unsubscribe = window.electronAPI.onDownloadCompleted((result) => {
          if (result.operationId !== operationId) return; // Bỏ qua nếu không đúng dòng đang đợi
          cleanup();
          if (result.status === 'success') {
            resolve();
          } else {
            reject(new Error(result.reason || 'Tải lỗi không rõ nguyên nhân'));
          }
        });

        cleanup = () => {
          if (cleaned) return;
          cleaned = true;
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
history.pushState = function () {
  originalPushState.apply(this, arguments);
  checkUrlChange();
};

const originalReplaceState = history.replaceState;
history.replaceState = function () {
  originalReplaceState.apply(this, arguments);
  checkUrlChange();
};

window.addEventListener('popstate', checkUrlChange);
window.addEventListener('hashchange', checkUrlChange);


