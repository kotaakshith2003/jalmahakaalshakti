class WaterFlowSystem {
    constructor(map) {
        this.map = map;
        this.tanks = [];
        this.activeTank = null;
        this.flowAnimations = [];
        this.flowLayers = [];
    }

    addTank(tank) {
        this.tanks.push(tank);
        this.drawTankOnMap(tank);
    }

    drawTankOnMap(tank) {
        const icon = L.divIcon({
            className: 'tank-icon',
            html: `<div style="background: ${tank.isActive ? '#4CAF50' : '#757575'}; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; font-size: 10px; color: white; font-weight: bold; cursor: pointer;">T</div>`,
            iconSize: [20, 20]
        });

        const marker = L.marker([tank.latitude, tank.longitude], { icon })
            .addTo(this.map);

        marker.on('click', () => {
            window.openTankSidebar(tank.tankId);
        });

        tank.marker = marker;
        
        if (tank.isActive) {
            this.activeTank = tank;
            this.startWaterFlow(tank);
        }
    }

    getTankPopupContent(tank) {
        return `<div style="min-width: 150px; text-align: center;">
            <h4>${tank.name}</h4>
            <p>Click for details</p>
        </div>`;
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

            // Update all tank markers
            this.tanks.forEach(t => {
                if (t.marker) {
                    this.map.removeLayer(t.marker);
                    this.drawTankOnMap(t);
                }
            });

            if (tank.isActive) {
                this.activeTank = tank;
                this.startWaterFlow(tank);
            } else {
                this.stopWaterFlow();
            }
            
            return true;
        } catch (err) {
            console.error('Error toggling tank:', err);
            return false;
        }
    }

    updateTankMarker(tank) {
        if (tank.marker) {
            this.map.removeLayer(tank.marker);
        }
        this.drawTankOnMap(tank);
    }

    async startWaterFlow(tank) {
        this.stopWaterFlow();

        try {
            const response = await fetch('http://localhost:3000/api/pipelines');
            const pipelines = await response.json();

            const segments = this.findConnectedPipelines(tank, pipelines);
            
            console.log('Starting water flow animation with', segments.length, 'segments');

            if (segments.length > 0) {
                this.animateWaterFlow(segments, tank);
            } else {
                console.log('No connected pipelines found');
            }
        } catch (err) {
            console.error('Error starting water flow:', err);
        }
    }

    findConnectedPipelines(tank, pipelines) {
        const CONNECT_DISTANCE = 100;
        const allSegments = [];
        const visitedPipelines = new Set();
        const queue = [];

        console.log('Starting BFS from tank:', tank.name);
        console.log('Total pipelines:', pipelines.length);

        // Find initial pipelines connected to tank
        pipelines.forEach(pipeline => {
            const nodes = JSON.parse(pipeline.nodes);
            let minDist = Infinity;
            nodes.forEach(node => {
                const dist = this.map.distance([tank.latitude, tank.longitude], [node.lat, node.lng]);
                if (dist < minDist) minDist = dist;
            });

            if (minDist < CONNECT_DISTANCE) {
                console.log('Initial connection to pipeline', pipeline.id, 'distance:', minDist);
                queue.push(pipeline.id);
                visitedPipelines.add(pipeline.id);
            }
        });

        console.log('Initial connected pipelines:', visitedPipelines.size);

        // BFS to find all connected pipelines
        while (queue.length > 0) {
            const currentId = queue.shift();
            const currentPipeline = pipelines.find(p => p.id === currentId);
            if (!currentPipeline) continue;

            const currentNodes = JSON.parse(currentPipeline.nodes);
            
            // Add all segments from this pipeline
            for (let i = 0; i < currentNodes.length - 1; i++) {
                allSegments.push({
                    start: currentNodes[i],
                    end: currentNodes[i + 1]
                });
            }

            // Check all other pipelines for connections
            pipelines.forEach(pipeline => {
                if (visitedPipelines.has(pipeline.id)) return;

                const nodes = JSON.parse(pipeline.nodes);
                const isConnected = this.pipelinesConnect(currentNodes, nodes);

                if (isConnected) {
                    console.log('BFS found connection to pipeline', pipeline.id);
                    queue.push(pipeline.id);
                    visitedPipelines.add(pipeline.id);
                }
            });
        }

        console.log('Total connected pipelines:', visitedPipelines.size);
        console.log('Total segments to animate:', allSegments.length);

        return allSegments;
    }

    pipelinesConnect(nodes1, nodes2) {
        const CONNECT_DISTANCE = 100;
        
        for (let n1 of nodes1) {
            for (let n2 of nodes2) {
                const dist = this.map.distance([n1.lat, n1.lng], [n2.lat, n2.lng]);
                if (dist < CONNECT_DISTANCE) {
                    return true;
                }
            }
        }
        return false;
    }

    animateWaterFlow(segments, tank) {
        if (!segments || segments.length === 0) {
            console.log('No segments to animate');
            return;
        }

        console.log('Creating', segments.length, 'flow lines');

        // Draw all segments
        segments.forEach((segment, idx) => {
            const flowLine = L.polyline(
                [[segment.start.lat, segment.start.lng], [segment.end.lat, segment.end.lng]],
                {
                    color: '#2196F3',
                    weight: 6,
                    opacity: 1,
                    dashArray: '10, 10',
                    className: 'water-flow-line'
                }
            ).addTo(this.map);

            this.flowLayers.push(flowLine);
        });

        console.log('Flow layers created:', this.flowLayers.length);

        // Animate
        let offset = 0;
        const animate = () => {
            if (!tank.isActive) {
                this.stopWaterFlow();
                return;
            }

            offset = (offset + 2) % 20;
            
            this.flowLayers.forEach(flowLine => {
                if (flowLine._path) {
                    flowLine._path.style.strokeDashoffset = offset;
                }
            });

            const animId = requestAnimationFrame(animate);
            this.flowAnimations.push(animId);
        };

        animate();
    }

    stopWaterFlow() {
        this.flowAnimations.forEach(id => cancelAnimationFrame(id));
        this.flowAnimations = [];

        this.flowLayers.forEach(layer => this.map.removeLayer(layer));
        this.flowLayers = [];

        if (this.activeTank) {
            this.activeTank.isActive = false;
            this.activeTank = null;
        }
    }

    async loadTanks() {
        try {
            const response = await fetch('http://localhost:3000/api/tanks');
            const tanks = await response.json();
            
            this.tanks = tanks;
            tanks.forEach(tank => this.drawTankOnMap(tank));
        } catch (err) {
            console.error('Error loading tanks:', err);
        }
    }

    clearTanks() {
        this.tanks.forEach(tank => {
            if (tank.marker) {
                this.map.removeLayer(tank.marker);
            }
        });
        this.tanks = [];
    }
}

// Make it globally accessible
let waterFlowSystem;