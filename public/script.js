const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('fileInput');
const filePreview = document.getElementById('file-preview');
const fileNameDisplay = document.getElementById('file-name');
const fileSizeDisplay = document.getElementById('file-size');
const uploadBtn = document.getElementById('upload-btn');
const loader = document.getElementById('loader');
const resultContainer = document.getElementById('result-container');
const uploadGrid = document.querySelector('.upload-grid');
const resetBtn = document.getElementById('reset-btn');

let selectedFile = null;

// Trigger file input on click
dropZone.addEventListener('click', () => fileInput.click());

// Handle Drag & Drop
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
        handleFileSelect(e.dataTransfer.files[0]);
    }
});

// Handle File input change
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileSelect(e.target.files[0]);
    }
});

function handleFileSelect(file) {
    selectedFile = file;
    fileNameDisplay.textContent = file.name;
    fileSizeDisplay.textContent = formatBytes(file.size);
    filePreview.classList.remove('hidden');

    // Change icon based on extension
    const icon = filePreview.querySelector('i');
    const ext = file.name.split('.').pop().toLowerCase();
    icon.className = getFileIcon(ext);
}

async function uploadFile() {
    if (!selectedFile) return;

    const provider = document.querySelector('input[name="provider"]:checked').value;
    const folderId = document.getElementById('folderId').value;

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('provider', provider);
    if (folderId) formData.append('folderId', folderId);

    loader.classList.remove('hidden');

    try {
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            showResult(data);
        } else {
            alert('Upload failed: ' + data.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred during upload.');
    } finally {
        loader.classList.add('hidden');
    }
}

function showResult(data) {
    uploadGrid.classList.add('hidden');
    document.querySelector('header').classList.add('hidden');
    resultContainer.classList.remove('hidden');

    document.getElementById('res-id').textContent = data.fileId;
    document.getElementById('res-provider').textContent = data.provider;

    const viewLink = document.getElementById('view-link');
    const downloadLink = document.getElementById('download-link');
    const copyBtn = document.getElementById('copy-btn');
    const viewUrlDisplay = document.getElementById('res-view-url');
    const downloadUrlDisplay = document.getElementById('res-download-url');

    // Use our new proxy URLs if available, otherwise fallback to direct links
    const finalViewUrl = data.viewUrl || data.permalink;
    const finalDownloadUrl = data.downloadUrl || data.permalink;

    if (finalViewUrl) {
        viewLink.href = finalViewUrl;
        viewLink.style.display = 'flex';
        viewUrlDisplay.textContent = finalViewUrl;

        // Handle Copy URL
        copyBtn.style.display = 'flex';
        copyBtn.onclick = () => {
            const fullUrl = finalViewUrl.startsWith('http') ? finalViewUrl : window.location.origin + finalViewUrl;
            navigator.clipboard.writeText(fullUrl).then(() => {
                const originalText = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                copyBtn.classList.replace('btn-tertiary', 'btn-secondary');
                setTimeout(() => {
                    copyBtn.innerHTML = originalText;
                    copyBtn.classList.replace('btn-secondary', 'btn-tertiary');
                }, 2000);
            });
        };
    } else {
        viewLink.style.display = 'none';
        viewUrlDisplay.textContent = '---';
        copyBtn.style.display = 'none';
    }

    if (finalDownloadUrl) {
        downloadLink.href = finalDownloadUrl;
        downloadLink.style.display = 'flex';
        downloadUrlDisplay.textContent = finalDownloadUrl;
        // Force download attribute for the download link
        downloadLink.setAttribute('download', data.filename || 'file');
    } else {
        downloadLink.style.display = 'none';
        downloadUrlDisplay.textContent = '---';
    }
}

resetBtn.addEventListener('click', () => {
    resultContainer.classList.add('hidden');
    uploadGrid.classList.remove('hidden');
    document.querySelector('header').classList.remove('hidden');
    filePreview.classList.add('hidden');
    selectedFile = null;
    fileInput.value = '';
});

uploadBtn.addEventListener('click', uploadFile);

// Helpers
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function getFileIcon(ext) {
    const map = {
        'pdf': 'far fa-file-pdf',
        'doc': 'far fa-file-word',
        'docx': 'far fa-file-word',
        'xls': 'far fa-file-excel',
        'xlsx': 'far fa-file-excel',
        'png': 'far fa-file-image',
        'jpg': 'far fa-file-image',
        'jpeg': 'far fa-file-image',
        'zip': 'far fa-file-archive',
        'mp4': 'far fa-file-video'
    };
    return (map[ext] || 'far fa-file') + ' ' + 'fa-2x';
}

// Interactive Provider Selection
document.querySelectorAll('.provider-card').forEach(card => {
    card.addEventListener('click', () => {
        document.querySelectorAll('.provider-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
    });
});
