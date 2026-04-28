// Configure PDF.js worker (required for pdf.js)
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.js';

const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const progressContainer = document.getElementById('progressContainer');
const progressTitle = document.getElementById('progressTitle');
const progressBar = document.getElementById('progressBar');
const resultsSection = document.getElementById('resultsSection');
const uploadAgainBtn = document.getElementById('uploadAgainBtn');
const resultsTableContainer = document.getElementById('resultsTableContainer');

let allResults = [];
let currentPage = 1;
const pageSize = 10;

let totalPagesCount = 0;
let processedPagesCount = 0;

function showUploadBtn() {
    uploadBtn.style.display = 'inline-block';
    fileInput.value = '';
    progressContainer.style.display = 'none';
    resultsSection.style.display = 'none';
    resultsTableContainer.innerHTML = '';
    totalPagesCount = 0;
    processedPagesCount = 0;
}

function showProgress(title, percent, color = '#4f8cff') {
    progressContainer.style.display = 'block';
    progressTitle.textContent = title;
    progressBar.style.width = percent + '%';
    progressBar.style.background = color;
}

function hideProgress() {
    progressContainer.style.display = 'none';
}

function getOverallProgress(currentFileProgress) {
    if (totalPagesCount === 0) return 0;
    const currentProgress = (processedPagesCount + currentFileProgress) / totalPagesCount;
    return Math.max(0, Math.min(100, Math.round(currentProgress * 100)));
}

function getFileStatusClass(result) {
    if (!result.ocrBlobUrl) return 'status-error';
    if (result.failedPages && result.failedPages.length > 0) return 'status-warning';
    return 'status-success';
}

function getFileStatusText(result) {
    if (!result.ocrBlobUrl) return '处理失败';
    if (result.failedPages && result.failedPages.length > 0) {
        return `部分失败 (第 ${result.failedPages.join(', ')} 页)`;
    }
    if (result.totalPages === 0) return '空文件';
    return '处理成功';
}

function getFileStatusIcon(result) {
    if (!result.ocrBlobUrl) return '❌';
    if (result.failedPages && result.failedPages.length > 0) return '⚠️';
    return '✅';
}

function showResults(results) {
    allResults = results;
    currentPage = 1;
    resultsSection.style.display = 'block';
    renderResultsTable();
}

function renderResultsTable() {
    const startIdx = (currentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, allResults.length);
    let tableHtml = `<table class="results-table">
        <tr>
            <th>Preview</th>
            <th>File Name</th>
            <th>Pages</th>
            <th>Status</th>
            <th>Download Corrected</th>
        </tr>`;
    for (let i = startIdx; i < endIdx; i++) {
        const res = allResults[i];
        let preview = res.previewDataUrl
            ? `<img src="${res.previewDataUrl}" class="pdf-preview" alt="PDF Preview">`
            : `<span class="pdf-placeholder">No preview</span>`;
        let pagesText = res.totalPages ? `${res.totalPages} 页` : '-';
        let statusClass = getFileStatusClass(res);
        let statusText = getFileStatusText(res);
        let statusIcon = getFileStatusIcon(res);
        let downloadBtn = res.ocrBlobUrl
            ? `<a href="${res.ocrBlobUrl}" download="${res.ocrFilename}" title="Download corrected PDF" class="ocr-download-btn">${downloadSvg()}</a>`
            : `<span style="color:#888;">无法下载</span>`;
        tableHtml += `<tr>
            <td>${preview}</td>
            <td>${res.filename}</td>
            <td>${pagesText}</td>
            <td class="status-cell ${statusClass}" title="${statusText}">${statusIcon} ${statusText}</td>
            <td>${downloadBtn}</td>
        </tr>`;
    }
    tableHtml += `</table>`;

    if (allResults.length > pageSize) {
        let pages = Math.ceil(allResults.length / pageSize);
        tableHtml += `<div class="pagination">
            <button class="pagination-btn" id="prevPageBtn" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>
            <span>Page ${currentPage} of ${pages}</span>
            <button class="pagination-btn" id="nextPageBtn" ${currentPage === pages ? 'disabled' : ''}>Next</button>
        </div>`;
    }

    resultsTableContainer.innerHTML = tableHtml;
    if (allResults.length > pageSize) {
        document.getElementById('prevPageBtn').onclick = () => { if (currentPage > 1) { currentPage--; renderResultsTable(); } };
        document.getElementById('nextPageBtn').onclick = () => { let pages = Math.ceil(allResults.length / pageSize); if (currentPage < pages) { currentPage++; renderResultsTable(); } };
    }
}

function downloadSvg() {
    return `<svg width="32" height="32" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="8" fill="#4f8cff"/><path d="M16 8v12m0 0l-4-4m4 4l4-4m-10 8h12" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function generateOcrFilename(originalName) {
    const lastDotIndex = originalName.lastIndexOf('.');
    let baseName, extension;
    
    if (lastDotIndex === -1) {
        baseName = originalName;
        extension = '';
    } else {
        baseName = originalName.substring(0, lastDotIndex);
        extension = originalName.substring(lastDotIndex);
    }
    
    if (!baseName) {
        baseName = 'document';
    }
    
    return baseName + '_OCR.pdf';
}

async function getFilePageCount(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const count = doc.numPages;
        return count;
    } catch (e) {
        console.error('Failed to get page count for', file.name, ':', e);
        return 0;
    }
}

async function processPDF(file, fileIndex, totalFiles) {
    const result = {
        filename: file.name,
        previewDataUrl: '',
        ocrBlobUrl: null,
        ocrFilename: generateOcrFilename(file.name),
        totalPages: 0,
        processedPages: 0,
        failedPages: []
    };

    let arrayBuffer;
    try {
        arrayBuffer = await file.arrayBuffer();
    } catch (e) {
        console.error('Failed to read file:', file.name, e);
        return result;
    }

    let doc;
    try {
        doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        result.totalPages = doc.numPages;
        
        const page1 = await doc.getPage(1);
        const viewport = page1.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page1.render({ canvasContext: ctx, viewport: viewport }).promise;
        result.previewDataUrl = canvas.toDataURL('image/png');
    } catch (e) {
        console.error('Failed to load PDF:', file.name, e);
        result.totalPages = 0;
        return result;
    }

    const { PDFDocument, rgb, StandardFonts } = PDFLib;
    let pdfDoc;
    let helveticaFont;
    try {
        pdfDoc = await PDFDocument.create();
        helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    } catch (e) {
        console.error('Failed to create PDF document:', e);
        return result;
    }

    const numPages = result.totalPages;

    for (let i = 1; i <= numPages; i++) {
        const pageProgress = (i - 1) / numPages;
        const overallPercent = getOverallProgress(pageProgress);
        showProgress(`OCR: ${file.name} (第 ${i}/${numPages} 页)`, overallPercent, '#34d49c');

        let page;
        try {
            page = await doc.getPage(i);
        } catch (e) {
            console.error(`Failed to get page ${i} of ${file.name}:`, e);
            result.failedPages.push(i);
            continue;
        }

        let imgDataUrl;
        try {
            const viewport = page.getViewport({ scale: 2 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;
            imgDataUrl = canvas.toDataURL('image/png');
        } catch (e) {
            console.error(`Failed to render page ${i} of ${file.name}:`, e);
            result.failedPages.push(i);
            continue;
        }

        let ocrResult = null;
        try {
            ocrResult = await Tesseract.recognize(
                imgDataUrl,
                'ita+eng',
                {
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            const ocrProgress = (i - 1 + m.progress) / numPages;
                            const overallOcrPercent = getOverallProgress(ocrProgress);
                            showProgress(`OCR: ${file.name} (第 ${i}/${numPages} 页, ${Math.round(m.progress * 100)}%)`, overallOcrPercent, '#34d49c');
                        }
                    }
                }
            );
        } catch (e) {
            console.error(`OCR error on page ${i} of ${file.name}:`, e);
            result.failedPages.push(i);
            continue;
        }

        try {
            const imgBytes = await fetch(imgDataUrl).then(r => r.arrayBuffer());
            const pdfImage = await pdfDoc.embedPng(imgBytes);
            const { width, height } = pdfImage;
            const pdfPage = pdfDoc.addPage([width, height]);
            pdfPage.drawImage(pdfImage, { x: 0, y: 0, width, height });

            if (ocrResult && ocrResult.data && Array.isArray(ocrResult.data.words)) {
                ocrResult.data.words.forEach(word => {
                    if (!word.text.trim()) return;
                    const x = word.bbox.x0;
                    const y = canvas.height - word.bbox.y1;
                    const boxHeight = word.bbox.y1 - word.bbox.y0;
                    const maxWidth = word.bbox.x1 - word.bbox.x0;
                    const fontSize = Math.max(7, Math.min(32, boxHeight * 0.85));
                    pdfPage.drawText(word.text, {
                        x: x,
                        y: y,
                        size: fontSize,
                        font: helveticaFont,
                        color: rgb(1, 1, 1),
                        opacity: 0.01,
                        maxWidth: maxWidth,
                        lineHeight: boxHeight * 1.05,
                    });
                });
            }
            
            result.processedPages++;
        } catch (e) {
            console.error(`Failed to add page ${i} to output PDF of ${file.name}:`, e);
            result.failedPages.push(i);
            continue;
        }
    }

    processedPagesCount += numPages;

    const finalPercent = getOverallProgress(1);
    showProgress(`保存中: ${file.name}`, finalPercent, '#34d49c');

    try {
        const pdfBytes = await pdfDoc.save();
        result.ocrBlobUrl = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
    } catch (e) {
        console.error('Failed to save output PDF:', file.name, e);
        result.ocrBlobUrl = null;
    }

    return result;
}

function filterFiles(files) {
    return Array.from(files).filter(f =>
        f.type === "application/pdf" &&
        !f.name.toLowerCase().endsWith('.lnk') &&
        f.name.toLowerCase().endsWith('.pdf')
    );
}

uploadBtn.onclick = () => fileInput.click();

fileInput.onchange = async function() {
    const files = filterFiles(fileInput.files);
    if (files.length === 0) {
        alert('Only original PDF files are accepted!');
        showUploadBtn();
        return;
    }

    uploadBtn.style.display = 'none';
    showProgress('计算总页数...', 0, '#4f8cff');

    totalPagesCount = 0;
    processedPagesCount = 0;
    const filePageCounts = [];
    
    for (let i = 0; i < files.length; i++) {
        showProgress(`计算总页数... (${i + 1}/${files.length})`, Math.round(((i) / files.length) * 100), '#4f8cff');
        const pageCount = await getFilePageCount(files[i]);
        filePageCounts.push(pageCount);
        totalPagesCount += pageCount;
    }
    
    showProgress(`总计 ${files.length} 个文件, ${totalPagesCount} 页`, 0, '#4f8cff');

    let results = [];
    
    for (let i = 0; i < files.length; i++) {
        const res = await processPDF(files[i], i + 1, files.length);
        results.push(res);
        
        const currentPercent = getOverallProgress(1);
        showProgress(`处理完成 ${i + 1}/${files.length} 个文件`, currentPercent, '#34d49c');
    }

    hideProgress();
    showResults(results);
};

uploadAgainBtn.onclick = showUploadBtn;

showUploadBtn();
