const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxbeCAl6NYYkzXaa75Y9ZVcj7lMw3_0WpSLxmZVcfAmWHJXJxNzknRhyiJ5qqISRrGoHQ/exec";

let currentSearchResults = [];
let filteredResults = [];
let batchChartInstance = null;
let doughnutChartInstance = null;

// Speed: client-side cache + debounce + request de-dup
const searchCache = new Map();      // normalizedQuery -> results array
let debounceTimer = null;
let activeController = null;        // AbortController for in-flight request
let lastRenderedQuery = "";

const DOUGHNUT_COLORS = [
    '#3b82f6','#10b981','#a855f7','#f59e0b','#ef4444',
    '#06b6d4','#ec4899','#84cc16','#6366f1','#f97316'
];

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    document.getElementById('themeIcon').innerText = isDark ? "☀️" : "🌙";
    if (filteredResults.length > 0) {
        generateMetricsAndCharts(filteredResults);
    }
}

function toggleExportDropdown(event) {
    event.stopPropagation();
    document.getElementById('exportDropdown').classList.toggle('hidden');
}

window.onclick = function(event) {
    const dropdown = document.getElementById('exportDropdown');
    if (dropdown && !dropdown.classList.contains('hidden')) {
        dropdown.classList.add('hidden');
    }
}

function handleKeyPress(event) {
    if (event.key === "Enter") performSearch(true);
}

function normalizeQuery(raw) {
    let query = raw.trim();
    const digitsOnly = query.replace(/\D/g, '');
    if (digitsOnly.length >= 10) query = digitsOnly.slice(-10);
    return query;
}

function clearSearch() {
    const input = document.getElementById('searchInput');
    input.value = "";
    document.getElementById('clearBtn').classList.add('hidden');
    resetToPlaceholder();
    input.focus();
}

function resetToPlaceholder() {
    currentSearchResults = [];
    filteredResults = [];
    lastRenderedQuery = "";
    document.getElementById('resultsContainer').innerHTML = "";
    document.getElementById('reportSection').classList.add('hidden');
    document.getElementById('skeletonSection').classList.add('hidden');
    document.getElementById('actionPanel').classList.add('hidden');
    document.getElementById('filterPanel').classList.add('hidden');
    document.getElementById('status').classList.add('hidden');
    document.getElementById('placeholderText').classList.remove('hidden');
}

// Live search: debounce as the user types
function handleInput() {
    const raw = document.getElementById('searchInput').value;
    document.getElementById('clearBtn').classList.toggle('hidden', raw.length === 0);

    clearTimeout(debounceTimer);

    const query = normalizeQuery(raw);
    if (query.length < 3) {
        // too short to search live; wait for more input
        return;
    }
    debounceTimer = setTimeout(() => performSearch(false), 450);
}

async function performSearch(forced) {
    const raw = document.getElementById('searchInput').value;
    const query = normalizeQuery(raw);

    const status = document.getElementById('status');
    const container = document.getElementById('resultsContainer');
    const reportSection = document.getElementById('reportSection');
    const skeleton = document.getElementById('skeletonSection');
    const actionPanel = document.getElementById('actionPanel');
    const filterPanel = document.getElementById('filterPanel');
    const placeholder = document.getElementById('placeholderText');

    if (!query) {
        if (forced) alert("Please enter a target entry parameter.");
        return;
    }
    if (!forced && query.length < 3) return;
    if (query === lastRenderedQuery && !forced) return; // already showing this

    // Serve from cache instantly
    if (searchCache.has(query)) {
        clearTimeout(debounceTimer);
        renderFromData(searchCache.get(query), query);
        return;
    }

    // Cancel any in-flight request before starting a new one
    if (activeController) activeController.abort();
    activeController = new AbortController();
    const thisController = activeController;

    // Show skeletons immediately (feels instant)
    if (placeholder) placeholder.classList.add('hidden');
    container.innerHTML = "";
    reportSection.classList.add('hidden');
    skeleton.classList.remove('hidden');
    status.classList.remove('hidden');

    try {
        const response = await fetch(`${WEB_APP_URL}?q=${encodeURIComponent(query)}`, {
            method: "GET", redirect: "follow", signal: thisController.signal
        });
        const data = await response.json();

        // Ignore stale responses (a newer query already fired)
        if (thisController !== activeController) return;

        searchCache.set(query, data || []);
        renderFromData(data || [], query);

    } catch (error) {
        if (error.name === 'AbortError') return; // superseded; ignore
        console.error(error);
        skeleton.classList.add('hidden');
        status.classList.add('hidden');
        let extra = (location.protocol === 'file:')
            ? `<div class="mt-2 text-xs font-normal text-red-600 dark:text-red-300">⚠️ You opened this page as a local file. Browsers block live data requests from local files. Please host it (e.g. GitHub Pages) or run a local server, then search again.</div>`
            : ``;
        container.innerHTML = `<div class="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-4 rounded-xl border border-red-100 dark:border-red-800 text-sm">❌ Live database communication link loss. <button onclick="performSearch(true)" class="underline font-semibold ml-1">Retry</button>${extra}</div>`;
    }
}

function renderFromData(data, query) {
    const status = document.getElementById('status');
    const container = document.getElementById('resultsContainer');
    const reportSection = document.getElementById('reportSection');
    const skeleton = document.getElementById('skeletonSection');
    const actionPanel = document.getElementById('actionPanel');
    const filterPanel = document.getElementById('filterPanel');

    skeleton.classList.add('hidden');
    status.classList.add('hidden');
    lastRenderedQuery = query;

    currentSearchResults = Array.isArray(data) ? data : [];

    if (currentSearchResults.length === 0) {
        actionPanel.classList.add('hidden');
        filterPanel.classList.add('hidden');
        reportSection.classList.add('hidden');
        container.innerHTML = `<div class="bg-white dark:bg-gray-800 p-6 rounded-xl text-center text-sm text-gray-600 dark:text-gray-400 shadow border dark:border-gray-700 rise-in">❌ No matching profile rows found inside data tabs.</div>`;
        return;
    }

    populateFilterDropdown(currentSearchResults);
    filterPanel.classList.remove('hidden');
    actionPanel.classList.remove('hidden');
    reportSection.classList.remove('hidden');
    reportSection.classList.add('rise-in');

    filteredResults = [...currentSearchResults];
    renderStudentCards(filteredResults);
    generateMetricsAndCharts(filteredResults);
}

function populateFilterDropdown(data) {
    let batches = new Set(['All Admission Batches']);
    data.forEach(item => {
        let bch = item["Admitted Batches"] || item["Admission Batch"] || item["Batch"];
        if (bch) batches.add(bch.trim());
    });

    const select = document.getElementById('filterBatch');
    select.innerHTML = "";
    batches.forEach(val => {
        let opt = document.createElement('option');
        opt.value = val; opt.innerText = val;
        select.appendChild(opt);
    });
}

function applyFilters() {
    const batchVal = document.getElementById('filterBatch').value;

    filteredResults = currentSearchResults.filter(item => {
        let bch = item["Admitted Batches"] || item["Admission Batch"] || item["Batch"] || "";
        return (batchVal === 'All Admission Batches' || bch.trim() === batchVal);
    });

    renderStudentCards(filteredResults);
    generateMetricsAndCharts(filteredResults);
}

function getPaidValue(item) {
    for (let [key, val] of Object.entries(item)) {
        let kLow = key.toLowerCase();
        if ((kLow.includes('paid') || kLow.includes('amount') || kLow.includes('ammount')) && !isNaN(parseFloat(val))) {
            return parseFloat(val);
        }
    }
    return 0;
}

function renderStudentCards(data) {
    const container = document.getElementById('resultsContainer');
    if (data.length === 0) {
        container.innerHTML = `<div class="bg-white dark:bg-gray-800 p-6 rounded-xl text-center text-sm text-gray-500 shadow rise-in">No records match the selected filter configuration.</div>`;
        return;
    }

    // Core Profile fields may be named differently across sheets and may be
    // filled in some but blank in others. Match by KEYWORD (substring of the
    // column header) and scan ALL matched records for the first non-empty value.
    const IGNORE_KEYS = ["sheet origin", "sheet"];
    function isFilled(v) {
        return v !== undefined && v !== null && v.toString().trim() && v.toString().trim() !== "-" && v.toString().trim().toLowerCase() !== "n/a";
    }
    function fieldByKeyword(keywords, excludeKeywords) {
        for (let row of data) {
            for (let [key, val] of Object.entries(row)) {
                let kl = key.toLowerCase();
                if (IGNORE_KEYS.includes(kl)) continue;
                if (excludeKeywords && excludeKeywords.some(x => kl.includes(x))) continue;
                if (keywords.some(x => kl.includes(x)) && isFilled(val)) {
                    return val.toString().trim();
                }
            }
        }
        return "-";
    }

    let nameVal = fieldByKeyword(["name"], ["institute", "user", "school", "college", "batch"]);
    let emailVal = fieldByKeyword(["email", "mail", "gmail"]);
    let mobileVal = fieldByKeyword(["whatsapp", "mobile", "phone", "contact", "number", "cell"]);
    let instituteVal = fieldByKeyword(["institute", "school", "college", "university", "institution"]);

    let initials = (nameVal || "?").trim().split(/\s+/).map(w => w[0]).slice(0,2).join("").toUpperCase() || "?";

    // Full Paid detection: found in the Master sheet
    let isFullPaid = data.some(row => {
        let origin = (row["Sheet Origin"] || row["Sheet"] || "").toString().toLowerCase();
        return origin.includes("master");
    });
    let fullPaidBadge = isFullPaid ? `
        <span class="inline-flex items-center gap-1 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 text-[10px] md:text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border border-green-200 dark:border-green-700 whitespace-nowrap flex-shrink-0 shadow-sm">
            ✅ Full Paid User
        </span>` : `
        <span class="inline-flex items-center gap-1 bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 text-[10px] md:text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border border-red-200 dark:border-red-700 whitespace-nowrap flex-shrink-0 shadow-sm">
            ⛔ Not a Full Paid User
        </span>`;

    // Build the enrollment history rows (Sheet Origin, Admission Batch, Paid Amount)
    let tableRows = "";
    let grandTotal = 0;
    data.forEach(item => {
        let batchVal = item["Admitted Batches"] || item["Admission Batch"] || item["Batch"] || "-";
        let sheetVal = item["Sheet Origin"] || "Sheet";
        let paid = getPaidValue(item);
        grandTotal += paid;
        let paidVal = paid ? paid.toLocaleString() + " ৳" : "—";

        tableRows += `
            <tr class="border-b border-gray-100 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-900/40 transition page-break-inside-avoid">
                <td class="px-4 py-3">
                    <span class="inline-block bg-purple-100 dark:bg-purple-900/50 text-purple-900 dark:text-purple-200 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wide">${sheetVal}</span>
                </td>
                <td class="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200">${batchVal}</td>
                <td class="px-4 py-3 text-sm font-bold text-right text-green-600 dark:text-green-400 whitespace-nowrap">${paidVal}</td>
            </tr>
        `;
    });

    // Visual breakdown: a proportional bar per enrollment entry (easy to scan).
    const palette = ['#3b82f6','#10b981','#a855f7','#f59e0b','#ef4444','#06b6d4','#ec4899','#84cc16','#6366f1','#f97316'];
    let maxPaid = Math.max(1, ...data.map(getPaidValue));
    let breakdownHtml = "";
    data.forEach((item, idx) => {
        let sheetVal = item["Sheet Origin"] || ("Record " + (idx + 1));
        let batchVal = item["Admitted Batches"] || item["Admission Batch"] || item["Batch"] || sheetVal;
        let paid = getPaidValue(item);
        let pct = Math.max(2, Math.round((paid / maxPaid) * 100));
        let color = palette[idx % palette.length];
        breakdownHtml += `
            <div class="page-break-inside-avoid">
                <div class="flex items-center justify-between text-xs mb-1">
                    <span class="font-semibold text-gray-700 dark:text-gray-200 truncate pr-2">${batchVal}</span>
                    <span class="font-bold text-gray-600 dark:text-gray-300 whitespace-nowrap">${paid.toLocaleString()} ৳</span>
                </div>
                <div class="w-full h-3.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div style="width:${pct}%;background:${color};" class="h-full rounded-full transition-all duration-700"></div>
                </div>
            </div>
        `;
    });

    let dashboardHtml = `
        <div class="bg-white dark:bg-gray-800 p-5 md:p-7 rounded-xl shadow border border-gray-200 dark:border-gray-700 w-full pdf-page rise-in">

            <!-- Core Profile Identity -->
            <div class="border-b dark:border-gray-700 pb-5 mb-6">
                <div class="flex items-center gap-4 mb-5">
                    <div class="w-16 h-16 flex-shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white flex items-center justify-center text-xl font-extrabold shadow-lg ring-4 ring-blue-500/10">${initials}</div>
                    <div class="min-w-0 flex-1">
                        <h2 class="text-[11px] font-bold uppercase tracking-widest text-blue-500 mb-0.5">Core Profile Identity</h2>
                        <div class="flex items-center justify-between gap-3">
                            <p class="text-xl md:text-2xl font-extrabold text-gray-800 dark:text-gray-100 leading-tight truncate">${nameVal}</p>
                            ${fullPaidBadge}
                        </div>
                    </div>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-px bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden border border-gray-100 dark:border-gray-700">
                    <div class="bg-white dark:bg-gray-800 p-3">
                        <span class="block text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Email Address</span>
                        <span class="text-sm font-medium text-gray-700 dark:text-gray-200 break-all">${emailVal}</span>
                    </div>
                    <div class="bg-white dark:bg-gray-800 p-3">
                        <span class="block text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Mobile / WhatsApp</span>
                        <span class="text-sm font-medium text-gray-700 dark:text-gray-200">${mobileVal}</span>
                    </div>
                    <div class="bg-white dark:bg-gray-800 p-3">
                        <span class="block text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Educational Institute</span>
                        <span class="text-sm font-medium text-gray-700 dark:text-gray-200">${instituteVal}</span>
                    </div>
                </div>
            </div>

            <!-- Academic Enrollment Sheets History -->
            <h2 class="text-[11px] font-bold uppercase tracking-widest text-purple-500 mb-3">Academic Enrollment Sheets History</h2>
            <div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table class="w-full border-collapse">
                    <thead>
                        <tr class="bg-gray-50 dark:bg-gray-900/60 text-left">
                            <th class="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">Sheet Origin</th>
                            <th class="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">Admission Batch</th>
                            <th class="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-gray-400 text-right">Paid Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                    <tfoot>
                        <tr class="bg-gray-50 dark:bg-gray-900/60 border-t-2 border-gray-200 dark:border-gray-700">
                            <td class="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-gray-500" colspan="2">Total Paid</td>
                            <td class="px-4 py-3 text-sm font-extrabold text-right text-green-700 dark:text-green-400 whitespace-nowrap">${grandTotal.toLocaleString()} ৳</td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            <!-- Paid Amount Breakdown (visual) -->
            <h2 class="text-[11px] font-bold uppercase tracking-widest text-blue-500 mt-6 mb-3">Paid Amount Breakdown</h2>
            <div class="space-y-3 bg-gray-50 dark:bg-gray-900/40 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                ${breakdownHtml}
            </div>
        </div>
    `;

    container.innerHTML = dashboardHtml;
}

// Smoothly count a number up to its target
function animateCount(el, target, suffix) {
    const duration = 600;
    const start = performance.now();
    function tick(now) {
        const p = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        const val = Math.round(target * eased);
        el.innerText = val.toLocaleString() + (suffix || "");
        if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

function generateMetricsAndCharts(data) {
    let totalRecords = data.length, totalRevenue = 0, batchRevenue = {};

    data.forEach(student => {
        let currentPaid = getPaidValue(student);
        let currentBatches = [];

        for (let [key, val] of Object.entries(student)) {
            let sKey = key.toLowerCase();
            if (sKey.includes('batch') || sKey.includes('admitted')) {
                let bName = val ? val.toString().trim() : 'Unassigned';
                if (bName && bName !== '-' && bName !== 'N/A') currentBatches.push(bName);
            }
        }

        totalRevenue += currentPaid;
        currentBatches.forEach(batchName => {
            batchRevenue[batchName] = (batchRevenue[batchName] || 0) + currentPaid;
        });
    });

    const batchCount = Object.keys(batchRevenue).length;
    const avg = totalRecords ? Math.round(totalRevenue / totalRecords) : 0;

    animateCount(document.getElementById('kpiTotalStudents'), totalRecords, "");
    animateCount(document.getElementById('kpiTotalRevenue'), totalRevenue, " ৳");
    animateCount(document.getElementById('kpiTotalBatches'), batchCount, "");
    animateCount(document.getElementById('kpiAvgRevenue'), avg, " ৳");

    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? '#374151' : '#e5e7eb';
    const textColor = isDark ? '#9ca3af' : '#4b5563';

    const labels = Object.keys(batchRevenue).length ? Object.keys(batchRevenue) : ["No Active Batches"];
    const values = Object.values(batchRevenue).length ? Object.values(batchRevenue) : [0];

    // ---- Bar chart ----
    if (batchChartInstance) batchChartInstance.destroy();
    batchChartInstance = new Chart(document.getElementById('batchChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Total Paid Amount (৳)',
                data: values,
                backgroundColor: 'rgba(16, 185, 129, 0.75)',
                borderColor: 'rgb(16, 185, 129)',
                borderWidth: 1,
                borderRadius: 6,
                maxBarThickness: 60
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 700, easing: 'easeOutQuart' },
            plugins: {
                legend: { labels: { color: textColor, font: { size: 10 } } },
                tooltip: { callbacks: { label: (ctx) => ` Paid: ${ctx.raw.toLocaleString()} ৳` } }
            },
            scales: {
                x: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 9 } } },
                y: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 9 }, callback: (v) => v.toLocaleString() + " ৳" } }
            }
        }
    });

    // ---- Doughnut chart (batch share) ----
    if (doughnutChartInstance) doughnutChartInstance.destroy();
    doughnutChartInstance = new Chart(document.getElementById('batchDoughnut').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: labels.map((_, i) => DOUGHNUT_COLORS[i % DOUGHNUT_COLORS.length]),
                borderColor: isDark ? '#1f2937' : '#ffffff',
                borderWidth: 2,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            animation: { animateRotate: true, duration: 800, easing: 'easeOutQuart' },
            plugins: {
                legend: { position: 'right', labels: { color: textColor, font: { size: 10 }, boxWidth: 12, padding: 8 } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
                            const pct = ((ctx.raw / total) * 100).toFixed(1);
                            return ` ${ctx.label}: ${ctx.raw.toLocaleString()} ৳ (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function exportToPDF() {
    const wrapper = document.getElementById('exportWrapper');

    // Snapshot both charts as images so they survive the print layout
    const snapshots = [];
    [['batchChart','canvasParent'], ['batchDoughnut','doughnutParent']].forEach(([cid, pid]) => {
        const canvas = document.getElementById(cid);
        const parent = document.getElementById(pid);
        if (!canvas || !parent) return;
        const img = document.createElement('img');
        img.src = canvas.toDataURL("image/png");
        img.className = "pdf-chart-snapshot";
        parent.classList.add('hidden');
        parent.parentElement.appendChild(img);
        snapshots.push({ img, parent });
    });

    wrapper.classList.add('pdf-print-container');

    const opt = {
        margin:       [0.4, 0.4, 0.4, 0.4],
        filename:     `P2A_Full_Paid_Report.pdf`,
        image:        { type: 'jpeg', quality: 1.0 },
        html2canvas:  { scale: 2, useCORS: true, scrollY: 0, letterRendering: true },
        jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' },
        pagebreak:    { mode: ['avoid-all', 'css'] }
    };

    html2pdf().set(opt).from(wrapper).save().then(() => {
        wrapper.classList.remove('pdf-print-container');
        snapshots.forEach(({ img, parent }) => {
            img.remove();
            parent.classList.remove('hidden');
        });
    });
}

function exportToExcel() {
    if (filteredResults.length === 0) return alert("No operational dataset available to process.");

    const formattedRows = filteredResults.map(item => ({
        "Sheet Source": item["Sheet Origin"] || "-",
        "Student ID": item["Student Id"] || item["Student ID"] || "-",
        "Name": item["Name"] || "-",
        "Email Address": item["Email Address"] || "-",
        "WhatsApp Number": item["Whatsapp Number"] || "-",
        "Educational Institute": item["Educational Institute"] || "-",
        "Admission Batch": item["Admitted Batches"] || "-",
        "Paid Amount (৳)": getPaidValue(item)
    }));

    const totalPaid = formattedRows.reduce((s, r) => s + (Number(r["Paid Amount (৳)"]) || 0), 0);
    formattedRows.push({
        "Sheet Source": "", "Student ID": "", "Name": "", "Email Address": "",
        "WhatsApp Number": "", "Educational Institute": "", "Admission Batch": "TOTAL",
        "Paid Amount (৳)": totalPaid
    });

    const worksheet = XLSX.utils.json_to_sheet(formattedRows);

    // Column widths for readability
    worksheet['!cols'] = [
        { wch: 16 }, { wch: 12 }, { wch: 22 }, { wch: 28 },
        { wch: 16 }, { wch: 28 }, { wch: 18 }, { wch: 16 }
    ];

    // Bold header row
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r: 0, c });
        if (worksheet[addr]) {
            worksheet[addr].s = {
                font: { bold: true, color: { rgb: "FFFFFF" } },
                fill: { fgColor: { rgb: "1E40AF" } },
                alignment: { horizontal: "center" }
            };
        }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Filtered Export");
    XLSX.writeFile(workbook, `P2A_Database_Export.xlsx`);
}

function exportToWord() {
    if (filteredResults.length === 0) return alert("No active data entries to export.");

    let nameVal = filteredResults[0]["Name"] || "Student";
    let emailVal = filteredResults[0]["Email Address"] || "-";
    let phoneVal = filteredResults[0]["Whatsapp Number"] || "-";

    const totalPaid = filteredResults.reduce((s, r) => s + getPaidValue(r), 0);
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    let uniqueHeadersSet = new Set();
    filteredResults.forEach(row => {
        Object.keys(row).forEach(k => { if (k !== "Sheet Origin") uniqueHeadersSet.add(k); });
    });
    let uniqueHeadersArray = Array.from(uniqueHeadersSet);

    let htmlContent = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
        <meta charset="utf-8">
        <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; margin: 40px; color: #222; }
            h1 { color: #1e40af; border-bottom: 3px solid #1e40af; padding-bottom: 8px; font-size: 22px; margin-bottom: 4px; }
            .meta { color: #64748b; font-size: 11px; margin-bottom: 20px; }
            .profile-box { background-color: #f8fafc; border: 1px solid #cbd5e1; padding: 15px; margin-bottom: 20px; border-radius: 4px; line-height: 1.7; }
            .summary { display: inline-block; background:#eff6ff; border:1px solid #bfdbfe; color:#1e3a8a; padding:8px 14px; border-radius:4px; font-size:12px; margin-bottom:20px; font-weight:bold; }
            h2 { color:#0f172a; font-size: 15px; margin-top: 10px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #94a3b8; padding: 8px; text-align: left; font-size: 11px; }
            th { background-color: #1e40af; color: #ffffff; font-weight: bold; }
            tr:nth-child(even) td { background-color: #f8fafc; }
        </style>
        </head>
        <body>
            <h1>P2A Full Paid Student Data Finder Report</h1>
            <div class="meta">Generated on ${today}</div>
            <div class="profile-box">
                <strong>Primary Student Name:</strong> ${nameVal}<br/>
                <strong>Email Address Account:</strong> ${emailVal}<br/>
                <strong>Mobile/WhatsApp Number:</strong> ${phoneVal}
            </div>
            <div class="summary">Records: ${filteredResults.length} &nbsp;|&nbsp; Total Paid: ${totalPaid.toLocaleString()} ৳</div>
            <h2>Comprehensive Academic, Placement &amp; Fee Data Matrix Logs</h2>
            <table>
                <thead>
                    <tr>
                        <th>Sheet Origin Tab</th>
                        ${uniqueHeadersArray.map(header => `<th>${header}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
    `;

    filteredResults.forEach(item => {
        htmlContent += `<tr><td>${item["Sheet Origin"] || "-"}</td>`;
        uniqueHeadersArray.forEach(header => {
            let cellVal = item[header] !== undefined && item[header] !== "" ? item[header] : "-";
            htmlContent += `<td>${cellVal}</td>`;
        });
        htmlContent += `</tr>`;
    });

    htmlContent += `</tbody></table></body></html>`;

    const contentBuffer = btoa(unescape(encodeURIComponent(htmlContent)));
    const downloadLink = document.createElement('a');
    downloadLink.href = 'data:application/msword;base64,' + contentBuffer;
    downloadLink.download = `P2A_Student_Comprehensive_Report.doc`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}

// Warn if the page is opened directly as a local file (search needs http/https).
(function localFileWarning() {
    if (location.protocol === 'file:') {
        const ph = document.getElementById('placeholderText');
        if (ph) {
            ph.classList.remove('text-gray-400', 'border-gray-300');
            ph.classList.add('text-amber-700', 'dark:text-amber-300', 'border-amber-400');
            ph.innerHTML = `⚠️ <strong>This page is open as a local file.</strong><br>Browsers block live data requests from local files, so search won't work here. Upload it to <strong>GitHub Pages</strong> (or any web host / local server) and open it via an <em>https://</em> link — search will work normally.`;
        }
    }
})();
