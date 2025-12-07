// Live sensor data simulator - works in Node.js and Browser

const deviceId = '123456';  // Change this to your device ID

let currentWaterLevel = 7.5;
let currentTemp = 25.0;
let isIncreasing = true;

// Check if running in Node.js
const isNode = typeof window === 'undefined';

// Import http module if in Node.js
let http;
if (isNode) {
  http = require('http');
}

// Send data function
async function sendSensorData() {
  // Simulate realistic water level changes
  if (isIncreasing) {
    currentWaterLevel += Math.random() * 0.05;
    if (currentWaterLevel > 9.5) isIncreasing = false;
  } else {
    currentWaterLevel -= Math.random() * 0.08;
    if (currentWaterLevel < 2.0) isIncreasing = true;
  }
  
  currentTemp += (Math.random() - 0.5) * 0.3;
  currentTemp = Math.max(20, Math.min(35, currentTemp));
  
  const payload = {
    deviceId: deviceId,
    waterLevel: parseFloat(currentWaterLevel.toFixed(2)),
    temperature: parseFloat(currentTemp.toFixed(1)),
    timestamp: new Date().toISOString()
  };

  const jsonData = JSON.stringify(payload);

  if (isNode) {
    // Node.js HTTP request - USE 127.0.0.1 instead of localhost
    const options = {
      hostname: '127.0.0.1',  // Changed from 'localhost'
      port: 3000,
      path: '/api/sensor/data',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(jsonData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.success) {
            console.log(`✅ [${new Date().toLocaleTimeString()}] Water: ${payload.waterLevel}m | Temp: ${payload.temperature}°C | Volume: ${result.metrics.volumeLiters.toFixed(0)}L | Pressure: ${result.metrics.pressureKPa}kPa`);
          } else {
            console.log(`⚠️  [${new Date().toLocaleTimeString()}] Response:`, data);
          }
        } catch (e) {
          console.log(`❌ [${new Date().toLocaleTimeString()}] Error:`, data);
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ Error:', error.message);
      console.error('💡 Make sure your server is running on http://127.0.0.1:3000');
      console.error('💡 Check if device "123456" exists in your tanks table');
    });

    req.write(jsonData);
    req.end();

  } else {
    // Browser fetch
    try {
      const response = await fetch('http://localhost:3000/api/sensor/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: jsonData
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Error:', error);
        return;
      }

      const result = await response.json();
      console.log(`✅ [${new Date().toLocaleTimeString()}] Water: ${payload.waterLevel}m | Temp: ${payload.temperature}°C | Volume: ${result.metrics.volumeLiters.toFixed(0)}L`);
      
    } catch (error) {
      console.error('❌ Network Error:', error.message);
    }
  }
}

// Start streaming
console.log('🚀 Starting live sensor data stream...');
console.log(`📡 Device ID: ${deviceId}`);
console.log('⏱️  Sending data every 3 seconds');
console.log('💡 Server must be running on http://127.0.0.1:3000');
console.log('💡 Device ID must exist in tanks table with matching deviceId');
console.log('-----------------------------------');

sendSensorData();
setInterval(sendSensorData, 3000);