/**
 * COMMUTESYNC PRO - MASTER LOGIC
 * Dependencies: simple-statistics (ss), Chart.js, FontAwesome
 */

const ss = window.ss || window.statistics;
const API_URL = 'https://commutesync.onrender.com/api';

// --- CONFIGURATION: TRANSPORT MODES ---
const MODE_MAP = {
    'Bus':     { icon: 'fa-bus',           class: 'mode-bus' },
    'QCBus':   { icon: 'fa-bus-simple',    class: 'mode-qcbus' },
    'Train':   { icon: 'fa-train-subway',  class: 'mode-train' },
    'Jeep':    { icon: 'fa-shuttle-van',   class: 'mode-jeep' },
    'Ejeep':   { icon: 'fa-bolt',          class: 'mode-ejeep' },
    'Walking': { icon: 'fa-walking',       class: 'mode-walk' },
    'Default': { icon: 'fa-route',         class: 'mode-bus' },
    'Tricycle':{ icon: 'fa-car-side',      class: 'mode-jeep' },
    'Custom':  { icon: 'fa-route',         class: 'mode-train' }
};

// --- GLOBAL STATE ---
let tripData = { timestamps: {} };
let missedCycles = 0;
let availableRoutes = [];
let myChart = null;
let currentMode = "Vehicle";

// --- LOCALSTORAGE PERSISTENCE FOR LOGGER ---
const LOGGER_STORAGE_KEY = 'commutesync_logger_data';
const PENDING_SYNC_KEY = 'commutesync_pending_sync';

// Save to both localStorage and server with retry logic
async function saveLoggerState(showFeedback = false) {
    // Save to localStorage as backup
    const state = {
        timestamps: tripData.timestamps,
        missedCycles: missedCycles,
        savedAt: new Date().toISOString(),
        routeId: document.getElementById('logRouteSelect')?.value
    };
    localStorage.setItem(LOGGER_STORAGE_KEY, JSON.stringify(state));
    
    // Save to server if user is logged in
    if (currentUserId) {
        const success = await syncToServer(state, 3, 1000); // 3 retries, 1s initial delay
        if (showFeedback) {
            showFeedbackModal(success, 'Logger saved to server', 'Failed to sync to server (saved locally)');
        }
    } else {
        // Save pending sync for when user logs in
        const pending = JSON.parse(localStorage.getItem(PENDING_SYNC_KEY) || '[]');
        pending.push({ ...state, timestamp: Date.now() });
        localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(pending));
        if (showFeedback) {
            showFeedbackModal(true, 'Logger saved locally', 'Will sync when you login');
        }
    }
}

// Show "server waking up" feedback
let serverWakingUp = false;

function showServerWakingModal() {
    if (serverWakingUp) return;
    serverWakingUp = true;
    
    const modal = document.getElementById('feedbackModal');
    const title = document.getElementById('feedbackTitle');
    const message = document.getElementById('feedbackMessage');
    const icon = document.getElementById('feedbackIcon');
    const btn = document.getElementById('feedbackBtn');
    
    title.innerText = 'Server Waking Up';
    title.style.color = 'var(--apple-orange)';
    message.innerText = 'Please wait while the server starts...';
    icon.innerHTML = '<i class="fas fa-hourglass-half" style="font-size:3rem; color:var(--apple-orange); animation: spin 2s linear infinite;"></i>';
    btn.innerText = 'OK';
    btn.onclick = () => {
        modal.classList.add('hidden');
        serverWakingUp = false;
    };
    btn.style.background = 'linear-gradient(135deg, var(--apple-orange), #cc7a00)';
    
    modal.classList.remove('hidden');
}

// Add spin animation
const style = document.createElement('style');
style.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
document.head.appendChild(style);

// Sync to server with retry logic
async function syncToServer(state, maxRetries = 3, initialDelay = 1000) {
    let lastError = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(`${API_URL}/logger-session?user_id=${currentUserId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    route_id: state.routeId,
                    timestamps: state.timestamps,
                    missed_cycles: state.missedCycles
                })
            });
            
            if (response.ok) {
                console.log("Successfully synced to server");
                serverWakingUp = false;
                return true;
            }
            
            // Check if server is starting (503 or connection error)
            if (response.status === 503 || lastError?.message?.includes('Failed to fetch')) {
                showServerWakingModal();
            }
            
            lastError = new Error(`Server returned ${response.status}`);
        } catch (e) {
            lastError = e;
            // Show server waking modal on first connection failure
            if (attempt === 0) {
                showServerWakingModal();
            }
            console.warn(`Sync attempt ${attempt + 1} failed:`, e.message);
        }
        
        // Exponential backoff before retry
        if (attempt < maxRetries - 1) {
            const delay = initialDelay * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    console.error("All sync attempts failed:", lastError);
    return false;
}

// Sync any pending data when user logs in
async function syncPendingData() {
    const pending = JSON.parse(localStorage.getItem(PENDING_SYNC_KEY) || '[]');
    if (pending.length === 0) return;
    
    console.log("Syncing pending data:", pending.length, "items");
    
    let successCount = 0;
    let failCount = 0;
    
    for (const item of pending) {
        const success = await syncToServer(item, 3, 1000);
        if (success) {
            successCount++;
        } else {
            failCount++;
        }
    }
    
    // Keep failed items for next sync
    const failedItems = pending.slice(-failCount);
    localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(failedItems));
    
    console.log(`Pending sync complete: ${successCount} success, ${failCount} failed`);
}

// Show feedback modal (iOS-friendly)
function showFeedbackModal(success, successMsg, failMsg) {
    const modal = document.getElementById('feedbackModal');
    const title = document.getElementById('feedbackTitle');
    const message = document.getElementById('feedbackMessage');
    const icon = document.getElementById('feedbackIcon');
    const btn = document.getElementById('feedbackBtn');
    
    if (success) {
        title.innerText = 'Success';
        title.style.color = 'var(--apple-green)';
        message.innerText = successMsg;
        icon.innerHTML = '<i class="fas fa-check-circle" style="font-size:3rem; color:var(--apple-green);"></i>';
        btn.innerText = 'OK';
        btn.onclick = () => modal.classList.add('hidden');
        btn.style.background = 'linear-gradient(135deg, var(--apple-green), #248a3d)';
    } else {
        title.innerText = 'Sync Issue';
        title.style.color = 'var(--apple-orange)';
        message.innerText = failMsg;
        icon.innerHTML = '<i class="fas fa-exclamation-triangle" style="font-size:3rem; color:var(--apple-orange);"></i>';
        btn.innerText = 'OK';
        btn.onclick = () => modal.classList.add('hidden');
        btn.style.background = 'linear-gradient(135deg, var(--apple-blue), var(--apple-blue-dark))';
    }
    
    modal.classList.remove('hidden');
}

// Load from server first, then localStorage
async function loadLoggerState() {
    // First try to load from server if user is logged in
    if (currentUserId) {
        try {
            const res = await fetch(`${API_URL}/logger-session?user_id=${currentUserId}`);
            const session = await res.json();
            
            if (session && session.timestamps && Object.keys(session.timestamps).length > 0) {
                tripData.timestamps = session.timestamps;
                missedCycles = session.missed_cycles || 0;
                
                // Restore route if available
                if (session.route_id) {
                    const routeSelect = document.getElementById('logRouteSelect');
                    if (routeSelect) {
                        routeSelect.value = session.route_id;
                        // Trigger change event to update route details
                        routeSelect.dispatchEvent(new Event('change'));
                    }
                }
                
                // Restore UI
                restoreLoggerUI();
                document.getElementById('logStatus').innerText = 'Session restored from server';
                return true;
            }
        } catch (e) {
            console.warn("Failed to load from server, trying local backup:", e);
        }
    }
    
    // Fallback to localStorage
    const stored = localStorage.getItem(LOGGER_STORAGE_KEY);
    if (stored) {
        try {
            const state = JSON.parse(stored);
            tripData.timestamps = state.timestamps || {};
            missedCycles = state.missedCycles || 0;
            
            // Restore UI if we have data
            if (Object.keys(tripData.timestamps).length > 0) {
                restoreLoggerUI();
            }
            return true;
        } catch (e) {
            console.error("Failed to load logger state:", e);
            return false;
        }
    }
    return false;
}

// Clear session from both server and localStorage
async function clearLoggerState() {
    // Clear localStorage
    localStorage.removeItem(LOGGER_STORAGE_KEY);
    
    // Clear server session if user is logged in
    if (currentUserId) {
        try {
            await fetch(`${API_URL}/logger-session?user_id=${currentUserId}`, {
                method: 'DELETE'
            });
        } catch (e) {
            console.warn("Failed to clear server session:", e);
        }
    }
}

async function resetLogger() {
    // Use modal instead of confirm()
    const modal = document.getElementById('feedbackModal');
    const title = document.getElementById('feedbackTitle');
    const message = document.getElementById('feedbackMessage');
    const icon = document.getElementById('feedbackIcon');
    const btn = document.getElementById('feedbackBtn');
    
    title.innerText = 'Reset Logger?';
    title.style.color = 'var(--apple-orange)';
    message.innerText = 'This will clear all recorded times.';
    icon.innerHTML = '<i class="fas fa-redo" style="font-size:3rem; color:var(--apple-orange);"></i>';
    
    btn.innerText = 'Reset';
    btn.style.background = 'linear-gradient(135deg, var(--apple-orange), #cc7a00)';
    btn.onclick = async () => {
        modal.classList.add('hidden');
        
        tripData = { timestamps: {} };
        missedCycles = 0;
        
        // Clear both localStorage and server
        await clearLoggerState();
        
        // Reset UI
        resetLoggerUI();
        
        document.getElementById('logStatus').innerText = 'Logger reset - Ready';
        showFeedbackModal(true, 'Logger has been reset', '');
    };
    
    // Add cancel button
    let cancelBtn = document.getElementById('resetCancelBtn');
    if (!cancelBtn) {
        cancelBtn = document.createElement('button');
        cancelBtn.id = 'resetCancelBtn';
        cancelBtn.className = 'btn btn-outline';
        cancelBtn.style.marginTop = '12px';
        cancelBtn.innerText = 'Cancel';
        btn.parentNode.insertBefore(cancelBtn, btn.nextSibling);
    }
    cancelBtn.onclick = () => modal.classList.add('hidden');
    
    modal.classList.remove('hidden');
}

function restoreLoggerUI() {
    const timestamps = tripData.timestamps;
    
    // Restore buttons based on what was recorded
    if (timestamps.arrived) {
        const btn = document.getElementById('btnArrived');
        btn.className = "btn btn-success";
        btn.disabled = true;
        btn.innerHTML = btn.innerHTML.replace(/<i class="fas fa-stopwatch"><\/i>/, '') + ` <span style="font-size:0.85rem;opacity:0.8">${formatTime12hr(timestamps.arrived)}</span> <i class="fas fa-check"></i>`;
        
        document.getElementById('btnBoarded').disabled = false;
        document.getElementById('btnBoarded').className = "btn btn-primary";
    }
    
    if (timestamps.boarded) {
        const btn = document.getElementById('btnBoarded');
        btn.className = "btn btn-success";
        btn.disabled = true;
        btn.innerHTML = btn.innerHTML.replace(/<i class="fas fa-ticket-alt"><\/i>/, '') + ` <span style="font-size:0.85rem;opacity:0.8">${formatTime12hr(timestamps.boarded)}</span> <i class="fas fa-check"></i>`;
        
        document.getElementById('btnDeparted').disabled = false;
        document.getElementById('btnDeparted').className = "btn btn-primary";
    }
    
    if (timestamps.departed) {
        const btn = document.getElementById('btnDeparted');
        btn.className = "btn btn-success";
        btn.disabled = true;
        btn.innerHTML = btn.innerHTML.replace(/<i class="fas fa-bus"><\/i>/, '') + ` <span style="font-size:0.85rem;opacity:0.8">${formatTime12hr(timestamps.departed)}</span> <i class="fas fa-check"></i>`;
        
        enableEndingStage();
    }
    
    if (timestamps.dropped) {
        const btn = document.getElementById('btnDropped');
        btn.className = "btn btn-success";
        btn.disabled = true;
        btn.innerHTML = btn.innerHTML.replace(/<i class="fas fa-flag-checkered"><\/i>/, '') + ` <span style="font-size:0.85rem;opacity:0.8">${formatTime12hr(timestamps.dropped)}</span> <i class="fas fa-check"></i>`;
        
        document.getElementById('saveSection').classList.remove('hidden');
    }
    
    // Restore missed cycles
    document.getElementById('cycleCount').innerText = missedCycles;
    
    document.getElementById('logStatus').innerText = 'Session restored from previous session';
}

function resetLoggerUI() {
    // Reset all buttons to initial state
    const btnArrived = document.getElementById('btnArrived');
    btnArrived.className = "btn btn-primary";
    btnArrived.disabled = false;
    btnArrived.innerHTML = '<i class="fas fa-stopwatch"></i> I\'m at the Stop';
    
    const btnBoarded = document.getElementById('btnBoarded');
    btnBoarded.className = "btn btn-outline";
    btnBoarded.disabled = true;
    btnBoarded.innerHTML = '<i class="fas fa-ticket-alt"></i> Boarding';
    
    const btnDeparted = document.getElementById('btnDeparted');
    btnDeparted.className = "btn btn-outline";
    btnDeparted.disabled = true;
    btnDeparted.innerHTML = '<i class="fas fa-bus"></i> Departing';
    
    const btnDropped = document.getElementById('btnDropped');
    btnDropped.className = "btn btn-outline";
    btnDropped.disabled = true;
    btnDropped.innerHTML = '<i class="fas fa-flag-checkered"></i> Drop Off';
    
    document.getElementById('saveSection').classList.add('hidden');
    document.getElementById('cycleCount').innerText = '0';
}

// --- AUTH STATE ---
let currentUserId = localStorage.getItem('commutesync_user_id');
let currentUsername = localStorage.getItem('commutesync_email') || localStorage.getItem('commutesync_username');
let currentEmail = localStorage.getItem('commutesync_email');

// ==========================================
// 1. FAIL-SAFE HELPERS
// ==========================================

// Helper to format time in 12-hour format for display
function formatTime12hr(time24) {
    if (!time24) return '';
    try {
        const [hours, minutes] = time24.split(':');
        const d = new Date();
        d.setHours(parseInt(hours));
        d.setMinutes(parseInt(minutes));
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    } catch (e) { return time24; }
}

// Helper to convert 12-hour time input to 24-hour for storage
function time12to24(time12) {
    if (!time12) return '';
    try {
        const d = new Date('2000-01-01T' + time12);
        return d.toTimeString().split(' ')[0];
    } catch (e) { return time12; }
}

function getTime() { 
    return new Date().toTimeString().split(' ')[0]; 
}

function timeDiff(t1, t2) {
    if (!t1 || !t2 || t1 === "00:00:00" || t2 === "00:00:00") return 0;
    try {
        const d1 = new Date("2000-01-01T" + t1);
        const d2 = new Date("2000-01-01T" + t2);
        const diff = Math.round((d2 - d1) / 60000);
        return isNaN(diff) ? 0 : Math.max(0, diff);
    } catch (e) { return 0; }
}

// ==========================================
// 2. ANALYTICS & VISUALS
// ==========================================

async function renderEfficiencyChart(logs) {
    if (!logs || logs.length < 2) return;
    try {
        const chartData = {};
        logs.slice(0, 15).forEach(l => {
            const d = l.date.split('-')[2];
            const travelTime = timeDiff(l.timestamp_departed, l.timestamp_arrived_dropoff);
            if (travelTime > 0) {
                if(!chartData[d]) chartData[d] = [];
                chartData[d].push(travelTime);
            }
        });

        const labels = Object.keys(chartData).reverse();
        const values = labels.map(d => Math.round(ss.mean(chartData[d])));

        if (myChart) myChart.destroy();
        const ctx = document.getElementById('efficiencyChart').getContext('2d');
        myChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    data: values,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.4,
                    borderWidth: 3,
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                    x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    } catch(e) { console.warn("Chart Engine: Syncing data..."); }
}

let dayChart = null;

async function loadDayChart() {
    try {
        const res = await apiFetch(`${API_URL}/day-stats`);
        const { labels, data } = await res.json();
        
        if (!data || data.every(v => v === 0)) {
            document.getElementById('dayChart').style.display = 'none';
            return;
        }
        
        document.getElementById('dayChart').style.display = 'block';
        
        const ctx = document.getElementById('dayChart').getContext('2d');
        
        if (dayChart) dayChart.destroy();
        
        dayChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: [
                        'rgba(239, 68, 68, 0.7)',   // Sun - red
                        'rgba(59, 130, 246, 0.7)',   // Mon - blue
                        'rgba(59, 130, 246, 0.7)',  // Tue - blue
                        'rgba(59, 130, 246, 0.7)',  // Wed - blue
                        'rgba(59, 130, 246, 0.7)',  // Thu - blue
                        'rgba(59, 130, 246, 0.7)',  // Fri - blue
                        'rgba(16, 185, 129, 0.7)'    // Sat - green
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', stepSize: 1 } },
                    x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
                }
            }
        });
    } catch (e) {
        console.error("Failed to load day stats:", e);
    }
}

async function runBenchmark() {
    try {
        const res = await apiFetch(`${API_URL}/benchmark`);
        const data = await res.json();
        const tbody = document.querySelector('#benchmarkTable tbody');
        if(!tbody) return;

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center;">No data available</td></tr>';
            return;
        }

        tbody.innerHTML = data.map(row => {
            const accVal = parseInt(row.prediction_accuracy);
            const color = accVal >= 80 ? '#10b981' : (accVal >= 60 ? '#f59e0b' : '#ef4444');
            const modeInfo = MODE_MAP[row.mode] || MODE_MAP['Default'];
            return `<tr>
                <td style="font-weight:700;">${row.route}</td>
                <td><span class="step-mode">${row.mode || 'Vehicle'}</span></td>
                <td class="text-muted">${row.avg_min}m</td>
                <td class="text-muted">±${row.volatility_min}m</td>
                <td style="color:${color}; font-weight:800;">${row.prediction_accuracy}</td>
            </tr>`;
        }).join('');
    } catch (e) { console.error("Benchmark sync failed."); }
}

// ==========================================
// 3. DATA & LOG LOADING
// ==========================================

async function loadLogs() {
    try {
        const res = await apiFetch(`${API_URL}/logs`);
        const logs = await res.json();
        const tbody = document.querySelector('#logsTable tbody');
        if (!tbody) return;

        if (!logs || logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No history found.</td></tr>';
            return;
        }

        tbody.innerHTML = logs.map(l => {
            const wait = timeDiff(l.timestamp_arrived_pickup, l.timestamp_boarded);
            const travel = timeDiff(l.timestamp_departed, l.timestamp_arrived_dropoff);
            const routeName = l.routes ? l.routes.name : 'Unknown';
            const dateStr = l.date.split('-')[1] + "/" + l.date.split('-')[2];
            const dropped = l.timestamp_arrived_dropoff ? formatTime12hr(l.timestamp_arrived_dropoff) : '--';

            return `<tr>
                <td>${dateStr}</td>
                <td style="font-weight:600;">${routeName}</td>
                <td>${wait}m</td>
                <td>${travel}m <span style="opacity:0.5;font-size:0.75rem">${dropped}</span></td>
            </tr>`;
        }).join('');

        renderEfficiencyChart(logs);
    } catch(e) {
        console.error("History Loading Failed.");
    }
}

async function loadRoutes() {
    try {
        const res = await apiFetch(`${API_URL}/routes`);
        availableRoutes = await res.json();
        
        const logSelect = document.getElementById('logRouteSelect');
        const schedSelect = document.getElementById('scheduleRouteSelect');
        
        logSelect.innerHTML = '<option value="">-- Select Route --</option>';
        schedSelect.innerHTML = '<option value="">-- Select Route --</option>';

        availableRoutes.forEach(r => {
            // Crucial: we embed the mode into the data attribute here
            const opt = `<option value="${r.id}" data-mode="${r.mode}" data-origin="${r.origin}" data-dest="${r.destination}">${r.name}</option>`;
            logSelect.innerHTML += opt;
            schedSelect.innerHTML += opt;
        });

        // Restore previously selected route from localStorage
        const savedRouteId = localStorage.getItem('commutesync_selected_route');
        if (savedRouteId) {
            logSelect.value = savedRouteId;
            if (logSelect.value) {
                const opt = logSelect.options[logSelect.selectedIndex];
                document.getElementById('routeDetails').innerText = `${opt.dataset.origin} ➔ ${opt.dataset.dest}`;
                setLoggerMode(opt.dataset.mode);
            }
        }

        logSelect.onchange = () => {
            const opt = logSelect.options[logSelect.selectedIndex];
            if (opt.value) {
                document.getElementById('routeDetails').innerText = `${opt.dataset.origin} ➔ ${opt.dataset.dest}`;
                setLoggerMode(opt.dataset.mode);
                // Save selected route to localStorage
                localStorage.setItem('commutesync_selected_route', opt.value);
            }
            // Update manual logger inputs when route changes
            updateManualLoggerInputs();
        };

        addRouteToChain(); 
    } catch(e) { console.error("Initial load failed."); }
}

function setLoggerMode(mode) {
    currentMode = mode;
    const vehicle = document.getElementById('vehicleControls');
    const walking = document.getElementById('walkingControls');
    const cycle = document.getElementById('vehicleCycleCounter');

    if (mode === 'Walking' || mode === 'Bicycle') {
        vehicle.classList.add('hidden');
        walking.classList.remove('hidden');
        cycle.classList.add('hidden');
    } else {
        vehicle.classList.remove('hidden');
        walking.classList.add('hidden');
        cycle.classList.remove('hidden');
    }
}

// ==========================================
// 4. ACTION & STOPWATCH LOGIC
// ==========================================

const actionBtns = ['btnArrived', 'btnBoarded', 'btnDeparted'];
actionBtns.forEach((id, index) => {
    const btn = document.getElementById(id);
    if(btn) {
        btn.onclick = function() {
            const key = id.replace('btn', '').toLowerCase();
            const time24 = getTime();
            tripData.timestamps[key] = time24;
            const time12 = formatTime12hr(time24);
            this.className = "btn btn-success";
            this.disabled = true;
            this.innerHTML = this.innerHTML.replace(/<i class="fas fa-stopwatch"><\/i>|<i class="fas fa-ticket-alt"><\/i>|<i class="fas fa-bus"><\/i>/, '') + ` <span style="font-size:0.85rem;opacity:0.8">${time12}</span> <i class="fas fa-check"></i>`;
            if(index < actionBtns.length - 1) {
                const next = document.getElementById(actionBtns[index+1]);
                next.disabled = false;
                next.className = "btn btn-primary";
            } else {
                enableEndingStage();
            }
            // Save state to localStorage for persistence
            saveLoggerState();
        };
    }
});

document.getElementById('btnStartWalk').onclick = function() {
    const now = getTime();
    tripData.timestamps = { arrived: now, boarded: now, departed: now };
    const time12 = formatTime12hr(now);
    this.className = "btn btn-success";
    this.disabled = true;
    this.innerHTML = `<i class="fas fa-walking"></i> <span style="font-size:0.85rem;opacity:0.8">${time12}</span> <i class="fas fa-check"></i>`;
    enableEndingStage();
    // Save state to localStorage for persistence
    saveLoggerState();
};

function enableEndingStage() {
    const drop = document.getElementById('btnDropped');
    drop.disabled = false;
    drop.className = "btn btn-primary";
}

document.getElementById('btnDropped').onclick = function() {
    const time24 = getTime();
    tripData.timestamps['dropped'] = time24;
    const time12 = formatTime12hr(time24);
    this.className = "btn btn-success";
    this.disabled = true;
    this.innerHTML = this.innerHTML.replace(/<i class="fas fa-flag-checkered"><\/i>/, '') + ` <span style="font-size:0.85rem;opacity:0.8">${time12}</span> <i class="fas fa-check"></i>`;
    document.getElementById('saveSection').classList.remove('hidden');
    // Save state to localStorage for persistence
    saveLoggerState();
};

document.getElementById('btnSaveLog').onclick = async function() {
    const routeId = document.getElementById('logRouteSelect').value;
    if (!routeId) return alert("Please select a route first.");
    
    const date = new Date().toISOString().split('T')[0];
    const body = {
        route_id: routeId,
        date: date,
        timestamps: tripData.timestamps,
        missed_cycles: missedCycles
    };

    try {
        const btn = this;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        
        const res = await fetch(`${API_URL}/log`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
        
        if (!res.ok) throw new Error('Save failed');
        
        // Clear both localStorage and server session after successful save
        await clearLoggerState();
        
        alert("Trip saved successfully!");
        location.reload();
    } catch(e) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Save Trip Data';
        alert("Save failed: " + e.message);
    }
};

// ==========================================
// 5. PREDICTION & SAVE ENGINE
// ==========================================

function addRouteToChain() {
    const container = document.getElementById('routeChainContainer');
    const div = document.createElement('div');
    // Include mode, origin, and destination in the options
    const options = availableRoutes.map(r => {
        const label = r.origin && r.destination ? `${r.name} (${r.origin} → ${r.destination})` : r.name;
        return `<option value="${r.id}" data-mode="${r.mode}" data-origin="${r.origin || ''}" data-dest="${r.destination || ''}">${label}</option>`;
    }).join('');
    div.innerHTML = `<select class="route-select" style="margin-bottom:10px">
        <option value="">-- Select Stop --</option>
        ${options}
    </select>`;
    container.appendChild(div);
}

// ==========================================
// PRESET FUNCTIONS
// ==========================================

async function loadPresets() {
    try {
        const res = await apiFetch(`${API_URL}/presets`);
        const presets = await res.json();
        const select = document.getElementById('presetSelect');
        
        select.innerHTML = '<option value="">-- Select Preset --</option>';
        presets.forEach(p => {
            select.innerHTML += `<option value="${p.id}">${p.name}</option>`;
        });
        
        return presets;
    } catch (e) {
        console.error("Failed to load presets:", e);
        return [];
    }
}

window.loadPreset = async function() {
    const select = document.getElementById('presetSelect');
    const presetId = select.value;
    if (!presetId) return;
    
    try {
        const res = await fetch(`${API_URL}/presets`);
        const presets = await res.json();
        const preset = presets.find(p => p.id === presetId);
        
        if (!preset || !preset.route_ids) return;
        
        // Clear existing chain
        document.getElementById('routeChainContainer').innerHTML = '';
        
        // Add routes from preset
        preset.route_ids.forEach(routeId => {
            addRouteToChain();
            const selects = document.querySelectorAll('.route-select');
            const lastSelect = selects[selects.length - 1];
            if (lastSelect) {
                lastSelect.value = routeId;
            }
        });
    } catch (e) {
        console.error("Failed to load preset:", e);
    }
};

window.savePreset = async function() {
    const selects = Array.from(document.querySelectorAll('.route-select'));
    const routeIds = selects.map(s => s.value).filter(v => v);
    
    if (routeIds.length === 0) return alert("Add at least one route to save.");
    
    const name = prompt("Enter a name for this route:");
    if (!name) return;
    
    try {
        await fetch(`${API_URL}/presets`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name, route_ids: routeIds })
        });
        
        alert("Preset saved!");
        loadPresets();
    } catch (e) {
        alert("Failed to save preset.");
    }
};

window.deletePreset = async function() {
    const select = document.getElementById('presetSelect');
    const presetId = select.value;
    if (!presetId) return alert("Select a preset to delete.");
    
    if (!confirm("Delete this preset?")) return;
    
    try {
        await fetch(`${API_URL}/presets/${presetId}`, { method: 'DELETE' });
        alert("Preset deleted!");
        loadPresets();
    } catch (e) {
        alert("Failed to delete preset.");
    }
};

async function calculatePrediction() {
    const start = document.getElementById('predictStartTime').value;
    const date = document.getElementById('predictDate').value;
    const selects = Array.from(document.querySelectorAll('.route-select'));
    const ids = selects.map(s => s.value).filter(v => v);
    
    if(ids.length === 0) return alert("Select at least one stop.");
    if(!start) return alert("Please select a departure time.");

    try {
        // Show loading state
        const predictBtn = document.querySelector('#view-predict .btn-primary');
        const originalText = predictBtn.innerHTML;
        predictBtn.disabled = true;
        predictBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Calculating...';
        
        const res = await fetch(`${API_URL}/predict`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ start_time: start, date: date, route_ids: ids })
        });
        const data = await res.json();
        
        // Restore button
        predictBtn.disabled = false;
        predictBtn.innerHTML = originalText;
        
        document.getElementById('predictionResult').classList.remove('hidden');
        // Convert times from 24hr to 12hr format
        document.getElementById('timeBest').innerText = formatTime12hr(data.arrivals.best) || data.arrivals.best;
        document.getElementById('timeSafe').innerText = formatTime12hr(data.arrivals.safe) || data.arrivals.safe;
        document.getElementById('timeWorst').innerText = formatTime12hr(data.arrivals.worst) || data.arrivals.worst;

        const detailsContainer = document.getElementById('predDetails');
        
        detailsContainer.innerHTML = data.breakdown.map((leg, i) => {
            const selectedOpt = selects[i].options[selects[i].selectedIndex];
            // Use name from server response, fallback to dropdown text
            const name = leg.name || selectedOpt.text;
            const origin = leg.origin || selectedOpt.dataset.origin || '';
            const destination = leg.destination || selectedOpt.dataset.dest || '';
            // Use mode from server response, fallback to dataset mode
            const mode = leg.mode || selectedOpt.dataset.mode || 'Default';
            const modeInfo = MODE_MAP[mode] || MODE_MAP['Default'];
            const isWalking = mode === 'Walking' || mode === 'Bicycle';
            
            const delay = (leg.timelines.worst.wait + leg.timelines.worst.travel) - (leg.timelines.safe.wait + leg.timelines.safe.travel);
            
            // Format arrival times to 12-hour format
            const arrivalBest = leg.arrival_time?.best ? formatTime12hr(leg.arrival_time.best) : '';
            const arrivalSafe = leg.arrival_time?.safe ? formatTime12hr(leg.arrival_time.safe) : '';
            const arrivalWorst = leg.arrival_time?.worst ? formatTime12hr(leg.arrival_time.worst) : '';
            
            return `
            <div class="itinerary-step">
                <div class="itinerary-dot mode-aware ${modeInfo.class}">
                    <i class="fas ${modeInfo.icon}"></i>
                </div>
                <div class="step-header">
                    <span class="step-title">${name}</span>
                    <span class="step-mode">${mode}</span>
                </div>
                ${origin && destination ? `<div class="step-route">${origin} ➔ ${destination}</div>` : ''}
                <div class="step-meta">
                    <div class="meta-box">
                        <span class="meta-label">${isWalking ? 'Duration' : 'Waiting'}</span>
                        <span>${leg.timelines.safe.wait}m</span>
                    </div>
                    <div class="meta-box">
                        <span class="meta-label">${isWalking ? 'Total' : 'Transit'}</span>
                        <span>${leg.timelines.safe.travel}m</span>
                    </div>
                </div>
                ${(arrivalBest || arrivalSafe || arrivalWorst) ? `
                <div class="step-arrival" style="margin-top:10px; padding:8px 12px; background:rgba(59,130,246,0.1); border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.7rem; color:var(--text-muted);"><i class="fas fa-clock"></i> Arrive at</span>
                    <span style="font-weight:800; color:var(--primary);">${arrivalSafe}</span>
                </div>
                ` : ''}
                ${delay > 0 ? `<div class="risk-alert"><i class="fas fa-exclamation-triangle"></i> Variance Risk: +${delay}m</div>` : ''}
            </div>`;
        }).join('');
    } catch(e) { 
        // Restore button on error
        const predictBtn = document.querySelector('#view-predict .btn-primary');
        predictBtn.disabled = false;
        predictBtn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Predict Arrival';
        alert("Prediction error."); 
    }
}

async function saveManualLog() {
    const routeId = document.getElementById('logRouteSelect').value;
    const date = document.getElementById('manualDate').value;
    const missed = document.getElementById('manualCycles').value || 0;
    
    if(!routeId || !date) return alert("Route and Date required.");

    // Get selected route mode
    const routeSelect = document.getElementById('logRouteSelect');
    const selectedOption = routeSelect.options[routeSelect.selectedIndex];
    const mode = selectedOption?.dataset?.mode;
    
    let timestamps;
    
    if (mode === 'Walking' || mode === 'Bicycle') {
        // Walking mode - only need start and end times
        const started = document.getElementById('manualStarted').value;
        const ended = document.getElementById('manualEnded').value;
        
        if (!started || !ended) return alert("Please enter start and end times.");
        
        timestamps = {
            arrived: started,
            boarded: started,
            departed: started,
            dropped: ended
        };
    } else {
        // Vehicle mode - need all timestamps
        timestamps = {
            arrived: document.getElementById('manualArrived').value,
            boarded: document.getElementById('manualBoarded').value,
            departed: document.getElementById('manualDeparted').value,
            dropped: document.getElementById('manualDropped').value
        };
    }

    const body = {
        route_id: routeId,
        date: date,
        timestamps: timestamps,
        missed_cycles: parseInt(missed)
    };

    try {
        // Show loading state
        const confirmBtn = document.querySelector('#manualLoggerUI .btn-success');
        const originalText = confirmBtn.innerHTML;
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        
        const res = await fetch(`${API_URL}/log`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
        
        if (!res.ok) throw new Error('Save failed');
        
        // Show success feedback
        confirmBtn.innerHTML = '<i class="fas fa-check"></i> Saved!';
        confirmBtn.style.background = 'var(--accent)';
        
        setTimeout(() => {
            location.reload();
        }, 1000);
    } catch(e) {
        // Show error feedback
        const confirmBtn = document.querySelector('#manualLoggerUI .btn-success');
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = originalText;
        alert("Save failed: " + e.message);
    }
}

// ==========================================
// 6. GLOBAL BRIDGE
// ==========================================

function switchTab(viewId, btn) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    btn.classList.add('active');
    if (viewId === 'view-manage') { loadLogs(); runBenchmark(); loadDayChart(); }
    if (viewId === 'view-analytics') { loadAnalytics(); }
}

window.switchTab = switchTab;
window.runBenchmark = runBenchmark;
window.saveManualLog = saveManualLog;
window.resetLogger = resetLogger;
window.adjustCycles = (a) => { missedCycles = Math.max(0, missedCycles + a); document.getElementById('cycleCount').innerText = missedCycles; saveLoggerState(); };
window.calculatePrediction = calculatePrediction;
window.addRouteToChain = addRouteToChain;
let isManualMode = false;
window.toggleManualMode = () => {
    isManualMode = !isManualMode;
    const manualBtn = document.querySelector('#view-log .btn-outline');
    
    if (isManualMode) {
        document.getElementById('liveLoggerUI').classList.add('hidden');
        document.getElementById('manualLoggerUI').classList.remove('hidden');
        if (manualBtn) {
            manualBtn.innerHTML = '<i class="fas fa-stopwatch"></i> Smart';
        }
    } else {
        document.getElementById('liveLoggerUI').classList.remove('hidden');
        document.getElementById('manualLoggerUI').classList.add('hidden');
        if (manualBtn) {
            manualBtn.innerHTML = '<i class="fas fa-edit"></i> Manual';
        }
    }
    
    updateManualLoggerInputs();
};

// Function to update manual logger inputs based on selected route mode
function updateManualLoggerInputs() {
    const routeSelect = document.getElementById('logRouteSelect');
    const selectedOption = routeSelect.options[routeSelect.selectedIndex];
    const mode = selectedOption?.dataset?.mode;
    
    if (mode === 'Walking' || mode === 'Bicycle') {
        document.getElementById('manualVehicleInputs').classList.add('hidden');
        document.getElementById('manualWalkingInputs').classList.remove('hidden');
    } else {
        document.getElementById('manualVehicleInputs').classList.remove('hidden');
        document.getElementById('manualWalkingInputs').classList.add('hidden');
    }
}
window.toggleCustomMode = (select) => {
    const input = document.getElementById('customModeInput');
    select.value === 'Custom' ? input.classList.remove('hidden') : input.classList.add('hidden');
};

window.createNewRoute = async function() {
    const name = document.getElementById('newRouteName').value;
    const origin = document.getElementById('newOrigin').value;
    const destination = document.getElementById('newDest').value;
    let mode = document.getElementById('newRouteMode').value;
    
    // Handle custom mode
    if (mode === 'Custom') {
        mode = document.getElementById('customModeInput').value;
        if (!mode) return alert("Please enter a custom mode name.");
    }
    
    if (!name || !origin || !destination) return alert("Please fill in all fields.");
    
    const body = { name, origin, destination, mode };
    
    // Include user_id if logged in
    if (currentUserId) {
        body.user_id = currentUserId;
    }
    
    try {
        const url = getApiUrl(`${API_URL}/routes`);
        const res = await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
        
        if (!res.ok) throw new Error('Failed to create route');
        
        alert("Route created successfully!");
        loadRoutes();
        
        // Clear form
        document.getElementById('newRouteName').value = '';
        document.getElementById('newOrigin').value = '';
        document.getElementById('newDest').value = '';
    } catch(e) {
        alert("Failed to create route: " + e.message);
    }
};

async function loadAnalytics() {
    try {
        const res = await fetch(`${API_URL}/analytics`);
        const data = await res.json();
        const container = document.getElementById('analyticsContainer');
        
        if (!data || data.length === 0) {
            container.innerHTML = '<div style="text-align:center; color:var(--text-muted);">No data available</div>';
            return;
        }
        
        container.innerHTML = data.map(route => {
            const isWalking = route.mode === 'Walking' || route.mode === 'Bicycle';
            const modeInfo = MODE_MAP[route.mode] || MODE_MAP['Default'];
            
            return `
            <div class="analytics-card" style="background:rgba(0,0,0,0.2); border-radius:12px; padding:15px; margin-bottom:15px;">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                    <div class="itinerary-dot mode-aware ${modeInfo.class}" style="position:relative; left:0; width:28px; height:28px;">
                        <i class="fas ${modeInfo.icon}" style="font-size:0.8rem;"></i>
                    </div>
                    <div>
                        <div style="font-weight:700;">${route.route_name}</div>
                        <div style="font-size:0.75rem; color:var(--text-muted);">${route.origin} → ${route.destination}</div>
                    </div>
                    <span class="step-mode" style="margin-left:auto;">${route.mode}</span>
                </div>
                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; text-align:center;">
                    <div>
                        <div style="font-size:1.2rem; font-weight:800; color:var(--accent);">${route.total_trips}</div>
                        <div style="font-size:0.65rem; color:var(--text-muted);">TRIPS</div>
                    </div>
                    <div>
                        <div style="font-size:1.2rem; font-weight:800; color:var(--primary);">${route.avg_total}m</div>
                        <div style="font-size:0.65rem; color:var(--text-muted);">${isWalking ? 'DURATION' : 'AVG TOTAL'}</div>
                    </div>
                    <div>
                        <div style="font-size:1.2rem; font-weight:800;">${route.missed_cycles_avg}</div>
                        <div style="font-size:0.65rem; color:var(--text-muted);">MISSED</div>
                    </div>
                </div>
                ${!isWalking ? `
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.05);">
                    <div>
                        <div style="font-size:0.7rem; color:var(--text-muted);">WAIT (${route.min_wait}-${route.max_wait}m)</div>
                        <div style="font-weight:600;">Avg: ${route.avg_wait}m</div>
                    </div>
                    <div>
                        <div style="font-size:0.7rem; color:var(--text-muted);">TRAVEL (${route.min_travel}-${route.max_travel}m)</div>
                        <div style="font-weight:600;">Avg: ${route.avg_travel}m</div>
                    </div>
                </div>
                ` : ''}
            </div>`;
        }).join('');
    } catch (e) {
        console.error("Failed to load analytics:", e);
        document.getElementById('analyticsContainer').innerHTML = '<div style="text-align:center; color:var(--danger);">Failed to load analytics</div>';
    }
}

window.saveSchedule = async function() {
    const routeId = document.getElementById('scheduleRouteSelect').value;
    const dayType = document.getElementById('schedDay').value;
    const interval = document.getElementById('schedInterval').value;
    const start = document.getElementById('schedStart').value;
    const end = document.getElementById('schedEnd').value;
    
    if (!routeId || !interval) return alert("Please select a route and enter interval.");
    
    const body = {
        route_id: routeId,
        day_type: dayType,
        interval_minutes: parseInt(interval),
        start_time: start,
        end_time: end
    };
    
    try {
        const res = await fetch(`${API_URL}/schedule`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
        
        if (!res.ok) throw new Error('Failed to save schedule');
        
        alert("Schedule saved successfully!");
    } catch(e) {
        alert("Failed to save schedule: " + e.message);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    loadRoutes();
    loadPresets();
    checkLoginStatus();
    // Load logger from server if logged in (sync from cloud)
    if (currentUserId) {
        loadLoggerState();
    }
    // Start status checker
    checkSystemStatus();
    setInterval(() => {
        const clock = document.getElementById('mainClock');
        if(clock) clock.innerText = new Date().toLocaleTimeString([], { hour12: true });
    }, 1000);
    // Check status every 30 seconds
    setInterval(checkSystemStatus, 30000);
});

// --- SYSTEM STATUS CHECKER ---
async function checkSystemStatus() {
    const indicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    
    if (!indicator || !statusText) return;
    
    let backendOk = false;
    
    // Check backend status by hitting /routes endpoint
    try {
        const res = await fetch(`${API_URL}/routes`, { method: 'GET' });
        backendOk = res.ok && res.status === 200;
    } catch (e) {
        backendOk = false;
    }
    
    // Update UI based on status
    if (backendOk) {
        indicator.style.background = 'var(--apple-green)';
        indicator.style.boxShadow = '0 0 8px var(--apple-green)';
        statusText.innerText = 'Backend online';
    } else {
        indicator.style.background = 'var(--apple-orange)';
        indicator.style.boxShadow = '0 0 8px var(--apple-orange)';
        statusText.innerText = 'Backend offline';
    }
}

// ==========================================
// AUTH FUNCTIONS
// ==========================================

// Helper to add user_id to API calls - CRITICAL for multi-user support!
function getApiUrl(endpoint) {
    const url = new URL(endpoint, API_URL);
    if (currentUserId) {
        url.searchParams.set('user_id', currentUserId);
    }
    return url.toString();
}

// Updated fetch wrapper that includes user_id
async function apiFetch(endpoint, options = {}) {
    const url = getApiUrl(endpoint);
    return fetch(url, options);
}

function checkLoginStatus() {
    const mainContent = document.getElementById('mainContent');
    const navBar = document.querySelector('.nav-bar');
    
    if (currentUserId) {
        document.getElementById('loginBtnText').innerText = currentUsername || 'Logout';
        // Hide login modal when logged in
        document.getElementById('loginModal').classList.add('hidden');
        // Add logged-in class to body to show nav bar
        document.body.classList.add('logged-in');
        // Show main content
        if (mainContent) mainContent.classList.remove('hidden');
        // Show nav bar
        if (navBar) navBar.style.display = 'flex';
        
        // Load logger state from server after login
        loadLoggerState();
    } else {
        document.getElementById('loginBtnText').innerText = 'Login';
        // Show login modal when not logged in
        document.getElementById('loginModal').classList.remove('hidden');
        // Remove logged-in class to hide nav bar
        document.body.classList.remove('logged-in');
        // Hide main content
        if (mainContent) mainContent.classList.add('hidden');
        // Hide nav bar
        if (navBar) navBar.style.display = 'none';
    }
}

window.showLoginModal = function() {
    if (currentUserId) {
        // Already logged in - logout using modal
        const modal = document.getElementById('feedbackModal');
        const title = document.getElementById('feedbackTitle');
        const message = document.getElementById('feedbackMessage');
        const icon = document.getElementById('feedbackIcon');
        const btn = document.getElementById('feedbackBtn');
        
        title.innerText = 'Logout';
        title.style.color = 'var(--apple-red)';
        message.innerText = 'Are you sure you want to logout?';
        icon.innerHTML = '<i class="fas fa-sign-out-alt" style="font-size:3rem; color:var(--apple-red);"></i>';
        
        // Create cancel and logout buttons
        btn.innerText = 'Logout';
        btn.style.background = 'linear-gradient(135deg, var(--apple-red), #cc3630)';
        btn.onclick = () => {
            modal.classList.add('hidden');
            localStorage.removeItem('commutesync_user_id');
            localStorage.removeItem('commutesync_username');
            localStorage.removeItem('commutesync_email');
            currentUserId = null;
            currentUsername = null;
            currentEmail = null;
            checkLoginStatus();
            location.reload();
        };
        
        // Add cancel button dynamically
        let cancelBtn = document.getElementById('cancelLogoutBtn');
        if (!cancelBtn) {
            cancelBtn = document.createElement('button');
            cancelBtn.id = 'cancelLogoutBtn';
            cancelBtn.className = 'btn btn-outline';
            cancelBtn.style.marginTop = '12px';
            cancelBtn.innerText = 'Cancel';
            btn.parentNode.insertBefore(cancelBtn, btn.nextSibling);
        }
        cancelBtn.onclick = () => modal.classList.add('hidden');
        
        modal.classList.remove('hidden');
    } else {
        document.getElementById('loginModal').classList.remove('hidden');
        document.getElementById('loginError').innerText = '';
    }
};

window.closeLoginModal = function() {
    document.getElementById('loginModal').classList.add('hidden');
};

window.doLogin = async function() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    
    if (!email || !password) {
        errorEl.innerText = 'Please enter email and password';
        return;
    }
    
    try {
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ email, password })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            errorEl.innerText = data.error || 'Login failed';
            return;
        }
        
        // Save login
        localStorage.setItem('commutesync_user_id', data.user_id);
        localStorage.setItem('commutesync_email', data.email);
        currentUserId = data.user_id;
        currentUsername = data.email;
        currentEmail = data.email;
        
        checkLoginStatus();
        closeLoginModal();
        
        // Sync any pending data after login
        await syncPendingData();
        
        location.reload();
    } catch (e) {
        errorEl.innerText = 'Connection error';
    }
};
