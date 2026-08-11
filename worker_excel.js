const { parentPort, workerData } = require('worker_threads');
const { processInvoiceXMLFile } = require('./invoice_matcher');
const fs = require('fs');
const path = require('path');

const { items, activeMst } = workerData;

async function processItems() {
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
          await fs.promises.unlink(item.xmlPath);
        } catch (e) {
          console.error('Không thể xóa file XML:', e);
        }
      } else {
        results.push({ success: false, invoiceNumber: item.invoiceNumber, reason: result.reason });
      }
    } catch(err) {
      results.push({ success: false, invoiceNumber: item.invoiceNumber, reason: err.message });
    }
    
    // Báo cho main thread biết 1 file đã xong
    parentPort.postMessage({ type: 'item_done' });
  }
  
  parentPort.postMessage({ type: 'done', data: results });
}

processItems();
