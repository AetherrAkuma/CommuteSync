require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const ss = require('simple-statistics');

const app = express();
const port = process.env.PORT || 3000;

// CORS configuration - allow specific origins
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : ['https://commutesync.onrender.com', "http://127.0.0.1:5500", "https://commute-sync.netlify.app"];

app.use(cors({
    origin: allowedOrigins,
    credentials: true
}));
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Helper to get user_id from query param or header
function getUserId(req) {
    return req.query.user_id || req.headers['x-user-id'] || null;
}

// Helper to convert time string to minutes
function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

// 0. AUTH - Register (optional, can be disabled via Supabase Auth)
app.post('/api/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: "Email and password required" });
        }
        
        // Check if registration is enabled
        const registrationEnabled = process.env.ENABLE_REGISTRATION === 'true';
        
        if (!registrationEnabled) {
            return res.status(403).json({ error: "Registration is disabled" });
        }
        
        // Use Supabase Auth to create user
        const { data, error } = await supabase.auth.signUp({
            email,
            password
        });
        
        if (error) throw error;
        
        res.status(201).json({ 
            success: true, 
            user_id: data.user?.id,
            message: "User registered successfully" 
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 0. AUTH - Login using Supabase Auth
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: "Email and password required" });
        }
        
        // Use Supabase Auth to sign in
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        
        if (error) {
            return res.status(401).json({ error: error.message });
        }
        
        res.json({ 
            success: true, 
            user_id: data.user?.id,
            email: data.user?.email 
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 1. GET ALL ROUTES
app.get('/api/routes', async (req, res) => {
    try {
        const userId = getUserId(req);
        let query = supabase.from('routes').select('*').order('name', { ascending: true });
        
        if (userId) {
            query = query.eq('user_id', userId);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        res.json(data || []);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. GET TRIP HISTORY
app.get('/api/logs', async (req, res) => {
    try {
        const userId = getUserId(req);
        let query = supabase
            .from('trip_logs')
            .select('*, routes(name, mode)')
            .order('date', { ascending: false })
            .limit(50);
        
        if (userId) {
            query = query.eq('user_id', userId);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        res.json(data || []);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3. POST NEW LOG
app.post('/api/log', async (req, res) => {
    try {
        const { route_id, date, timestamps, missed_cycles } = req.body;
        const userId = getUserId(req);
        
        const logData = {
            route_id, date,
            timestamp_arrived_pickup: timestamps.arrived || "00:00:00",
            timestamp_boarded: timestamps.boarded || "00:00:00",
            timestamp_departed: timestamps.departed || "00:00:00",
            timestamp_arrived_dropoff: timestamps.dropped || "00:00:00",
            timestamp_reached_next: timestamps.nextStop || null,
            missed_cycles: missed_cycles || 0
        };
        
        if (userId) {
            logData.user_id = userId;
        }
        
        const { data, error } = await supabase.from('trip_logs').insert([logData]).select();
        if (error) throw error;
        res.status(201).json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 4. PREDICT ENGINE (Non-Hardcoded)
app.post('/api/predict', async (req, res) => {
    try {
        const { route_ids, start_time, date } = req.body;
        const userId = getUserId(req);
        
        console.log("Predict request:", { route_ids, start_time, date, userId });
        
        // Validate start_time - if missing, return error
        if (!start_time) {
            return res.status(400).json({ error: "start_time is required" });
        }
        
        // Use provided date or current date - handle empty string
        const targetDate = (date && date.trim()) ? new Date(date) : new Date();
        const today = targetDate.getDay();
        const dayType = (today === 0) ? 'Sunday/Holiday' : (today === 6 ? 'Saturday' : 'Weekday');
        
        // Create clocks with valid time - default to 08:00 if start_time is invalid
        const validStartTime = (start_time && start_time.includes(':')) ? start_time : '08:00';
        let clocks = { best: new Date(`2000-01-01T${validStartTime}`), safe: new Date(`2000-01-01T${validStartTime}`), worst: new Date(`2000-01-01T${validStartTime}`) };
        let legs = [];

        for (const id of route_ids) {
            // Get route info to determine mode, name, origin, destination
            let routeQuery = supabase.from('routes').select('mode, name, origin, destination').eq('id', id);
            if (userId) {
                routeQuery = routeQuery.eq('user_id', userId);
            }
            const { data: routeData } = await routeQuery.single();
            const routeMode = routeData?.mode || 'QCBus';
            const isWalking = routeMode === 'Walking' || routeMode === 'Bicycle';
            
            let logsQuery = supabase.from('trip_logs').select('*').eq('route_id', id);
            if (userId) {
                logsQuery = logsQuery.eq('user_id', userId);
            }
            const { data: logs } = await logsQuery;
            
            // Get schedules for this route
            let schedulesQuery = supabase.from('route_schedules')
                .select('*')
                .eq('route_id', id)
                .eq('day_type', dayType);
            if (userId) {
                schedulesQuery = schedulesQuery.eq('user_id', userId);
            }
            const { data: schedules } = await schedulesQuery;
            
            console.log(`Route ${id} schedules:`, schedules);
            
            let interval = 0;
            let firstBusTime = null;
            
            if (schedules?.length > 0) {
                // Get the earliest schedule for this day type
                const sortedSchedules = schedules
                    .filter(s => s.start_time)
                    .sort((a, b) => a.start_time.localeCompare(b.start_time));
                
                if (sortedSchedules.length > 0) {
                    const earliest = sortedSchedules[0];
                    firstBusTime = earliest.start_time;
                    interval = earliest.interval_minutes || 0;
                }
            }
            
            // Calculate wait and travel times based on mode
            let wB, wS, wW, tB, tS, tW;
            
            // Check if we have historical data
            const hasHistoricalData = logs && logs.length > 0;
            // Check if we have schedule data
            const hasScheduleData = schedules && schedules.length > 0 && firstBusTime && interval > 0;
            
            if (isWalking) {
                // Walking mode: no waiting, just travel time
                if (hasHistoricalData) {
                    const travels = logs.map(l => {
                        return (new Date(`2000-01-01T${l.timestamp_arrived_dropoff}`) - new Date(`2000-01-01T${l.timestamp_arrived_pickup}`))/60000;
                    });
                    wB = 0; wS = 0; wW = 0;
                    tB = ss.min(travels);
                    tS = ss.mean(travels);
                    tW = ss.max(travels);
                } else {
                    // No data - use reasonable defaults for walking
                    wB = 0; wS = 0; wW = 0;
                    tB = 10; tS = 15; tW = 20;
                }
            } else {
                // Vehicle mode: wait + travel
                
                if (hasHistoricalData) {
                    const waits = logs.map(l => (new Date(`2000-01-01T${l.timestamp_boarded}`) - new Date(`2000-01-01T${l.timestamp_arrived_pickup}`))/60000);
                    const travels = logs.map(l => (new Date(`2000-01-01T${l.timestamp_arrived_dropoff}`) - new Date(`2000-01-01T${l.timestamp_departed}`))/60000);
                    
                    const validWaits = waits.filter(w => w > 0);
                    const validTravels = travels.filter(t => t > 0);
                    
                    // BEST: Lucky - 0 wait + min travel
                    wB = 0;
                    tB = validTravels.length > 0 ? ss.min(validTravels) : 10;
                    
                    // SAFE: Average - avg wait + avg travel
                    const avgHistoricalWait = validWaits.length > 0 ? ss.mean(validWaits) : 5;
                    tS = validTravels.length > 0 ? ss.mean(validTravels) : 15;
                    
                    // WORST: Unlucky - max wait + interval (missed bus) + max travel
                    const maxHistoricalWait = validWaits.length > 0 ? ss.max(validWaits) : 10;
                    tW = validTravels.length > 0 ? ss.max(validTravels) : 20;
                    
                    // Apply schedule adjustments ONLY if we have schedule data
                    if (hasScheduleData && start_time && start_time < firstBusTime) {
                        // User arrives before first bus - wait for first bus
                        const waitForFirst = timeToMinutes(firstBusTime) - timeToMinutes(start_time);
                        wS = Math.max(avgHistoricalWait, waitForFirst);
                        wW = Math.max(maxHistoricalWait, waitForFirst + interval);
                    } else if (hasScheduleData && interval > 0) {
                        // Apply schedule interval to worst case
                        wW = maxHistoricalWait + interval;
                    } else {
                        // No schedule - use historical data only
                        wW = maxHistoricalWait;
                    }
                } else {
                    // No historical logs - use defaults
                    wB = 0;
                    
                    if (hasScheduleData && start_time && firstBusTime && start_time < firstBusTime) {
                        // Has schedule and user departs before first bus
                        const waitForFirst = timeToMinutes(firstBusTime) - timeToMinutes(start_time);
                        wS = waitForFirst;
                        wW = waitForFirst + interval;
                    } else if (hasScheduleData && interval > 0) {
                        // Has schedule - use interval-based defaults
                        wS = interval / 2;
                        wW = interval;
                    } else {
                        // No schedule at all - use generic defaults
                        wS = 5;
                        wW = 15;
                    }
                    tB = 10; tS = 15; tW = 20;
                }
            }

            clocks.best = new Date(clocks.best.getTime() + (wB+tB)*60000);
            clocks.safe = new Date(clocks.safe.getTime() + (wS+tS)*60000);
            clocks.worst = new Date(clocks.worst.getTime() + (wW+tW)*60000);
            
            console.log(`Route ${id}: wait=${wS}/${wW} travel=${tS}/${tW}, interval=${interval}, firstBus=${firstBusTime}, logs=${logs?.length || 0}, schedules=${schedules?.length || 0}`);

            legs.push({ 
                mode: routeMode,
                name: routeData?.name || 'Unknown',
                origin: routeData?.origin || '',
                destination: routeData?.destination || '',
                first_bus: firstBusTime,
                interval: interval,
                arrival_time: {
                    best: clocks.best.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false}),
                    safe: clocks.safe.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false}),
                    worst: clocks.worst.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false})
                },
                timelines: { 
                    safe: {wait: Math.round(wS), travel: Math.round(tS)}, 
                    worst: {wait: Math.round(wW), travel: Math.round(tW)} 
                } 
            });
        }
        res.json({ arrivals: { 
            best: clocks.best.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false}), 
            safe: clocks.safe.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false}), 
            worst: clocks.worst.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false}) 
        }, breakdown: legs });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 5. OTHER UTILS
app.post('/api/routes', async (req, res) => {
    try {
        const userId = getUserId(req);
        const routeData = { ...req.body };
        
        if (userId) {
            routeData.user_id = userId;
        }
        
        console.log("Creating route with data:", routeData);
        const { data, error } = await supabase.from('routes').insert([routeData]).select();
        if (error) {
            console.error("Supabase error:", error);
            return res.status(500).json(error);
        }
        res.status(201).json(data);
    } catch (e) {
        console.error("Route creation error:", e);
        res.status(500).json({ error: e.message });
    }
});

// Drop constraint to allow all modes
app.post('/api/drop-constraint', async (req, res) => {
    try {
        // Note: This requires the service role key with admin privileges
        const { error } = await supabase.rpc('drop_routes_mode_constraint', {});
        if (error) {
            // Try direct SQL via postgres protocol - need to use a different approach
            return res.status(500).json({ error: "Could not drop constraint automatically. Please run this SQL in Supabase dashboard: ALTER TABLE routes DROP CONSTRAINT routes_mode_check;" });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message, hint: "Please run this SQL in Supabase SQL Editor: ALTER TABLE routes DROP CONSTRAINT routes_mode_check;" });
    }
});

// 6. SAVE SCHEDULE
app.post('/api/schedule', async (req, res) => {
    try {
        const userId = getUserId(req);
        const { route_id, day_type, interval_minutes, start_time, end_time } = req.body;
        
        const scheduleData = {
            route_id,
            day_type,
            interval_minutes,
            start_time,
            end_time
        };
        
        if (userId) {
            scheduleData.user_id = userId;
        }
        
        const { data, error } = await supabase.from('route_schedules').insert([scheduleData]).select();
        if (error) throw error;
        res.status(201).json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 7. PRESETS
app.get('/api/presets', async (req, res) => {
    try {
        const userId = getUserId(req);
        let query = supabase.from('presets').select('*').order('name', { ascending: true });
        
        if (userId) {
            query = query.eq('user_id', userId);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        res.json(data || []);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/presets', async (req, res) => {
    try {
        const userId = getUserId(req);
        const { name, route_ids } = req.body;
        
        const presetData = { name, route_ids };
        
        if (userId) {
            presetData.user_id = userId;
        }
        
        const { data, error } = await supabase.from('presets').insert([presetData]).select();
        if (error) throw error;
        res.status(201).json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/presets/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase.from('presets').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/benchmark', async (req, res) => {
    try {
        const userId = getUserId(req);
        let logsQuery = supabase.from('trip_logs').select('*, routes(name, mode)').not('timestamp_arrived_dropoff', 'is', null);
        
        if (userId) {
            logsQuery = logsQuery.eq('user_id', userId);
        }
        
        const { data: logs } = await logsQuery;
        
        if (!logs || logs.length === 0) {
            res.json([]);
            return;
        }
        
        const stats = {};
        logs.forEach(l => {
            const n = l.routes?.name || 'Unknown';
            if(!stats[n]) stats[n] = { times: [], mode: l.routes?.mode };
            
            // Calculate actual travel time
            const actualTravel = (new Date(`2000-01-01T${l.timestamp_arrived_dropoff}`) - new Date(`2000-01-01T${l.timestamp_departed}`))/60000;
            if(actualTravel > 0) stats[n].times.push(actualTravel);
        });
        
        res.json(Object.keys(stats).map(n => {
            const data = stats[n];
            const avg = ss.mean(data.times);
            const stdDev = ss.standardDeviation(data.times);
            const volatility = Math.round(stdDev);
            
            // Accuracy based on volatility (lower is better)
            // 90%+ = within 2 min, 80%+ = within 5 min, 70%+ = within 10 min
            let accuracy;
            if (volatility <= 2) accuracy = 95;
            else if (volatility <= 5) accuracy = 90;
            else if (volatility <= 10) accuracy = 80;
            else if (volatility <= 15) accuracy = 70;
            else accuracy = 60;
            
            return { 
                route: n,
                mode: data.mode,
                total_trips: data.times.length, 
                avg_min: Math.round(avg), 
                volatility_min: volatility, 
                prediction_accuracy: accuracy + "%" 
            };
        }));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 8. DAY OF WEEK DISTRIBUTION
app.get('/api/day-stats', async (req, res) => {
    try {
        const userId = getUserId(req);
        let logsQuery = supabase.from('trip_logs').select('date');
        
        if (userId) {
            logsQuery = logsQuery.eq('user_id', userId);
        }
        
        const { data: logs } = await logsQuery;
        
        if (!logs || logs.length === 0) {
            res.json({ labels: [], data: [] });
            return;
        }
        
        // Count trips by day of week
        const dayCounts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        logs.forEach(l => {
            const dayOfWeek = new Date(l.date).getDay();
            dayCounts[dayOfWeek]++;
        });
        
        const labels = dayNames;
        const data = [dayCounts[0], dayCounts[1], dayCounts[2], dayCounts[3], dayCounts[4], dayCounts[5], dayCounts[6]];
        
        res.json({ labels, data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 10. LOGGER SESSION - Server-side persistence
// GET current in-progress session
app.get('/api/logger-session', async (req, res) => {
    try {
        const userId = getUserId(req);
        
        if (!userId) {
            return res.status(400).json({ error: "User ID required" });
        }
        
        let query = supabase
            .from('logger_sessions')
            .select('*')
            .eq('status', 'in_progress')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1);
        
        const { data, error } = await query;
        
        if (error) {
            console.error("Get logger session error:", error);
            return res.status(500).json({ error: "Failed to get session: " + error.message });
        }
        
        if (data && data.length > 0) {
            res.json(data[0]);
        } else {
            res.json(null);
        }
    } catch (e) { 
        console.error("Get logger session exception:", e);
        res.status(500).json({ error: e.message }); 
    }
});

// POST create or update session
app.post('/api/logger-session', async (req, res) => {
    try {
        let { route_id, timestamps, missed_cycles } = req.body;
        const userId = getUserId(req);
        
        console.log("Logger session request:", { route_id, timestamps, missed_cycles, userId });
        
        if (!userId) {
            return res.status(400).json({ error: "User ID required" });
        }
        
        // Handle empty/null route_id - convert to null for UUID column
        if (!route_id || route_id === '') {
            route_id = null;
        }
        
        // Check for existing in-progress session
        let existingQuery = supabase
            .from('logger_sessions')
            .select('id')
            .eq('status', 'in_progress')
            .eq('user_id', userId)
            .limit(1);
        
        const { data: existing, error: fetchError } = await existingQuery;
        
        if (fetchError) {
            console.error("Fetch existing session error:", fetchError);
            return res.status(500).json({ error: "Failed to fetch session: " + fetchError.message });
        }
        
        if (existing && existing.length > 0) {
            // Update existing session
            const updateData = {
                timestamps: timestamps || {},
                missed_cycles: missed_cycles || 0,
                updated_at: new Date().toISOString()
            };
            if (route_id) {
                updateData.route_id = route_id;
            }
            
            const { data, error } = await supabase
                .from('logger_sessions')
                .update(updateData)
                .eq('id', existing[0].id)
                .select()
                .single();
            
            if (error) {
                console.error("Update session error:", error);
                return res.status(500).json({ error: "Failed to update session: " + error.message });
            }
            res.json(data);
        } else {
            // Create new session
            const insertData = {
                user_id: userId,
                timestamps: timestamps || {},
                missed_cycles: missed_cycles || 0,
                status: 'in_progress'
            };
            
            if (route_id) {
                insertData.route_id = route_id;
            }
            
            console.log("Creating new session with:", insertData);
            
            const { data, error } = await supabase
                .from('logger_sessions')
                .insert([insertData])
                .select()
                .single();
            
            if (error) {
                console.error("Insert session error:", error);
                return res.status(500).json({ error: "Failed to create session: " + error.message });
            }
            res.status(201).json(data);
        }
    } catch (e) { 
        console.error("Logger session exception:", e);
        res.status(500).json({ error: e.message }); 
    }
});

// DELETE clear session (after save or manual reset)
app.delete('/api/logger-session', async (req, res) => {
    try {
        const userId = getUserId(req);
        
        if (!userId) {
            return res.status(400).json({ error: "User ID required" });
        }
        
        const { error } = await supabase
            .from('logger_sessions')
            .delete()
            .eq('status', 'in_progress')
            .eq('user_id', userId);
        
        if (error) throw error;
        
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 11. SINGLE TIMESTAMP - For Shortcuts/MacroDroid integration
// POST a single timestamp (arrived, boarded, departed, or dropped)
app.post('/api/log-timestamp', async (req, res) => {
    try {
        const { route_id, timestamp_type, time, missed_cycles } = req.body;
        const userId = getUserId(req);
        
        if (!userId) {
            return res.status(400).json({ error: "User ID required (add ?user_id=YOUR_ID to URL)" });
        }
        
        if (!route_id || !timestamp_type || !time) {
            return res.status(400).json({ error: "route_id, timestamp_type, and time are required" });
        }
        
        // Valid timestamp types
        const validTypes = ['arrived', 'boarded', 'departed', 'dropped'];
        if (!validTypes.includes(timestamp_type)) {
            return res.status(400).json({ error: "timestamp_type must be: arrived, boarded, departed, or dropped" });
        }
        
        // Find existing in-progress session for this user
        let existingQuery = supabase
            .from('logger_sessions')
            .select('*')
            .eq('status', 'in_progress')
            .eq('user_id', userId)
            .limit(1);
        
        const { data: existing } = await existingQuery;
        
        let sessionId;
        let currentTimestamps = {};
        let currentMissedCycles = missed_cycles || 0;
        
        if (existing && existing.length > 0) {
            // Use existing session
            sessionId = existing[0].id;
            currentTimestamps = existing[0].timestamps || {};
            currentMissedCycles = existing[0].missed_cycles || 0;
        } else {
            // Create new session if none exists
            // If this is not the first timestamp (arrived), we can't proceed
            if (timestamp_type !== 'arrived') {
                return res.status(400).json({ error: "No active session. Start with arrived timestamp." });
            }
        }
        
        // Update the timestamp
        currentTimestamps[timestamp_type] = time;
        
        // Preserve missed_cycles if not provided
        if (missed_cycles === undefined || missed_cycles === null) {
            missed_cycles = currentMissedCycles;
        }
        
        if (sessionId) {
            // Update existing session
            const { data, error } = await supabase
                .from('logger_sessions')
                .update({
                    route_id,
                    timestamps: currentTimestamps,
                    missed_cycles,
                    updated_at: new Date().toISOString()
                })
                .eq('id', sessionId)
                .select()
                .single();
            
            if (error) throw error;
            res.json({ success: true, session: data });
        } else {
            // Create new session
            const { data, error } = await supabase
                .from('logger_sessions')
                .insert([{
                    user_id: userId,
                    route_id,
                    timestamps: currentTimestamps,
                    missed_cycles,
                    status: 'in_progress'
                }])
                .select()
                .single();
            
            if (error) throw error;
            res.status(201).json({ success: true, session: data });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 9. ANALYTICS
app.get('/api/analytics', async (req, res) => {
    try {
        const userId = getUserId(req);
        
        // Get user's routes with their stats
        let routesQuery = supabase.from('routes').select('*');
        let logsQuery = supabase.from('trip_logs').select('*');
        
        if (userId) {
            routesQuery = routesQuery.eq('user_id', userId);
            logsQuery = logsQuery.eq('user_id', userId);
        }
        
        const { data: routes } = await routesQuery;
        const { data: logs } = await logsQuery;
        
        const analytics = routes.map(route => {
            const routeLogs = logs.filter(l => l.route_id === route.id);
            
            if (routeLogs.length === 0) {
                return {
                    route_id: route.id,
                    route_name: route.name,
                    mode: route.mode,
                    origin: route.origin,
                    destination: route.destination,
                    total_trips: 0,
                    avg_wait: 0,
                    avg_travel: 0,
                    avg_total: 0,
                    min_wait: 0,
                    max_wait: 0,
                    min_travel: 0,
                    max_travel: 0,
                    missed_cycles_avg: 0
                };
            }
            
            const waits = routeLogs.map(l => {
                const w = (new Date(`2000-01-01T${l.timestamp_boarded}`) - new Date(`2000-01-01T${l.timestamp_arrived_pickup}`))/60000;
                return w > 0 ? w : 0;
            });
            
            const travels = routeLogs.map(l => {
                const t = (new Date(`2000-01-01T${l.timestamp_arrived_dropoff}`) - new Date(`2000-01-01T${l.timestamp_departed}`))/60000;
                return t > 0 ? t : 0;
            });
            
            const totals = waits.map((w, i) => w + travels[i]);
            const missed = routeLogs.map(l => l.missed_cycles || 0);
            
            const isWalking = route.mode === 'Walking' || route.mode === 'Bicycle';
            
            return {
                route_id: route.id,
                route_name: route.name,
                mode: route.mode,
                origin: route.origin,
                destination: route.destination,
                total_trips: routeLogs.length,
                avg_wait: isWalking ? 0 : Math.round(ss.mean(waits)),
                avg_travel: Math.round(ss.mean(travels)),
                avg_total: Math.round(ss.mean(totals)),
                min_wait: isWalking ? 0 : Math.round(ss.min(waits)),
                max_wait: isWalking ? 0 : Math.round(ss.max(waits)),
                min_travel: Math.round(ss.min(travels)),
                max_travel: Math.round(ss.max(travels)),
                missed_cycles_avg: Math.round(ss.mean(missed))
            };
        });
        
        res.json(analytics);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(port, () => console.log(`Server running on ${port}`));
