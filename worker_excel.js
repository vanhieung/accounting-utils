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
    } else {
      results.push({ success: false, invoiceNumber: item.invoiceNumber, reason: result.reason });
    }
    
    // Luôn luôn dọn dẹp file XML sau khi xử lý xong (kể cả thành công hay thất bại) theo yêu cầu
    try {
      fs.unlinkSync(item.xmlPath);
    } catch (e) {}
  } catch(err) {
    results.push({ success: false, invoiceNumber: item.invoiceNumber, reason: err.message });
  }
  
  // Gửi tiến độ về cho main thread
  parentPort.postMessage({ type: 'progress', data: { completed: results.length, total: items.length } });
}

parentPort.postMessage({ type: 'done', data: results });
