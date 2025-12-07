// ==================== ADVANCED WATER FLOW SYSTEM WITH VALVE CONTROL ====================
class AdvancedWaterFlowSystem {
    constructor(map) {
        this.map = map;
        this.tanks = [];
        this.pipelines = [];
        this.activeTanks = [];
        this.flowAnimations = [];
        this.flowLayers = [];
        this.tankMarkers = new Map();
    }

    addTank(tank) {
        this.tanks.push(tank);
        this.drawTankOnMap(tank);
    }

    drawTankOnMap(tank) {
        // Remove existing marker if present
        if (this.tankMarkers.has(tank.tankId)) {
            const oldMarker = this.tankMarkers.get(tank.tankId);
            this.map.removeLayer(oldMarker);
            this.tankMarkers.delete(tank.tankId);
        }

        const isActive = tank.isActive;
        
        // Create highly visible tank icon with emoji
        const iconClass = isActive ? 'tank-icon tank-icon-active' : 'tank-icon tank-icon-inactive';
        const icon = L.divIcon({
            className: 'tank-marker',
            html: `<div class="${iconClass}">🏭</div>`,
            iconSize: [48, 48],
            iconAnchor: [24, 24],
            popupAnchor: [0, -24]
        });

        const marker = L.marker([tank.latitude, tank.longitude], { 
            icon,
            zIndexOffset: 10000,
            riseOnHover: true
        }).addTo(this.map);

        marker.bindPopup(`
            <div style="min-width: 200px;">
                <h4 style="margin: 0 0 10px 0;">🏭 ${tank.name}</h4>
                <p><strong>Status:</strong> ${isActive ? '✅ Active' : '⭕ Inactive'}</p>
                <p><strong>Type:</strong> ${tank.type}</p>
                <p><strong>Capacity:</strong> ${tank.capacity.toLocaleString()} L</p>
                <p style="margin: 10px 0 0 0; font-size: 12px; color: #666;">Click for details</p>
            </div>
        `);
        
        marker.on('click', () => {
            window.openTankSidebar(tank.tankId);
        });

        this.tankMarkers.set(tank.tankId, marker);
        tank.marker = marker;
        
        console.log(`🏭 Tank "${tank.name}" drawn at [${tank.latitude}, ${tank.longitude}]`);
        
        if (isActive && !this.activeTanks.find(t => t.tankId === tank.tankId)) {
            this.activeTanks.push(tank);
            this.recalculateAllFlows();
        }
    }

    async toggleTank(tankId) {
        const tank = this.tanks.find(t => t.tankId === tankId);
        if (!tank) return;

        tank.isActive = !tank.isActive;

        try {
            await fetch(`http://localhost:3000/api/tank/${tankId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: tank.isActive })
            });

            if (tank.isActive) {
                if (!this.activeTanks.find(t => t.tankId === tankId)) {
                    this.activeTanks.push(tank);
                }
            } else {
                this.activeTanks = this.activeTanks.filter(t => t.tankId !== tankId);
            }

            this.tanks.forEach(t => this.drawTankOnMap(t));
            await this.recalculateAllFlows();
            
            this.updateFlowStatistics();
            return true;
        } catch (err) {
            console.error('Error toggling tank:', err);
            return false;
        }
    }

    async recalculateAllFlows() {
        console.log('🔄 Recalculating water flows for all active tanks with valve control');
        this.stopWaterFlow();

        if (this.activeTanks.length === 0) {
            console.log('⚠️ No active tanks');
            return;
        }

        try {
            const response = await fetch('http://localhost:3000/api/pipelines');
            const pipelines = await response.json();
            this.pipelines = pipelines;

            const allFlowingSegments = this.computeMultiTankBFS(this.activeTanks, pipelines);
            
            console.log('📊 Multi-tank flow computation complete:', {
                activeTanks: this.activeTanks.length,
                totalSegments: allFlowingSegments.totalSegments,
                flowingSegments: allFlowingSegments.segments.length,
                blockedSegments: allFlowingSegments.blockedSegments.length,
                coverage: ((allFlowingSegments.segments.length / allFlowingSegments.totalSegments) * 100).toFixed(1) + '%'
            });

            this.animateWaterFlow(allFlowingSegments);
            this.updateFlowStatistics();
            
        } catch (err) {
            console.error('Error recalculating flows:', err);
        }
    }

    computeMultiTankBFS(tanks, pipelines) {
        const CONNECT_DISTANCE = 50;
        const VALVE_BLOCK_DISTANCE = 15; // Distance to check if valve blocks segment
        
        const flowData = {
            segments: [],
            blockedSegments: [],
            totalSegments: 0,
            pipelineStatus: new Map()
        };

        // Get all closed valves from the gate valve system
        const closedValves = (typeof gateValveSystem !== 'undefined' && gateValveSystem) 
            ? gateValveSystem.valves.filter(v => !v.isOpen) 
            : [];
        
        console.log(`🔧 Found ${closedValves.length} closed valves that will block flow`);

        const visitedSegments = new Set();
        const blockedSegments = new Set();
        const queue = [];

        console.log(`🔍 Starting BFS from ${tanks.length} active tank(s)`);
        
        tanks.forEach(tank => {
            console.log(`🏭 Processing tank: ${tank.name}`);
            pipelines.forEach(pipeline => {
                const nodes = JSON.parse(pipeline.nodes);
                
                for (let idx = 0; idx < nodes.length; idx++) {
                    const node = nodes[idx];
                    const dist = this.map.distance(
                        [tank.latitude, tank.longitude], 
                        [node.lat, node.lng]
                    );
                    
                    if (dist < CONNECT_DISTANCE) {
                        console.log(`✅ Tank "${tank.name}" connected to Pipeline ${pipeline.id} node ${idx} (distance: ${dist.toFixed(1)}m)`);
                        queue.push({ 
                            pipelineId: pipeline.id, 
                            nodeIndex: idx,
                            sourceTank: tank.name
                        });
                        break;
                    }
                }
                
                for (let i = 0; i < nodes.length - 1; i++) {
                    const segmentDist = this.distanceToSegment(
                        { lat: tank.latitude, lng: tank.longitude },
                        nodes[i],
                        nodes[i + 1]
                    );
                    
                    if (segmentDist < CONNECT_DISTANCE) {
                        console.log(`✅ Tank "${tank.name}" connected to Pipeline ${pipeline.id} segment ${i}-${i+1} (distance: ${segmentDist.toFixed(1)}m)`);
                        queue.push({ 
                            pipelineId: pipeline.id, 
                            nodeIndex: i,
                            sourceTank: tank.name
                        });
                        break;
                    }
                }
            });
        });

        console.log(`🌊 BFS Phase 2: Propagating flow through ${queue.length} initial connections`);

        const visitedPipelineNodes = new Set();
        let iterations = 0;
        const maxIterations = 10000;

        while (queue.length > 0 && iterations < maxIterations) {
            iterations++;
            const current = queue.shift();
            const currentPipeline = pipelines.find(p => p.id === current.pipelineId);
            
            if (!currentPipeline) continue;

            const currentNodes = JSON.parse(currentPipeline.nodes);
            const nodeKey = `${current.pipelineId}-${current.nodeIndex}`;
            
            if (visitedPipelineNodes.has(nodeKey)) continue;
            visitedPipelineNodes.add(nodeKey);

            // Process each segment of current pipeline with valve checking
            for (let i = 0; i < currentNodes.length - 1; i++) {
                const segmentKey = `${current.pipelineId}-${i}-${i+1}`;
                
                if (visitedSegments.has(segmentKey) || blockedSegments.has(segmentKey)) {
                    continue;
                }
                
                // CRITICAL: Check if any closed valve blocks this segment
                const blockingValve = this.getBlockingValve(
                    currentNodes[i], 
                    currentNodes[i + 1], 
                    closedValves,
                    VALVE_BLOCK_DISTANCE
                );
                
                if (blockingValve) {
                    console.log(`🚫 Segment ${segmentKey} BLOCKED by valve "${blockingValve.name}"`);
                    blockedSegments.add(segmentKey);
                    flowData.blockedSegments.push({
                        pipelineId: current.pipelineId,
                        start: currentNodes[i],
                        end: currentNodes[i + 1],
                        status: 'blocked',
                        blockedBy: blockingValve.name
                    });
                    // Don't add downstream segments to queue - flow stops here
                    break; // Stop processing this pipeline beyond the valve
                } else {
                    visitedSegments.add(segmentKey);
                    flowData.segments.push({
                        pipelineId: current.pipelineId,
                        start: currentNodes[i],
                        end: currentNodes[i + 1],
                        status: 'flowing',
                        sourceTank: current.sourceTank
                    });
                }
            }

            flowData.pipelineStatus.set(currentPipeline.id, 'flowing');

            // Find connections to other pipelines (only if not blocked)
            pipelines.forEach(otherPipeline => {
                if (otherPipeline.id === current.pipelineId) return;

                const otherNodes = JSON.parse(otherPipeline.nodes);
                
                currentNodes.forEach((currentNode, currentIdx) => {
                    // Check node-to-node connections
                    otherNodes.forEach((otherNode, otherIdx) => {
                        const dist = this.map.distance(
                            [currentNode.lat, currentNode.lng],
                            [otherNode.lat, otherNode.lng]
                        );

                        if (dist < CONNECT_DISTANCE) {
                            const otherNodeKey = `${otherPipeline.id}-${otherIdx}`;
                            if (!visitedPipelineNodes.has(otherNodeKey)) {
                                queue.push({ 
                                    pipelineId: otherPipeline.id, 
                                    nodeIndex: otherIdx,
                                    sourceTank: current.sourceTank
                                });
                            }
                        }
                    });
                    
                    // Check node-to-segment connections
                    for (let i = 0; i < otherNodes.length - 1; i++) {
                        const segmentDist = this.distanceToSegment(
                            currentNode,
                            otherNodes[i],
                            otherNodes[i + 1]
                        );
                        
                        if (segmentDist < CONNECT_DISTANCE) {
                            const otherNodeKey = `${otherPipeline.id}-${i}`;
                            if (!visitedPipelineNodes.has(otherNodeKey)) {
                                queue.push({ 
                                    pipelineId: otherPipeline.id, 
                                    nodeIndex: i,
                                    sourceTank: current.sourceTank
                                });
                            }
                        }
                    }
                });
                
                // Check segment-to-node connections
                for (let i = 0; i < currentNodes.length - 1; i++) {
                    otherNodes.forEach((otherNode, otherIdx) => {
                        const segmentDist = this.distanceToSegment(
                            otherNode,
                            currentNodes[i],
                            currentNodes[i + 1]
                        );
                        
                        if (segmentDist < CONNECT_DISTANCE) {
                            const otherNodeKey = `${otherPipeline.id}-${otherIdx}`;
                            if (!visitedPipelineNodes.has(otherNodeKey)) {
                                queue.push({ 
                                    pipelineId: otherPipeline.id, 
                                    nodeIndex: otherIdx,
                                    sourceTank: current.sourceTank
                                });
                            }
                        }
                    });
                }
            });
        }

        pipelines.forEach(pipeline => {
            const nodes = JSON.parse(pipeline.nodes);
            flowData.totalSegments += nodes.length - 1;
        });

        console.log(`✅ BFS complete in ${iterations} iterations`);
        console.log(`📈 Flowing: ${flowData.segments.length} segments, Blocked: ${flowData.blockedSegments.length} segments`);

        return flowData;
    }
    
    // NEW: Check if valve blocks a segment
    getBlockingValve(segmentStart, segmentEnd, closedValves, maxDistance) {
        for (let valve of closedValves) {
            const distToSegment = this.distanceToSegment(
                { lat: valve.latitude, lng: valve.longitude },
                segmentStart,
                segmentEnd
            );
            
            if (distToSegment < maxDistance) {
                return valve; // This valve blocks the segment
            }
        }
        return null;
    }
    
    distanceToSegment(point, segmentStart, segmentEnd) {
        const A = point.lat - segmentStart.lat;
        const B = point.lng - segmentStart.lng;
        const C = segmentEnd.lat - segmentStart.lat;
        const D = segmentEnd.lng - segmentStart.lng;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        
        if (lenSq != 0) param = dot / lenSq;
        
        let xx, yy;
        
        if (param < 0) {
            xx = segmentStart.lat;
            yy = segmentStart.lng;
        } else if (param > 1) {
            xx = segmentEnd.lat;
            yy = segmentEnd.lng;
        } else {
            xx = segmentStart.lat + param * C;
            yy = segmentStart.lng + param * D;
        }
        
        return this.map.distance(point, {lat: xx, lng: yy});
    }

    animateWaterFlow(flowData) {
        if (!flowData.segments || flowData.segments.length === 0) {
            console.log('⚠️ No segments to animate');
            
            // Still show blocked segments
            if (flowData.blockedSegments && flowData.blockedSegments.length > 0) {
                this.drawBlockedSegments(flowData.blockedSegments);
            }
            return;
        }

        console.log(`🎨 Creating animated flow for ${flowData.segments.length} segments`);
        console.log(`🚫 Drawing ${flowData.blockedSegments.length} blocked segments`);

        // Draw flowing segments with animation
        flowData.segments.forEach((segment, idx) => {
            const flowLine = L.polyline(
                [[segment.start.lat, segment.start.lng], [segment.end.lat, segment.end.lng]],
                {
                    color: '#2196F3',
                    weight: 6,
                    opacity: 0.8,
                    dashArray: '12, 12',
                    className: 'water-flow-line'
                }
            ).addTo(this.map);

            flowLine.bindPopup(`
                <b>💧 Water Flow Active</b><br>
                Pipeline: ${segment.pipelineId}<br>
                Source: ${segment.sourceTank}<br>
                Status: ✅ Flowing
            `);

            this.flowLayers.push(flowLine);
        });

        // Draw blocked segments (static, red, dimmed)
        this.drawBlockedSegments(flowData.blockedSegments);

        let offset = 0;
        const animate = () => {
            if (this.activeTanks.length === 0) {
                this.stopWaterFlow();
                return;
            }

            offset = (offset + 1) % 24;
            
            this.flowLayers.forEach(flowLine => {
                if (flowLine._path && flowLine.options.className === 'water-flow-line') {
                    flowLine._path.style.strokeDashoffset = offset;
                }
            });

            const animId = requestAnimationFrame(animate);
            this.flowAnimations.push(animId);
        };

        animate();
        console.log('✅ Flow animation started');
    }

    drawBlockedSegments(blockedSegments) {
        blockedSegments.forEach(segment => {
            const blockedLine = L.polyline(
                [[segment.start.lat, segment.start.lng], [segment.end.lat, segment.end.lng]],
                {
                    color: '#f44336',
                    weight: 6,
                    opacity: 0.4,
                    dashArray: '8, 8',
                    className: 'water-blocked-line'
                }
            ).addTo(this.map);

            blockedLine.bindPopup(`
                <b>🚫 Flow Blocked</b><br>
                Pipeline: ${segment.pipelineId}<br>
                Blocked by: ${segment.blockedBy}<br>
                Status: ❌ No Water Flow
            `);

            this.flowLayers.push(blockedLine);
        });
    }

    stopWaterFlow() {
        console.log('🛑 Stopping water flow');
        this.flowAnimations.forEach(id => cancelAnimationFrame(id));
        this.flowAnimations = [];

        this.flowLayers.forEach(layer => this.map.removeLayer(layer));
        this.flowLayers = [];
        
        this.updateFlowStatistics();
    }

    async loadTanks() {
        try {
            const response = await fetch('http://localhost:3000/api/tanks');
            const tanks = await response.json();
            
            this.tanks = tanks;
            this.activeTanks = tanks.filter(t => t.isActive);
            
            tanks.forEach(tank => this.drawTankOnMap(tank));
            
            if (this.activeTanks.length > 0) {
                await this.recalculateAllFlows();
            }
            
            this.updateFlowStatistics();
        } catch (err) {
            console.error('Error loading tanks:', err);
        }
    }

    clearTanks() {
        this.tankMarkers.forEach(marker => {
            this.map.removeLayer(marker);
        });
        this.tankMarkers.clear();
        this.tanks = [];
        this.activeTanks = [];
    }

    updateFlowStatistics() {
        const activeTanksCount = this.activeTanks.length;
        const flowingSegments = this.flowLayers.filter(l => l.options.className === 'water-flow-line').length;
        
        let totalSegments = 0;
        this.pipelines.forEach(p => {
            const nodes = JSON.parse(p.nodes);
            totalSegments += nodes.length - 1;
        });

        const coverage = totalSegments > 0 
            ? ((flowingSegments / totalSegments) * 100).toFixed(1) 
            : 0;

        document.getElementById('activeTanksCount').textContent = activeTanksCount;
        document.getElementById('flowingSegments').textContent = flowingSegments;
        document.getElementById('flowCoverage').textContent = coverage + '%';
    }
}

// ==================== MAIN APPLICATION ====================
const map = L.map('map').setView([17.385, 78.486], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
}).addTo(map);

// Create custom pane for markers to ensure they're always visible
map.createPane('markerPane');
map.getPane('markerPane').style.zIndex = 1000;

let isDrawing = false;
let isErasing = false;
let isAddingTank = false;
let nodes = [];
let lines = [];
let markers = [];
let savedPipelines = [];
let selectedPipelineId = null;
let editingPipelineId = null;
let allLayers = [];
let eraserStartNode = null;
let eraserEndNode = null;
let tempTankMarker = null;
let editingTankId = null;
let currentViewingTank = null;

const drawBtn = document.getElementById('drawBtn');
const loadBtn = document.getElementById('loadBtn');
const eraseBtn = document.getElementById('eraseBtn');
const addTankBtn = document.getElementById('addTankBtn');
const tankModal = document.getElementById('tankModal');
const modalOverlay = document.getElementById('modalOverlay');
const tankForm = document.getElementById('tankForm');
const cancelTankBtn = document.getElementById('cancelTankBtn');
const tankSidebar = document.getElementById('tankSidebar');

const SNAP_DISTANCE = 50;

const waterFlowSystem = new AdvancedWaterFlowSystem(map);

// ==================== TAB SWITCHING ====================
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        
        // Update active tab button
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Show corresponding content
        const contentMap = {
            'pipelines': 'pipelinesList',
            'tanks': 'tanksList',
            'valves': 'valvesList'
        };
        
        Object.values(contentMap).forEach(id => {
            document.getElementById(id).style.display = 'none';
        });
        document.getElementById(contentMap[tab]).style.display = 'block';
    });
});

// ==================== TANK SIDEBAR FUNCTIONS ====================

function closeTankSidebar() {
    tankSidebar.classList.remove('open');
    currentViewingTank = null;
}

async function openTankSidebar(tankId) {
    try {
        const response = await fetch(`http://localhost:3000/api/tank/${tankId}`);
        const tank = await response.json();
        currentViewingTank = tank;
        
        const sidebarContent = document.getElementById('tankSidebarContent');
        sidebarContent.innerHTML = `
            <div class="detail-header">
                <h2>🏭 ${tank.name}</h2>
                <div class="status-badge ${tank.isActive ? 'active' : 'inactive'}">
                    ${tank.isActive ? '🟢 ACTIVE - Water Flowing' : '🔴 INACTIVE'}
                </div>
            </div>
            
            <div class="detail-content">
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
                
                <div class="info-card">
                    <label>📊 Water Level</label>
                    <value>${tank.waterLevel || 0}m</value>
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
    } catch (err) {
        console.error('Error loading tank details:', err);
        alert('Error loading tank details');
    }
}

async function toggleTankFromSidebar(tankId) {
    await waterFlowSystem.toggleTank(tankId);
    await openTankSidebar(tankId);
    await loadTanks();
}

function editTankFromSidebar(tankId) {
    closeTankSidebar();
    const tank = waterFlowSystem.tanks.find(t => t.tankId === tankId);
    if (tank) {
        editTank(tank);
    }
}

async function deleteTankFromSidebar(tankId) {
    closeTankSidebar();
    await deleteTank(tankId);
}

window.closeTankSidebar = closeTankSidebar;
window.openTankSidebar = openTankSidebar;
window.toggleTankFromSidebar = toggleTankFromSidebar;
window.editTankFromSidebar = editTankFromSidebar;
window.deleteTankFromSidebar = deleteTankFromSidebar;

// ==================== DRAWING EVENT HANDLERS ====================

drawBtn.addEventListener('click', () => {
    isDrawing = !isDrawing;
    isErasing = false;
    isAddingTank = false;
    eraseBtn.classList.remove('active');
    addTankBtn.classList.remove('active');
    drawBtn.classList.toggle('active');
    map.getContainer().style.cursor = isDrawing ? 'crosshair' : '';
});

eraseBtn.addEventListener('click', () => {
    if (!selectedPipelineId) {
        alert('⚠️ Select a pipeline first to erase');
        return;
    }
    isErasing = !isErasing;
    isDrawing = false;
    isAddingTank = false;
    drawBtn.classList.remove('active');
    addTankBtn.classList.remove('active');
    eraseBtn.classList.toggle('active');
    eraserStartNode = null;
    eraserEndNode = null;
    map.getContainer().style.cursor = isErasing ? 'crosshair' : '';
});

map.on('click', (e) => {
    // Priority 1: Tank placement
    if (isAddingTank) {
        handleTankPlacement(e);
        return;
    }
    
    // Priority 2: Erasing
    if (isErasing) {
        handleErasing(e);
        return;
    }
    
    // Priority 3: Drawing
    if (!isDrawing) return;

    const clickPoint = e.latlng;
    let snappedToExisting = false;
    let snappedNode = null;

    for (let pipeline of savedPipelines) {
        const pipelineNodes = JSON.parse(pipeline.nodes);
        
        for (let i = 0; i < pipelineNodes.length; i++) {
            const node = pipelineNodes[i];
            const dist = map.distance(clickPoint, [node.lat, node.lng]);
            if (dist < SNAP_DISTANCE) {
                snappedNode = { lat: node.lat, lng: node.lng };
                snappedToExisting = true;
                console.log(`🔗 Snapped to Pipeline ${pipeline.id} node ${i}`);
                break;
            }
        }
        
        if (!snappedToExisting) {
            for (let i = 0; i < pipelineNodes.length - 1; i++) {
                const start = pipelineNodes[i];
                const end = pipelineNodes[i + 1];
                const distToLine = distanceToLineSegment(
                    clickPoint,
                    {lat: start.lat, lng: start.lng},
                    {lat: end.lat, lng: end.lng}
                );
                if (distToLine < SNAP_DISTANCE) {
                    snappedNode = { lat: clickPoint.lat, lng: clickPoint.lng };
                    snappedToExisting = true;
                    console.log(`🔗 Snapped to Pipeline ${pipeline.id} segment ${i}-${i+1}`);
                    break;
                }
            }
        }
        
        if (snappedToExisting) break;
    }

    const node = snappedToExisting ? snappedNode : {
        lat: clickPoint.lat,
        lng: clickPoint.lng
    };

    nodes.push(node);

    const markerColor = snappedToExisting ? '#FF9800' : '#f44336';
    const markerRadius = snappedToExisting ? 8 : 5;
    
    const marker = L.circleMarker([node.lat, node.lng], {
        radius: markerRadius,
        color: markerColor,
        fillColor: markerColor,
        fillOpacity: 1
    }).addTo(map);
    
    if (snappedToExisting) {
        marker.bindPopup('🔗 Connection Point');
    }
    
    markers.push(marker);

    if (nodes.length > 1) {
        const prevNode = nodes[nodes.length - 2];
        const line = L.polyline([
            [prevNode.lat, prevNode.lng],
            [node.lat, node.lng]
        ], {
            color: '#2196F3',
            weight: 5,
            opacity: 0.7
        }).addTo(map);
        lines.push(line);
    }
});

// ==================== HELPER FUNCTIONS ====================

function handleTankPlacement(e) {
    if (tempTankMarker) {
        map.removeLayer(tempTankMarker);
    }
    
    const clickedLat = e.latlng.lat;
    const clickedLng = e.latlng.lng;
    
    const icon = L.divIcon({
        className: 'temp-tank-icon',
        html: '<div style="background: linear-gradient(135deg, #FF9800 0%, #F57C00 100%); width: 48px; height: 48px; border-radius: 50%; border: 4px solid white; display: flex; align-items: center; justify-content: center; font-size: 24px; color: white; font-weight: bold; box-shadow: 0 4px 16px rgba(0,0,0,0.3); animation: pulse 1.5s ease-in-out infinite;">📍</div>',
        iconSize: [48, 48],
        iconAnchor: [24, 24]
    });
    
    tempTankMarker = L.marker([clickedLat, clickedLng], { 
        icon,
        draggable: true
    }).addTo(map);
    
    tempTankMarker.savedLat = clickedLat;
    tempTankMarker.savedLng = clickedLng;
    
    tempTankMarker.on('drag', function() {
        const pos = tempTankMarker.getLatLng();
        tempTankMarker.savedLat = pos.lat;
        tempTankMarker.savedLng = pos.lng;
        updateTankLocationDisplay();
    });
    
    tempTankMarker.on('dragend', function() {
        const pos = tempTankMarker.getLatLng();
        tempTankMarker.savedLat = pos.lat;
        tempTankMarker.savedLng = pos.lng;
        updateTankLocationDisplay();
        console.log('📍 Tank position updated:', pos.lat, pos.lng);
    });
    
    editingTankId = null;
    tankForm.reset();
    document.getElementById('tankModalTitle').textContent = '🏭 Add Tank (Drag marker to reposition)';
    updateTankLocationDisplay();
    tankModal.classList.add('show');
    modalOverlay.classList.add('show');
    
    map.getContainer().style.cursor = '';
    isAddingTank = false;
    addTankBtn.classList.remove('active');
}

function updateTankLocationDisplay() {
    const locationInput = document.getElementById('tankLocation');
    if (locationInput && tempTankMarker && tempTankMarker.savedLat) {
        locationInput.value = `${tempTankMarker.savedLat.toFixed(6)}, ${tempTankMarker.savedLng.toFixed(6)}`;
    }
}

function distanceToLineSegment(point, lineStart, lineEnd) {
    const A = point.lat - lineStart.lat;
    const B = point.lng - lineStart.lng;
    const C = lineEnd.lat - lineStart.lat;
    const D = lineEnd.lng - lineStart.lng;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    
    if (lenSq != 0) param = dot / lenSq;
    
    let xx, yy;
    
    if (param < 0) {
        xx = lineStart.lat;
        yy = lineStart.lng;
    } else if (param > 1) {
        xx = lineEnd.lat;
        yy = lineEnd.lng;
    } else {
        xx = lineStart.lat + param * C;
        yy = lineStart.lng + param * D;
    }
    
    return map.distance(point, {lat: xx, lng: yy});
}

function handleErasing(e) {
    const pipeline = savedPipelines.find(p => p.id === selectedPipelineId);
    if (!pipeline) return;
    
    const pipelineNodes = JSON.parse(pipeline.nodes);
    const clickPoint = e.latlng;
    
    let closestNodeIndex = -1;
    let minDist = Infinity;
    
    for (let i = 0; i < pipelineNodes.length; i++) {
        const dist = map.distance(clickPoint, [pipelineNodes[i].lat, pipelineNodes[i].lng]);
        if (dist < minDist && dist < SNAP_DISTANCE * 2) {
            minDist = dist;
            closestNodeIndex = i;
        }
    }
    
    if (closestNodeIndex === -1) return;
    
    if (!eraserStartNode) {
        eraserStartNode = closestNodeIndex;
        L.circleMarker([pipelineNodes[closestNodeIndex].lat, pipelineNodes[closestNodeIndex].lng], {
            radius: 10,
            color: '#f44336',
            fillColor: '#f44336',
            fillOpacity: 0.6
        }).addTo(map);
        alert('✅ First point selected. Click second point to erase between.');
    } else {
        eraserEndNode = closestNodeIndex;
        eraseSection(pipeline, eraserStartNode, eraserEndNode);
    }
}

async function eraseSection(pipeline, startIdx, endIdx) {
    const pipelineNodes = JSON.parse(pipeline.nodes);
    
    const start = Math.min(startIdx, endIdx);
    const end = Math.max(startIdx, endIdx);
    
    const newNodes = [
        ...pipelineNodes.slice(0, start + 1),
        ...pipelineNodes.slice(end)
    ];
    
    if (newNodes.length < 2) {
        alert('❌ Cannot erase - would leave less than 2 nodes');
        eraserStartNode = null;
        eraserEndNode = null;
        return;
    }
    
    try {
        await fetch(`http://localhost:3000/api/pipeline/${pipeline.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nodes: newNodes })
        });
        alert('✅ Section erased!');
        isErasing = false;
        eraseBtn.classList.remove('active');
        eraserStartNode = null;
        eraserEndNode = null;
        loadPipelines();
    } catch (err) {
        alert('❌ Error erasing section');
    }
}

// ==================== SAVE & LOAD FUNCTIONS ====================

// Save button handler
document.addEventListener('DOMContentLoaded', () => {
    const saveBtn = document.createElement('button');
    saveBtn.className = 'control-btn';
    saveBtn.innerHTML = '<i class="fas fa-save"></i>';
    saveBtn.title = 'Save Pipeline';
    saveBtn.style.cssText = 'color: #4CAF50;';
    
    saveBtn.addEventListener('click', async () => {
        if (nodes.length < 2) {
            alert('⚠️ Draw at least 2 nodes');
            return;
        }

        try {
            if (editingPipelineId) {
                await fetch(`http://localhost:3000/api/pipeline/${editingPipelineId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nodes })
                });
                alert('✅ Pipeline updated!');
                editingPipelineId = null;
            } else {
                const response = await fetch('http://localhost:3000/api/pipeline', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nodes })
                });
                const data = await response.json();
                alert('✅ New pipeline created! ID: ' + data.id);
            }
            
            clearDrawing();
            await loadPipelines();
            await waterFlowSystem.recalculateAllFlows();
        } catch (err) {
            console.error('Error saving:', err);
            alert('❌ Error saving pipeline: ' + err.message);
        }
    });
    
    // Insert save button after draw button
    const controls = document.getElementById('controls');
    controls.insertBefore(saveBtn, controls.children[1]);
});

loadBtn.addEventListener('click', loadPipelines);

addTankBtn.addEventListener('click', () => {
    isAddingTank = !isAddingTank;
    isDrawing = false;
    isErasing = false;
    drawBtn.classList.remove('active');
    eraseBtn.classList.remove('active');
    addTankBtn.classList.toggle('active');
    
    if (isAddingTank) {
        map.getContainer().style.cursor = 'crosshair';
    } else {
        map.getContainer().style.cursor = '';
        if (tempTankMarker) {
            map.removeLayer(tempTankMarker);
            tempTankMarker = null;
        }
    }
});

cancelTankBtn.addEventListener('click', () => {
    tankModal.classList.remove('show');
    modalOverlay.classList.remove('show');
    document.getElementById('tankId').disabled = false;
    
    if (tempTankMarker) {
        map.removeLayer(tempTankMarker);
        tempTankMarker = null;
    }
    
    editingTankId = null;
});

modalOverlay.addEventListener('click', () => {
    tankModal.classList.remove('show');
    modalOverlay.classList.remove('show');
    document.getElementById('tankId').disabled = false;
    
    if (tempTankMarker) {
        map.removeLayer(tempTankMarker);
        tempTankMarker = null;
    }
    
    editingTankId = null;
});

tankForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    let latitude, longitude;
    
    if (tempTankMarker && tempTankMarker.savedLat && tempTankMarker.savedLng) {
        latitude = tempTankMarker.savedLat;
        longitude = tempTankMarker.savedLng;
        console.log('💾 Saving tank at position from saved properties:', latitude, longitude);
    } else if (tempTankMarker) {
        const pos = tempTankMarker.getLatLng();
        latitude = pos.lat;
        longitude = pos.lng;
        console.log('💾 Saving tank at position from getLatLng:', latitude, longitude);
    } else if (editingTankId) {
        const tank = waterFlowSystem.tanks.find(t => t.tankId === editingTankId);
        if (tank) {
            latitude = tank.latitude;
            longitude = tank.longitude;
        }
    } else {
        alert('⚠️ Please place tank on map first');
        return;
    }
    
    if (!latitude || !longitude || isNaN(latitude) || isNaN(longitude)) {
        alert('⚠️ Invalid coordinates. Please try placing the tank again.');
        console.error('Invalid coordinates:', { latitude, longitude });
        return;
    }
    
    const tankData = {
        tankId: document.getElementById('tankId').value.trim(),
        deviceId: document.getElementById('deviceId').value.trim() || '',
        name: document.getElementById('tankName').value.trim(),
        state: document.getElementById('state').value.trim() || '',
        district: document.getElementById('district').value.trim() || '',
        mandal: document.getElementById('mandal').value.trim() || '',
        habitation: document.getElementById('habitation').value.trim() || '',
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        type: document.getElementById('tankType').value,
        shape: document.getElementById('tankShape').value,
        diameter: parseFloat(document.getElementById('diameter').value),
        height: parseFloat(document.getElementById('height').value),
        sensorHeight: parseFloat(document.getElementById('sensorHeight').value),
        capacity: parseFloat(document.getElementById('capacity').value),
        waterLevel: 0,
        isActive: false
    };

    console.log('📤 Sending tank data to server:', tankData);

    try {
        let response;
        if (editingTankId) {
            response = await fetch(`http://localhost:3000/api/tank/${editingTankId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tankData)
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Update failed');
            }
            
            alert('✅ Tank updated successfully!');
            editingTankId = null;
        } else {
            response = await fetch('http://localhost:3000/api/tank', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tankData)
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Create failed');
            }
            
            const result = await response.json();
            console.log('✅ Tank created:', result);
            alert('✅ Tank added successfully!');
        }
        
        tankModal.classList.remove('show');
        modalOverlay.classList.remove('show');
        
        if (tempTankMarker) {
            map.removeLayer(tempTankMarker);
            tempTankMarker = null;
        }
        
        await loadTanks();
        
    } catch (err) {
        console.error('❌ Error saving tank:', err);
        alert('❌ Error saving tank: ' + err.message);
    }
});

// ==================== PIPELINE MANAGEMENT ====================

async function loadPipelines() {
    try {
        const response = await fetch('http://localhost:3000/api/pipelines');
        const pipelines = await response.json();
        savedPipelines = pipelines;
        
        clearAllLayers();
        
        const pipelinesList = document.getElementById('pipelinesList');
        pipelinesList.innerHTML = '';
        
        if (pipelines.length === 0) {
            pipelinesList.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No pipelines yet. Draw one!</p>';
        } else {
            pipelines.forEach(pipeline => {
                const div = document.createElement('div');
                div.className = 'list-item';
                if (pipeline.id === selectedPipelineId) {
                    div.style.borderColor = '#667eea';
                }
                
                div.innerHTML = `
                    <div class="list-item-content" onclick="selectPipeline(${pipeline.id})">
                        <div class="item-icon">
                            <i class="fas fa-route"></i>
                        </div>
                        <div class="item-details">
                            <h4>Pipeline ${pipeline.id}</h4>
                            <p>${JSON.parse(pipeline.nodes).length} nodes</p>
                        </div>
                    </div>
                    <div class="item-actions">
                        <button class="icon-btn edit" onclick="event.stopPropagation(); editPipeline(${pipeline.id})">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="icon-btn delete" onclick="event.stopPropagation(); deletePipeline(${pipeline.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
                
                pipelinesList.appendChild(div);
            });
        }

        pipelines.forEach(pipeline => {
            const pipelineNodes = JSON.parse(pipeline.nodes);
            drawPipelineOnMap(pipelineNodes, '#757575', pipeline.id);
        });
        
        loadTanks();
    } catch (err) {
        console.error('Error loading pipelines:', err);
        alert('❌ Error loading pipelines');
    }
}

async function loadTanks() {
    try {
        waterFlowSystem.clearTanks();
        await waterFlowSystem.loadTanks();
        
        const tanksList = document.getElementById('tanksList');
        tanksList.innerHTML = '';
        
        if (waterFlowSystem.tanks.length === 0) {
            tanksList.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No tanks yet. Add one!</p>';
        } else {
            waterFlowSystem.tanks.forEach(tank => {
                const div = document.createElement('div');
                div.className = 'list-item';
                
                div.innerHTML = `
                    <div class="list-item-content" onclick="openTankSidebar('${tank.tankId}')">
                        <div class="item-icon" style="background: linear-gradient(135deg, ${tank.isActive ? '#4CAF50' : '#757575'} 0%, ${tank.isActive ? '#45a049' : '#616161'} 100%);">
                            <i class="fas fa-water"></i>
                        </div>
                        <div class="item-details">
                            <h4>${tank.name}</h4>
                            <p>${tank.isActive ? '🟢 Active' : '⭕ Inactive'} • ${tank.type}</p>
                        </div>
                    </div>
                    <div class="item-actions">
                        <button class="icon-btn edit" onclick="event.stopPropagation(); editTank(waterFlowSystem.tanks.find(t => t.tankId === '${tank.tankId}'))">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="icon-btn delete" onclick="event.stopPropagation(); deleteTank('${tank.tankId}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
                
                tanksList.appendChild(div);
            });
        }
    } catch (err) {
        console.error('Error loading tanks:', err);
    }
}

function editTank(tank) {
    if (tempTankMarker) {
        map.removeLayer(tempTankMarker);
    }
    
    const icon = L.divIcon({
        className: 'temp-tank-icon',
        html: '<div style="background: linear-gradient(135deg, #FF9800 0%, #F57C00 100%); width: 48px; height: 48px; border-radius: 50%; border: 4px solid white; display: flex; align-items: center; justify-content: center; font-size: 24px; color: white; font-weight: bold; box-shadow: 0 4px 16px rgba(0,0,0,0.3);">📍</div>',
        iconSize: [48, 48],
        iconAnchor: [24, 24]
    });
    
    console.log('✏️ Editing tank at position:', tank.latitude, tank.longitude);
    
    tempTankMarker = L.marker([tank.latitude, tank.longitude], { 
        icon,
        draggable: true
    }).addTo(map);
    
    tempTankMarker.savedLat = tank.latitude;
    tempTankMarker.savedLng = tank.longitude;
    
    tempTankMarker.on('drag', function() {
        const pos = tempTankMarker.getLatLng();
        tempTankMarker.savedLat = pos.lat;
        tempTankMarker.savedLng = pos.lng;
        updateTankLocationDisplay();
    });
    
    tempTankMarker.on('dragend', function() {
        const pos = tempTankMarker.getLatLng();
        tempTankMarker.savedLat = pos.lat;
        tempTankMarker.savedLng = pos.lng;
        updateTankLocationDisplay();
        console.log('📍 Tank position updated during edit:', pos.lat, pos.lng);
    });
    
    editingTankId = tank.tankId;
    document.getElementById('tankModalTitle').textContent = '✏️ Edit Tank (Drag marker to reposition)';
    document.getElementById('tankId').value = tank.tankId;
    document.getElementById('tankId').disabled = true;
    document.getElementById('deviceId').value = tank.deviceId || '';
    document.getElementById('tankName').value = tank.name;
    document.getElementById('state').value = tank.state || '';
    document.getElementById('district').value = tank.district || '';
    document.getElementById('mandal').value = tank.mandal || '';
    document.getElementById('habitation').value = tank.habitation || '';
    document.getElementById('tankType').value = tank.type;
    document.getElementById('tankShape').value = tank.shape;
    document.getElementById('diameter').value = tank.diameter;
    document.getElementById('height').value = tank.height;
    document.getElementById('sensorHeight').value = tank.sensorHeight;
    document.getElementById('capacity').value = tank.capacity;
    
    updateTankLocationDisplay();
    
    tankModal.classList.add('show');
    modalOverlay.classList.add('show');
    
    map.setView([tank.latitude, tank.longitude], 16);
}

async function deleteTank(tankId) {
    if (!confirm(`🗑️ Are you sure you want to delete tank "${tankId}"?\n\nThis action cannot be undone.`)) return;
    
    try {
        const response = await fetch(`http://localhost:3000/api/tank/${tankId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Delete failed');
        }
        
        console.log('✅ Tank deleted:', tankId);
        alert('✅ Tank deleted successfully!');
        
        if (currentViewingTank && currentViewingTank.tankId === tankId) {
            closeTankSidebar();
        }
        
        await loadTanks();
        await waterFlowSystem.recalculateAllFlows();
        
    } catch (err) {
        console.error('❌ Error deleting tank:', err);
        alert('❌ Error deleting tank: ' + err.message);
    }
}

function selectPipeline(id) {
    const pipeline = savedPipelines.find(p => p.id === id);
    if (!pipeline) return;
    
    selectedPipelineId = id;
    const pipelineNodes = JSON.parse(pipeline.nodes);
    if (pipelineNodes.length > 0) {
        map.setView([pipelineNodes[0].lat, pipelineNodes[0].lng], 15);
    }
    loadPipelines();
}

function editPipeline(id) {
    const pipeline = savedPipelines.find(p => p.id === id);
    if (!pipeline) return;
    
    clearDrawing();
    editingPipelineId = id;
    const pipelineNodes = JSON.parse(pipeline.nodes);
    
    nodes = [...pipelineNodes];
    
    pipelineNodes.forEach((node, idx) => {
        const marker = L.circleMarker([node.lat, node.lng], {
            radius: 6,
            color: '#f44336',
            fillColor: '#f44336',
            fillOpacity: 1
        }).addTo(map);
        markers.push(marker);
        
        if (idx > 0) {
            const prevNode = pipelineNodes[idx - 1];
            const line = L.polyline([
                [prevNode.lat, prevNode.lng],
                [node.lat, node.lng]
            ], {
                color: '#2196F3',
                weight: 5,
                opacity: 0.7
            }).addTo(map);
            lines.push(line);
        }
    });
    
    isDrawing = true;
    drawBtn.classList.add('active');
    alert('✏️ Editing Pipeline ' + id + '. Continue drawing to add nodes or save to update.');
}

async function deletePipeline(id) {
    if (!confirm('🗑️ Delete pipeline ' + id + '?')) return;
    
    try {
        await fetch(`http://localhost:3000/api/pipeline/${id}`, {
            method: 'DELETE'
        });
        alert('✅ Pipeline deleted');
        if (selectedPipelineId === id) {
            selectedPipelineId = null;
        }
        await loadPipelines();
        await waterFlowSystem.recalculateAllFlows();
    } catch (err) {
        alert('❌ Error deleting pipeline');
    }
}

function drawPipelineOnMap(pipelineNodes, color, id) {
    pipelineNodes.forEach(node => {
        const m = L.circleMarker([node.lat, node.lng], {
            radius: 4,
            color: color,
            fillColor: color,
            fillOpacity: 0.8
        }).addTo(map);
        allLayers.push(m);
    });

    for (let i = 0; i < pipelineNodes.length - 1; i++) {
        const l = L.polyline([
            [pipelineNodes[i].lat, pipelineNodes[i].lng],
            [pipelineNodes[i + 1].lat, pipelineNodes[i + 1].lng]
        ], {
            color: color,
            weight: 4,
            opacity: 0.6
        }).addTo(map);
        allLayers.push(l);
    }
}

function clearDrawing() {
    nodes = [];
    markers.forEach(m => map.removeLayer(m));
    lines.forEach(l => map.removeLayer(l));
    markers = [];
    lines = [];
    isDrawing = false;
    drawBtn.classList.remove('active');
}

function clearAllLayers() {
    allLayers.forEach(layer => map.removeLayer(layer));
    allLayers = [];
}

// Make functions globally accessible
window.selectPipeline = selectPipeline;
window.editPipeline = editPipeline;
window.deletePipeline = deletePipeline;
window.editTank = editTank;
window.deleteTank = deleteTank;

// Initial load
loadPipelines();