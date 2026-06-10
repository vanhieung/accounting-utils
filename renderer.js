const btnSelectFiles = document.getElementById('btnSelectFiles');
const fileList = document.getElementById('fileList');
const btnSelectDest = document.getElementById('btnSelectDest');
const destPathEl = document.getElementById('destPath');
const btnExtract = document.getElementById('btnExtract');
const statusContainer = document.getElementById('statusContainer');
const resultsList = document.getElementById('resultsList');

let selectedFiles = [];
let destDirectory = null;

// Handle native file selection dialog
btnSelectFiles.addEventListener('click', async () => {
  const files = await window.api.selectZips();
  if (files && files.length > 0) {
    files.forEach(file => {
      if (!selectedFiles.some(f => f.path === file.path)) {
        selectedFiles.push(file);
      }
    });
    updateFileList();
    checkReady();
  }
});

function updateFileList() {
  fileList.innerHTML = '';
  selectedFiles.forEach((file, index) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${file.name}</span> <span style="color:var(--error);cursor:pointer;" id="remove-btn-${index}">Xóa</span>`;
    fileList.appendChild(li);
    document.getElementById(`remove-btn-${index}`).addEventListener('click', () => {
      removeFile(index);
    });
  });
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  updateFileList();
  checkReady();
}

// Handle Directory Selection
btnSelectDest.addEventListener('click', async () => {
  const dir = await window.api.selectDirectory();
  if (dir) {
    destDirectory = dir;
    destPathEl.textContent = dir;
    checkReady();
  }
});

function checkReady() {
  if (selectedFiles.length > 0 && destDirectory) {
    btnExtract.disabled = false;
  } else {
    btnExtract.disabled = true;
  }
}

// Extract Files
btnExtract.addEventListener('click', async () => {
  btnExtract.disabled = true;
  btnExtract.textContent = 'Đang trích xuất...';
  statusContainer.style.display = 'none';
  resultsList.innerHTML = '';

  const paths = selectedFiles.map(f => f.path);
  
  const results = await window.api.extractZips({
    filePaths: paths,
    destDir: destDirectory
  });

  statusContainer.style.display = 'block';
  
  results.forEach(res => {
    const li = document.createElement('li');
    if (res.status === 'success') {
      li.innerHTML = `<span>${res.file}</span> <span class="status-success">${res.msg}</span>`;
    } else if (res.status === 'warning') {
      li.innerHTML = `<span>${res.file}</span> <span class="status-warning">${res.msg}</span>`;
    } else {
      li.innerHTML = `<span>${res.file}</span> <span class="status-error">Thất bại: ${res.error}</span>`;
    }
    resultsList.appendChild(li);
  });

  btnExtract.textContent = 'Bắt đầu Giải nén';
  checkReady();
  
  // Clear selection after success
  selectedFiles = [];
  updateFileList();
  checkReady();
});

const btnOpenBatchDownload = document.getElementById('btnOpenBatchDownload');
if (btnOpenBatchDownload) {
  btnOpenBatchDownload.addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openBatchDownload();
  });
}
