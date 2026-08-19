const { parentPort, workerData } = require('worker_threads');
const { processInvoiceXMLFile } = require('./invoice_matcher');
const fs = require('fs');
const path = require('path');

const { items, activeMst } = workerData;

async function processItems() {
  const results = [];

  for (const item of items) {
    let success = false;
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
        success = true;
        results.push({
          success: true,
          invoiceNumber: item.invoiceNumber,
          xmlPath: item.xmlPath,
          outputName: path.basename(result.outputPath),
          outputPath: result.outputPath
        });
      } else {
        results.push({ success: false, invoiceNumber: item.invoiceNumber, xmlPath: item.xmlPath, reason: result.reason });
      }
    } catch (err) {
      results.push({ success: false, invoiceNumber: item.invoiceNumber, xmlPath: item.xmlPath, reason: err.message });
    }

    // Chỉ xóa XML sau khi EXPORT THÀNH CÔNG.
    // Nếu export thất bại, giữ lại XML để người dùng có thể thử lại
    // (trước đây xóa cả khi thất bại → mất dữ liệu gốc không thể khôi phục).
    if (success) {
      try {
        if (fs.existsSync(item.xmlPath)) {
          await fs.promises.unlink(item.xmlPath);
        }
      } catch (e) {
        console.error('Không thể xóa file XML:', e);
      }
    }

    // Báo cho main thread biết 1 file đã xong
    parentPort.postMessage({ type: 'item_done' });
  }

  parentPort.postMessage({ type: 'done', data: results });
}

processItems();
