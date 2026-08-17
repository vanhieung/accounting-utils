const { contextBridge, ipcRenderer } = require('electron');

const api = {
  changeDownloadFolder: () => ipcRenderer.invoke('change-download-folder'),
  getDownloadFolder: () => ipcRenderer.invoke('get-download-folder'),
  armDownload: (payload) => ipcRenderer.invoke('arm-download', payload),
  getWidgetIcon: () => ipcRenderer.invoke('get-widget-icon'),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  onDownloadCompleted: (callback) => {
    const listener = (event, arg) => callback(arg);
    ipcRenderer.on('download-completed', listener);
    return () => {
      ipcRenderer.removeListener('download-completed', listener);
    };
  },
  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  saveAccount: (account) => ipcRenderer.invoke('save-account', account),
  deleteAccount: (id) => ipcRenderer.invoke('delete-account', id),
  importExcelAccounts: () => ipcRenderer.invoke('import-excel-accounts'),
  setActiveMst: (mst) => ipcRenderer.invoke('set-active-mst', mst),
  setFolderOrganization: (enabled) => ipcRenderer.invoke('set-organize-folders', enabled),
  getFolderOrganization: () => ipcRenderer.invoke('get-organize-folders'),
  deleteXmlBatch: (items) => ipcRenderer.invoke('delete-xml-batch', items),
  exportAccountsExcel: () => ipcRenderer.invoke('export-accounts-excel'),
  getTemplates: () => ipcRenderer.invoke('get-templates'),
  exportExcelBatch: (items) => ipcRenderer.invoke('export-excel-batch', items),
  onExportProgress: (callback) => {
    const listener = (event, arg) => callback(arg);
    ipcRenderer.on('export-excel-progress', listener);
    return () => {
      ipcRenderer.removeListener('export-excel-progress', listener);
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

// Expose API cho web page (main world) qua contextBridge
contextBridge.exposeInMainWorld('electronAPI', api);
// Cũng gán lên window của preload (isolated world) để code OverlayUI/InvoiceRunner trong file này truy cập được
window.electronAPI = api;

function formatCurrency(val) {
  if (val === null || val === undefined || isNaN(val)) return '0 đ';
  return new Intl.NumberFormat('vi-VN').format(Math.round(val)) + ' đ';
}

let isAppInitialized = false;
function initApp() {
  if (isAppInitialized) return;
  if (!window.location.href.includes('hoadondientu.gdt.gov.vn')) return;
  isAppInitialized = true;

  class OverlayUI {
    constructor(onStart, onPause, onStop, onSkip, onRetryFailed, onChangeFolder, initialFolder) {
      this.onStart = onStart;
      this.onPause = onPause;
      this.onStop = onStop;
      this.onSkip = onSkip;
      this.onRetryFailed = onRetryFailed;
      this.onChangeFolder = onChangeFolder;

      this.totalPretax = 0;
      this.totalTax = 0;
      this.totalSum = 0;
      this.runnerState = 'IDLE';

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
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
      </style>
        <style>
          .panel {
    width: 440px;
    background: rgba(255, 255, 255, 0.75);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.6);
    border-radius: 16px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255,255,255,0.5);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1e293b;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s ease;
    resize: both;
    min-width: 340px;
    min-height: 580px;
    height: 680px;
    max-height: 95vh;
  }
          .panel.minimized { display: none; }
          .widget-btn {
            position: relative;
            display: none;
            width: 62px;
            height: 62px;
            border-radius: 50%;
            background-color: #007aff;
            background-size: cover;
            background-position: center;
            box-shadow: 0 6px 20px rgba(0,0,0,0.3);
            cursor: pointer;
            transition: transform 0.2s;
            border: 2px solid white;
          }
          .widget-btn:hover {
            transform: scale(1.08);
          }
          .widget-btn.minimized {
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .widget-badge {
            position: absolute;
            top: -4px;
            right: -4px;
            background: #ea5455;
            color: white;
            font-size: 11px;
            font-weight: bold;
            padding: 2px 7px;
            border-radius: 10px;
            border: 2px solid white;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          }
          .btn-minimize {
            background: transparent;
            border: none;
            color: #0f172a;
            font-weight: bold;
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
            padding: 0;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
          }
          .btn-minimize:hover {
            background: rgba(0,0,0,0.1);
          }
          .header {
    background: rgba(255, 255, 255, 0.4);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid rgba(226, 232, 240, 0.6);
    color: #0f172a;
    padding: 16px 20px;
    font-weight: 600;
    font-size: 15px;
    cursor: move;
    display: flex;
    justify-content: space-between;
    align-items: center;
    user-select: none;
  }
          .body {
            padding: 14px;
            display: flex;
            flex-direction: column;
            flex: 1;
            overflow: hidden;
          }
          .folder-section {
            margin-bottom: 10px;
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
            max-width: 290px;
            font-size: 12px;
          }
          .account-section {
            margin-bottom: 10px;
            font-size: 12px;
            background: #eef2fe;
            padding: 8px 10px;
            border-radius: 6px;
            display: flex;
            gap: 5px;
            align-items: center;
          }
          .financial-card {
            background: #f0f7ff;
            border: 1px solid #cce3ff;
            border-radius: 8px;
            padding: 8px 10px;
            margin-bottom: 10px;
            font-size: 11px;
          }
          .financial-title {
            font-weight: 600;
            color: #0052cc;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .financial-grid {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 6px;
            text-align: center;
          }
          .financial-val {
            font-weight: bold;
            font-size: 12px;
            color: #2c3e50;
          }
          .financial-lbl {
            color: #5a6a85;
            font-size: 10px;
          }
          .status-badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
          }
          .status-badge.idle { background: #e4e7ed; color: #5a6a85; }
          .status-badge.downloading, .status-badge.reading_rows { background: #e6f4ea; color: #137333; }
          .status-badge.paused { background: #fef7e0; color: #b06000; }
          .status-badge.failed, .status-badge.stopped { background: #fce8e6; color: #c5221f; }
          .status-badge.completed { background: #e6f4ea; color: #137333; }
          .progress-bar-bg {
            width: 100%;
            height: 8px;
            background: #e4e7ed;
            border-radius: 4px;
            overflow: hidden;
            margin-top: 6px;
          }
          .progress-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #3b82f6, #60a5fa);
    border-radius: 4px;
    width: 0%;
    transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
  }
  .progress-bar-fill::after {
    content: '';
    position: absolute;
    top: 0; left: 0; bottom: 0; width: 50%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
    animation: shimmer 1.5s infinite;
  }
  @keyframes shimmer {
    0% { transform: translateX(-200%); }
    100% { transform: translateX(200%); }
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes scaleUp { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  @keyframes spin { 100% { transform: rotate(360deg); } }
          .modal {
            position: absolute; top:0; left:0; width:100%; height:100%;
            background: rgba(0,0,0,0.5); z-index: 10;
            display: none; flex-direction: column; justify-content: center; align-items: center;
            animation: fadeIn 0.2s ease-out forwards;
          }
          .modal-content {
            background: white; padding: 15px; border-radius: 10px; width: 88%;
            box-shadow: 0 8px 30px rgba(0,0,0,0.25); display: flex; flex-direction: column; gap: 8px;
            animation: scaleUp 0.3s ease-out forwards;
          }
          #review-modal .modal-content {
            resize: both;
            overflow: hidden;
            width: 95%;
            max-width: 1100px;
            height: 85vh;
            min-height: 420px;
            max-height: 95vh;
          }
          .modal-content input {
            padding: 6px; font-size: 12px; border: 1px solid #dcdfe6; border-radius: 4px;
          }
          .acc-list {
            list-style: none; padding: 0; margin: 0; max-height: 120px; overflow-y: auto; font-size: 11px;
          }
          .acc-item {
            display: flex; justify-content: space-between; padding: 6px; border-bottom: 1px solid #eee; align-items: center;
          }
          .btn-small {
            font-size: 12px;
            background: #0052cc;
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.2s, transform 0.1s;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
          }
          .btn-small:hover {
            background: #0040a3;
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
          }
          .btn-small:active {
            transform: scale(0.98);
          }
          .confidence-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
          }
          .confidence-badge.high { background: #e6f4ea; color: #137333; border: 1px solid #ceead6; }
          .confidence-badge.med { background: #fef7e0; color: #b06000; border: 1px solid #fef0b5; }
          .confidence-badge.low { background: #fce8e6; color: #c5221f; border: 1px solid #fad2cf; }

          .filter-tabs {
            display: flex;
            gap: 6px;
            margin-bottom: 8px;
            border-bottom: 1px solid #e4e7ed;
            padding-bottom: 6px;
          }
          .filter-tab {
            padding: 4px 12px;
            font-size: 11px;
            border-radius: 14px;
            background: #eef2fe;
            color: #5a6a85;
            cursor: pointer;
            border: 1px solid transparent;
            transition: all 0.2s ease;
          }
          .filter-tab:hover { background: #dce6ff; }
          .filter-tab.active {
            background: #0052cc;
            color: white;
            font-weight: bold;
          }

          .bulk-toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            background: #f4f6fc;
            border: 1px solid #e4e7ed;
            border-radius: 6px;
            margin-bottom: 8px;
            font-size: 12px;
          }

          .review-table-container {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            margin: 6px 0;
            border: 1px solid #dcdfe6;
            border-radius: 6px;
          }
          .review-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
          }
          .review-table th, .review-table td {
            border: 1px solid #dcdfe6;
            padding: 6px;
            text-align: left;
            vertical-align: middle;
          }
          .review-table th {
            background: #f4f6fc;
            position: sticky;
            top: 0;
            z-index: 1;
            font-weight: 600;
          }
          .custom-select {
            position: relative;
            flex: 1;
            min-width: 150px;
            font-size: 13px;
          }
          .custom-select-trigger {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background-color: #fff;
            border: 1px solid #dcdfe6;
            border-radius: 6px;
            padding: 6px 10px;
            color: #2c3e50;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .custom-select-trigger:hover { border-color: #0052cc; }
          .custom-select.open .custom-select-trigger {
            border-color: #007aff;
            box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.15);
          }
          .custom-options {
            position: absolute; top: calc(100% + 4px); left: 0; right: 0;
            background: #fff; border: 1px solid #dcdfe6; border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-height: 200px;
            overflow-y: auto; z-index: 100; display: none;
          }
          .custom-select.open .custom-options { display: block; }
          .custom-option {
            padding: 8px 10px; cursor: pointer; transition: background 0.1s;
          }
          .custom-option:hover { background: #f4f6fc; }
          .custom-option.selected { background: #eef2fe; color: #0052cc; font-weight: 600; }
          .review-table select {
            width: 100%;
            min-width: 240px;
            font-size: 13px !important;
            font-weight: 600 !important;
            color: #0052cc !important;
            background-color: #f4f8ff !important;
            border: 1.5px solid #0052cc !important;
            border-radius: 6px !important;
            padding: 6px 30px 6px 10px !important;
            -webkit-appearance: none !important;
            appearance: none !important;
            cursor: pointer !important;
            box-shadow: 0 2px 4px rgba(0, 82, 204, 0.08) !important;
            background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%230052cc' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e") !important;
            background-repeat: no-repeat !important;
            background-position: right 8px center !important;
            background-size: 14px !important;
          }
          .review-table select:hover, .review-table select:focus {
            border-color: #007aff !important;
            background-color: #ffffff !important;
            box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.2) !important;
            outline: none !important;
          }
          .stats-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
            margin-bottom: 10px;
            font-size: 12px;
          }
          .stat-card {
            background: white;
            padding: 8px 10px;
            border-radius: 6px;
            border: 1px solid #e4e7ed;
          }
          .stat-label {
            color: #909399;
            font-size: 11px;
            text-transform: uppercase;
            margin-bottom: 2px;
          }
          .stat-value {
            font-weight: bold;
            font-size: 14px;
          }
          .actions {
            display: flex;
            gap: 6px;
            margin-bottom: 10px;
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
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
          }
          .btn-start { background: #28c76f; color: white; }
          .btn-start:hover:not(:disabled) { background: #20a65b; }
          .btn-pause { background: #007aff; color: white; }
          .btn-pause:hover:not(:disabled) { background: #0056b3; }
          .btn-skip { background: #ff9f43; color: white; }
          .btn-skip:hover:not(:disabled) { background: #e0852b; }
          .btn-stop { background: #ea5455; color: white; }
          .btn-stop:hover:not(:disabled) { background: #d63b3b; }
          button:disabled { background: #c0c4cc; cursor: not-allowed; opacity: 0.6; }
          .log-panel {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            background: #1a1a2e;
            color: #e0e0e0;
            font-family: inherit;
            font-size: 11px;
            padding: 10px;
            border-radius: 6px;
            box-shadow: inset 0 2px 6px rgba(0,0,0,0.3);
          }
          .log-item {
            margin-bottom: 4px;
            line-height: 1.4;
          }
          .log-item.success { color: #39ff14; }
          .log-item.error { color: #ff4d4f; }
          .log-item.warning { color: #ffc107; }

          /* Toast notification */
          .toast-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 1000;
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: none;
          }
          .toast {
            pointer-events: auto;
            display: flex;
            align-items: flex-start;
            gap: 10px;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #e0e0e0;
            padding: 12px 16px;
            border-radius: 10px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.08);
            font-size: 13px;
            min-width: 300px;
            max-width: 420px;
            animation: toastSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            backdrop-filter: blur(12px);
            border-left: 4px solid #28c76f;
          }
          .toast.toast-hiding {
            animation: toastSlideOut 0.35s cubic-bezier(0.55, 0, 1, 0.45) forwards;
          }
          .toast-icon { font-size: 20px; flex-shrink: 0; }
          .toast-body { flex: 1; display: flex; flex-direction: column; gap: 8px; }
          .toast-msg { font-weight: 500; line-height: 1.4; }
          .toast-actions { display: flex; gap: 6px; flex-wrap: wrap; }
          .toast-btn {
            padding: 5px 12px;
            border-radius: 6px;
            border: none;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .toast-btn-primary {
            background: linear-gradient(135deg, #28c76f 0%, #1fa85c 100%);
            color: white;
          }
          .toast-btn-primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(40, 199, 111, 0.35);
          }
          .toast-btn-dismiss {
            background: rgba(255,255,255,0.12);
            color: #d0d0d0;
          }
          .toast-btn-dismiss:hover {
            background: rgba(255,255,255,0.22);
            color: #ffffff;
          }
          @keyframes toastSlideIn { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
          @keyframes toastSlideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(120%); opacity: 0; } }

          /* Update banner */
          .update-banner {
            display: none;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            padding: 10px 12px;
            font-size: 12px;
            color: #e0e0e0;
            border-top: 1px solid rgba(255,255,255,0.06);
          }
          .update-banner.visible { display: block; }
          .version-badge {
            font-size: 10px;
            background: rgba(255,255,255,0.2);
            padding: 2px 6px;
            border-radius: 8px;
            font-weight: 500;
            margin-left: 6px;
          }
          .organize-section {
            margin-bottom: 10px;
            font-size: 11px;
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 10px;
            background: #f0f7ff;
            border-radius: 6px;
            border: 1px dashed #b0c4de;
          }
          .organize-section input[type="checkbox"] {
            accent-color: #0052cc;
            cursor: pointer;
            width: 14px;
            height: 14px;
          }
          .detail-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            margin-top: 10px;
          }
          .detail-table th, .detail-table td {
            border: 1px solid #dcdfe6;
            padding: 6px 8px;
            text-align: left;
          }
          .detail-table th {
            background: #f4f6fc;
            font-weight: 600;
          }
        </style>
        <div class="panel" id="main-panel">
          <div class="header">
            <div style="display: flex; align-items: center;">
              <span>Công Cụ Tải Hóa Đơn</span>
              <span class="version-badge" id="version-badge">v--</span>
            </div>
            <button class="btn-minimize" id="btn-minimize" title="Thu nhỏ">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>

          <div id="update-banner" class="update-banner">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <div style="font-weight: 600; color: #60a5fa;">🔄 Có bản cập nhật mới!</div>
              <button style="background: transparent; border: none; color: #8899a6; cursor: pointer;" id="update-dismiss">✕</button>
            </div>
            <div style="font-size: 11px; color: #a0b0c0; margin-bottom: 8px;" id="update-msg">Phiên bản mới đã sẵn sàng.</div>
            <div style="display: flex; gap: 6px;" id="update-actions">
              <button class="btn-small" id="update-download-btn" style="flex:1;">⬇ Tải cập nhật</button>
              <button class="btn-small" id="update-later-btn" style="background: rgba(255,255,255,0.15);">Để sau</button>
            </div>
            <div id="update-progress" style="display:none; margin-top: 8px;">
              <div class="progress-bar-bg"><div class="progress-bar-fill" id="update-progress-bar"></div></div>
              <div style="font-size: 10px; color: #8899a6; text-align: center; margin-top: 4px;" id="update-progress-text">0%</div>
            </div>
          </div>

          <div class="body">
            <div class="folder-title">Tài khoản & Thư mục</div>
            <div class="account-section">
              <div class="custom-select" id="account-select-wrapper">
                <div class="custom-select-trigger" id="account-select-trigger">
                  <span id="account-select-label" style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">-- Chọn tài khoản --</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5a6a85" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
                <div class="custom-options" id="account-select-options"></div>
              </div>
              <input type="hidden" id="account-select" value="">
              <button class="btn-small" id="btn-fill-account" title="Điền form">Điền form</button>
              <button class="btn-small" id="btn-manage-accounts" title="Quản lý">Quản lý</button>
            </div>

            <div class="folder-section">
              <span class="folder-text" id="folder-path" title="${initialFolder}">${initialFolder}</span>
              <button class="btn-small" id="btn-change-folder">Đổi</button>
            </div>

            <div class="organize-section">
              <input type="checkbox" id="chk-organize-mst" />
              <label for="chk-organize-mst" style="cursor: pointer; color: #2c3e50; font-weight: 500;">📁 Tạo thư mục riêng theo MST</label>
            </div>

            <div class="organize-section" style="background: #fffcf0; border-color: #ffd89b;">
              <span style="font-weight: 600; font-size: 11px;">Loại Hóa Đơn:</span>
              <input type="radio" id="rad-invoice-buying" name="rad-invoice-type" value="buying" checked style="cursor: pointer; accent-color: #ff9f43;" />
              <label for="rad-invoice-buying" style="cursor: pointer; font-weight: 500;">Mua vào</label>
              <input type="radio" id="rad-invoice-selling" name="rad-invoice-type" value="selling" style="cursor: pointer; accent-color: #ff9f43; margin-left: 8px;" />
              <label for="rad-invoice-selling" style="cursor: pointer; font-weight: 500;">Bán ra</label>
            </div>

            <!-- Financial Summary Card -->
            <div class="financial-card">
              <div class="financial-title">💰 Giá trị hóa đơn đã tải</div>
              <div class="financial-grid">
                <div>
                  <div class="financial-lbl">Chưa thuế</div>
                  <div class="financial-val" id="lbl-total-pretax">0 đ</div>
                </div>
                <div>
                  <div class="financial-lbl">Thuế GTGT</div>
                  <div class="financial-val" id="lbl-total-tax" style="color: #0052cc;">0 đ</div>
                </div>
                <div>
                  <div class="financial-lbl">Thanh toán</div>
                  <div class="financial-val" id="lbl-total-sum" style="color: #28c76f;">0 đ</div>
                </div>
              </div>
            </div>

            <!-- Main Stats Grid -->
            <div class="stats-grid">
              <div class="stat-card" style="grid-column: span 2;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <div class="stat-label">Trạng thái</div>
                  <div class="status-badge idle" id="lbl-status-badge">Sẵn sàng</div>
                </div>
                <div class="progress-bar-bg" style="position: relative;">
                  <div class="progress-bar-fill" id="progress-bar-fill"></div>
                  <div id="progress-text-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; mix-blend-mode: difference; color: white;">0%</div>
                </div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Tiến trình</div>
                <div class="stat-value" id="lbl-progress">0 / 0 (0%)</div>
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

            <!-- Retry Bar (Hidden by default) -->
            <div id="retry-bar" style="display: none; margin-bottom: 8px;">
              <button class="btn-action" id="btn-retry-failed" style="background: #ff9f43; color: white; width: 100%; padding: 8px; font-size: 12px; font-weight: bold; border: none; border-radius: 6px; cursor: pointer;">
                🔄 Tải lại <span id="lbl-failed-count">0</span> dòng bị lỗi
              </button>
            </div>

            <!-- Action Controls -->
            <div class="actions">
              <button class="btn-action btn-start" id="btn-start" title="Tải về"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Tải về</button>
              <button class="btn-action btn-pause" id="btn-pause" disabled title="Tạm dừng/Tiếp tục"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Tạm dừng</button>
              <button class="btn-action btn-skip" id="btn-skip" disabled title="Bỏ qua dòng"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg> Bỏ qua</button>
              <button class="btn-action btn-stop" id="btn-stop" disabled title="Dừng quy trình"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg> Dừng</button>
            </div>

            <div class="log-panel" id="log-container">
              <div class="log-item">[Hệ thống] Sẵn sàng tải hóa đơn.</div>
            </div>
          </div>
        </div>

        <!-- Floating Minimized Widget Button with Badge -->
        <div class="widget-btn" id="widget-btn" title="Mở công cụ tải hóa đơn">
          <div class="widget-badge" id="widget-badge" style="display: none;">0</div>
        </div>

        <!-- Account Modal -->
        <div id="account-modal" class="modal">
          <div class="modal-content">
            <div style="font-weight: bold; margin-bottom: 5px;">Quản lý tài khoản</div>
            <input type="text" id="acc-mst" placeholder="Mã số thuế" />
            <input type="password" id="acc-pwd" placeholder="Mật khẩu" />
            <input type="text" id="acc-name" placeholder="Tên công ty (tùy chọn)" />
            <div style="display: flex; gap: 5px;">
              <button class="btn-small" id="btn-save-acc" style="flex: 1; background: #28c76f;">Lưu / Thêm</button>
              <button class="btn-small" id="btn-close-acc" style="flex: 1; background: #6c757d;">Đóng</button>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
              <div style="font-weight: bold; font-size: 11px;">Danh sách đã lưu:</div>
              <button class="btn-small" id="btn-import-excel" style="background: #0052cc;">Nhập Excel</button>
              <button class="btn-small" id="btn-export-excel" style="background: #28c76f;">Xuất Excel</button>
            </div>
            <ul id="acc-list" class="acc-list"></ul>
          </div>
        </div>

        <!-- Review Modal with Confidence Badges, Bulk Edit, Quick Filters -->
        <div id="review-modal" class="modal">
          <div class="modal-content">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <div>
                <div style="font-weight: bold; font-size: 15px; color: #0052cc;">Xác nhận Mẫu Excel & Độ Tin Cậy Gợi Ý</div>
                <div style="font-size: 11px; color: #5a6a85;">Kiểm tra độ tin cậy gợi ý và chọn mẫu phù hợp trước khi xuất MISA.</div>
              </div>
              <span class="version-badge" id="review-count-badge" style="background: #0052cc; color: white; font-size: 11px; padding: 4px 10px;">0 hóa đơn</span>
            </div>

            <!-- Filter Tabs -->
            <div class="filter-tabs" id="review-filter-tabs">
              <div class="filter-tab active" data-filter="all">Tất cả (<span id="cnt-all">0</span>)</div>
              <div class="filter-tab" data-filter="goods">📦 Hàng hóa (<span id="cnt-goods">0</span>)</div>
              <div class="filter-tab" data-filter="services">🛠 Dịch vụ (<span id="cnt-services">0</span>)</div>
              <div class="filter-tab" data-filter="review">⚠️ Cần xem xét (<span id="cnt-review">0</span>)</div>
            </div>

            <!-- Bulk Edit Toolbar -->
            <div class="bulk-toolbar">
              <input type="checkbox" id="chk-review-select-all" style="accent-color: #0052cc; cursor: pointer; width: 15px; height: 15px;" />
              <span style="font-weight: 500;">Chọn tất cả</span>
              <div style="flex: 1;"></div>
              <span style="color: #5a6a85;">Đổi hàng loạt:</span>
              <select id="bulk-template-select" style="font-size: 13px; font-weight: 600; color: #0052cc; background-color: #ffffff; border: 1.5px solid #0052cc; border-radius: 6px; padding: 6px 10px; min-width: 250px; max-width: 350px; cursor: pointer;"></select>
              <button class="btn-small" id="btn-apply-bulk" style="background: #0052cc; padding: 6px 12px; font-weight: bold;">Áp dụng</button>
            </div>

            <div class="review-table-container">
              <table class="review-table" id="review-table">
                <thead>
                  <tr>
                    <th style="width: 35px; text-align: center;">✓</th>
                    <th style="width: 40px;">STT</th>
                    <th style="width: 95px;">Số HĐ</th>
                    <th style="min-width: 160px;">Đối tác</th>
                    <th style="width: 120px;">Độ tin cậy</th>
                    <th style="min-width: 280px; width: 38%;">Mẫu Excel MISA đã chọn</th>
                    <th style="width: 55px; text-align: center;">Xem</th>
                  </tr>
                </thead>
                <tbody id="review-tbody"></tbody>
              </table>
            </div>

            <div style="display: flex; gap: 8px; justify-content: space-between; align-items: center; margin-top: 6px;">
              <div style="font-size: 12px; color: #5a6a85;" id="review-summary-info">Tổng tiền chưa thuế: <b>0 đ</b> | Thuế GTGT: <b>0 đ</b></div>
              <div style="display: flex; gap: 8px;">
                <button class="btn-small" id="btn-cancel-review" style="background: #6c757d; padding: 6px 15px;">Đóng</button>
                <button class="btn-small" id="btn-export-review" style="background: #28c76f; padding: 6px 18px; font-weight: bold;">Xuất Tất Cả Excel</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Detail Modal for Quick View -->
        <div id="detail-modal" class="modal">
          <div class="modal-content" style="width: 90%; max-width: 780px; height: 80vh; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e4e7ed; padding-bottom: 8px;">
              <div>
                <div style="font-weight: bold; font-size: 16px; color: #0052cc;" id="detail-modal-title">Chi Tiết Hóa Đơn</div>
                <div style="font-size: 12px; color: #5a6a85;" id="detail-modal-subtitle"></div>
              </div>
              <button class="btn-small" id="btn-close-detail" style="background: #6c757d;">✕ Đóng</button>
            </div>
            <div id="detail-modal-body" style="flex: 1; overflow-y: auto; padding-top: 10px;"></div>
          </div>
        </div>
      `;

      this.folderEl = this.shadow.getElementById('folder-path');
      this.statusBadge = this.shadow.getElementById('lbl-status-badge');
      this.progressEl = this.shadow.getElementById('lbl-progress');
      this.progressBarFill = this.shadow.getElementById('progress-bar-fill');
      this.pageEl = this.shadow.getElementById('lbl-page');
      this.successEl = this.shadow.getElementById('lbl-success');
      this.failureEl = this.shadow.getElementById('lbl-failure');
      this.logContainer = this.shadow.getElementById('log-container');
      this.widgetBadge = this.shadow.getElementById('widget-badge');

      this.lblTotalPretax = this.shadow.getElementById('lbl-total-pretax');
      this.lblTotalTax = this.shadow.getElementById('lbl-total-tax');
      this.lblTotalSum = this.shadow.getElementById('lbl-total-sum');

      this.btnStart = this.shadow.getElementById('btn-start');
      this.btnPause = this.shadow.getElementById('btn-pause');
      this.btnSkip = this.shadow.getElementById('btn-skip');
      this.btnStop = this.shadow.getElementById('btn-stop');
      this.btnChangeFolder = this.shadow.getElementById('btn-change-folder');
      this.btnRetryFailed = this.shadow.getElementById('btn-retry-failed');
      this.retryBar = this.shadow.getElementById('retry-bar');
      this.lblFailedCount = this.shadow.getElementById('lbl-failed-count');

      // Update UI elements
      this.updateBanner = this.shadow.getElementById('update-banner');
      this.updateMsg = this.shadow.getElementById('update-msg');
      this.updateActions = this.shadow.getElementById('update-actions');
      this.updateDownloadBtn = this.shadow.getElementById('update-download-btn');
      this.updateLaterBtn = this.shadow.getElementById('update-later-btn');
      this.updateProgress = this.shadow.getElementById('update-progress');
      this.updateProgressBar = this.shadow.getElementById('update-progress-bar');
      this.updateProgressText = this.shadow.getElementById('update-progress-text');
      this.versionBadge = this.shadow.getElementById('version-badge');

      this.btnStart.addEventListener('click', () => this.onStart());
      this.btnPause.addEventListener('click', () => this.onPause());
      this.btnSkip.addEventListener('click', () => this.onSkip());
      this.btnStop.addEventListener('click', () => this.onStop());
      this.btnChangeFolder.addEventListener('click', () => this.onChangeFolder());
      this.btnRetryFailed.addEventListener('click', () => this.onRetryFailed());

      this.shadow.getElementById('btn-minimize').addEventListener('click', () => {
        this.shadow.getElementById('main-panel').classList.add('minimized');
        this.shadow.getElementById('widget-btn').classList.add('minimized');
      });

      this.shadow.getElementById('widget-btn').addEventListener('click', (e) => {
        if (this.dragMoved) return;
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

      // Update button listeners
      this.updateDownloadBtn.addEventListener('click', () => {
        this.updateDownloadBtn.disabled = true;
        this.updateDownloadBtn.textContent = 'Đang tải...';
        window.electronAPI.downloadUpdate();
      });

      this.updateLaterBtn.addEventListener('click', () => {
        this.updateBanner.classList.remove('visible');
      });

      this.shadow.getElementById('update-dismiss').addEventListener('click', () => {
        this.updateBanner.classList.remove('visible');
      });

      // Account selector
      this.accountSelect = this.shadow.getElementById('account-select');
      const wrapper = this.shadow.getElementById('account-select-wrapper');
      const trigger = this.shadow.getElementById('account-select-trigger');
      const label = this.shadow.getElementById('account-select-label');
      const optionsContainer = this.shadow.getElementById('account-select-options');

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        wrapper.classList.toggle('open');
      });

      optionsContainer.addEventListener('click', (e) => {
        const option = e.target.closest('.custom-option');
        if (option) {
          const value = option.dataset.value;
          const text = option.textContent;
          this.accountSelect.value = value;
          label.textContent = text;
          wrapper.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
          option.classList.add('selected');
          wrapper.classList.remove('open');
        }
      });

      document.addEventListener('click', (e) => {
        if (!e.composedPath().includes(wrapper)) {
          wrapper.classList.remove('open');
        }
      });

      this.btnFillAccount = this.shadow.getElementById('btn-fill-account');
      this.btnManageAccounts = this.shadow.getElementById('btn-manage-accounts');
      this.accountModal = this.shadow.getElementById('account-modal');
      this.btnCloseAcc = this.shadow.getElementById('btn-close-acc');
      this.btnSaveAcc = this.shadow.getElementById('btn-save-acc');
      this.btnImportExcel = this.shadow.getElementById('btn-import-excel');
      this.accList = this.shadow.getElementById('acc-list');

      this.accounts = [];

      this.btnManageAccounts.addEventListener('click', () => {
        this.accountModal.style.display = 'flex';
        this.renderAccountList();
      });

      this.btnCloseAcc.addEventListener('click', () => {
        this.accountModal.style.display = 'none';
      });

      this.btnImportExcel.addEventListener('click', async () => {
        this.btnImportExcel.textContent = '...';
        this.btnImportExcel.disabled = true;
        try {
          const res = await window.electronAPI.importExcelAccounts();
          if (res.success) {
            this.showToast(`Nhập thành công ${res.count} tài khoản!`);
            this.loadAccounts();
          } else if (res.reason !== 'canceled') {
            this.showToast(`Lỗi: ${res.reason}`, { type: 'error' });
          }
        } catch (e) {
          this.showToast(`Lỗi: ${e.message}`, { type: 'error' });
        } finally {
          this.btnImportExcel.textContent = 'Nhập Excel';
          this.btnImportExcel.disabled = false;
        }
      });

      this.btnExportExcel = this.shadow.getElementById('btn-export-excel');
      this.btnExportExcel.addEventListener('click', async () => {
        this.btnExportExcel.textContent = '...';
        this.btnExportExcel.disabled = true;
        try {
          const res = await window.electronAPI.exportAccountsExcel();
          if (res.success) {
            this.showToast('Xuất tài khoản thành công!', {
              actions: [{
                label: '📂 Mở thư mục',
                onClick: () => window.electronAPI.openFolder(res.dirPath)
              }]
            });
          } else if (res.reason !== 'canceled') {
            this.showToast(`Lỗi: ${res.reason}`, { type: 'error' });
          }
        } catch (e) {
          this.showToast(`Lỗi: ${e.message}`, { type: 'error' });
        } finally {
          this.btnExportExcel.textContent = 'Xuất Excel';
          this.btnExportExcel.disabled = false;
        }
      });

      this.btnSaveAcc.addEventListener('click', async () => {
        const mst = this.shadow.getElementById('acc-mst').value.trim();
        const pwd = this.shadow.getElementById('acc-pwd').value;
        const name = this.shadow.getElementById('acc-name').value.trim();

        if (!mst || !pwd) {
          this.showToast('Vui lòng nhập MST và Mật khẩu', { type: 'warning' });
          return;
        }

        await window.electronAPI.saveAccount({ mst, password: pwd, name });
        this.shadow.getElementById('acc-mst').value = '';
        this.shadow.getElementById('acc-pwd').value = '';
        this.shadow.getElementById('acc-name').value = '';
        this.showToast('Lưu tài khoản thành công!');
        this.loadAccounts();
      });

      this.btnFillAccount.addEventListener('click', () => {
        const selectedId = this.accountSelect.value;
        if (!selectedId) {
          this.showToast('Vui lòng chọn tài khoản', { type: 'warning' });
          return;
        }
        const acc = this.accounts.find(a => a.id === selectedId);
        if (acc) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          const inputs = document.querySelectorAll('input');
          let mstFilled = false;
          let pwdFilled = false;

          for (const input of inputs) {
            const name = (input.name || '').toLowerCase();
            const id = (input.id || '').toLowerCase();
            const placeholder = (input.placeholder || '').toLowerCase();

            const isUsername = name.includes('username') || name.includes('tendangnhap') || name === 'mst' ||
              id.includes('username') || id.includes('tendangnhap') || id === 'mst' ||
              placeholder.includes('tên đăng nhập') || placeholder.includes('mã số thuế') ||
              placeholder.includes('tendangnhap');

            if (isUsername && !mstFilled && input.type !== 'hidden') {
              nativeInputValueSetter.call(input, acc.mst);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              mstFilled = true;
            } else if (input.type === 'password' && !pwdFilled) {
              nativeInputValueSetter.call(input, acc.password);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              pwdFilled = true;
            }
          }
          if (mstFilled || pwdFilled) {
            this.showToast('Đã điền thông tin đăng nhập', { type: 'info' });
          } else {
            this.showToast('Không tìm thấy ô đăng nhập trên trang này', { type: 'warning' });
          }
        }
      });

      this.loadAccounts();

      this.chkOrganizeMst = this.shadow.getElementById('chk-organize-mst');
      window.electronAPI.getFolderOrganization().then(val => {
        this.chkOrganizeMst.checked = val;
      });
      this.chkOrganizeMst.addEventListener('change', () => {
        window.electronAPI.setFolderOrganization(this.chkOrganizeMst.checked);
        this.log(this.chkOrganizeMst.checked ? '📁 Bật tạo thư mục theo MST' : '📁 Tắt tạo thư mục theo MST');
      });

      // Shortcut handler
      document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey) {
          switch (e.code) {
            case 'KeyS':
              e.preventDefault();
              if (!this.btnStart.disabled) this.onStart();
              break;
            case 'KeyP':
              e.preventDefault();
              if (!this.btnPause.disabled) this.onPause();
              break;
            case 'KeyX':
              e.preventDefault();
              if (!this.btnStop.disabled) this.onStop();
              break;
            case 'KeyN':
              e.preventDefault();
              if (!this.btnSkip.disabled) this.onSkip();
              break;
            case 'KeyM':
              e.preventDefault();
              const panel = this.shadow.getElementById('main-panel');
              const widget = this.shadow.getElementById('widget-btn');
              if (panel.classList.contains('minimized')) {
                panel.classList.remove('minimized');
                widget.classList.remove('minimized');
              } else {
                panel.classList.add('minimized');
                widget.classList.add('minimized');
              }
              break;
          }
        }
      });
    }

    async loadAccounts() {
      this.accounts = await window.electronAPI.getAccounts();
      const optionsContainer = this.shadow.getElementById('account-select-options');
      const label = this.shadow.getElementById('account-select-label');
      
      optionsContainer.innerHTML = '<div class="custom-option selected" data-value="">-- Chọn tài khoản --</div>';
      
      this.accounts.forEach(acc => {
        const div = document.createElement('div');
        div.className = 'custom-option';
        div.dataset.value = acc.id;
        div.textContent = acc.name ? `${acc.mst} - ${acc.name}` : acc.mst;
        optionsContainer.appendChild(div);
      });
      
      const currentVal = this.accountSelect.value;
      const stillExists = this.accounts.find(a => a.id === currentVal);
      if (!stillExists) {
        this.accountSelect.value = '';
        label.textContent = '-- Chọn tài khoản --';
      }

      if (this.accountModal.style.display === 'flex') {
        this.renderAccountList();
      }
    }

    renderAccountList() {
      this.accList.innerHTML = '';
      const frag = document.createDocumentFragment();
      this.accounts.forEach(acc => {
        const li = document.createElement('li');
        li.className = 'acc-item';

        const info = document.createElement('span');
        info.textContent = acc.name ? `${acc.mst} - ${acc.name}` : acc.mst;

        const btnDel = document.createElement('button');
        btnDel.textContent = 'Xóa';
        btnDel.className = 'btn-small';
        btnDel.style.background = '#ea5455';
        btnDel.onclick = async () => {
          if (confirm(`Xóa tài khoản MST ${acc.mst}?`)) {
            await window.electronAPI.deleteAccount(acc.id);
            this.loadAccounts();
          }
        };

        li.appendChild(info);
        li.appendChild(btnDel);
        frag.appendChild(li);
      });
      this.accList.appendChild(frag);
    }

    updateFinancials(pretax, tax, total) {
      this.totalPretax += (pretax || 0);
      this.totalTax += (tax || 0);
      this.totalSum += (total || 0);

      this.lblTotalPretax.textContent = formatCurrency(this.totalPretax);
      this.lblTotalTax.textContent = formatCurrency(this.totalTax);
      this.lblTotalSum.textContent = formatCurrency(this.totalSum);
    }

    resetFinancials() {
      this.totalPretax = 0;
      this.totalTax = 0;
      this.totalSum = 0;
      this.lblTotalPretax.textContent = '0 đ';
      this.lblTotalTax.textContent = '0 đ';
      this.lblTotalSum.textContent = '0 đ';
    }

    updateWidgetBadge(count, isRunning) {
      if (isRunning || count > 0) {
        this.widgetBadge.style.display = 'block';
        this.widgetBadge.textContent = count > 0 ? `${count}` : '⚙';
      } else {
        this.widgetBadge.style.display = 'none';
      }
    }

    updateFolder(folder) {
      this.folderEl.textContent = folder;
      this.folderEl.title = folder;
    }

    updateState(state) {
      this.runnerState = state;
      this.statusBadge.textContent = this.translateState(state);
      this.statusBadge.className = 'status-badge ' + state.toLowerCase();

      if (state === 'IDLE' || state === 'COMPLETED' || state === 'FAILED' || state === 'STOPPED') {
        this.btnStart.disabled = false;
        this.btnPause.disabled = true;
        this.btnSkip.disabled = true;
        this.btnStop.disabled = true;
        this.btnPause.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Tạm dừng`;
      } else if (state === 'PAUSED') {
        this.btnStart.disabled = true;
        this.btnPause.disabled = false;
        this.btnSkip.disabled = false;
        this.btnStop.disabled = false;
        this.btnPause.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Tiếp tục`;
      } else {
        this.btnStart.disabled = true;
        this.btnPause.disabled = false;
        this.btnSkip.disabled = false;
        this.btnStop.disabled = false;
        this.btnPause.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Tạm dừng`;
      }
    }

    translateState(state) {
      switch (state) {
        case 'IDLE': return 'Sẵn sàng';
        case 'WAITING_FOR_TABLE': return 'Đợi bảng Thuế...';
        case 'READING_ROWS': return 'Đang đọc dòng...';
        case 'SELECTING_ROW': return 'Chọn dòng...';
        case 'WAITING_FOR_DOWNLOAD_BUTTON': return 'Tìm nút tải...';
        case 'DOWNLOADING': return 'Đang tải về...';
        case 'MOVING_TO_NEXT_PAGE': return 'Chuyển trang...';
        case 'PAUSED': return 'Đã tạm dừng';
        case 'COMPLETED': return 'Hoàn tất';
        case 'FAILED': return 'Lỗi';
        case 'STOPPED': return 'Đã dừng';
        default: return state;
      }
    }

    updateStats(done, total, success, failure, page) {
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      this.progressEl.textContent = `${done} / ${total} (${pct}%)`;
      this.progressBarFill.style.width = `${pct}%`;
      const overlay = this.shadow.getElementById('progress-text-overlay');
      if (overlay) overlay.textContent = `${pct}%`;
      this.successEl.textContent = success;
      this.failureEl.textContent = failure;
      this.pageEl.textContent = page;
      this.updateWidgetBadge(done, this.runnerState !== 'IDLE' && this.runnerState !== 'COMPLETED');
    }

    showRetryBar(failedCount) {
      if (failedCount > 0) {
        this.retryBar.style.display = 'block';
        this.lblFailedCount.textContent = failedCount;
      } else {
        this.retryBar.style.display = 'none';
      }
    }

    log(msg, type = 'normal') {
      const el = document.createElement('div');
      el.className = `log-item ${type}`;
      el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
      this.logContainer.appendChild(el);
      while (this.logContainer.childElementCount > 200) {
        this.logContainer.removeChild(this.logContainer.firstElementChild);
      }
      this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }

    showToast(message, { actions = [], autoDismissMs = 12000, type = 'success' } = {}) {
      let toastContainer = this.shadow.querySelector('.toast-container');
      if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        this.shadow.appendChild(toastContainer);
      }

      const toast = document.createElement('div');
      toast.className = 'toast';

      // Phân biệt icon & màu viền theo loại thông báo
      const typeConfig = {
        success: { icon: '✅', borderColor: '#28c76f' },
        error:   { icon: '❌', borderColor: '#ea5455' },
        warning: { icon: '⚠️', borderColor: '#ff9f43' },
        info:    { icon: 'ℹ️', borderColor: '#007aff' }
      };
      const config = typeConfig[type] || typeConfig.success;
      toast.style.borderLeftColor = config.borderColor;

      const actionsHtml = actions.map((act, i) =>
        `<button class="toast-btn ${act.primary !== false ? 'toast-btn-primary' : 'toast-btn-dismiss'}" id="toast-act-${i}">${act.label}</button>`
      ).join('') + `<button class="toast-btn toast-btn-dismiss" id="toast-dismiss">Đóng</button>`;

      toast.innerHTML = `
        <span class="toast-icon">${config.icon}</span>
        <div class="toast-body">
          <div class="toast-msg" style="white-space: pre-line;">${message}</div>
          <div class="toast-actions">${actionsHtml}</div>
        </div>
      `;

      // Giới hạn tối đa 3 toast hiển thị cùng lúc để tránh che kín màn hình
      while (toastContainer.children.length >= 3) {
        toastContainer.firstElementChild.remove();
      }

      toastContainer.appendChild(toast);

      const dismiss = () => {
        toast.classList.add('toast-hiding');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
      };

      toast.querySelector('#toast-dismiss').addEventListener('click', dismiss);

      actions.forEach((act, i) => {
        const btn = toast.querySelector(`#toast-act-${i}`);
        if (btn && act.onClick) {
          btn.addEventListener('click', () => {
            act.onClick();
            dismiss();
          });
        }
      });

      if (autoDismissMs > 0) {
        setTimeout(dismiss, autoDismissMs);
      }
    }

    handleUpdateStatus(data) {
      switch (data.status) {
        case 'checking':
          if (data.isManual) {
            this.updateBanner.classList.add('visible');
            this.updateMsg.textContent = 'Đang tìm phiên bản mới nhất...';
            this.updateActions.style.display = 'none';
            this.updateProgress.style.display = 'none';
          }
          break;
        case 'available':
          this.updateBanner.classList.add('visible');
          this.updateMsg.textContent = `Bản v${data.version} đã sẵn sàng. Đang tự động tải...`;
          this.updateActions.style.display = 'none';
          this.updateProgress.style.display = 'block';
          this.updateProgressBar.style.width = '0%';
          this.updateProgressText.textContent = 'Đang tải...';
          this.log(`🔄 Phát hiện bản v${data.version}, đang tải ngầm...`, 'warning');
          break;
        case 'downloading':
          this.updateBanner.classList.add('visible');
          const pct = Math.round(data.percent || 0);
          this.updateProgressBar.style.width = `${pct}%`;
          this.updateProgressText.textContent = `${pct}%`;
          break;
        case 'downloaded':
          this.updateBanner.classList.add('visible');
          this.updateMsg.textContent = `Bản v${data.version} đã tải xong. Sẵn sàng cài đặt.`;
          this.updateProgress.style.display = 'none';
          this.updateActions.style.display = 'flex';
          this.updateDownloadBtn.textContent = '🚀 Cài đặt & Khởi động lại';
          this.updateDownloadBtn.onclick = () => window.electronAPI.installUpdate();
          this.log(`✅ Tải cập nhật v${data.version} hoàn tất.`, 'success');
          break;
      }
    }

    makeDraggable() {
      const header = this.shadow.querySelector('.header');
      const widget = this.shadow.getElementById('widget-btn');
      let isDragging = false;
      let offsetX = 0, offsetY = 0;
      this.dragMoved = false;

      const onMouseDown = (e) => {
        if (e.button !== 0) return;
        isDragging = true;
        this.dragMoved = false;
        offsetX = e.clientX - this.container.getBoundingClientRect().left;
        offsetY = e.clientY - this.container.getBoundingClientRect().top;
      };

      header.addEventListener('mousedown', onMouseDown);
      widget.addEventListener('mousedown', onMouseDown);

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        this.dragMoved = true;

        let newLeft = e.clientX - offsetX;
        let newTop = e.clientY - offsetY;

        const rect = this.container.getBoundingClientRect();
        const maxLeft = window.innerWidth - rect.width;
        const maxTop = window.innerHeight - rect.height;

        newLeft = Math.max(0, Math.min(newLeft, maxLeft));
        newTop = Math.max(0, Math.min(newTop, maxTop));

        this.container.style.left = `${newLeft}px`;
        this.container.style.top = `${newTop}px`;
        this.container.style.right = 'auto';
        this.container.style.bottom = 'auto';
      });

      document.addEventListener('mouseup', () => { isDragging = false; });
    }
  }

  class InvoiceRunner {
    constructor() {
      this.state = 'IDLE';
      this.isPaused = false;
      this.abortController = null;
      this.skipController = null;
      this.currentPage = 1;
      this.successCount = 0;
      this.failureCount = 0;
      this.failedRows = [];
      this.pendingReviews = [];

      this.selectors = {
        resultTable: 'table',
        invoiceRows: 'tbody tr',
        nextPageButton: '.ant-pagination-next button, button.next-page'
      };

      this.behavior = {
        selectionDelayMs: 100,
        downloadTimeoutMs: 15000
      };

      window.electronAPI.getDownloadFolder().then(folder => {
        this.ui = new OverlayUI(
          this.start.bind(this),
          this.togglePause.bind(this),
          this.stop.bind(this),
          this.skipRow.bind(this),
          this.retryFailedRows.bind(this),
          this.changeFolder.bind(this),
          folder
        );

        window.electronAPI.onUpdateStatus((data) => {
          if (this.ui) this.ui.handleUpdateStatus(data);
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
        this.ui.log('Đã yêu cầu bỏ qua dòng hiện tại.', 'warning');
      }
    }

    togglePause() {
      if (this.state === 'IDLE' || this.state === 'COMPLETED' || this.state === 'STOPPED') return;
      this.isPaused = !this.isPaused;
      if (this.isPaused) {
        this.setState('PAUSED');
        this.ui.log('⏸ Đã tạm dừng tiến trình.', 'warning');
      } else {
        this.setState('READING_ROWS');
        this.ui.log('▶️ Tiếp tục tiến trình tải...', 'success');
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
      this.isPaused = false;
      this.failedRows = [];
      this.pendingReviews = [];
      this.ui.resetFinancials();
      this.ui.showRetryBar(0);
      this.ui.log('Bắt đầu quy trình tải siêu tốc...');

      this.currentPage = 1;
      this.successCount = 0;
      this.failureCount = 0;

      if (this.ui && this.ui.accountSelect) {
        const selectedId = this.ui.accountSelect.value;
        const selectedAcc = this.ui.accounts.find(a => a.id === selectedId);
        await window.electronAPI.setActiveMst(selectedAcc ? selectedAcc.mst : null);
      }

      try {
        this.setState('WAITING_FOR_TABLE');
        const table = document.querySelector(this.selectors.resultTable);
        if (!table) {
          throw new Error('Không tìm thấy bảng kết quả. Vui lòng bấm Tìm kiếm trên web Thuế trước.');
        }

        while (!signal.aborted) {
          await this.processCurrentPage(signal);
          if (signal.aborted) break;

          const hasNext = await this.goToNextPage(signal);
          if (!hasNext) {
            this.ui.log('Đã tải hết toàn bộ các trang.');
            break;
          }
          this.currentPage++;
        }

        if (!signal.aborted) {
          this.setState('COMPLETED');
          this.ui.log('Hoàn tất tải toàn bộ hóa đơn!', 'success');

          if (this.pendingReviews.length > 0) {
            this.showReviewModal();
          } else {
            const folder = await window.electronAPI.getDownloadFolder();
            this.ui.showToast(
              `Đã tải xong ${this.successCount} hóa đơn thành công!`,
              {
                actions: [{
                  label: '📂 Mở thư mục',
                  onClick: () => window.electronAPI.openFolder(folder)
                }],
                autoDismissMs: 15000
              }
            );
          }
        }
      } catch (e) {
        if (e.name === 'AbortError') {
          this.setState('STOPPED');
          this.ui.log('Đã dừng bởi người dùng.', 'warning');
          if (this.pendingReviews.length > 0) {
            this.showReviewModal();
          }
        } else {
          this.setState('FAILED');
          this.ui.log(`Lỗi: ${e.message}`, 'error');
        }
      }
    }

    stop() {
      if (this.abortController) this.abortController.abort();
      if (this.skipController) this.skipController.abort();
      this.isPaused = false;
      this.setState('STOPPED');
    }

    wait(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    isElementVisibleAndEnabled(el) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled')) return false;
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

        // Check Pause loop
        while (this.isPaused && !signal.aborted) {
          await this.wait(300);
        }
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        this.ui.updateStats(i, totalRows, this.successCount, this.failureCount, this.currentPage);

        const currentRows = Array.from(document.querySelectorAll(this.selectors.invoiceRows));
        const currentRow = currentRows[i];
        if (!currentRow) {
          this.ui.log(`Cảnh báo: Dòng ${i + 1} không tồn tại`, 'warning');
          continue;
        }

        this.skipController = new AbortController();

        try {
          const dlResult = await this.downloadRow(currentRow, i, signal, this.skipController.signal);
          
          this.successCount++;
          if (dlResult && dlResult.reviewItems) {
            this.pendingReviews.push(...dlResult.reviewItems);
            dlResult.reviewItems.forEach(item => {
              this.ui.updateFinancials(item.tongChuaThue, item.tongThue, item.tongThanhToan);
            });
            this.ui.log(`✓ Dòng ${i + 1}: Tải xong HĐ ${dlResult.reviewItems[0]?.invoiceNumber || ''}. Đợi xác nhận mẫu...`, 'success');
          } else {
            this.ui.log(`✓ Dòng ${i + 1}: Tải thành công.`, 'success');
          }
        } catch (e) {
          if (e.name === 'AbortError' && e.message !== 'Người dùng bấm Bỏ qua') {
            throw e;
          }
          this.failureCount++;
          this.failedRows.push({ row: currentRow, index: i, page: this.currentPage });
          this.ui.showRetryBar(this.failedRows.length);

          if (e.message === 'Người dùng bấm Bỏ qua') {
            this.ui.log(`⏭ Dòng ${i + 1}: Bỏ qua (người dùng).`, 'warning');
          } else {
            this.ui.log(`✗ Dòng ${i + 1}: ${e.message} (đã ghi nhận để tải lại)`, 'error');
          }
        } finally {
          this.skipController = null;
          this.ui.updateStats(i + 1, totalRows, this.successCount, this.failureCount, this.currentPage);
        }

        await this.wait(0);
      }
    }

    async retryFailedRows() {
      if (this.failedRows.length === 0) return;
      this.ui.log(`🔄 Bắt đầu tải lại ${this.failedRows.length} dòng bị lỗi...`, 'warning');
      const retrying = [...this.failedRows];
      this.failedRows = [];
      this.ui.showRetryBar(0);

      const signal = this.abortController ? this.abortController.signal : new AbortController().signal;

      for (const item of retrying) {
        if (signal.aborted) break;
        this.skipController = new AbortController();
        try {
          const dlResult = await this.downloadRow(item.row, item.index, signal, this.skipController.signal);
          this.successCount++;
          if (this.failureCount > 0) this.failureCount--;
          if (dlResult && dlResult.reviewItems) {
            this.pendingReviews.push(...dlResult.reviewItems);
            dlResult.reviewItems.forEach(rev => {
              this.ui.updateFinancials(rev.tongChuaThue, rev.tongThue, rev.tongThanhToan);
            });
          }
          this.ui.log(`✓ Tải lại thành công dòng ${item.index + 1}`, 'success');
        } catch (e) {
          this.failedRows.push(item);
          this.ui.log(`✕ Tải lại thất bại dòng ${item.index + 1}: ${e.message}`, 'error');
        } finally {
          this.skipController = null;
        }
      }
      this.ui.showRetryBar(this.failedRows.length);
    }

    async downloadRow(row, index, signal, skipSignal) {
      this.setState('SELECTING_ROW');
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.click();

      await new Promise((r, reject) => {
        const t = setTimeout(r, this.behavior.selectionDelayMs);
        signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); });
        skipSignal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Người dùng bấm Bỏ qua', 'AbortError')); });
      });

      this.setState('WAITING_FOR_DOWNLOAD_BUTTON');
      let dlBtn = null;

      const icons = Array.from(document.querySelectorAll('g#icon_ketxuat, svg path[d^="M10.54"]'));
      if (icons.length > 0) {
        dlBtn = icons[icons.length - 1].closest('button');
      }

      if (!dlBtn) {
        const fallbackBtns = Array.from(document.querySelectorAll('.ant-pagination-options ~ button:last-of-type'));
        if (fallbackBtns.length > 0) {
          dlBtn = fallbackBtns[fallbackBtns.length - 1];
        }
      }

      if (!dlBtn) {
        throw new Error('Không tìm thấy nút Tải xuống.');
      }

      const operationId = `${this.currentPage}-${index}-${Date.now()}`;
      const isSelling = this.ui.shadow.getElementById('rad-invoice-selling').checked;
      const invoiceType = isSelling ? 'selling' : 'buying';

      this.setState('DOWNLOADING');
      await window.electronAPI.armDownload({ operationId, invoiceType });
      dlBtn.click();

      return new Promise((resolve, reject) => {
        let cleaned = false;
        let cleanup = () => { };

        let errorObserver = null;
        const setupErrorObserver = () => {
          errorObserver = new MutationObserver((mutations) => {
            const errorMsg = document.querySelector('.ant-message-error, .ant-message-notice-error, .ant-notification-notice-error, .ant-message-custom-content.ant-message-error');
            if (errorMsg && errorMsg.innerText) {
              const errorText = errorMsg.innerText;
              const closeBtn = document.querySelector('.ant-message-notice-close, .ant-notification-notice-close');
              if (closeBtn) closeBtn.click();
              else errorMsg.remove();
              cleanup();
              reject(new Error(`Hệ thống Thuế báo lỗi: ${errorText}`));
            }
          });
          errorObserver.observe(document.body, { childList: true, subtree: true });
        };
        setupErrorObserver();

        const timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error('Quá thời gian chờ file tải về'));
        }, this.behavior.downloadTimeoutMs);

        const unsubscribe = window.electronAPI.onDownloadCompleted((result) => {
          if (result.operationId !== operationId) return;
          cleanup();
          if (result.status === 'success') {
            resolve(result);
          } else {
            reject(new Error(result.reason || 'Tải lỗi không rõ nguyên nhân'));
          }
        });

        cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          clearTimeout(timeoutId);
          if (errorObserver) { errorObserver.disconnect(); errorObserver = null; }
          unsubscribe();
          // Cleanup abort listeners to prevent memory leak across many downloadRow() calls
          signal.removeEventListener('abort', onSignalAbort);
          skipSignal.removeEventListener('abort', onSkipAbort);
        };

        const onSignalAbort = () => {
          cleanup();
          reject(new DOMException('Aborted', 'AbortError'));
        };

        const onSkipAbort = () => {
          cleanup();
          reject(new DOMException('Người dùng bấm Bỏ qua', 'AbortError'));
        };

        signal.addEventListener('abort', onSignalAbort, { once: true });
        skipSignal.addEventListener('abort', onSkipAbort, { once: true });
      });
    }

    async showReviewModal() {
      const modal = this.ui.shadow.getElementById('review-modal');
      const tbody = this.ui.shadow.getElementById('review-tbody');
      const btnCancel = this.ui.shadow.getElementById('btn-cancel-review');
      const btnExport = this.ui.shadow.getElementById('btn-export-review');
      const reviewCountBadge = this.ui.shadow.getElementById('review-count-badge');
      const reviewSummaryInfo = this.ui.shadow.getElementById('review-summary-info');
      const chkSelectAll = this.ui.shadow.getElementById('chk-review-select-all');
      const bulkSelect = this.ui.shadow.getElementById('bulk-template-select');
      const btnApplyBulk = this.ui.shadow.getElementById('btn-apply-bulk');
      const filterTabs = this.ui.shadow.getElementById('review-filter-tabs');

      const cntAll = this.ui.shadow.getElementById('cnt-all');
      const cntGoods = this.ui.shadow.getElementById('cnt-goods');
      const cntServices = this.ui.shadow.getElementById('cnt-services');
      const cntReview = this.ui.shadow.getElementById('cnt-review');

      tbody.innerHTML = '';
      const templates = await window.electronAPI.getTemplates();

      reviewCountBadge.textContent = `${this.pendingReviews.length} hóa đơn`;

      const isSellingFirst = this.pendingReviews[0]?.invoiceType === 'selling';
      const availableTemplates = isSellingFirst ? templates.selling : templates.buying;
      bulkSelect.innerHTML = availableTemplates.map(t => `<option value="${t.file}">${t.name}</option>`).join('');

      let totalPretax = 0;
      let totalTax = 0;
      let goodsCount = 0;
      let serviceCount = 0;
      let lowConfidenceCount = 0;

      this.pendingReviews.forEach((item, index) => {
        totalPretax += (item.tongChuaThue || 0);
        totalTax += (item.tongThue || 0);

        const score = item.score !== undefined ? item.score : 85;
        if (score < 80) lowConfidenceCount++;

        const isService = (item.templateName || '').includes('dịch vụ') || (item.template || '').includes('dich_vu');
        if (isService) serviceCount++;
        else goodsCount++;

        const scoreClass = score >= 85 ? 'high' : score >= 60 ? 'med' : 'low';
        const scoreLabel = `${score}% tin cậy`;

        const tr = document.createElement('tr');
        tr.dataset.index = index;
        tr.dataset.category = isService ? 'services' : 'goods';
        tr.dataset.lowConfidence = score < 80 ? 'true' : 'false';

        const isSelling = item.invoiceType === 'selling';
        const templateList = isSelling ? templates.selling : templates.buying;

        const optionsHtml = templateList.map(t =>
          `<option value="${t.file}" ${t.file === item.template ? 'selected' : ''}>${t.name}</option>`
        ).join('');

        tr.innerHTML = `
          <td style="text-align: center;">
            <input type="checkbox" class="chk-review-row" data-index="${index}" style="accent-color: #0052cc; cursor: pointer;" />
          </td>
          <td>${index + 1}</td>
          <td style="font-weight: 600; color: #0052cc;">${item.invoiceNumber || 'N/A'}</td>
          <td style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;" title="${isSelling ? item.nmuaTen : item.nbanTen}">
            ${isSelling ? item.nmuaTen : item.nbanTen}
          </td>
          <td>
            <span class="confidence-badge ${scoreClass}" title="${(item.reasons || []).join(' | ')}">
              ${scoreLabel}
            </span>
          </td>
          <td>
            <select data-index="${index}">${optionsHtml}</select>
          </td>
          <td style="text-align: center;">
            <button class="btn-small btn-view-detail" data-index="${index}" style="padding: 3px 8px; font-size: 11px; background: #5a6a85;">👁 Xem</button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      cntAll.textContent = this.pendingReviews.length;
      cntGoods.textContent = goodsCount;
      cntServices.textContent = serviceCount;
      cntReview.textContent = lowConfidenceCount;

      reviewSummaryInfo.innerHTML = `Tổng tiền chưa thuế: <b>${formatCurrency(totalPretax)}</b> | Thuế GTGT: <b>${formatCurrency(totalTax)}</b>`;

      filterTabs.onclick = (e) => {
        const tab = e.target.closest('.filter-tab');
        if (!tab) return;
        filterTabs.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const filter = tab.dataset.filter;
        const rows = tbody.querySelectorAll('tr');
        rows.forEach(r => {
          if (filter === 'all') r.style.display = '';
          else if (filter === 'goods' && r.dataset.category === 'goods') r.style.display = '';
          else if (filter === 'services' && r.dataset.category === 'services') r.style.display = '';
          else if (filter === 'review' && r.dataset.lowConfidence === 'true') r.style.display = '';
          else r.style.display = 'none';
        });
      };

      chkSelectAll.checked = false;
      chkSelectAll.onchange = () => {
        const checkboxes = tbody.querySelectorAll('.chk-review-row');
        checkboxes.forEach(cb => {
          if (cb.closest('tr').style.display !== 'none') {
            cb.checked = chkSelectAll.checked;
          }
        });
      };

      btnApplyBulk.onclick = () => {
        const targetTemplate = bulkSelect.value;
        const selectedCbs = tbody.querySelectorAll('.chk-review-row:checked');
        if (selectedCbs.length === 0) {
          this.ui.showToast('Vui lòng chọn ít nhất một hóa đơn', { type: 'warning' });
          return;
        }
        selectedCbs.forEach(cb => {
          const idx = parseInt(cb.dataset.index);
          this.pendingReviews[idx].template = targetTemplate;
          const sel = tbody.querySelector(`select[data-index="${idx}"]`);
          if (sel) sel.value = targetTemplate;
        });
        this.ui.showToast(`Đã đổi mẫu cho ${selectedCbs.length} hóa đơn`, { type: 'info' });
      };

      tbody.onclick = (e) => {
        const btnView = e.target.closest('.btn-view-detail');
        if (btnView) {
          const idx = parseInt(btnView.dataset.index);
          const item = this.pendingReviews[idx];
          if (item) this.showDetailModal(item);
        }
      };

      modal.style.display = 'flex';

      btnCancel.onclick = () => {
        if (this.pendingReviews.length > 0) {
          window.electronAPI.deleteXmlBatch(this.pendingReviews);
        }
        modal.style.display = 'none';
        this.pendingReviews = [];
      };

      btnExport.onclick = async () => {
        btnExport.disabled = true;
        btnExport.textContent = 'Đang xuất...';

        const selects = tbody.querySelectorAll('select');
        selects.forEach(select => {
          const idx = parseInt(select.getAttribute('data-index'));
          this.pendingReviews[idx].template = select.value;
        });

        try {
          // Cập nhật trạng thái tiến độ chi tiết trên nút
          const spinner = `<svg style="animation: spin 1s linear infinite; margin-right: 4px;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>`;
          btnExport.innerHTML = `${spinner} Đang xử lý xuất Excel... 0%`;
          
          // Lắng nghe progress từ Worker
          const removeListener = window.electronAPI.onExportProgress((progress) => {
            const percent = Math.round((progress.completed / progress.total) * 100);
            btnExport.innerHTML = `${spinner} Đang xuất: ${progress.completed} / ${progress.total} (${percent}%)`;
          });

          const results = await window.electronAPI.exportExcelBatch(this.pendingReviews);
          removeListener();
          const successResults = results.filter(r => r.success);
          const successCount = successResults.length;
          modal.style.display = 'none';
          this.pendingReviews = [];

          const folder = await window.electronAPI.getDownloadFolder();
          const primaryFile = successResults[0]?.outputPath;

          const actions = [
            {
              label: '📂 Mở thư mục chứa',
              onClick: () => window.electronAPI.openFolder(folder)
            }
          ];

          if (primaryFile) {
            actions.unshift({
              label: '📊 Mở file Excel ngay',
              onClick: () => window.electronAPI.openFile(primaryFile)
            });
          }

          this.ui.showToast(
            `Đã xuất Excel xong: ${successCount}/${results.length} file thành công!\n💰 Tổng tiền chưa thuế: ${formatCurrency(totalPretax)} | GTGT: ${formatCurrency(totalTax)}`,
            {
              actions,
              autoDismissMs: 20000
            }
          );
        } catch (e) {
          this.ui.showToast(`Lỗi xuất Excel: ${e.message}`, { type: 'error' });
        } finally {
          btnExport.disabled = false;
          btnExport.textContent = 'Xuất Tất Cả Excel';
        }
      };
    }

    showDetailModal(item) {
      const detailModal = this.ui.shadow.getElementById('detail-modal');
      const detailTitle = this.ui.shadow.getElementById('detail-modal-title');
      const detailSubtitle = this.ui.shadow.getElementById('detail-modal-subtitle');
      const detailBody = this.ui.shadow.getElementById('detail-modal-body');
      const btnCloseDetail = this.ui.shadow.getElementById('btn-close-detail');

      detailTitle.textContent = `Hóa Đơn Số ${item.invoiceNumber || 'N/A'}`;
      detailSubtitle.textContent = `Ngày lập: ${item.ngayLap || 'N/A'} | Mẫu đề xuất: ${item.templateName || item.template}`;

      const itemsRows = (item.items || []).map((it, idx) => `
        <tr>
          <td style="text-align: center;">${idx + 1}</td>
          <td>${it.ten || ''}</td>
          <td style="text-align: center;">${it.dvt || ''}</td>
          <td style="text-align: right;">${it.so_luong || 1}</td>
          <td style="text-align: right;">${formatCurrency(it.don_gia)}</td>
          <td style="text-align: right;">${formatCurrency(it.thanh_tien)}</td>
          <td style="text-align: center;">${it.thue_suat || ''}</td>
        </tr>
      `).join('');

      detailBody.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 12px; margin-bottom: 12px; background: #f8f9fa; padding: 10px; border-radius: 6px;">
          <div>
            <div style="font-weight: bold; color: #0052cc; margin-bottom: 4px;">🏢 Bên Bán (Người bán)</div>
            <div><b>Tên:</b> ${item.nbanTen || 'N/A'}</div>
            <div><b>MST:</b> ${item.nbanMst || 'N/A'}</div>
            <div><b>Địa chỉ:</b> ${item.nbanDchi || 'N/A'}</div>
          </div>
          <div>
            <div style="font-weight: bold; color: #0052cc; margin-bottom: 4px;">🛒 Bên Mua (Người mua)</div>
            <div><b>Tên:</b> ${item.nmuaTen || 'N/A'}</div>
            <div><b>MST:</b> ${item.nmuaMst || 'N/A'}</div>
            <div><b>Địa chỉ:</b> ${item.nmuaDchi || 'N/A'}</div>
          </div>
        </div>

        <div style="font-weight: bold; font-size: 13px; color: #2c3e50; margin-bottom: 6px;">Danh Sách Mặt Hàng / Dịch Vụ (${(item.items || []).length} mục)</div>
        <table class="detail-table">
          <thead>
            <tr>
              <th style="width: 35px; text-align: center;">STT</th>
              <th>Tên hàng hóa / dịch vụ</th>
              <th style="width: 60px; text-align: center;">ĐVT</th>
              <th style="width: 65px; text-align: right;">Số lượng</th>
              <th style="width: 100px; text-align: right;">Đơn giá</th>
              <th style="width: 110px; text-align: right;">Thành tiền</th>
              <th style="width: 70px; text-align: center;">Thuế suất</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows.length > 0 ? itemsRows : '<tr><td colspan="7" style="text-align: center; color: #909399; padding: 30px;"><svg style="margin-bottom: 8px;" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#dcdfe6" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg><br/>Không có thông tin chi tiết mặt hàng</td></tr>'}
          </tbody>
        </table>

        <div style="margin-top: 14px; background: #eef2fe; padding: 10px; border-radius: 6px; font-size: 12px; display: flex; justify-content: space-around; font-weight: 500;">
          <div>Tiền hàng: <b style="color: #2c3e50;">${formatCurrency(item.tongChuaThue)}</b></div>
          <div>Thuế GTGT: <b style="color: #0052cc;">${formatCurrency(item.tongThue)}</b></div>
          <div>Tổng thanh toán: <b style="color: #28c76f;">${formatCurrency(item.tongThanhToan)}</b></div>
        </div>
      `;

      detailModal.style.display = 'flex';
      btnCloseDetail.onclick = () => {
        detailModal.style.display = 'none';
      };
    }

    async goToNextPage(signal) {
      this.setState('MOVING_TO_NEXT_PAGE');
      const nextBtn = document.querySelector(this.selectors.nextPageButton);

      if (!nextBtn || !this.isElementVisibleAndEnabled(nextBtn)) {
        return false;
      }

      const oldFirstRowText = document.querySelector(this.selectors.invoiceRows)?.textContent || '';
      nextBtn.click();

      await this.wait(1000);

      const startTime = Date.now();
      const pageChangeTimeoutMs = 15000;

      while (Date.now() - startTime < pageChangeTimeoutMs) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const newFirstRowText = document.querySelector(this.selectors.invoiceRows)?.textContent || '';
        if (newFirstRowText !== oldFirstRowText) {
          await this.wait(1000);
          return true;
        }
        await this.wait(500);
      }

      return false;
    }
  }

  const runner = new InvoiceRunner();

  const bodyObserver = new MutationObserver(() => {
    if (runner.ui && runner.ui.container && document.body && !document.getElementById('electron-batch-dl-root')) {
      document.body.appendChild(runner.ui.container);
    }
  });
  if (document.body) {
    bodyObserver.observe(document.body, { childList: true });
  }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initApp();
} else {
  window.addEventListener('DOMContentLoaded', initApp);
  window.addEventListener('load', initApp);
}

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
