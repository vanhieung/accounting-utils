const { app, BrowserWindow, session, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const JSZip = require('jszip');

// Cấu hình thư mục lưu mặc định
let downloadDestination = path.join(app.getPath('downloads'), 'InvoicesAuto');
if (!fs.existsSync(downloadDestination)) {
  fs.mkdirSync(downloadDestination, { recursive: true });
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
    icon: path.join(__dirname, 'app_icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: 'persist:invoice-session'
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
  pendingOperations = pendingOperations.filter(op => now - op.timestamp < 60000);

  pendingOperations.push({
    operationId: payload.operationId,
    timestamp: now
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

ipcMain.handle('get-widget-icon', async () => {
  try {
    const iconPath = path.join(__dirname, 'widget_icon.png');
    const data = await fsPromises.readFile(iconPath);
    return `data:image/png;base64,${data.toString('base64')}`;
  } catch (e) {
    return null;
  }
});

