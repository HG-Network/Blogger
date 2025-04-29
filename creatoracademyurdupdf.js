// Set PDF.js worker path
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.12.313/pdf.worker.min.js';
    
    // DOM elements
    const fileInput = document.getElementById('fileInput');
    const dropZone = document.getElementById('dropZone');
    const progressBar = document.getElementById('progressBar');
    const statusText = document.getElementById('statusText');
    const statusEmoji = document.getElementById('statusEmoji');
    const resultsContainer = document.getElementById('resultsContainer');
    const fileList = document.getElementById('fileList');
    const fileStats = document.getElementById('fileStats');
    const redirectNotice = document.getElementById('redirectNotice');
    
    // Document type patterns (updated with enhanced LEDGER pattern)
    const DOCUMENT_PATTERNS = [
        {
            name: "QUOT",
            regex: /Q\.(\d+)/i,
            filename: (match) => `QUOT ${match[1]}`,
            csvValue: (match) => `QUOT ${match[1]}`,
            sortKey: (match) => parseInt(match[1], 10)
        },
        {
            name: "WARRANTY INV",
            regex: /Sales Tax Invoice (\d+)/i,
            filename: (match) => `WARRANTY INV ${match[1]}`,
            csvValue: (match) => `WARRANTY INV ${match[1]}`,
            sortKey: (match) => parseInt(match[1], 10)
        },
        {
            name: "Ledger",
            regex: /Global Distributor LEDGER.*?(\d{2}-\d{4})/i,
            filename: (match) => `${match[1]}`,
            csvValue: (match) => `${match[1]}`,
            sortKey: (match) => match[1],
            mergeAdjacent: true
        },
        {
            name: "Ledger",
            regex: /(\d{2}-\d{2}-\d{2}-\d{4}-\d{4})/,
            filename: (match) => match[1],
            csvValue: (match) => match[1],
            sortKey: (match) => match[1],
            mergeAdjacent: true
        },
        {
            name: "Ledger",
            regex: /LEDGER.*?(\d{2}-\d{4})/i,
            filename: (match) => `${match[1]}`,
            csvValue: (match) => `${match[1]}`,
            sortKey: (match) => match[1],
            mergeAdjacent: true
        }
    ];
    
    // State variables
    let extractedData = {};
    let totalPages = 0;
    let processedPages = 0;
    let originalPdfBytes = null;
    
    // Event listeners
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    dropZone.addEventListener('dragover', handleDragOver);
    dropZone.addEventListener('drop', handleDrop);
    
    // Cute emoji states
    const emojiStates = {
        ready: "😊",
        processing: "⏳",
        searching: "🔍",
        extracting: "📂",
        success: "🎉",
        error: "❌"
    };
    
    // Functions
    function updateStatus(text, emoji) {
        statusText.textContent = text;
        statusEmoji.textContent = emoji || emojiStates.ready;
        
        if (emoji === emojiStates.processing) {
            statusEmoji.classList.add('processing-character');
        } else {
            statusEmoji.classList.remove('processing-character');
        }
    }
    
    function handleFileSelect(event) {
        const file = event.target.files[0];
        if (file && file.type === 'application/pdf') {
            processPDF(file);
        }
    }
    
    function handleDragOver(event) {
        event.preventDefault();
        event.stopPropagation();
        dropZone.style.backgroundColor = '#f0f8ff';
    }
    
    function handleDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        dropZone.style.backgroundColor = '';
        
        const file = event.dataTransfer.files[0];
        if (file && file.type === 'application/pdf') {
            processPDF(file);
        }
    }
    
    async function extractPaySlipInfo(pageText) {
        updateStatus("Looking for employee info...", emojiStates.searching);
        
        const nameMatch = pageText.match(/Employee Name\s*:\s*([A-Za-z\s]+)/i);
        const employeeName = nameMatch ? nameMatch[1].trim() : null;
        
        const codeMatch = pageText.match(/Employee Code\s*:\s*(\d{2,8})/i);
        const employeeCode = codeMatch ? codeMatch[1] : null;
        
        let filename = "PAY SLIP";
        let csvValue = "PAY SLIP";
        
        if (employeeName && employeeCode) {
            filename = `PaySlip ${employeeName} Emp ${employeeCode}`;
            csvValue = `PaySlip ${employeeName} (${employeeCode})`;
        } else if (employeeName) {
            filename = `PaySlip ${employeeName}`;
            csvValue = `PaySlip ${employeeName}`;
        } else if (employeeCode) {
            filename = `PaySlip ${employeeCode}`;
            csvValue = `PaySlip ${employeeCode}`;
        } else {
            return null;
        }
        
        return {
            type: "PAY SLIP",
            filename: filename,
            csvValue: csvValue,
            sortKey: employeeCode || employeeName,
            rawMatch: nameMatch?.[0] || codeMatch?.[0]
        };
    }
    
    async function processPDF(file) {
        extractedData = {};
        processedPages = 0;
        resultsContainer.style.display = 'none';
        redirectNotice.style.display = 'none';
        
        try {
            updateStatus('Loading PDF...', emojiStates.processing);
            
            originalPdfBytes = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument(originalPdfBytes).promise;
            totalPages = pdf.numPages;
            
            updateStatus(`Processing 0/${totalPages} pages...`, emojiStates.extracting);
            progressBar.style.width = '0%';
            
            // First pass: Extract all document info
            const pageInfos = [];
            for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                try {
                    const page = await pdf.getPage(pageNum);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    
                    let docInfo = await extractPaySlipInfo(pageText);
                    
                    if (!docInfo) {
                        for (const pattern of DOCUMENT_PATTERNS) {
                            const match = pageText.match(pattern.regex);
                            if (match) {
                                docInfo = {
                                    type: pattern.name,
                                    filename: pattern.filename(match),
                                    csvValue: pattern.csvValue(match),
                                    sortKey: pattern.sortKey(match),
                                    rawMatch: match[0],
                                    mergeAdjacent: pattern.mergeAdjacent || false
                                };
                                break;
                            }
                        }
                    }
                    
                    pageInfos.push({
                        pageNum,
                        docInfo,
                        pageText
                    });
                    
                    processedPages++;
                    const progress = Math.round((processedPages / totalPages) * 100);
                    progressBar.style.width = `${progress}%`;
                    updateStatus(`Processing ${processedPages}/${totalPages} pages...`, emojiStates.processing);
                    
                } catch (error) {
                    console.error(`Error processing page ${pageNum}:`, error);
                    pageInfos.push({ pageNum, docInfo: null });
                    processedPages++;
                }
            }
            
            // Second pass: Merge adjacent pages for ledger documents
            let currentLedger = null;
            for (let i = 0; i < pageInfos.length; i++) {
                const { pageNum, docInfo } = pageInfos[i];
                
                if (docInfo && docInfo.mergeAdjacent) {
                    // Found a ledger document
                    const key = `${docInfo.type}|${docInfo.sortKey}`;
                    
                    if (!extractedData[key]) {
                        extractedData[key] = {
                            filename: docInfo.filename,
                            csvValue: docInfo.csvValue,
                            type: docInfo.type,
                            sortKey: docInfo.sortKey,
                            pages: new Set([pageNum])
                        };
                        currentLedger = key;
                    } else {
                        extractedData[key].pages.add(pageNum);
                        currentLedger = key;
                    }
                } else if (currentLedger && !docInfo) {
                    // No document info but previous page was a ledger - merge it
                    extractedData[currentLedger].pages.add(pageNum);
                } else {
                    // Regular document processing
                    if (docInfo) {
                        const key = `${docInfo.type}|${pageNum}|${docInfo.sortKey}`;
                        if (!extractedData[key]) {
                            extractedData[key] = {
                                filename: docInfo.filename,
                                csvValue: docInfo.csvValue,
                                type: docInfo.type,
                                sortKey: docInfo.sortKey,
                                pages: new Set([pageNum])
                            };
                        }
                    }
                    currentLedger = null;
                }
            }
            
            updateStatus('Creating output files...', emojiStates.processing);
            await createAndDownloadOutputFiles(extractedData);
            
        } catch (error) {
            console.error('Error processing PDF:', error);
            updateStatus('Error processing PDF. Please try another file.', emojiStates.error);
        }
    }
    
    async function createAndDownloadOutputFiles(extractedData) {
        try {
            const zip = new JSZip();
            const csvData = [];
            
            const originalPdfDoc = await PDFLib.PDFDocument.load(originalPdfBytes);
            
            // Sort documents by type and sortKey
            const sortedEntries = Object.entries(extractedData).sort((a, b) => {
                const [aKey, aData] = a;
                const [bKey, bData] = b;
                
                // First sort by type
                if (aData.type < bData.type) return -1;
                if (aData.type > bData.type) return 1;
                
                // Then sort by sortKey
                if (typeof aData.sortKey === 'number' && typeof bData.sortKey === 'number') {
                    return aData.sortKey - bData.sortKey;
                }
                return String(aData.sortKey).localeCompare(String(bData.sortKey));
            });
            
            // Process documents in parallel for better performance
            const processingPromises = sortedEntries.map(async ([identifier, data]) => {
                const { pages, filename, csvValue } = data;
                const pageArray = Array.from(pages).sort((a, b) => a - b);
                
                const newPdfDoc = await PDFLib.PDFDocument.create();
                for (const pageNum of pageArray) {
                    try {
                        const [copiedPage] = await newPdfDoc.copyPages(originalPdfDoc, [pageNum - 1]);
                        newPdfDoc.addPage(copiedPage);
                    } catch (error) {
                        console.error(`Error copying page ${pageNum}:`, error);
                    }
                }
                
                const pdfBytes = await newPdfDoc.save();
                let uniqueFilename = filename;
                let counter = 1;
                while (zip.file(`${uniqueFilename}.pdf`)) {
                    uniqueFilename = `${filename}_${counter}`;
                    counter++;
                }
                
                return {
                    filename: uniqueFilename,
                    pdfBytes,
                    csvValue,
                    pageArray
                };
            });
            
            // Wait for all documents to be processed
            const processedDocuments = await Promise.all(processingPromises);
            
            // Add files to zip
            for (const doc of processedDocuments) {
                zip.file(`${doc.filename}.pdf`, doc.pdfBytes);
                csvData.push([doc.csvValue, ...doc.pageArray]);
            }
            
            if (csvData.length > 0) {
                const csvContent = "Document,Pages\n" + csvData.map(row => `${row[0]},${row.slice(1).join(',')}`).join('\n');
                zip.file('extracted_data.csv', csvContent);
            }
            
            const content = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'extracted_documents.zip';
            document.body.appendChild(a);
            a.click();
            
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                updateStatus('Download complete!', emojiStates.success);
                showResults(extractedData);
                
                // Show redirect notice and redirect after 5 seconds
                redirectNotice.style.display = 'block';
                setTimeout(() => {
                    window.location.href = "https://creatoracademyurdu.blogspot.com/2025/03/advanced-pdf-processor.html";
                }, 1000);
            }, 100);
            
        } catch (error) {
            console.error('Error generating output files:', error);
            updateStatus('Error generating output files. Please try again.', emojiStates.error);
        }
    }
    
    function showResults(extractedData) {
        resultsContainer.style.display = 'block';
        const docCounts = {};
        Object.values(extractedData).forEach(data => {
            docCounts[data.type] = (docCounts[data.type] || 0) + 1;
        });
        
        fileStats.innerHTML = `
            <p>Processed ${totalPages} pages</p>
            ${Object.entries(docCounts).map(([type, count]) => 
                `<p>Found ${count} ${type} documents</p>`).join('')}
            <p>Download should start automatically</p>
        `;
        
        fileList.innerHTML = '';
        Object.entries(extractedData).forEach(([identifier, data]) => {
            const div = document.createElement('div');
            div.className = 'file-item';
            div.innerHTML = `
                <strong>${data.filename}.pdf</strong> - Pages: ${Array.from(data.pages).join(', ')}
            `;
            fileList.appendChild(div);
        });
    }
