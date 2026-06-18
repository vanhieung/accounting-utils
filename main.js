const { app, BrowserWindow, session, ipcMain, dialog, shell, safeStorage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const JSZip = require('jszip');
const { autoUpdater } = require('electron-updater');

// Cấu hình thư mục lưu mặc định
let downloadDestination = path.join(app.getPath('downloads'), 'InvoicesAuto');
if (!fs.existsSync(downloadDestination)) {
  fs.mkdirSync(downloadDestination, { recursive: true });
}

let activeMst = null;
let organizeFoldersByMst = false;

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

let cachedSettings = null;

function loadSettings() {
  if (cachedSettings !== null) return cachedSettings;
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      cachedSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    } else {
      cachedSettings = {};
    }
  } catch (e) {
    console.error('Lỗi đọc settings.json:', e);
    cachedSettings = {};
  }
  return cachedSettings;
}

function saveSetting(key, value) {
  try {
    const settings = loadSettings();
    settings[key] = value;
    cachedSettings = settings;
    fsPromises.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2)).catch(e => {
      console.error('Lỗi lưu settings.json:', e);
    });
  } catch (e) {
    console.error('Lỗi cập nhật settings:', e);
  }
}

// Load initial settings
const _initSettings = loadSettings();
organizeFoldersByMst = !!_initSettings.organizeFoldersByMst;

const ACCOUNTS_FILE = path.join(app.getPath('userData'), 'accounts.json');

let cachedAccounts = null;

async function loadAccounts() {
  if (cachedAccounts !== null) return cachedAccounts;
  try {
    const exists = await fsPromises.access(ACCOUNTS_FILE).then(() => true).catch(() => false);
    if (exists) {
      const data = await fsPromises.readFile(ACCOUNTS_FILE, 'utf8');
      cachedAccounts = JSON.parse(data);
    } else {
      cachedAccounts = [];
    }
  } catch (e) {
    console.error('Lỗi đọc accounts.json:', e);
    cachedAccounts = [];
  }
  return cachedAccounts;
}

async function saveAccountsData(accounts) {
  cachedAccounts = accounts;
  try {
    await fsPromises.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  } catch (e) {
    console.error('Lỗi lưu accounts.json:', e);
  }
}

let batchDownloadWindow;
let pendingOperations = [];
let customSessionInitialized = false;

function openBatchDownloadWindow() {
  if (batchDownloadWindow && !batchDownloadWindow.isDestroyed()) {
    batchDownloadWindow.focus();
    return;
  }

  const customSession = session.fromPartition('persist:invoice-session');

  batchDownloadWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false, // Ẩn window khi mới tạo để tránh màn hình trắng
    backgroundColor: '#ffffff', // Set màu nền để nếu có delay cũng không bị chói
    icon: path.join(__dirname, 'app_icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: 'persist:invoice-session'
    }
  });

  // Chỉ hiện window khi đã render xong HTML/CSS (khắc phục lỗi màn hình trắng)
  batchDownloadWindow.once('ready-to-show', () => {
    batchDownloadWindow.show();
  });

  // Xử lý khi load trang bị lỗi (mất mạng, timeout, server sập...)
  batchDownloadWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Lỗi tải trang:', errorDescription);
    // Tự động tải lại sau 5 giây nếu lỗi
    setTimeout(() => {
      if (batchDownloadWindow && !batchDownloadWindow.isDestroyed()) {
        batchDownloadWindow.loadURL('https://hoadondientu.gdt.gov.vn/');
      }
    }, 5000);
  });

  // Xử lý khi tiến trình render bị crash (màn hình trắng)
  batchDownloadWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('Renderer process bị crash:', details.reason);
    if (details.reason === 'crashed' || details.reason === 'oom') {
      setTimeout(() => {
        if (batchDownloadWindow && !batchDownloadWindow.isDestroyed()) {
          batchDownloadWindow.reload();
        }
      }, 1000);
    }
  });

  // Security: Ngăn chặn điều hướng ngoài trang chủ
  batchDownloadWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('https://hoadondientu.gdt.gov.vn') && !url.startsWith('http://hoadondientu.gdt.gov.vn')) {
      event.preventDefault();
      console.log('Chặn điều hướng tới:', url);
    }
  });

  if (!customSessionInitialized) {
    customSessionInitialized = true;
    customSession.on('will-download', (event, item, webContents) => {
      // Ghép nối với operation đang chờ tải
      const now = Date.now();
      const matchedOpIndex = pendingOperations.findIndex(op => now - op.timestamp < 60000);
      let opId = null;
      if (matchedOpIndex >= 0) {
        opId = pendingOperations[matchedOpIndex].operationId;
        // Hủy timer no-download-started vì download đã bắt đầu
        if (pendingOperations[matchedOpIndex].noDownloadTimer) {
          clearTimeout(pendingOperations[matchedOpIndex].noDownloadTimer);
        }
        pendingOperations.splice(matchedOpIndex, 1);
      }

      // Không hiện hộp thoại hỏi chỗ lưu, tạo tên file duy nhất
      let originalFileName = item.getFilename();
      let fileName = originalFileName;

      // Nếu có opId (chứa thông tin trang-dòng-timestamp), ta ghép vào tên file để dễ phân biệt
      if (opId) {
        const ext = path.extname(originalFileName);
        const base = path.basename(originalFileName, ext);
        fileName = `${base}_${opId}${ext}`;
      }

      let actualDestination = downloadDestination;
      if (organizeFoldersByMst && activeMst) {
        actualDestination = path.join(downloadDestination, activeMst);
        if (!fs.existsSync(actualDestination)) {
          fs.mkdirSync(actualDestination, { recursive: true });
        }
      }
      let savePath = path.join(actualDestination, fileName);

      // Đảm bảo tuyệt đối không đè file nếu file đã tồn tại
      let counter = 1;
      while (fs.existsSync(savePath)) {
        const ext = path.extname(fileName);
        const base = path.basename(fileName, ext);
        savePath = path.join(actualDestination, `${base} (${counter})${ext}`);
        counter++;
      }

      item.setSavePath(savePath);

      item.on('updated', (event, state) => {
        if (state === 'interrupted') {
          console.log('Download is interrupted but can be resumed');
        } else if (state === 'progressing') {
          if (item.isPaused()) {
            console.log('Download is paused');
          }
          // Removed spammy console.log(`Received bytes: ...`)
        }
      });

      item.once('done', async (event, state) => {
        if (state === 'completed') {
          console.log('Download successfully:', savePath);

          let finalStatus = 'success';
          let failReason = null;

          // Tự động giải nén XML và xoá ZIP
          if (savePath.toLowerCase().endsWith('.zip')) {
            try {
              const fileData = await fsPromises.readFile(savePath);
              const zip = await JSZip.loadAsync(fileData);
              let extractedCount = 0;
              const promises = [];

              const destDir = path.dirname(savePath);
              const baseName = path.basename(savePath, '.zip');

              zip.forEach((relativePath, zipEntry) => {
                const entryName = zipEntry.name.toLowerCase();
                if (!zipEntry.dir && (entryName === 'invoice.xml' || entryName.endsWith('/invoice.xml'))) {
                  promises.push((async () => {
                    const content = await zipEntry.async("nodebuffer");
                    let destFileName = `${baseName}.xml`;
                    let destPath = path.join(destDir, destFileName);

                    let counter = 1;
                    while (fs.existsSync(destPath)) {
                      destFileName = `${baseName}_${counter}.xml`;
                      destPath = path.join(destDir, destFileName);
                      counter++;
                    }

                    await fsPromises.writeFile(destPath, content);
                    extractedCount++;
                  })());
                }
              });

              await Promise.all(promises);

              // Nếu giải nén thành công, xoá file zip
              if (extractedCount > 0) {
                try {
                  await fsPromises.unlink(savePath);
                  console.log('Extracted XML and deleted ZIP:', savePath);
                } catch (e) {
                  console.error('Không thể xóa file ZIP:', e);
                }
              } else {
                console.log('No invoice.xml found in ZIP:', savePath);
              }
            } catch (err) {
              console.error('Error extracting ZIP:', err);
              finalStatus = 'error';
              failReason = 'Lỗi giải nén ZIP';
            }
          }

          if (batchDownloadWindow && !batchDownloadWindow.isDestroyed()) {
            batchDownloadWindow.webContents.send('download-completed', {
              operationId: opId,
              fileName,
              status: finalStatus,
              reason: failReason
            });
          }
        } else {
          console.log(`Download failed: ${state}`);
          if (batchDownloadWindow && !batchDownloadWindow.isDestroyed()) {
            batchDownloadWindow.webContents.send('download-completed', { operationId: opId, fileName, status: 'error', reason: state });
          }
        }
      });
    });
  }

  batchDownloadWindow.loadURL('https://hoadondientu.gdt.gov.vn/');
}

app.whenReady().then(() => {
  // Tự động chuyển session cookies thành persistent cookies để duy trì trạng thái đăng nhập
  const customSession = session.fromPartition('persist:invoice-session');
  customSession.cookies.on('changed', async (event, cookie, cause, removed) => {
    if (removed) return;
    if (cookie.session) {
      const url = `${cookie.secure ? 'https' : 'http'}://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
      const expirationDate = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // Hết hạn sau 30 ngày
      try {
        await customSession.cookies.set({
          url: url,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          expirationDate: expirationDate
        });
      } catch (err) {
        console.error('Lỗi khi đổi session cookie thành persistent cookie:', err);
      }
    }
  });

  openBatchDownloadWindow();

  // === Menu Setup ===
  const menuTemplate = [
    {
      label: 'Công cụ',
      submenu: [
        {
          label: 'Kiểm tra cập nhật',
          click: () => {
            isManualUpdateCheck = true;
            autoUpdater.checkForUpdates().catch(err => {
              isManualUpdateCheck = false;
              // Error is handled by autoUpdater.on('error') event, so no native dialog needed
            });
          }
        },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Bật/Tắt DevTools' },
        { role: 'reload', label: 'Tải lại' },
        { role: 'quit', label: 'Thoát' }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  // === Auto-Updater Setup ===
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let isManualUpdateCheck = false;

  // Forward update events to renderer
  function sendUpdateStatus(channel, data) {
    if (batchDownloadWindow && !batchDownloadWindow.isDestroyed()) {
      batchDownloadWindow.webContents.send(channel, { ...data, isManual: isManualUpdateCheck });
    }
  }

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus('update-status', { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus('update-status', {
      status: 'available',
      version: info.version,
      releaseNotes: info.releaseNotes || '',
      releaseDate: info.releaseDate || ''
    });
    isManualUpdateCheck = false;
  });

  autoUpdater.on('update-not-available', (info) => {
    sendUpdateStatus('update-status', {
      status: 'not-available',
      version: info.version
    });
    isManualUpdateCheck = false;
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus('update-status', {
      status: 'downloading',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus('update-status', {
      status: 'downloaded',
      version: info.version
    });
  });

  autoUpdater.on('error', (err) => {
    sendUpdateStatus('update-status', {
      status: 'error',
      message: err.message || 'Lỗi kiểm tra cập nhật'
    });
    isManualUpdateCheck = false;
  });

  // Check for updates on startup (delay 5s to let app fully load)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      console.error('Auto-update check failed:', err);
    });
  }, 5000);


  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openBatchDownloadWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  const customSession = session.fromPartition('persist:invoice-session');
  await customSession.cookies.flushStore();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Đăng ký phiên tải
ipcMain.handle('arm-download', (event, payload) => {
  const now = Date.now();
  // Dọn dẹp memory leak
  pendingOperations = pendingOperations.filter(op => {
    if (now - op.timestamp >= 60000) {
      if (op.noDownloadTimer) clearTimeout(op.noDownloadTimer);
      return false;
    }
    return true;
  });

  // Timer: nếu sau 2 giây không có will-download event nào, báo lỗi cho renderer
  const noDownloadTimer = setTimeout(() => {
    const opIndex = pendingOperations.findIndex(op => op.operationId === payload.operationId);
    if (opIndex >= 0) {
      pendingOperations.splice(opIndex, 1);
      if (batchDownloadWindow && !batchDownloadWindow.isDestroyed()) {
        batchDownloadWindow.webContents.send('download-completed', {
          operationId: payload.operationId,
          fileName: null,
          status: 'error',
          reason: 'Không có file nào được tải về (server không trả file)'
        });
      }
    }
  }, 2000);

  pendingOperations.push({
    operationId: payload.operationId,
    timestamp: now,
    noDownloadTimer: noDownloadTimer
  });
  return { success: true };
});

// Lắng nghe sự kiện từ preload nếu muốn đổi thư mục
ipcMain.handle('change-download-folder', async () => {
  const result = await dialog.showOpenDialog(batchDownloadWindow, {
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    downloadDestination = result.filePaths[0];
  }
  return downloadDestination;
});

ipcMain.handle('get-download-folder', () => {
  return downloadDestination;
});

ipcMain.handle('open-folder', (event, folderPath) => {
  const target = folderPath || downloadDestination;
  shell.openPath(target);
});

ipcMain.handle('get-widget-icon', async () => {
  try {
    const iconPath = path.join(__dirname, 'widget_icon.png');
    const data = await fsPromises.readFile(iconPath);
    return `data:image/png;base64,${data.toString('base64')}`;
  } catch (e) {
    return null;
  }
});

// === Auto-Update IPC Handlers ===
ipcMain.handle('check-for-update', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, version: result?.updateInfo?.version };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// === Account Management IPC Handlers ===
ipcMain.handle('get-accounts', async () => {
  const accounts = await loadAccounts();
  return accounts.map(acc => {
    let password = '';
    try {
      if (acc.encryptedPassword && safeStorage.isEncryptionAvailable()) {
        const buffer = Buffer.from(acc.encryptedPassword, 'base64');
        password = safeStorage.decryptString(buffer);
      }
    } catch (e) {
      console.error('Lỗi giải mã mật khẩu:', e);
    }
    return { id: acc.id, mst: acc.mst, name: acc.name, password: password };
  });
});

ipcMain.handle('save-account', async (event, account) => {
  const accounts = await loadAccounts();
  let encryptedPassword = '';
  try {
    if (account.password && safeStorage.isEncryptionAvailable()) {
      const buffer = safeStorage.encryptString(account.password);
      encryptedPassword = buffer.toString('base64');
    }
  } catch (e) {
    console.error('Lỗi mã hóa mật khẩu:', e);
  }

  const existingIndex = accounts.findIndex(a => a.id === account.id);
  const accData = {
    id: account.id || Date.now().toString(),
    mst: account.mst,
    name: account.name,
    encryptedPassword: encryptedPassword
  };

  if (existingIndex >= 0) {
    accounts[existingIndex] = accData;
  } else {
    accounts.push(accData);
  }
  
  await saveAccountsData(accounts);
  return { success: true, id: accData.id };
});

ipcMain.handle('delete-account', async (event, id) => {
  let accounts = await loadAccounts();
  accounts = accounts.filter(a => a.id !== id);
  await saveAccountsData(accounts);
  return { success: true };
});

ipcMain.handle('import-excel-accounts', async () => {
  try {
    const result = await dialog.showOpenDialog(batchDownloadWindow, {
      title: 'Chọn file Excel chứa tài khoản',
      filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls', 'csv'] }],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, reason: 'canceled' };
    }

    const filePath = result.filePaths[0];
    const xlsx = require('xlsx');
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    // Chuyển sheet thành mảng 2 chiều (array of arrays)
    const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

    const accounts = await loadAccounts();
    let importedCount = 0;
    const mstRegex = /^\d{10}(-\d{3})?$/;

    for (const row of data) {
      if (!Array.isArray(row)) continue;
      
      let mstIndex = -1;
      let cleanMst = '';
      for (let i = 0; i < row.length; i++) {
        if (!row[i]) continue;
        let cellVal = String(row[i]).trim();
        // Xóa hậu tố -QL nếu có
        let potentialMst = cellVal.replace(/-QL$/i, '').trim();
        
        if (mstRegex.test(potentialMst)) {
          mstIndex = i;
          cleanMst = potentialMst;
          break;
        }
      }

      if (mstIndex !== -1) {
        const mst = cleanMst;
        
        // Mật khẩu là cột có dữ liệu cuối cùng trong dòng
        let password = '';
        for (let i = row.length - 1; i > mstIndex; i--) {
          if (row[i] && String(row[i]).trim() !== '') {
            password = String(row[i]).trim();
            break;
          }
        }
        
        const name = mstIndex > 0 ? String(row[mstIndex - 1] || '').trim() : '';

        if (password) {
          let encryptedPassword = '';
          if (safeStorage.isEncryptionAvailable()) {
            const buffer = safeStorage.encryptString(password);
            encryptedPassword = buffer.toString('base64');
          }

          const existingIndex = accounts.findIndex(a => a.mst === mst);
          const accData = {
            id: existingIndex >= 0 ? accounts[existingIndex].id : Date.now().toString() + Math.random(),
            mst,
            name,
            encryptedPassword
          };

          if (existingIndex >= 0) {
            accounts[existingIndex] = accData;
          } else {
            accounts.push(accData);
          }
          importedCount++;
        }
      }
    }

    await saveAccountsData(accounts);
    return { success: true, count: importedCount };

  } catch (error) {
    console.error('Lỗi import Excel:', error);
    return { success: false, reason: error.message };
  }
});

// === Per-Account Folder Organization IPC ===
ipcMain.handle('set-active-mst', (event, mst) => {
  activeMst = mst || null;
  return { success: true };
});

ipcMain.handle('set-folder-organization', (event, enabled) => {
  organizeFoldersByMst = !!enabled;
  saveSetting('organizeFoldersByMst', organizeFoldersByMst);
  return { success: true };
});

ipcMain.handle('get-folder-organization', () => {
  return organizeFoldersByMst;
});

// === Export Accounts to Excel ===
ipcMain.handle('export-accounts-excel', async () => {
  try {
    const accounts = await loadAccounts();
    if (accounts.length === 0) {
      return { success: false, reason: 'Không có tài khoản nào để xuất' };
    }

    const result = await dialog.showSaveDialog(batchDownloadWindow, {
      title: 'Xuất danh sách tài khoản',
      defaultPath: path.join(app.getPath('downloads'), 'accounts_export.xlsx'),
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    });

    if (result.canceled) {
      return { success: false, reason: 'canceled' };
    }

    const xlsx = require('xlsx');
    const exportData = accounts.map((acc, index) => {
      let password = '';
      try {
        if (acc.encryptedPassword && safeStorage.isEncryptionAvailable()) {
          const buffer = Buffer.from(acc.encryptedPassword, 'base64');
          password = safeStorage.decryptString(buffer);
        }
      } catch (e) { /* skip */ }
      return {
        'STT': index + 1,
        'Mã số thuế': acc.mst,
        'Tên công ty': acc.name || '',
        'Mật khẩu': password
      };
    });

    const ws = xlsx.utils.json_to_sheet(exportData);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Tài khoản');
    xlsx.writeFile(wb, result.filePath);

    return { success: true, filePath: result.filePath, dirPath: path.dirname(result.filePath) };
  } catch (error) {
    console.error('Lỗi xuất Excel:', error);
    return { success: false, reason: error.message };
  }
});
