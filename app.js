/**
 * COMMUTESYNC PRO - MASTER LOGIC
 * Dependencies: simple-statistics (ss), Chart.js, FontAwesome
 */

const ss = window.ss || window.statistics;
const API_URL = 'http://localhost:3000/api';

// --- CONFIGURATION: TRANSPORT MODES ---
const MODE_MAP = {
    'Bus':     { icon: 'fa-bus',           class: 'mode-bus' },
    'QCBus':   { icon: 'fa-bus-simple',    class: 'mode-qcbus' },
    'Train':   { icon: 'fa-train-subway',  class: 'mode-train' },
    'Jeep':    { icon: 'fa-shuttle-van',   class: 'mode-jeep' },
    'Ejeep':   { icon: 'fa-bolt',          class: 'mode-ejeep' },
    'Walking': { icon: 'fa-walking',       class: 'mode-walk' },
    'Default': { icon: 'fa-route',         class: 'mode-bus' }
};

// --- GLOBAL STATE ---
let tripData = { timestamps: {} };
let missedCycles = 0;
let availableRoutes = [];
let myChart = null;
let currentMode = "Vehicle";

// ==========================================
// 1. FAIL-SAFE HELPERS
// ==========================================

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

async function runBenchmark() {
    try {
        const res = await fetch(`${API_URL}/benchmark`);
        const data = await res.json();
        const tbody = document.querySelector('#benchmarkTable tbody');
        if(!tbody) return;

        tbody.innerHTML = data.map(row => {
            const accVal = parseInt(row.prediction_accuracy);
            const color = accVal > 80 ? '#10b981' : (accVal > 50 ? '#f59e0b' : '#ef4444');
            return `<tr>
                <td style="font-weight:700;">${row.route}</td>
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
        const res = await fetch(`${API_URL}/logs`);
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

            return `<tr>
                <td>${dateStr}</td>
                <td style="font-weight:600;">${routeName}</td>
                <td>${wait}m</td>
                <td>${travel}m</td>
            </tr>`;
        }).join('');

        renderEfficiencyChart(logs);
    } catch(e) {
        console.error("History Loading Failed.");
    }
}

async function loadRoutes() {
    try {
        const res = await fetch(`${API_URL}/routes`);
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

        logSelect.onchange = () => {
            const opt = logSelect.options[logSelect.selectedIndex];
            if (opt.value) {
                document.getElementById('routeDetails').innerText = `${opt.dataset.origin} ➔ ${opt.dataset.dest}`;
                setLoggerMode(opt.dataset.mode);
            }
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
            tripData.timestamps[key] = getTime();
            this.className = "btn btn-success";
            this.disabled = true;
            this.innerHTML += ' <i class="fas fa-check"></i>';
            if(index < actionBtns.length - 1) {
                const next = document.getElementById(actionBtns[index+1]);
                next.disabled = false;
                next.className = "btn btn-primary";
            } else {
                enableEndingStage();
            }
        };
    }
});

document.getElementById('btnStartWalk').onclick = function() {
    const now = getTime();
    tripData.timestamps = { arrived: now, boarded: now, departed: now };
    this.className = "btn btn-success";
    this.disabled = true;
    enableEndingStage();
};

function enableEndingStage() {
    const drop = document.getElementById('btnDropped');
    drop.disabled = false;
    drop.className = "btn btn-primary";
}

document.getElementById('btnDropped').onclick = function() {
    tripData.timestamps['dropped'] = getTime();
    this.className = "btn btn-success";
    this.disabled = true;
    document.getElementById('btnNext').disabled = false;
    document.getElementById('btnNext').className = "btn btn-primary";
    document.getElementById('saveSection').classList.remove('hidden');
};

document.getElementById('btnNext').onclick = function() {
    tripData.timestamps['nextStop'] = getTime();
    this.className = "btn btn-success";
    this.disabled = true;
};

// ==========================================
// 5. PREDICTION & SAVE ENGINE
// ==========================================

function addRouteToChain() {
    const container = document.getElementById('routeChainContainer');
    const div = document.createElement('div');
    // Ensure the data-mode is passed to the prediction selects
    const options = availableRoutes.map(r => `<option value="${r.id}" data-mode="${r.mode}">${r.name}</option>`).join('');
    div.innerHTML = `<select class="route-select" style="margin-bottom:10px">
        <option value="">-- Select Stop --</option>
        ${options}
    </select>`;
    container.appendChild(div);
}

async function calculatePrediction() {
    const start = document.getElementById('predictStartTime').value;
    const selects = Array.from(document.querySelectorAll('.route-select'));
    const ids = selects.map(s => s.value).filter(v => v);
    
    if(ids.length === 0) return alert("Select at least one stop.");

    try {
        const res = await fetch(`${API_URL}/predict`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ start_time: start, route_ids: ids })
        });
        const data = await res.json();
        
        document.getElementById('predictionResult').classList.remove('hidden');
        document.getElementById('timeBest').innerText = data.arrivals.best;
        document.getElementById('timeSafe').innerText = data.arrivals.safe;
        document.getElementById('timeWorst').innerText = data.arrivals.worst;

        const detailsContainer = document.getElementById('predDetails');
        
        detailsContainer.innerHTML = data.breakdown.map((leg, i) => {
            const selectedOpt = selects[i].options[selects[i].selectedIndex];
            const name = selectedOpt.text;
            const mode = selectedOpt.dataset.mode || 'Default';
            const modeInfo = MODE_MAP[mode] || MODE_MAP['Default'];
            
            const delay = (leg.timelines.worst.wait + leg.timelines.worst.travel) - (leg.timelines.safe.wait + leg.timelines.safe.travel);
            
            return `
            <div class="itinerary-step">
                <div class="itinerary-dot mode-aware ${modeInfo.class}">
                    <i class="fas ${modeInfo.icon}"></i>
                </div>
                <div class="step-header">
                    <span class="step-title">${name}</span>
                </div>
                <div class="step-meta">
                    <div class="meta-box">
                        <span class="meta-label">Waiting</span>
                        <span>${leg.timelines.safe.wait}m</span>
                    </div>
                    <div class="meta-box">
                        <span class="meta-label">Transit</span>
                        <span>${leg.timelines.safe.travel}m</span>
                    </div>
                </div>
                ${delay > 0 ? `<div class="risk-alert"><i class="fas fa-exclamation-triangle"></i> Variance Risk: +${delay}m</div>` : ''}
            </div>`;
        }).join('');
    } catch(e) { alert("Prediction error."); }
}

async function saveManualLog() {
    const routeId = document.getElementById('logRouteSelect').value;
    const date = document.getElementById('manualDate').value;
    const missed = document.getElementById('manualCycles').value || 0;
    
    if(!routeId || !date) return alert("Route and Date required.");

    const body = {
        route_id: routeId,
        date: date,
        timestamps: {
            arrived: document.getElementById('manualArrived').value,
            boarded: document.getElementById('manualBoarded').value,
            departed: document.getElementById('manualDeparted').value,
            dropped: document.getElementById('manualDropped').value
        },
        missed_cycles: parseInt(missed)
    };

    try {
        await fetch(`${API_URL}/log`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
        location.reload();
    } catch(e) { alert("Save failed."); }
}

// ==========================================
// 6. GLOBAL BRIDGE
// ==========================================

function switchTab(viewId, btn) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    btn.classList.add('active');
    if (viewId === 'view-manage') { loadLogs(); runBenchmark(); }
}

window.switchTab = switchTab;
window.runBenchmark = runBenchmark;
window.saveManualLog = saveManualLog;
window.adjustCycles = (a) => { missedCycles = Math.max(0, missedCycles + a); document.getElementById('cycleCount').innerText = missedCycles; };
window.calculatePrediction = calculatePrediction;
window.addRouteToChain = addRouteToChain;
window.toggleManualMode = () => {
    document.getElementById('liveLoggerUI').classList.toggle('hidden');
    document.getElementById('manualLoggerUI').classList.toggle('hidden');
};
window.toggleCustomMode = (select) => {
    const input = document.getElementById('customModeInput');
    select.value === 'Custom' ? input.classList.remove('hidden') : input.classList.add('hidden');
};

document.addEventListener('DOMContentLoaded', () => {
    loadRoutes();
    setInterval(() => {
        const clock = document.getElementById('mainClock');
        if(clock) clock.innerText = new Date().toLocaleTimeString([], { hour12: false });
    }, 1000);
});