// Set PDF.js worker path
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.12.313/pdf.worker.min.js';
        
        // DOM elements
        const fileInput = document.getElementById('fileInput');
        const dropZone = document.getElementById('dropZone');
        const progressBar = document.getElementById('progressBar');
        const statusText = document.getElementById('statusText');
        const resultsContainer = document.getElementById('resultsContainer');
        const fileList = document.getElementById('fileList');
        const fileStats = document.getElementById('fileStats');
        
        // Document type patterns
        const DOCUMENT_PATTERNS = [
            {
                name: "QUOT",
                regex: /Q\.(\d+)/i,
                filename: (match) => `QUOT ${match[1]}`,
                csvValue: (match) => match[1],
                sortKey: (match) => parseInt(match[1], 10)
            },
            {
                name: "WARRANTY INV",
                regex: /Sales Tax Invoice (\d+)/i,
                filename: (match) => `WARRANTY INV ${match[1]}`,
                csvValue: (match) => match[1],
                sortKey: (match) => parseInt(match[1], 10)
            },
            {
                name: "Ledger",
                regex: /Global Distributor LEDGER.*?(\d{2}-\d{4})/i,
                filename: (match) => match[1],
                csvValue: (match) => match[1],
                sortKey: (match) => match[1]
            },
            {
                name: "Ledger",
                regex: /(\d{2}-\d{2}-\d{2}-\d{4}-\d{4})/,
                filename: (match) => match[1],
                csvValue: (match) => match[1],
                sortKey: (match) => match[1]
            }
        ];
        
        // State variables
        let extractedData = {};
        let totalPages = 0;
        let processedPages = 0;
        let originalPdfBytes = null;
        let pageCodeMap = {};
        
        // Event listeners
        dropZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', handleFileSelect);
        dropZone.addEventListener('dragover', handleDragOver);
        dropZone.addEventListener('drop', handleDrop);
        
        // Functions
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
        
        function identifyDocumentType(pageText) {
            for (const pattern of DOCUMENT_PATTERNS) {
                const match = pageText.match(pattern.regex);
                if (match) {
                    return {
                        type: pattern.name,
                        filename: pattern.filename(match),
                        csvValue: pattern.csvValue(match),
                        rawMatch: match[0],
                        sortKey: pattern.sortKey(match)
                    };
                }
            }
            return null;
        }
        
        async function processPDF(file) {
            // Reset state
            extractedData = {};
            pageCodeMap = {};
            processedPages = 0;
            resultsContainer.style.display = 'none';
            
            try {
                updateStatus('Loading PDF...');
                
                // Read the original PDF bytes for later extraction
                originalPdfBytes = await file.arrayBuffer();
                
                // Load PDF for text extraction
                const pdf = await pdfjsLib.getDocument(originalPdfBytes).promise;
                totalPages = pdf.numPages;
                
                updateStatus(`Processing 0/${totalPages} pages...`);
                progressBar.style.width = '0%';
                
                // First pass: Identify all document identifiers and their pages
                for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                    try {
                        const page = await pdf.getPage(pageNum);
                        const textContent = await page.getTextContent();
                        const pageText = textContent.items.map(item => item.str).join(' ');
                        
                        // Identify document type
                        const docInfo = identifyDocumentType(pageText);
                        
                        // Map page to its identifiers
                        pageCodeMap[pageNum] = docInfo ? [docInfo] : [];
                        
                        // Map identifiers to their pages (without duplicates per page)
                        if (docInfo) {
                            const key = `${docInfo.type}|${docInfo.csvValue}`;
                            if (!extractedData[key]) {
                                extractedData[key] = {
                                    filename: docInfo.filename,
                                    csvValue: docInfo.csvValue,
                                    type: docInfo.type,
                                    sortKey: docInfo.sortKey,
                                    pages: new Set()
                                };
                            }
                            extractedData[key].pages.add(pageNum);
                        }
                        
                        processedPages++;
                        const progress = Math.round((processedPages / totalPages) * 100);
                        progressBar.style.width = `${progress}%`;
                        updateStatus(`Processing ${processedPages}/${totalPages} pages...`);
                        
                    } catch (error) {
                        console.error(`Error processing page ${pageNum}:`, error);
                    }
                }
                
                // Second pass: Group all pages until next document starts
                const finalOutput = groupAllPagesUntilNextDocument(extractedData, pageCodeMap, totalPages);
                
                // Processing complete
                updateStatus('Creating output files...');
                await createAndDownloadOutputFiles(finalOutput);
                
            } catch (error) {
                console.error('Error processing PDF:', error);
                updateStatus('Error processing PDF. Please try another file.');
            }
        }
        
        function groupAllPagesUntilNextDocument(extractedData, pageCodeMap, totalPages) {
            const result = {};
            
            // Convert extractedData to array and sort by document identifier
            const sortedIdentifiers = Object.keys(extractedData).sort((a, b) => {
                return extractedData[a].sortKey > extractedData[b].sortKey ? 1 : -1;
            });

            // Process each document type in order
            for (const identifier of sortedIdentifiers) {
                const { pages: pageSet, filename, csvValue, type, sortKey } = extractedData[identifier];
                const pages = Array.from(pageSet).sort((a, b) => a - b);
                const documentPages = new Set(pages);
                
                // Find the first page of this document
                const firstPage = pages[0];
                
                // Include all pages from first page until next document starts
                let currentPage = firstPage;
                while (currentPage <= totalPages) {
                    // Add current page to document
                    documentPages.add(currentPage);
                    
                    // Check if next page starts a new document
                    const nextPage = currentPage + 1;
                    if (nextPage > totalPages) break;
                    
                    const nextPageIdentifiers = pageCodeMap[nextPage] || [];
                    if (nextPageIdentifiers.length > 0) {
                        const nextDocInfo = nextPageIdentifiers[0];
                        if (nextDocInfo.sortKey > sortKey) {
                            // Next page starts a new document - stop here
                            break;
                        }
                    }
                    
                    currentPage = nextPage;
                }
                
                // Convert to sorted array
                const finalPages = Array.from(documentPages).sort((a, b) => a - b);
                
                // Add to results
                result[identifier] = {
                    pages: finalPages,
                    filename: filename,
                    csvValue: csvValue,
                    type: type
                };
            }
            
            return result;
        }
        
        async function createAndDownloadOutputFiles(groupedPages) {
            try {
                const zip = new JSZip();
                const csvData = [];
                
                // Load the original PDF with pdf-lib
                const originalPdfDoc = await PDFLib.PDFDocument.load(originalPdfBytes);
                
                // For each document group, create a PDF with its pages
                for (const [identifier, data] of Object.entries(groupedPages)) {
                    const { pages, filename, csvValue } = data;
                    
                    // Create a new PDF document
                    const newPdfDoc = await PDFLib.PDFDocument.create();
                    
                    // Copy pages from original PDF (convert to 0-based index)
                    for (const pageNum of pages) {
                        const [copiedPage] = await newPdfDoc.copyPages(originalPdfDoc, [pageNum - 1]);
                        newPdfDoc.addPage(copiedPage);
                    }
                    
                    // Save the new PDF
                    const pdfBytes = await newPdfDoc.save();
                    
                    // Add to ZIP
                    zip.file(`${filename}.pdf`, pdfBytes);
                    
                    // Add to CSV data (just the identifier value)
                    csvData.push([csvValue]);
                }
                
                // Add CSV to ZIP (single column with identifier values)
                const csvContent = csvData.map(row => row.join(',')).join('\n');
                zip.file('extracted_data.csv', csvContent);
                
                // Generate and download ZIP automatically
                const content = await zip.generateAsync({ type: 'blob' });
                const url = URL.createObjectURL(content);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'extracted_documents.zip';
                document.body.appendChild(a);
                a.click();
                
                // Clean up
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    updateStatus('Download complete!');
                    
                    // Show results summary
                    showResults(groupedPages);
                }, 100);
                
            } catch (error) {
                console.error('Error generating output files:', error);
                updateStatus('Error generating output files. Please try again.');
            }
        }
        
        function showResults(groupedPages) {
            resultsContainer.style.display = 'block';
            
            // Count unique documents by type
            const docCounts = {};
            Object.values(groupedPages).forEach(data => {
                docCounts[data.type] = (docCounts[data.type] || 0) + 1;
            });
            
            // Display statistics
            fileStats.innerHTML = `
                <p>Processed ${totalPages} pages</p>
                ${Object.entries(docCounts).map(([type, count]) => 
                    `<p>Found ${count} ${type} documents</p>`).join('')}
                <p>Download should start automatically</p>
            `;
            
            // Display file list
            fileList.innerHTML = '';
            Object.entries(groupedPages).forEach(([identifier, data]) => {
                const div = document.createElement('div');
                div.className = 'file-item';
                div.innerHTML = `
                    <strong>${data.filename}</strong> - Pages: ${data.pages.join(', ')}
                `;
                fileList.appendChild(div);
            });
        }
        
        function updateStatus(text) {
            statusText.textContent = text;
        }
