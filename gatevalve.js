// ==================== GATE VALVE MANAGEMENT SYSTEM WITH PIPELINE SNAPPING ====================

class GateValveSystem {
    constructor(map) {
        this.map = map;
        this.valves = [];
        this.valveMarkers = new Map();
    }

    // Create visible valve icon that won't disappear
    createValveIcon(isOpen = false) {
        const iconClass = isOpen ? 'valve-icon valve-icon-open' : 'valve-icon valve-icon-closed';
        const html = `<div class="${iconClass}">🔧</div>`;
        
        return L.divIcon({
            className: 'valve-marker',
            html: html,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
            popupAnchor: [0, -18]
        });
    }

    // Add valve to map with persistent marker
    addValve(valve) {
        // Remove existing marker if present
        if (this.valveMarkers.has(valve.valveId)) {
            const oldMarker = this.valveMarkers.get(valve.valveId);
            this.map.removeLayer(oldMarker);
            this.valveMarkers.delete(valve.valveId);
        }

        const icon = this.createValveIcon(valve.isOpen);
        
        const marker = L.marker([valve.latitude, valve.longitude], {
            icon: icon,
            zIndexOffset: 9000,
            riseOnHover: true
        }).addTo(this.map);

        // Add popup
        marker.bindPopup(`
            <div style="min-width: 200px;">
                <h4 style="margin: 0 0 10px 0;">🔧 ${valve.name}</h4>
                <p><strong>ID:</strong> ${valve.valveId}</p>
                <p><strong>Type:</strong> ${valve.type}</p>
                <p><strong>Category:</strong> ${valve.category}</p>
                <p><strong>Status:</strong> ${valve.isOpen ? '🔓 Open' : '🔒 Closed'}</p>
                ${valve.households ? `<p><strong>Households:</strong> ${valve.households}</p>` : ''}
                ${valve.flowRate ? `<p><strong>Flow Rate:</strong> ${valve.flowRate} L/min</p>` : ''}
                <p style="margin: 10px 0 0 0; font-size: 12px; color: #666;">Click for details</p>
            </div>
        `);

        // Add click handler
        marker.on('click', () => {
            this.openValveSidebar(valve);
        });

        this.valveMarkers.set(valve.valveId, marker);
        valve.marker = marker;
        
        // Add to valves array if not already there
        if (!this.valves.find(v => v.valveId === valve.valveId)) {
            this.valves.push(valve);
        }

        console.log(`🔧 Valve "${valve.name}" added at [${valve.latitude}, ${valve.longitude}]`);
    }

    // Open valve sidebar with details
    openValveSidebar(valve) {
        const sidebar = document.getElementById('valveSidebar');
        const content = document.getElementById('valveSidebarContent');
        
        content.innerHTML = `
            <div class="detail-header">
                <h2>🔧 ${valve.name}</h2>
                <div class="status-badge ${valve.isOpen ? 'active' : 'inactive'}">
                    ${valve.isOpen ? '🔓 OPEN - Water Flowing' : '🔒 CLOSED - Flow Blocked'}
                </div>
            </div>
            
            <div class="detail-content">
                <div class="info-card">
                    <label>Valve ID</label>
                    <value>${valve.valveId}</value>
                </div>
                
                <div class="info-card">
                    <label>Type</label>
                    <value>${valve.type} Valve</value>
                </div>
                
                <div class="info-card">
                    <label>Category</label>
                    <value>${valve.category}</value>
                </div>
                
                ${valve.parentValveId ? `
                <div class="info-card">
                    <label>Parent Valve</label>
                    <value>${valve.parentValveId}</value>
                </div>
                ` : ''}
                
                ${valve.households ? `
                <div class="info-card">
                    <label>Households Served</label>
                    <value>${valve.households}</value>
                </div>
                ` : ''}
                
                ${valve.flowRate ? `
                <div class="info-card">
                    <label>Flow Rate</label>
                    <value>${valve.flowRate} L/min</value>
                </div>
                ` : ''}
                
                ${valve.mandal || valve.habitation ? `
                <div class="info-card">
                    <label>📍 Location</label>
                    <value>
                        ${valve.mandal ? valve.mandal + ', ' : ''}${valve.habitation || ''}<br>
                        <small>Lat: ${valve.latitude.toFixed(6)}, Lng: ${valve.longitude.toFixed(6)}</small>
                    </value>
                </div>
                ` : `
                <div class="info-card">
                    <label>📍 Coordinates</label>
                    <value>${valve.latitude.toFixed(6)}, ${valve.longitude.toFixed(6)}</value>
                </div>
                `}
                
                <button class="action-button ${valve.isOpen ? 'danger' : 'success'}" 
                        onclick="gateValveSystem.toggleValve('${valve.valveId}')">
                    <i class="fas ${valve.isOpen ? 'fa-lock' : 'fa-lock-open'}"></i>
                    ${valve.isOpen ? '🔒 Close Valve' : '🔓 Open Valve'}
                </button>
                
                <button class="action-button warning" onclick="gateValveSystem.editValve('${valve.valveId}')">
                    <i class="fas fa-edit"></i> ✏️ Edit Valve
                </button>
                
                <button class="action-button danger" onclick="gateValveSystem.deleteValve('${valve.valveId}')">
                    <i class="fas fa-trash"></i> 🗑️ Delete Valve
                </button>
            </div>
        `;
        
        sidebar.classList.add('open');
    }

    // Toggle valve open/closed state
    async toggleValve(valveId) {
        const valve = this.valves.find(v => v.valveId === valveId);
        if (!valve) return;

        try {
            const response = await fetch(`http://localhost:3000/api/valve/${valveId}/toggle`, {
                method: 'PATCH'
            });
            
            if (!response.ok) throw new Error('Failed to toggle valve');
            
            const result = await response.json();
            valve.isOpen = result.isOpen;
            
            // Update marker icon
            const marker = this.valveMarkers.get(valveId);
            if (marker) {
                marker.setIcon(this.createValveIcon(valve.isOpen));
            }
            
            // CRITICAL: Recalculate water flow when valve state changes
            console.log(`🔄 Valve ${valveId} toggled - Recalculating flow...`);
            if (typeof waterFlowSystem !== 'undefined' && waterFlowSystem) {
                await waterFlowSystem.recalculateAllFlows();
            }
            
            // Refresh sidebar if open
            this.openValveSidebar(valve);
            
            // Update valve list
            this.updateValveList();
            
            // Update flow statistics
            this.updateFlowStatistics();
            
            console.log(`✅ Valve ${valveId} toggled to ${valve.isOpen ? 'OPEN' : 'CLOSED'} - Flow updated`);
            
        } catch (err) {
            console.error('Error toggling valve:', err);
            alert('❌ Error toggling valve: ' + err.message);
        }
    }

    // Edit valve
    async editValve(valveId) {
        const valve = this.valves.find(v => v.valveId === valveId);
        if (!valve) return;
        
        // Remove temp marker if exists
        if (tempValveMarker) {
            map.removeLayer(tempValveMarker);
        }
        
        // Create draggable temp marker at current valve position
        const tempIcon = L.divIcon({
            className: 'temp-valve-icon',
            html: '<div class="valve-icon" style="background: #FF9800; animation: pulse 1.5s ease-in-out infinite;">📍</div>',
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });
        
        tempValveMarker = L.marker([valve.latitude, valve.longitude], {
            icon: tempIcon,
            draggable: true
        }).addTo(map);
        
        valveMarkerPosition = { lat: valve.latitude, lng: valve.longitude };
        editingValveId = valve.valveId;
        
        tempValveMarker.on('drag', function() {
            const pos = tempValveMarker.getLatLng();
            valveMarkerPosition = pos;
            updateValveLocationDisplay();
        });
        
        tempValveMarker.on('dragend', function() {
            const pos = tempValveMarker.getLatLng();
            valveMarkerPosition = pos;
            updateValveLocationDisplay();
            
            // Snap to nearest pipeline on drag end
            snapValveToPipeline();
        });
        
        // Populate form
        document.getElementById('valveModalTitle').textContent = '✏️ Edit Valve (Drag to reposition - will snap to pipeline)';
        document.getElementById('valveId').value = valve.valveId;
        document.getElementById('valveId').disabled = true;
        document.getElementById('valveName').value = valve.name;
        document.getElementById('valveType').value = valve.type;
        document.getElementById('valveCategory').value = valve.category;
        document.getElementById('valveHouseholds').value = valve.households || '';
        document.getElementById('valveFlowRate').value = valve.flowRate || '';
        
        updateValveLocationDisplay();
        
        // Show modal
        document.getElementById('valveModal').classList.add('show');
        document.getElementById('modalOverlay').classList.add('show');
        
        // Close sidebar
        document.getElementById('valveSidebar').classList.remove('open');
        
        // Center map on valve
        map.setView([valve.latitude, valve.longitude], 16);
    }

    // Delete valve
    async deleteValve(valveId) {
        const valve = this.valves.find(v => v.valveId === valveId);
        if (!valve) return;
        
        if (!confirm(`🗑️ Delete valve "${valve.name}"?\n\nThis action cannot be undone.`)) {
            return;
        }

        try {
            const response = await fetch(`http://localhost:3000/api/valve/${valveId}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) throw new Error('Failed to delete valve');
            
            // Remove marker from map
            const marker = this.valveMarkers.get(valveId);
            if (marker) {
                this.map.removeLayer(marker);
                this.valveMarkers.delete(valveId);
            }
            
            // Remove from valves array
            this.valves = this.valves.filter(v => v.valveId !== valveId);
            
            // Close sidebar
            document.getElementById('valveSidebar').classList.remove('open');
            
            // Update valve list
            this.updateValveList();
            
            // Update flow statistics
            this.updateFlowStatistics();
            
            // Recalculate flow
            if (typeof waterFlowSystem !== 'undefined' && waterFlowSystem) {
                await waterFlowSystem.recalculateAllFlows();
            }
            
            alert('✅ Valve deleted successfully!');
            console.log(`✅ Valve ${valveId} deleted`);
            
        } catch (err) {
            console.error('Error deleting valve:', err);
            alert('❌ Error deleting valve: ' + err.message);
        }
    }

    // Load all valves from database
    async loadValves() {
        try {
            const response = await fetch('http://localhost:3000/api/valves');
            if (!response.ok) throw new Error('Failed to load valves');
            
            const valves = await response.json();
            
            // Clear existing valves
            this.clearValves();
            
            // Add each valve to map
            valves.forEach(valve => {
                this.addValve(valve);
            });
            
            // Update valve list in UI
            this.updateValveList();
            
            // Update flow statistics
            this.updateFlowStatistics();
            
            console.log(`✅ Loaded ${valves.length} valves`);
            
        } catch (err) {
            console.error('Error loading valves:', err);
        }
    }

    // Clear all valves from map
    clearValves() {
        this.valveMarkers.forEach(marker => {
            this.map.removeLayer(marker);
        });
        this.valveMarkers.clear();
        this.valves = [];
    }

    // Update valve list in sidebar
    updateValveList() {
        const container = document.getElementById('valvesList');
        if (!container) return;
        
        if (this.valves.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No valves yet. Add one!</p>';
            return;
        }
        
        container.innerHTML = this.valves.map(valve => `
            <div class="list-item" onclick="gateValveSystem.openValveSidebar(gateValveSystem.valves.find(v => v.valveId === '${valve.valveId}'))">
                <div class="list-item-content">
                    <div class="item-icon" style="background: linear-gradient(135deg, ${valve.isOpen ? '#2196F3' : '#f44336'} 0%, ${valve.isOpen ? '#1976D2' : '#d32f2f'} 100%);">
                        <i class="fas fa-valve"></i>
                    </div>
                    <div class="item-details">
                        <h4>${valve.name}</h4>
                        <p>${valve.isOpen ? '🔓 Open' : '🔒 Closed'} • ${valve.category}</p>
                    </div>
                </div>
                <div class="item-actions">
                    <button class="icon-btn edit" onclick="event.stopPropagation(); gateValveSystem.editValve('${valve.valveId}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="icon-btn delete" onclick="event.stopPropagation(); gateValveSystem.deleteValve('${valve.valveId}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    // Update flow statistics
    updateFlowStatistics() {
        const openValvesCount = this.valves.filter(v => v.isOpen).length;
        const openValvesEl = document.getElementById('openValvesCount');
        if (openValvesEl) {
            openValvesEl.textContent = openValvesCount;
        }
    }
}

// Global close function for valve sidebar
function closeValveSidebar() {
    document.getElementById('valveSidebar').classList.remove('open');
}

window.closeValveSidebar = closeValveSidebar;

// Initialize the system when DOM is loaded
let gateValveSystem;

// Wait for map to be initialized from pipeline-manager.js
setTimeout(() => {
    if (typeof map !== 'undefined') {
        gateValveSystem = new GateValveSystem(map);
        
        // Load existing valves
        gateValveSystem.loadValves();
        
        console.log('✅ Gate Valve System initialized');
    } else {
        console.error('❌ Map not initialized - retrying in 1 second');
        setTimeout(() => {
            if (typeof map !== 'undefined') {
                gateValveSystem = new GateValveSystem(map);
                gateValveSystem.loadValves();
                console.log('✅ Gate Valve System initialized (retry successful)');
            }
        }, 1000);
    }
}, 500);

// ==================== VALVE MODAL HANDLERS ====================

let valveAddMode = false;
let valveMarkerPosition = null;
let tempValveMarker = null;
let editingValveId = null;
let nearestPipelineInfo = null;

// Add Valve Button Handler
document.addEventListener('DOMContentLoaded', () => {
    const addValveBtn = document.getElementById('addValveBtn');
    const valveModal = document.getElementById('valveModal');
    const modalOverlay = document.getElementById('modalOverlay');
    const valveForm = document.getElementById('valveForm');
    const cancelValveBtn = document.getElementById('cancelValveBtn');

    if (addValveBtn) {
        addValveBtn.addEventListener('click', () => {
            valveAddMode = true;
            addValveBtn.classList.add('active');
            map.getContainer().style.cursor = 'crosshair';
            console.log('🔧 Valve add mode activated - click on or near a pipeline to place valve');
            alert('📍 Click on or near a pipeline to place the valve. It will automatically snap to the nearest pipeline.');
        });
    }

    // Cancel button
    if (cancelValveBtn) {
        cancelValveBtn.addEventListener('click', () => {
            valveModal.classList.remove('show');
            modalOverlay.classList.remove('show');
            document.getElementById('valveId').disabled = false;
            if (tempValveMarker && typeof map !== 'undefined') {
                map.removeLayer(tempValveMarker);
                tempValveMarker = null;
            }
            editingValveId = null;
            nearestPipelineInfo = null;
            valveForm.reset();
        });
    }

    // Form submission
    if (valveForm) {
        valveForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveValve();
        });
    }
    
    // Add modal overlay click handler for valve modal
    if (modalOverlay) {
        modalOverlay.addEventListener('click', function(e) {
            if (e.target === modalOverlay) {
                // Close valve modal
                valveModal.classList.remove('show');
                modalOverlay.classList.remove('show');
                document.getElementById('valveId').disabled = false;
                if (tempValveMarker && typeof map !== 'undefined') {
                    map.removeLayer(tempValveMarker);
                    tempValveMarker = null;
                }
                editingValveId = null;
                nearestPipelineInfo = null;
                
                // Close tank modal too
                const tankModal = document.getElementById('tankModal');
                if (tankModal) {
                    tankModal.classList.remove('show');
                }
            }
        });
    }
});

// Handle map click for valve placement
setTimeout(() => {
    if (typeof map !== 'undefined') {
        map.on('click', (e) => {
            if (valveAddMode) {
                handleValvePlacement(e);
            }
        });
    }
}, 1000);

// NEW: Helper function to find nearest pipeline and snap point
function findNearestPipelinePoint(clickPoint) {
    let minDistance = Infinity;
    let snapPoint = null;
    let pipelineInfo = null;
    
    if (typeof savedPipelines === 'undefined' || !savedPipelines) {
        return null;
    }
    
    savedPipelines.forEach(pipeline => {
        const nodes = JSON.parse(pipeline.nodes);
        
        // Check each segment
        for (let i = 0; i < nodes.length - 1; i++) {
            const segStart = nodes[i];
            const segEnd = nodes[i + 1];
            
            // Calculate closest point on this segment
            const closestPoint = getClosestPointOnSegment(clickPoint, segStart, segEnd);
            const distance = map.distance(clickPoint, [closestPoint.lat, closestPoint.lng]);
            
            if (distance < minDistance) {
                minDistance = distance;
                snapPoint = closestPoint;
                pipelineInfo = {
                    pipelineId: pipeline.id,
                    segmentIndex: i,
                    distance: distance
                };
            }
        }
    });
    
    return {
        snapPoint,
        pipelineInfo,
        distance: minDistance
    };
}

// NEW: Calculate closest point on a line segment
function getClosestPointOnSegment(point, segStart, segEnd) {
    const A = point.lat - segStart.lat;
    const B = point.lng - segStart.lng;
    const C = segEnd.lat - segStart.lat;
    const D = segEnd.lng - segStart.lng;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = lenSq !== 0 ? dot / lenSq : -1;
    
    // Clamp parameter to [0, 1] to stay on segment
    param = Math.max(0, Math.min(1, param));
    
    return {
        lat: segStart.lat + param * C,
        lng: segStart.lng + param * D
    };
}

// NEW: Snap valve to pipeline
function snapValveToPipeline() {
    if (!tempValveMarker || !valveMarkerPosition) return;
    
    const result = findNearestPipelinePoint(valveMarkerPosition);
    
    if (result && result.distance < 100) { // 100 meters threshold
        // Snap to pipeline
        valveMarkerPosition = result.snapPoint;
        nearestPipelineInfo = result.pipelineInfo;
        
        tempValveMarker.setLatLng([result.snapPoint.lat, result.snapPoint.lng]);
        updateValveLocationDisplay();
        
        console.log(`📍 Valve snapped to Pipeline ${result.pipelineInfo.pipelineId}, distance: ${result.distance.toFixed(1)}m`);
    }
}

function handleValvePlacement(e) {
    // Find nearest pipeline
    const result = findNearestPipelinePoint(e.latlng);
    
    if (!result || result.distance > 100) {
        alert('⚠️ Valve must be placed on a pipeline!\n\nClick closer to a pipeline (within 100 meters).\n\nIf no pipelines exist, draw one first using the pen tool.');
        return;
    }
    
    console.log(`✅ Placing valve on Pipeline ${result.pipelineInfo.pipelineId}, ${result.distance.toFixed(1)}m from click`);
    
    if (tempValveMarker) {
        map.removeLayer(tempValveMarker);
    }
    
    // Use snapped position
    valveMarkerPosition = result.snapPoint;
    nearestPipelineInfo = result.pipelineInfo;
    
    // Create temporary marker at EXACT pipeline position
    const tempIcon = L.divIcon({
        className: 'temp-valve-icon',
        html: '<div class="valve-icon" style="background: #FF9800; animation: pulse 1.5s ease-in-out infinite;">📍</div>',
        iconSize: [36, 36],
        iconAnchor: [18, 18]
    });
    
    tempValveMarker = L.marker([result.snapPoint.lat, result.snapPoint.lng], {
        icon: tempIcon,
        draggable: true
    }).addTo(map);
    
    tempValveMarker.on('drag', function() {
        const pos = tempValveMarker.getLatLng();
        valveMarkerPosition = pos;
        updateValveLocationDisplay();
    });
    
    tempValveMarker.on('dragend', function() {
        const pos = tempValveMarker.getLatLng();
        valveMarkerPosition = pos;
        updateValveLocationDisplay();
        
        // Re-snap to nearest pipeline on drag end
        snapValveToPipeline();
    });
    
    // Reset form for new valve
    editingValveId = null;
    document.getElementById('valveForm').reset();
    document.getElementById('valveModalTitle').textContent = '🔧 Add Valve (Snapped to Pipeline - drag to adjust)';
    document.getElementById('valveId').disabled = false;
    
    // Update location display
    updateValveLocationDisplay();
    
    // Show modal
    document.getElementById('valveModal').classList.add('show');
    document.getElementById('modalOverlay').classList.add('show');
    
    // Reset mode
    valveAddMode = false;
    document.getElementById('addValveBtn').classList.remove('active');
    map.getContainer().style.cursor = '';
    
    console.log('✅ Valve placement marker created at snapped position:', result.snapPoint);
}

function updateValveLocationDisplay() {
    const locationInput = document.getElementById('valveLocation');
    if (locationInput && valveMarkerPosition) {
        let locationText = `${valveMarkerPosition.lat.toFixed(6)}, ${valveMarkerPosition.lng.toFixed(6)}`;
        if (nearestPipelineInfo) {
            locationText += ` (on Pipeline ${nearestPipelineInfo.pipelineId})`;
        }
        locationInput.value = locationText;
    }
}

async function saveValve() {
    if (!valveMarkerPosition) {
        alert('❌ Please place valve on map first');
        return;
    }
    
    // Verify valve is on a pipeline
    const result = findNearestPipelinePoint(valveMarkerPosition);
    if (!result || result.distance > 15) {
        alert('❌ Valve must be on a pipeline!\n\nDistance to nearest pipeline: ' + (result ? result.distance.toFixed(1) : 'N/A') + 'm\n\nPlease drag the marker closer to a pipeline.');
        return;
    }
    
    const valveData = {
        valveId: document.getElementById('valveId').value.trim(),
        name: document.getElementById('valveName').value.trim(),
        type: document.getElementById('valveType').value,
        category: document.getElementById('valveCategory').value,
        households: parseInt(document.getElementById('valveHouseholds').value) || 0,
        flowRate: parseFloat(document.getElementById('valveFlowRate').value) || 0,
        latitude: parseFloat(valveMarkerPosition.lat),
        longitude: parseFloat(valveMarkerPosition.lng),
        isOpen: true // Default to open for new valves
    };
    
    // Validation
    if (!valveData.valveId || !valveData.name) {
        alert('❌ Valve ID and Name are required');
        return;
    }

    console.log('📤 Sending valve data to server:', valveData);
    console.log('📍 Valve is on Pipeline:', result.pipelineInfo.pipelineId);

    try {
        let response;
        
        if (editingValveId) {
            // Update existing valve
            response = await fetch(`http://localhost:3000/api/valve/${editingValveId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(valveData)
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to update valve');
            }
            
            console.log('✅ Valve updated:', valveData.valveId);
            alert('✅ Valve updated successfully!');
        } else {
            // Create new valve
            response = await fetch('http://localhost:3000/api/valve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(valveData)
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to save valve');
            }
            
            const result = await response.json();
            console.log('✅ Valve created:', result);
            alert('✅ Valve added successfully on Pipeline ' + nearestPipelineInfo.pipelineId + '!');
        }
        
        // Close modal
        document.getElementById('valveModal').classList.remove('show');
        document.getElementById('modalOverlay').classList.remove('show');
        
        // Remove temp marker
        if (tempValveMarker) {
            map.removeLayer(tempValveMarker);
            tempValveMarker = null;
        }
        
        // Reset form and state
        document.getElementById('valveForm').reset();
        document.getElementById('valveId').disabled = false;
        valveMarkerPosition = null;
        editingValveId = null;
        nearestPipelineInfo = null;
        
        // Reload valves
        if (gateValveSystem) {
            await gateValveSystem.loadValves();
        }
        
        // Recalculate water flow with new valve
        if (typeof waterFlowSystem !== 'undefined' && waterFlowSystem) {
            await waterFlowSystem.recalculateAllFlows();
        }
        
    } catch (err) {
        console.error('❌ Error saving valve:', err);
        alert('❌ Error saving valve: ' + err.message);
    }
}

// Export for global access
window.gateValveSystem = gateValveSystem;