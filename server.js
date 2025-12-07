const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const admin = require('firebase-admin');
const WebSocket = require('ws');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./pipeline.db');

// ==================== FIREBASE ADMIN INITIALIZATION ====================

const serviceAccount = require('./firebase-service-account.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://jal-mahakal-shakti-default-rtdb.asia-southeast1.firebasedatabase.app/'
});

const firebaseDb = admin.database();

// ==================== DATABASE SETUP ====================

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS pipelines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nodes TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS tanks (
            tankId TEXT PRIMARY KEY,
            deviceId TEXT,
            name TEXT NOT NULL,
            state TEXT,
            district TEXT,
            mandal TEXT,
            habitation TEXT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            type TEXT NOT NULL,
            shape TEXT NOT NULL,
            diameter REAL NOT NULL,
            height REAL NOT NULL,
            sensorHeight REAL NOT NULL,
            capacity REAL NOT NULL,
            waterLevel REAL DEFAULT 0,
            isActive INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS gate_valves (
            valveId TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            category TEXT NOT NULL,
            parentValveId TEXT,
            households INTEGER NOT NULL,
            flowRate REAL NOT NULL,
            mandal TEXT,
            habitation TEXT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            isOpen INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (parentValveId) REFERENCES gate_valves(valveId) ON DELETE SET NULL
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS sensor_data_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            deviceId TEXT NOT NULL,
            tankId TEXT,
            waterLevel REAL,
            volumeLiters REAL,
            pressure REAL,
            temperature REAL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            rawData TEXT,
            FOREIGN KEY (tankId) REFERENCES tanks(tankId) ON DELETE CASCADE
        )
    `, (err) => {
        if (err) {
            console.error('❌ Error creating sensor_data_history table:', err);
        } else {
            console.log('✅ All tables created successfully');
        }
    });
    
    db.run(`CREATE INDEX IF NOT EXISTS idx_sensor_deviceId ON sensor_data_history(deviceId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_sensor_timestamp ON sensor_data_history(timestamp)`);
});

// ==================== SSE CLIENT MANAGEMENT ====================

const sseClients = new Map();
const firebaseListeners = new Map();

// ==================== SENSOR DATA CALCULATION UTILITIES ====================

function calculateWaterMetrics(sensorHeight, tankDiameter, tankHeight, tankCapacity, tankShape) {
    const waterLevel = sensorHeight;
    let volumeLiters = 0;
    let percentageFull = 0;
    
    if (tankShape === 'Cylinder') {
        const radius = tankDiameter / 2;
        const volumeM3 = Math.PI * Math.pow(radius, 2) * waterLevel;
        volumeLiters = volumeM3 * 1000;
    } else if (tankShape === 'Cuboid') {
        const volumeM3 = tankDiameter * tankDiameter * waterLevel;
        volumeLiters = volumeM3 * 1000;
    }
    
    percentageFull = (volumeLiters / tankCapacity) * 100;
    const pressureKPa = (1000 * 9.81 * waterLevel) / 1000;
    
    return {
        waterLevel: parseFloat(waterLevel.toFixed(2)),
        volumeLiters: parseFloat(volumeLiters.toFixed(2)),
        percentageFull: parseFloat(percentageFull.toFixed(2)),
        pressureKPa: parseFloat(pressureKPa.toFixed(2))
    };
}

// ==================== FIREBASE REAL-TIME LISTENER ====================

function startRealtimeListener(deviceId, tankId) {
    if (firebaseListeners.has(deviceId)) {
        console.log(`⏭️  Already listening to device ${deviceId}`);
        return;
    }
    
    console.log(`🎧 Starting real-time listener for device ${deviceId}`);
    
    const deviceRef = firebaseDb.ref(`devices/${deviceId}/latest`);
    
    const listener = deviceRef.on('value', async (snapshot) => {
        const sensorData = snapshot.val();
        
        if (!sensorData) {
            console.log(`⚠️  No data for device ${deviceId}`);
            return;
        }
        
        console.log(`🔥 Received real-time update for device ${deviceId}:`, sensorData);
        
        db.get('SELECT * FROM tanks WHERE deviceId = ?', [deviceId], (err, tank) => {
            if (err || !tank) {
                console.error(`❌ Tank not found for device ${deviceId}`);
                return;
            }
            
            const metrics = calculateWaterMetrics(
                sensorData.waterLevel || sensorData.sensorHeight || 0,
                tank.diameter,
                tank.height,
                tank.capacity,
                tank.shape
            );
            
            metrics.temperature = sensorData.temperature || null;
            metrics.timestamp = sensorData.timestamp || new Date().toISOString();
            
            db.run(
                `INSERT INTO sensor_data_history 
                (deviceId, tankId, waterLevel, volumeLiters, pressure, temperature, timestamp, rawData) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    deviceId,
                    tank.tankId,
                    metrics.waterLevel,
                    metrics.volumeLiters,
                    metrics.pressureKPa,
                    metrics.temperature,
                    metrics.timestamp,
                    JSON.stringify(sensorData)
                ],
                (insertErr) => {
                    if (insertErr) {
                        console.error('❌ Error storing sensor data:', insertErr);
                    } else {
                        console.log(`💾 Stored sensor data for device ${deviceId}`);
                    }
                }
            );
            
            db.run(
                'UPDATE tanks SET waterLevel = ? WHERE deviceId = ?',
                [metrics.waterLevel, deviceId]
            );
            
            // Send to SSE clients only (not WebSocket)
            const clients = sseClients.get(deviceId) || [];
            const payload = {
                deviceId,
                tankId: tank.tankId,
                ...metrics,
                rawData: sensorData
            };
            
            const message = `data: ${JSON.stringify(payload)}\n\n`;
            clients.forEach(client => {
                try {
                    client.write(message);
                } catch (err) {
                    console.error(`❌ Error sending to client:`, err);
                }
            });
            
            console.log(`📤 Broadcasted sensor data to ${clients.length} SSE client(s)`);
        });
    }, (error) => {
        console.error(`❌ Firebase listener error for device ${deviceId}:`, error);
    });
    
    firebaseListeners.set(deviceId, { ref: deviceRef, listener });
}

function stopRealtimeListener(deviceId) {
    const listenerInfo = firebaseListeners.get(deviceId);
    if (listenerInfo) {
        listenerInfo.ref.off('value', listenerInfo.listener);
        firebaseListeners.delete(deviceId);
        console.log(`🔇 Stopped real-time listener for device ${deviceId}`);
    }
}

// ==================== SSE STREAMING ENDPOINT ====================

app.get('/api/stream/device/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    
    console.log(`🔌 Client connected to SSE stream for device ${deviceId}`);
    
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });
    
    if (!sseClients.has(deviceId)) {
        sseClients.set(deviceId, []);
    }
    sseClients.get(deviceId).push(res);
    
    db.get('SELECT tankId FROM tanks WHERE deviceId = ?', [deviceId], (err, tank) => {
        if (tank) {
            startRealtimeListener(deviceId, tank.tankId);
        }
    });
    
    res.write(`data: ${JSON.stringify({ status: 'connected', deviceId })}\n\n`);
    
    // Send last known data immediately
    db.get(
        `SELECT * FROM sensor_data_history 
         WHERE deviceId = ? 
         ORDER BY timestamp DESC 
         LIMIT 1`,
        [deviceId],
        (err, row) => {
            if (row) {
                const data = {
                    deviceId,
                    tankId: row.tankId,
                    waterLevel: row.waterLevel,
                    volumeLiters: row.volumeLiters,
                    pressureKPa: row.pressure,
                    temperature: row.temperature,
                    timestamp: row.timestamp,
                    rawData: JSON.parse(row.rawData)
                };
                res.write(`data: ${JSON.stringify(data)}\n\n`);
            }
        }
    );
    
    req.on('close', () => {
        console.log(`🔌 Client disconnected from SSE stream for device ${deviceId}`);
        const clients = sseClients.get(deviceId) || [];
        const index = clients.indexOf(res);
        if (index !== -1) {
            clients.splice(index, 1);
        }
        
        if (clients.length === 0) {
            sseClients.delete(deviceId);
            stopRealtimeListener(deviceId);
        }
    });
});

// ==================== REST API ENDPOINTS FOR SENSOR DATA ====================

app.get('/api/sensor/device/:deviceId/latest', (req, res) => {
    const { deviceId } = req.params;
    
    db.get(
        `SELECT * FROM sensor_data_history 
         WHERE deviceId = ? 
         ORDER BY timestamp DESC 
         LIMIT 1`,
        [deviceId],
        (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (!row) {
                return res.status(404).json({ error: 'No data found' });
            }
            res.json({
                ...row,
                rawData: JSON.parse(row.rawData)
            });
        }
    );
});

app.get('/api/sensor/device/:deviceId/history', (req, res) => {
    const { deviceId } = req.params;
    const { hours = 24, limit = 100 } = req.query;
    
    const hoursAgo = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    
    db.all(
        `SELECT * FROM sensor_data_history 
         WHERE deviceId = ? AND timestamp >= ?
         ORDER BY timestamp DESC
         LIMIT ?`,
        [deviceId, hoursAgo, parseInt(limit)],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json(rows.map(row => ({
                ...row,
                rawData: JSON.parse(row.rawData)
            })));
        }
    );
});

app.get('/api/sensor/tank/:tankId/latest', (req, res) => {
    const { tankId } = req.params;
    
    db.get(
        `SELECT * FROM sensor_data_history 
         WHERE tankId = ? 
         ORDER BY timestamp DESC 
         LIMIT 1`,
        [tankId],
        (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (!row) {
                return res.status(404).json({ error: 'No data found' });
            }
            res.json({
                ...row,
                rawData: JSON.parse(row.rawData)
            });
        }
    );
});

app.post('/api/sensor/data', (req, res) => {
    const { deviceId, tankId, waterLevel, temperature } = req.body;
    
    if (!deviceId || waterLevel === undefined) {
        return res.status(400).json({ error: 'deviceId and waterLevel required' });
    }
    
    db.get('SELECT * FROM tanks WHERE deviceId = ?', [deviceId], (err, tank) => {
        if (err || !tank) {
            return res.status(404).json({ error: 'Tank not found for this device' });
        }
        
        const metrics = calculateWaterMetrics(
            waterLevel,
            tank.diameter,
            tank.height,
            tank.capacity,
            tank.shape
        );
        
        metrics.temperature = temperature || null;
        metrics.timestamp = new Date().toISOString();
        
        db.run(
            `INSERT INTO sensor_data_history 
            (deviceId, tankId, waterLevel, volumeLiters, pressure, temperature, timestamp, rawData) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                deviceId,
                tank.tankId,
                metrics.waterLevel,
                metrics.volumeLiters,
                metrics.pressureKPa,
                metrics.temperature,
                metrics.timestamp,
                JSON.stringify(req.body)
            ],
            function(insertErr) {
                if (insertErr) {
                    return res.status(500).json({ error: insertErr.message });
                }
                
                // Send to SSE clients
                const clients = sseClients.get(deviceId) || [];
                const payload = {
                    deviceId,
                    tankId: tank.tankId,
                    ...metrics,
                    rawData: req.body
                };
                
                clients.forEach(client => {
                    try {
                        client.write(`data: ${JSON.stringify(payload)}\n\n`);
                    } catch (err) {
                        console.error('Error sending to SSE client:', err);
                    }
                });
                
                res.json({ success: true, id: this.lastID, metrics });
            }
        );
    });
});

// ==================== PIPELINES ENDPOINTS ====================

app.post('/api/pipeline', (req, res) => {
    const { nodes } = req.body;
    if (!nodes || !Array.isArray(nodes)) {
        return res.status(400).json({ error: 'Nodes array is required' });
    }
    db.run('INSERT INTO pipelines (nodes) VALUES (?)', [JSON.stringify(nodes)], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, message: 'Pipeline saved' });
    });
});

app.get('/api/pipelines', (req, res) => {
    db.all('SELECT * FROM pipelines ORDER BY created_at DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/pipeline/:id', (req, res) => {
    db.get('SELECT * FROM pipelines WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Pipeline not found' });
        res.json(row);
    });
});

app.put('/api/pipeline/:id', (req, res) => {
    const { nodes } = req.body;
    if (!nodes || !Array.isArray(nodes)) {
        return res.status(400).json({ error: 'Nodes array is required' });
    }
    db.run('UPDATE pipelines SET nodes = ? WHERE id = ?', [JSON.stringify(nodes), req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Pipeline updated' });
    });
});

app.delete('/api/pipeline/:id', (req, res) => {
    db.run('DELETE FROM pipelines WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Pipeline deleted' });
    });
});

// ==================== TANKS ENDPOINTS ====================

app.post('/api/tank', (req, res) => {
    const tank = req.body;
    if (!tank.tankId || !tank.name || !tank.latitude || !tank.longitude) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    db.run(
        `INSERT INTO tanks (tankId, deviceId, name, state, district, mandal, habitation, latitude, longitude, type, shape, diameter, height, sensorHeight, capacity, waterLevel, isActive) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tank.tankId, tank.deviceId || '', tank.name, tank.state || '', tank.district || '', tank.mandal || '', tank.habitation || '', 
         tank.latitude, tank.longitude, tank.type, tank.shape, tank.diameter, tank.height, tank.sensorHeight, tank.capacity, tank.waterLevel || 0, tank.isActive ? 1 : 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ tankId: tank.tankId, message: 'Tank added' });
        }
    );
});

app.get('/api/tanks', (req, res) => {
    db.all('SELECT * FROM tanks ORDER BY created_at DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const tanks = rows.map(row => ({ ...row, isActive: row.isActive === 1 }));
        res.json(tanks);
    });
});

app.get('/api/tank/:tankId', (req, res) => {
    db.get('SELECT * FROM tanks WHERE tankId = ?', [req.params.tankId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Tank not found' });
        row.isActive = row.isActive === 1;
        res.json(row);
    });
});

// 🎯 KEY FIX: Debounced broadcast to prevent spam
let broadcastTimeout = null;
const BROADCAST_DELAY = 300; // 300ms debounce

app.put('/api/tank/:tankId', (req, res) => {
    const tank = req.body;
    const updates = [];
    const values = [];
    Object.keys(tank).forEach(key => {
        if (key !== 'tankId') {
            updates.push(`${key} = ?`);
            values.push(key === 'isActive' ? (tank[key] ? 1 : 0) : tank[key]);
        }
    });
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    values.push(req.params.tankId);
    
    db.run(`UPDATE tanks SET ${updates.join(', ')} WHERE tankId = ?`, values, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        // Debounced broadcast to prevent rapid-fire updates
        clearTimeout(broadcastTimeout);
        broadcastTimeout = setTimeout(() => {
            db.get('SELECT * FROM tanks WHERE tankId = ?', [req.params.tankId], (err, updatedTank) => {
                if (updatedTank) {
                    updatedTank.isActive = updatedTank.isActive === 1;
                    broadcastToAll({
                        type: 'tank_updated',
                        tank: updatedTank
                    });
                    console.log(`📡 Broadcasted tank update: ${updatedTank.tankId} (isActive: ${updatedTank.isActive})`);
                }
            });
        }, BROADCAST_DELAY);
        
        res.json({ message: 'Tank updated' });
    });
});

app.delete('/api/tank/:tankId', (req, res) => {
    db.run('DELETE FROM tanks WHERE tankId = ?', [req.params.tankId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        // Broadcast deletion
        broadcastToAll({
            type: 'tank_deleted',
            tankId: req.params.tankId
        });
        
        res.json({ message: 'Tank deleted' });
    });
});

// ==================== VALVES ENDPOINTS ====================

app.post('/api/valve', (req, res) => {
    const valve = req.body;
    if (!valve.valveId || !valve.name || !valve.latitude || !valve.longitude) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    db.run(
        `INSERT INTO gate_valves (valveId, name, type, category, parentValveId, households, flowRate, mandal, habitation, latitude, longitude, isOpen) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [valve.valveId, valve.name, valve.type, valve.category, valve.parentValveId || null, valve.households || 0, 
         valve.flowRate || 0, valve.mandal || '', valve.habitation || '', valve.latitude, valve.longitude, valve.isOpen ? 1 : 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ valveId: valve.valveId, message: 'Valve added' });
        }
    );
});

app.get('/api/valves', (req, res) => {
    db.all('SELECT * FROM gate_valves ORDER BY created_at DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const valves = rows.map(row => ({ ...row, isOpen: row.isOpen === 1 }));
        res.json(valves);
    });
});

app.get('/api/valve/:valveId', (req, res) => {
    db.get('SELECT * FROM gate_valves WHERE valveId = ?', [req.params.valveId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Valve not found' });
        row.isOpen = row.isOpen === 1;
        res.json(row);
    });
});

app.put('/api/valve/:valveId', (req, res) => {
    const valve = req.body;
    const updates = [];
    const values = [];
    Object.keys(valve).forEach(key => {
        if (key !== 'valveId') {
            updates.push(`${key} = ?`);
            values.push(key === 'isOpen' ? (valve[key] ? 1 : 0) : (key === 'parentValveId' ? (valve[key] || null) : valve[key]));
        }
    });
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    values.push(req.params.valveId);
    
    db.run(`UPDATE gate_valves SET ${updates.join(', ')} WHERE valveId = ?`, values, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Valve not found' });
        
        // Debounced valve broadcast
        db.get('SELECT * FROM gate_valves WHERE valveId = ?', [req.params.valveId], (err, updatedValve) => {
            if (updatedValve) {
                updatedValve.isOpen = updatedValve.isOpen === 1;
                broadcastToAll({
                    type: 'valve_updated',
                    valve: updatedValve
                });
                console.log(`📡 Broadcasted valve update: ${updatedValve.valveId} (isOpen: ${updatedValve.isOpen})`);
            }
        });
        
        res.json({ message: 'Valve updated', changes: this.changes });
    });
});

app.delete('/api/valve/:valveId', (req, res) => {
    db.run('UPDATE gate_valves SET parentValveId = NULL WHERE parentValveId = ?', [req.params.valveId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.run('DELETE FROM gate_valves WHERE valveId = ?', [req.params.valveId], function(delErr) {
            if (delErr) return res.status(500).json({ error: delErr.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Valve not found' });
            res.json({ message: 'Valve deleted', changes: this.changes });
        });
    });
});

app.patch('/api/valve/:valveId/toggle', (req, res) => {
    db.get('SELECT isOpen FROM gate_valves WHERE valveId = ?', [req.params.valveId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Valve not found' });
        const newState = row.isOpen === 1 ? 0 : 1;
        db.run('UPDATE gate_valves SET isOpen = ? WHERE valveId = ?', [newState, req.params.valveId], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            db.get('SELECT * FROM gate_valves WHERE valveId = ?', [req.params.valveId], (err, updatedValve) => {
                if (updatedValve) {
                    updatedValve.isOpen = updatedValve.isOpen === 1;
                    broadcastToAll({
                        type: 'valve_updated',
                        valve: updatedValve
                    });
                }
            });
            
            res.json({ message: 'Valve toggled', isOpen: newState === 1, valveId: req.params.valveId });
        });
    });
});

// ==================== ERROR HANDLING ====================

app.use((req, res) => {
    res.status(404).json({ error: `Cannot ${req.method} ${req.path}` });
});

app.use((err, req, res, next) => {
    console.error('❌ Server error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
});

// ==================== WEBSOCKET SERVER - OPTIMIZED ====================

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const wsClients = new Set();

wss.on('connection', (ws) => {
    console.log('🔌 New WebSocket client connected');
    wsClients.add(ws);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 Received from client:', data);
            
            // Optional: Handle client requests if needed
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            }
        } catch (err) {
            console.error('Error parsing WebSocket message:', err);
        }
    });

    ws.on('close', () => {
        console.log('🔌 WebSocket client disconnected');
        wsClients.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        wsClients.delete(ws);
    });

    // Send connection confirmation
    ws.send(JSON.stringify({
        type: 'connected',
        message: 'Connected to Water Monitoring WebSocket',
        timestamp: new Date().toISOString()
    }));
});

// 🎯 OPTIMIZED: Only broadcast to OPEN connections
function broadcastToAll(data) {
    if (wsClients.size === 0) {
        console.log('⏭️  No WebSocket clients, skipping broadcast');
        return;
    }
    
    const message = JSON.stringify(data);
    let sent = 0;
    let closed = 0;
    
    wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
                sent++;
            } catch (err) {
                console.error('Error broadcasting:', err);
                wsClients.delete(client);
                closed++;
            }
        } else {
            // Remove dead connections
            wsClients.delete(client);
            closed++;
        }
    });
    
    if (sent > 0) {
        console.log(`📤 Broadcasted to ${sent}/${wsClients.size + closed} WebSocket client(s) (${closed} removed)`);
    }
}

// Heartbeat to keep connections alive and clean up dead ones
setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.isAlive === false) {
            console.log('💀 Terminating dead WebSocket connection');
            wsClients.delete(ws);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000); // Every 30 seconds

// ==================== CLEANUP ON EXIT ====================

process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    
    // Close all WebSocket connections gracefully
    wsClients.forEach(client => {
        try {
            client.close(1000, 'Server shutting down');
        } catch (err) {
            console.error('Error closing client:', err);
        }
    });
    wss.close();
    
    // Stop all Firebase listeners
    firebaseListeners.forEach((listenerInfo, deviceId) => {
        stopRealtimeListener(deviceId);
    });
    
    // Close database
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('✅ Database closed');
        }
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 SIGTERM received, shutting down...');
    process.exit(0);
});

// ==================== START SERVER ====================

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(60));
    console.log('🚀 Server with WebSocket running on http://0.0.0.0:3000');
    console.log('='.repeat(60));
    console.log('🔌 WebSocket: ws://localhost:3000');
    console.log('📡 SSE Sensor Stream: /api/stream/device/:deviceId');
    console.log('🔥 Firebase Real-Time Database: Connected');
    console.log('✅ Hybrid Mode: SSE for sensors + WebSocket for sync');
    console.log('🎯 Optimizations: Debounced broadcasts, dead connection cleanup');
    console.log('='.repeat(60));
    console.log('📋 Endpoints:');
    console.log('   Tanks:      /api/tanks');
    console.log('   Valves:     /api/valves');
    console.log('   Pipelines:  /api/pipelines');
    console.log('   Sensor:     /api/sensor/device/:deviceId/latest');
    console.log('='.repeat(60));
});