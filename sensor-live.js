// ==================== WEBSOCKET PATCH FOR MULTI-CLIENT SYNC ====================
(function() {
    'use strict';
    let ws = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT = 10;

    function connectWebSocket() {
        if (ws && ws.readyState === WebSocket.OPEN) return;
        console.log('🔌 Connecting to WebSocket...');
        ws = new WebSocket('ws://localhost:3000');

        ws.onopen = () => {
            console.log('✅ WebSocket connected');
            reconnectAttempts = 0;
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'tank_updated') {
                    handleTankUpdate(data.tank);
                } else if (data.type === 'valve_updated') {
                    handleValveUpdate(data.valve);
                }
            } catch (err) {
                console.error('Error parsing WebSocket message:', err);
            }
        };

        ws.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
        };

        ws.onclose = () => {
            console.log('🔌 WebSocket disconnected');
            if (reconnectAttempts < MAX_RECONNECT) {
                reconnectAttempts++;
                const delay = 3000 * reconnectAttempts;
                console.log(`🔄 Reconnecting in ${delay/1000}s...`);
                setTimeout(connectWebSocket, delay);
            }
        };
    }

    function handleTankUpdate(tank) {
        console.log('📡 Tank update via WebSocket:', tank.tankId, tank.isActive);
        
        // Update in waterFlowSystem WITHOUT reloading
        if (typeof waterFlowSystem !== 'undefined') {
            const existing = waterFlowSystem.tanks.find(t => t.tankId === tank.tankId);
            if (existing) {
                Object.assign(existing, tank);
                waterFlowSystem.drawTankOnMap(existing);
                
                if (tank.isActive) {
                    if (!waterFlowSystem.activeTanks.find(t => t.tankId === tank.tankId)) {
                        waterFlowSystem.activeTanks.push(existing);
                    }
                } else {
                    waterFlowSystem.activeTanks = waterFlowSystem.activeTanks.filter(
                        t => t.tankId !== tank.tankId
                    );
                }
                
                waterFlowSystem.recalculateAllFlows();
                waterFlowSystem.updateFlowStatistics();
            }
        }
        
        // Update sidebar if viewing this tank - NO RELOAD
        const sidebar = document.getElementById('tankSidebar');
        if (sidebar && sidebar.classList.contains('open') && 
            typeof currentViewingTank !== 'undefined' && 
            currentViewingTank && currentViewingTank.tankId === tank.tankId) {
            
            const badge = sidebar.querySelector('.status-badge');
            if (badge) {
                badge.className = `status-badge ${tank.isActive ? 'active' : 'inactive'}`;
                badge.textContent = tank.isActive ? '🟢 ACTIVE - Water Flowing' : '🔴 INACTIVE';
            }
            
            const btn = sidebar.querySelector('.action-button.success, .action-button.danger');
            if (btn) {
                btn.className = `action-button ${tank.isActive ? 'danger' : 'success'}`;
                btn.innerHTML = `
                    <i class="fas ${tank.isActive ? 'fa-stop' : 'fa-play'}"></i>
                    ${tank.isActive ? '🛑 Stop Water Flow' : '▶️ Start Water Flow'}
                `;
                btn.onclick = () => window.toggleTankFromSidebar(tank.tankId);
            }
        }
        
        // Update list item WITHOUT reloading entire list
        updateTankListItem(tank);
    }

    function updateTankListItem(tank) {
        const tanksList = document.getElementById('tanksList');
        if (!tanksList) return;
        
        tanksList.querySelectorAll('.list-item').forEach(item => {
            const onclick = item.querySelector('.list-item-content')?.getAttribute('onclick');
            if (onclick && onclick.includes(tank.tankId)) {
                const icon = item.querySelector('.item-icon');
                if (icon) {
                    icon.style.background = tank.isActive ?
                        'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)' :
                        'linear-gradient(135deg, #757575 0%, #616161 100%)';
                }
                const details = item.querySelector('.item-details p');
                if (details) {
                    details.innerHTML = `${tank.isActive ? '🟢 Active' : '⭕ Inactive'} • ${tank.type}`;
                }
            }
        });
    }

    function handleValveUpdate(valve) {
        console.log('📡 Valve update via WebSocket:', valve.valveId, valve.isOpen);
        
        if (typeof gateValveSystem !== 'undefined') {
            const existing = gateValveSystem.valves.find(v => v.valveId === valve.valveId);
            if (existing) {
                Object.assign(existing, valve);
                gateValveSystem.drawValveOnMap(existing);
            }
        }
        
        if (typeof waterFlowSystem !== 'undefined') {
            waterFlowSystem.recalculateAllFlows();
        }
        
        const valvesList = document.getElementById('valvesList');
        if (valvesList) {
            valvesList.querySelectorAll('.list-item').forEach(item => {
                const onclick = item.getAttribute('onclick');
                if (onclick && onclick.includes(valve.valveId)) {
                    const icon = item.querySelector('.item-icon');
                    if (icon) {
                        icon.style.background = valve.isOpen ?
                            'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' :
                            'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
                    }
                    const details = item.querySelector('.item-details p');
                    if (details) {
                        details.innerHTML = `${valve.isOpen ? '🟢 Open' : '🔴 Closed'} • ${valve.type}`;
                    }
                }
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', connectWebSocket);
    } else {
        connectWebSocket();
    }

    window.addEventListener('beforeunload', () => {
        if (ws) ws.close();
    });

    window.wsDebug = {
        connect: connectWebSocket,
        status: () => ws ? ws.readyState : 'Not initialized',
        send: (data) => ws && ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(data))
    };

    console.log('✅ WebSocket patch loaded (multi-client sync enabled)');
})();

// ==================== LIVE SENSOR DATA MANAGEMENT SYSTEM ====================

class LiveSensorManager {
    constructor() {
        this.activeStreams = new Map();
        this.latestData = new Map();
        this.chartData = new Map();
        this.updateCallbacks = new Map();
    }

    connectToDevice(deviceId, onDataCallback) {
        if (this.activeStreams.has(deviceId)) {
            console.log(`♻️ Reusing existing stream for ${deviceId}`);
            return; // Don't disconnect, keep the stream alive
        }

        console.log(`🔌 Connecting to live stream for device: ${deviceId}`);

        const eventSource = new EventSource(`http://localhost:3000/api/stream/device/${deviceId}`);

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                if (data.status === 'connected') {
                    console.log(`✅ Connected to device ${deviceId} stream`);
                    return;
                }

                this.latestData.set(deviceId, data);
                
                if (!this.chartData.has(deviceId)) {
                    this.chartData.set(deviceId, []);
                }
                const history = this.chartData.get(deviceId);
                history.push(data);
                if (history.length > 50) {
                    history.shift();
                }

                if (onDataCallback) {
                    onDataCallback(data);
                }

                const callbacks = this.updateCallbacks.get(deviceId) || [];
                callbacks.forEach(cb => cb(data));

                console.log(`📊 Received data for ${deviceId}:`, data);
            } catch (err) {
                console.error('Error parsing sensor data:', err);
            }
        };

        eventSource.onerror = (error) => {
            console.error(`❌ Stream error for device ${deviceId}:`, error);
            setTimeout(() => {
                console.log(`🔄 Reconnecting to device ${deviceId}...`);
                this.connectToDevice(deviceId, onDataCallback);
            }, 5000);
        };

        this.activeStreams.set(deviceId, eventSource);
    }

    disconnectFromDevice(deviceId) {
        const eventSource = this.activeStreams.get(deviceId);
        if (eventSource) {
            eventSource.close();
            this.activeStreams.delete(deviceId);
            console.log(`🔌 Disconnected from device ${deviceId}`);
        }
    }

    onDataUpdate(deviceId, callback) {
        if (!this.updateCallbacks.has(deviceId)) {
            this.updateCallbacks.set(deviceId, []);
        }
        this.updateCallbacks.get(deviceId).push(callback);
    }

    getLatestData(deviceId) {
        return this.latestData.get(deviceId) || null;
    }

    getChartData(deviceId) {
        return this.chartData.get(deviceId) || [];
    }

    async fetchHistory(deviceId, hours = 24) {
        try {
            const response = await fetch(`http://localhost:3000/api/sensor/device/${deviceId}/history?hours=${hours}`);
            if (!response.ok) throw new Error('Failed to fetch history');
            
            const history = await response.json();
            this.chartData.set(deviceId, history.slice(0, 50));
            return history;
        } catch (err) {
            console.error('Error fetching history:', err);
            return [];
        }
    }

    disconnectAll() {
        this.activeStreams.forEach((eventSource, deviceId) => {
            this.disconnectFromDevice(deviceId);
        });
    }
}

const liveSensorManager = new LiveSensorManager();

// ==================== ENHANCED openTankSidebar WITH LIVE DATA ====================

window.openTankSidebar = async function(tankId) {
    try {
        const response = await fetch(`http://localhost:3000/api/tank/${tankId}`);
        const tank = await response.json();
        currentViewingTank = tank;
        
        const sidebarContent = document.getElementById('tankSidebarContent');
        const hasDevice = tank.deviceId && tank.deviceId.trim() !== '';
        
        sidebarContent.innerHTML = `
            <div class="detail-header">
                <h2>🏭 ${tank.name}</h2>
                <div class="status-badge ${tank.isActive ? 'active' : 'inactive'}">
                    ${tank.isActive ? '🟢 ACTIVE - Water Flowing' : '🔴 INACTIVE'}
                </div>
            </div>
            
            <div class="detail-content">
                ${hasDevice ? `
                    <div class="info-card" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 24px; margin-bottom: 20px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                            <label style="color: white; font-size: 14px; margin: 0;">📡 LIVE SENSOR DATA</label>
                            <div id="connectionStatus-${tank.deviceId}" style="font-size: 12px; padding: 4px 12px; background: rgba(255,255,255,0.2); border-radius: 12px;">
                                🔄 Connecting...
                            </div>
                        </div>
                        
                        <div id="liveDataDisplay-${tank.deviceId}">
                            <div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.7);">
                                <i class="fas fa-spinner fa-spin" style="font-size: 24px;"></i>
                                <p style="margin-top: 12px; font-size: 14px;">Waiting for sensor data...</p>
                            </div>
                        </div>
                    </div>

                    <div id="liveMetricsGrid-${tank.deviceId}" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 20px;">
                    </div>

                    <div class="info-card" style="margin-bottom: 20px;">
                        <label>📈 Water Level Trend (Last Hour)</label>
                        <canvas id="miniChart-${tank.deviceId}" width="100%" height="80"></canvas>
                    </div>
                ` : `
                    <div class="info-card" style="background: #fff3cd; border: 2px solid #ffc107; padding: 16px; margin-bottom: 20px;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <i class="fas fa-exclamation-triangle" style="color: #ff9800; font-size: 24px;"></i>
                            <div>
                                <strong style="color: #856404;">No Device Linked</strong>
                                <p style="margin: 4px 0 0 0; font-size: 13px; color: #856404;">
                                    Please link a device ID to view live sensor data
                                </p>
                            </div>
                        </div>
                    </div>
                `}
                
                <div class="info-card">
                    <label>Tank ID</label>
                    <value>${tank.tankId}</value>
                </div>
                
                <div class="info-card">
                    <label>Device ID</label>
                    <value>${tank.deviceId || 'Not linked'}</value>
                </div>
                
                <div class="info-card">
                    <label>📍 Location</label>
                    <value>
                        ${tank.state ? tank.state + ', ' : ''}${tank.district ? tank.district + ', ' : ''}
                        ${tank.mandal ? tank.mandal + ', ' : ''}${tank.habitation || ''}<br>
                        <small>Lat: ${tank.latitude.toFixed(6)}, Lng: ${tank.longitude.toFixed(6)}</small>
                    </value>
                </div>
                
                <div class="info-card">
                    <label>🗃️ Type & Shape</label>
                    <value>${tank.type} - ${tank.shape}</value>
                </div>
                
                <div class="info-card">
                    <label>📏 Dimensions</label>
                    <value>
                        Diameter: ${tank.diameter}m<br>
                        Height: ${tank.height}m<br>
                        Sensor Height: ${tank.sensorHeight}m
                    </value>
                </div>
                
                <div class="info-card">
                    <label>💧 Capacity</label>
                    <value>${tank.capacity.toLocaleString()} Liters</value>
                </div>
                
                <button class="action-button ${tank.isActive ? 'danger' : 'success'}" 
                        onclick="toggleTankFromSidebar('${tank.tankId}')">
                    <i class="fas ${tank.isActive ? 'fa-stop' : 'fa-play'}"></i>
                    ${tank.isActive ? '🛑 Stop Water Flow' : '▶️ Start Water Flow'}
                </button>
                
                <button class="action-button warning" onclick="editTankFromSidebar('${tank.tankId}')">
                    <i class="fas fa-edit"></i> ✏️ Edit Tank
                </button>
                
                <button class="action-button danger" onclick="deleteTankFromSidebar('${tank.tankId}')">
                    <i class="fas fa-trash"></i> 🗑️ Delete Tank
                </button>
            </div>
        `;
        
        tankSidebar.classList.add('open');

        if (hasDevice) {
            startLiveSensorDisplay(tank.deviceId, tank);
        }
        
    } catch (err) {
        console.error('Error loading tank details:', err);
        alert('Error loading tank details');
    }
};

// ==================== LIVE SENSOR DISPLAY LOGIC ====================

function startLiveSensorDisplay(deviceId, tank) {
    console.log(`🚀 Starting live sensor display for device: ${deviceId}`);
    
    liveSensorManager.connectToDevice(deviceId, (data) => {
        updateLiveDataDisplay(deviceId, data, tank);
        updateConnectionStatus(deviceId, 'connected');
    });

    liveSensorManager.fetchHistory(deviceId, 1).then(() => {
        updateMiniChart(deviceId);
    });
}

function updateConnectionStatus(deviceId, status) {
    const statusEl = document.getElementById(`connectionStatus-${deviceId}`);
    if (!statusEl) return;

    const statusMap = {
        'connecting': { text: '🔄 Connecting...', color: 'rgba(255,255,255,0.3)' },
        'connected': { text: '✅ Live', color: 'rgba(76, 175, 80, 0.9)' },
        'error': { text: '❌ Error', color: 'rgba(244, 67, 54, 0.9)' }
    };

    const config = statusMap[status] || statusMap['connecting'];
    statusEl.textContent = config.text;
    statusEl.style.background = config.color;
}

function updateLiveDataDisplay(deviceId, data, tank) {
    const displayEl = document.getElementById(`liveDataDisplay-${deviceId}`);
    if (displayEl) {
        const percentFull = (data.volumeLiters / tank.capacity * 100).toFixed(1);
        const fillColor = percentFull > 70 ? '#4CAF50' : percentFull > 30 ? '#FF9800' : '#f44336';
        
        displayEl.innerHTML = `
            <div style="text-align: center; margin-bottom: 16px;">
                <div style="font-size: 48px; font-weight: bold; margin-bottom: 8px;">
                    ${data.waterLevel || 0}m
                </div>
                <div style="font-size: 14px; opacity: 0.9;">Water Level</div>
            </div>
            
            <div style="background: rgba(255,255,255,0.2); border-radius: 12px; height: 24px; overflow: hidden; margin-bottom: 16px;">
                <div style="background: ${fillColor}; height: 100%; width: ${percentFull}%; transition: width 0.3s ease; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600;">
                    ${percentFull}%
                </div>
            </div>

            <div style="display: flex; justify-content: space-between; font-size: 13px;">
                <div>
                    <div style="opacity: 0.8;">Volume</div>
                    <div style="font-weight: 600; font-size: 16px;">${data.volumeLiters.toLocaleString()}L</div>
                </div>
                <div>
                    <div style="opacity: 0.8;">Pressure</div>
                    <div style="font-weight: 600; font-size: 16px;">${data.pressureKPa} kPa</div>
                </div>
            </div>
            
            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 11px; opacity: 0.8;">
                Last updated: ${new Date(data.timestamp).toLocaleTimeString()}
            </div>
        `;
    }

    const metricsEl = document.getElementById(`liveMetricsGrid-${deviceId}`);
    if (metricsEl) {
        metricsEl.innerHTML = `
            <div class="info-card" style="text-align: center; padding: 16px;">
                <div style="font-size: 24px; margin-bottom: 4px;">💧</div>
                <div style="font-size: 20px; font-weight: 700; color: #667eea;">${data.volumeLiters.toLocaleString()}</div>
                <div style="font-size: 12px; color: #666; margin-top: 4px;">Liters</div>
            </div>
            
            <div class="info-card" style="text-align: center; padding: 16px;">
                <div style="font-size: 24px; margin-bottom: 4px;">📊</div>
                <div style="font-size: 20px; font-weight: 700; color: #667eea;">${data.pressureKPa}</div>
                <div style="font-size: 12px; color: #666; margin-top: 4px;">kPa Pressure</div>
            </div>
            
            <div class="info-card" style="text-align: center; padding: 16px;">
                <div style="font-size: 24px; margin-bottom: 4px;">📏</div>
                <div style="font-size: 20px; font-weight: 700; color: #667eea;">${data.waterLevel}m</div>
                <div style="font-size: 12px; color: #666; margin-top: 4px;">Height</div>
            </div>
            
            <div class="info-card" style="text-align: center; padding: 16px;">
                <div style="font-size: 24px; margin-bottom: 4px;">${data.temperature ? '🌡️' : '⏱️'}</div>
                <div style="font-size: 20px; font-weight: 700; color: #667eea;">
                    ${data.temperature ? data.temperature + '°C' : new Date(data.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div style="font-size: 12px; color: #666; margin-top: 4px;">${data.temperature ? 'Temperature' : 'Updated'}</div>
            </div>
        `;
    }

    updateMiniChart(deviceId);
}

function updateMiniChart(deviceId) {
    const canvas = document.getElementById(`miniChart-${deviceId}`);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const chartData = liveSensorManager.getChartData(deviceId);
    
    if (chartData.length === 0) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const width = canvas.width;
    const height = canvas.height;
    const padding = 10;
    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;

    const values = chartData.map(d => d.waterLevel || 0);
    const maxValue = Math.max(...values);
    const minValue = Math.min(...values);
    const valueRange = maxValue - minValue || 1;

    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padding + (graphHeight / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
    }

    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 2;
    ctx.beginPath();

    chartData.forEach((data, index) => {
        const x = padding + (graphWidth / (chartData.length - 1)) * index;
        const normalizedValue = (data.waterLevel - minValue) / valueRange;
        const y = padding + graphHeight - (normalizedValue * graphHeight);

        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.stroke();

    ctx.fillStyle = '#667eea';
    chartData.forEach((data, index) => {
        const x = padding + (graphWidth / (chartData.length - 1)) * index;
        const normalizedValue = (data.waterLevel - minValue) / valueRange;
        const y = padding + graphHeight - (normalizedValue * graphHeight);
        
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
    });

    ctx.fillStyle = '#666';
    ctx.font = '10px Arial';
    ctx.fillText(maxValue.toFixed(1) + 'm', 5, padding + 10);
    ctx.fillText(minValue.toFixed(1) + 'm', 5, height - padding);
}

// ==================== CLEANUP & TOGGLE - FIXED NO RELOAD ====================

window.closeTankSidebar = function() {
    console.log('🔌 Closing tank sidebar (keeping streams alive)...');
    
    // DON'T disconnect streams - keep them running
    // Users might reopen the sidebar soon
    
    const sidebar = document.getElementById('tankSidebar');
    if (sidebar) {
        sidebar.classList.remove('open');
    }
    
    if (typeof window !== 'undefined') {
        window.currentViewingTank = null;
    }
    
    console.log('✅ Tank sidebar closed - streams still active - NO RELOAD');
};

// 🎯 KEY FIX: Remove all loadTanks() calls!
window.toggleTankFromSidebar = async function(tankId) {
    console.log('🔄 Toggling tank:', tankId);
    
    try {
        const tank = waterFlowSystem.tanks.find(t => t.tankId === tankId);
        if (!tank) return;

        tank.isActive = !tank.isActive;

        // Update server
        await fetch(`http://localhost:3000/api/tank/${tankId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive: tank.isActive })
        });

        // Update local state
        if (tank.isActive) {
            if (!waterFlowSystem.activeTanks.find(t => t.tankId === tankId)) {
                waterFlowSystem.activeTanks.push(tank);
            }
        } else {
            waterFlowSystem.activeTanks = waterFlowSystem.activeTanks.filter(t => t.tankId !== tankId);
        }

        // Update marker WITHOUT recreating it
        const marker = waterFlowSystem.tankMarkers.get(tankId);
        if (marker) {
            const isActive = tank.isActive;
            const iconClass = isActive ? 'tank-icon tank-icon-active' : 'tank-icon tank-icon-inactive';
            const newIcon = L.divIcon({
                className: 'tank-marker',
                html: `<div class="${iconClass}">🏭</div>`,
                iconSize: [48, 48],
                iconAnchor: [24, 24],
                popupAnchor: [0, -24]
            });
            marker.setIcon(newIcon);
        }

        // Recalculate flows
        await waterFlowSystem.recalculateAllFlows();
        waterFlowSystem.updateFlowStatistics();

        // Update sidebar UI WITHOUT reloading
        const statusBadge = document.querySelector('.status-badge');
        if (statusBadge) {
            statusBadge.className = `status-badge ${tank.isActive ? 'active' : 'inactive'}`;
            statusBadge.innerHTML = tank.isActive ? '🟢 ACTIVE - Water Flowing' : '🔴 INACTIVE';
        }

        const toggleBtn = document.querySelector('.action-button.success, .action-button.danger');
        if (toggleBtn) {
            toggleBtn.className = `action-button ${tank.isActive ? 'danger' : 'success'}`;
            toggleBtn.innerHTML = `
                <i class="fas ${tank.isActive ? 'fa-stop' : 'fa-play'}"></i>
                ${tank.isActive ? '🛑 Stop Water Flow' : '▶️ Start Water Flow'}
            `;
            toggleBtn.onclick = () => window.toggleTankFromSidebar(tankId);
        }

        // ❌ REMOVED: await loadTanks() - this was causing the reload!
        // WebSocket will sync other clients automatically
        
        console.log('✅ Tank toggled - NO RELOAD - live data continues');
        
    } catch (err) {
        console.error('Error toggling tank:', err);
        alert('Error toggling tank: ' + err.message);
    }
};

window.addEventListener('beforeunload', () => {
    liveSensorManager.disconnectAll();
});

window.liveSensorManager = liveSensorManager;

console.log('✅ Live Sensor Management System initialized (WebSocket + SSE hybrid)');