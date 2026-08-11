const { parentPort, workerData } = require('worker_threads');
const { processInvoiceXMLFile } = require('./invoice_matcher');
const fs = require('fs');
const path = require('path');

const { items, activeMst } = workerData;
const results = [];

for (const item of items) {
  try {
    const result = processInvoiceXMLFile(
      item.xmlPath, 
      item.templateDir, 
      item.invoiceType, 
      null, 
      activeMst, 
      item.template
    );
    
    if (result.success) {
      results.push({ 
        success: true, 
        invoiceNumber: item.invoiceNumber, 
        outputName: path.basename(result.outputPath),
        outputPath: result.outputPath
      });
      // Di chuyển XML vào thư mục .backup thay vì xóa — cho phép phục hồi nếu Excel bị lỗi
      try {
        const xmlDir = path.dirname(item.xmlPath);
        const backupDir = path.join(xmlDir, '.backup');
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }
        const backupPath = path.join(backupDir, path.basename(item.xmlPath));
        fs.renameSync(item.xmlPath, backupPath);
      } catch (e) {
        // Nếu rename thất bại (cross-device), fallback copy + delete
        try {
          const xmlDir = path.dirname(item.xmlPath);
          const backupDir = path.join(xmlDir, '.backup');
          if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
          }
          fs.copyFileSync(item.xmlPath, path.join(backupDir, path.basename(item.xmlPath)));
          fs.unlinkSync(item.xmlPath);
        } catch (e2) { /* best-effort backup */ }
      }
    } else {
      results.push({ success: false, invoiceNumber: item.invoiceNumber, reason: result.reason });
    }
  } catch(err) {
    results.push({ success: false, invoiceNumber: item.invoiceNumber, reason: err.message });
  }
  
  // Gửi tiến độ về cho main thread
  parentPort.postMessage({ type: 'progress', data: { completed: results.length, total: items.length } });
}

parentPort.postMessage({ type: 'done', data: results });
