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
      } else {
        results.push({ success: false, invoiceNumber: item.invoiceNumber, reason: result.reason });
      }
    } catch(err) {
      results.push({ success: false, invoiceNumber: item.invoiceNumber, reason: err.message });
    } finally {
      // Xóa XML sau khi xử lý (bất kể thành công hay thất bại để clean hết)
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
