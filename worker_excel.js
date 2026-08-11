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
      // Xóa XML sau khi xuất Excel thành công
      try {
        fs.unlinkSync(item.xmlPath);
      } catch (e) {
        console.error('Không thể xóa file XML:', e);
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
