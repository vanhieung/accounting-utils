const { app, BrowserWindow, session, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const JSZip = require('jszip');

// Cấu hình thư mục lưu mặc định
let downloadDestination = path.join(app.getPath('downloads'), 'InvoicesAuto');
if (!fs.existsSync(downloadDestination)) {
  fs.mkdirSync(downloadDestination, { recursive: true });
}

let dashboardWindow;
let batchDownloadWindow;
let pendingOperations = [];
let customSessionInitialized = false;

function createDashboardWindow() {
  dashboardWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload-dashboard.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true,
  });

  dashboardWindow.loadFile('index.html');
}

function openBatchDownloadWindow() {
  if (batchDownloadWindow && !batchDownloadWindow.isDestroyed()) {
    batchDownloadWindow.focus();
    return;
  }

  const customSession = session.fromPartition('persist:invoice-session');

  batchDownloadWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:invoice-session'
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

    let savePath = path.join(downloadDestination, fileName);
    
    // Đảm bảo tuyệt đối không đè file nếu file đã tồn tại
    let counter = 1;
    while (fs.existsSync(savePath)) {
      const ext = path.extname(fileName);
      const base = path.basename(fileName, ext);
      savePath = path.join(downloadDestination, `${base} (${counter})${ext}`);
      counter++;
    }

    item.setSavePath(savePath);

    item.on('updated', (event, state) => {
      if (state === 'interrupted') {
        console.log('Download is interrupted but can be resumed');
      } else if (state === 'progressing') {
        if (item.isPaused()) {
          console.log('Download is paused');
        } else {
          console.log(`Received bytes: ${item.getReceivedBytes()}`);
        }
      }
    });
    
    item.once('done', (event, state) => {
      if (state === 'completed') {
        console.log('Download successfully:', savePath);
        if (batchDownloadWindow && !batchDownloadWindow.isDestroyed()) {
          batchDownloadWindow.webContents.send('download-completed', { operationId: opId, fileName, status: 'success' });
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
  createDashboardWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createDashboardWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Đăng ký phiên tải
ipcMain.handle('arm-download', (event, payload) => {
  pendingOperations.push({
    operationId: payload.operationId,
    timestamp: Date.now()
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

// === IPC Handlers for Account Utils ===
ipcMain.on('open-batch-download', () => {
  openBatchDownloadWindow();
});

ipcMain.handle('select-zips', async () => {
  const result = await dialog.showOpenDialog(dashboardWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'ZIP Files', extensions: ['zip'] }
    ]
  });
  if (result.canceled) {
    return [];
  } else {
    return result.filePaths.map(fp => ({
      name: path.basename(fp),
      path: fp
    }));
  }
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(dashboardWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled) {
    return null;
  } else {
    return result.filePaths[0];
  }
});

ipcMain.handle('extract-zips', async (event, { filePaths, destDir }) => {
  const results = [];

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    try {
      const fileName = path.basename(filePath, path.extname(filePath));
      const fileData = fs.readFileSync(filePath);
      const zip = await JSZip.loadAsync(fileData);
      
      let extractedCount = 0;
      const promises = [];
      
      zip.forEach((relativePath, zipEntry) => {
        const entryName = zipEntry.name.toLowerCase();
        if (!zipEntry.dir && (entryName === 'invoice.xml' || entryName.endsWith('/invoice.xml'))) {
          promises.push(new Promise(async (resolve, reject) => {
            try {
              const content = await zipEntry.async("nodebuffer");
              
              let destFileName = `${fileName}_invoice.xml`;
              let destPath = path.join(destDir, destFileName);
              
              let counter = 1;
              while (fs.existsSync(destPath)) {
                destFileName = `${fileName}_invoice_${counter}.xml`;
                destPath = path.join(destDir, destFileName);
                counter++;
              }
              
              fs.writeFileSync(destPath, content);
              extractedCount++;
              resolve();
            } catch (err) {
              reject(err);
            }
          }));
        }
      });
      
      await Promise.all(promises);
      if (extractedCount > 0) {
        results.push({ file: path.basename(filePath), status: 'success', msg: `Đã trích xuất ${extractedCount} file invoice.xml` });
      } else {
        results.push({ file: path.basename(filePath), status: 'warning', msg: 'Không tìm thấy invoice.xml' });
      }
    } catch (err) {
      console.error(err);
      results.push({ file: path.basename(filePath), status: 'error', error: err.message });
    }
  }
  return results;
});
