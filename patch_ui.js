const fs = require('fs');
const path = require('path');

const preloadPath = path.join(__dirname, 'preload.js');
let content = fs.readFileSync(preloadPath, 'utf8');

// 1. Cải thiện Thiết kế Trực quan (Glassmorphism & Animation)
content = content.replace(
  /\.panel\s*\{[^}]+\}/,
  `.panel {
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
  }`
);

content = content.replace(
  /\.header\s*\{[^}]+\}/,
  `.header {
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
  }`
);

content = content.replace(
  /\.progress-bar-fill\s*\{[^}]+\}/,
  `.progress-bar-fill {
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
  }`
);

// Thêm Font Inter vào HTML nếu chưa có
if (!content.includes('fonts.googleapis.com')) {
  content = content.replace(
    /this\.shadow\.innerHTML = `/,
    `this.shadow.innerHTML = \`
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
      </style>`
  );
}

// 2. Thêm Preview & báo cáo tiến độ chi tiết (Export Worker Progress)
// Tìm logic gọi exportExcelBatch để chèn tiến độ
const exportCallRegex = /const results = await window\.electronAPI\.exportExcelBatch\(this\.pendingReviews\);/g;
if (exportCallRegex.test(content)) {
  const replacement = `
            // Cập nhật trạng thái tiến độ chi tiết
            const statusEl = this.shadow.getElementById('review-status');
            statusEl.innerHTML = '<span style="color:#b06000;">Đang xử lý xuất Excel (Worker)... 0%</span>';
            
            // Lắng nghe progress từ Worker
            const removeListener = window.electronAPI.onExportProgress((progress) => {
              const percent = Math.round((progress.completed / progress.total) * 100);
              statusEl.innerHTML = \`<span style="color:#0052cc;">Đang xuất: \${progress.completed} / \${progress.total} (\${percent}%)</span>\`;
            });

            const results = await window.electronAPI.exportExcelBatch(this.pendingReviews);
            removeListener();
  `;
  content = content.replace(exportCallRegex, replacement.trim());
}

fs.writeFileSync(preloadPath, content, 'utf8');
console.log('UI Patched Successfully!');
