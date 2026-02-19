const canvas = document.getElementById('clockCanvas');
const ctx = canvas.getContext('2d');
const timeDisplay = document.getElementById('timeDisplay');

// Set canvas size
const SIZE = 400;
let pixelSize = 4;
let gridSize = SIZE / pixelSize;

canvas.width = SIZE;
canvas.height = SIZE;

// Create grid to represent pixels
let grid = Array(gridSize).fill(null).map(() => Array(gridSize).fill(false));
let animatedPixels = [];

// Slider for pixel size
const pixelSizeSlider = document.getElementById('pixelSizeSlider');
const pixelSizeValue = document.getElementById('pixelSizeValue');

function setPixelSize(value) {
    pixelSize = value;
    gridSize = SIZE / pixelSize;
    pixelSizeValue.textContent = pixelSize;
    grid = Array(gridSize).fill(null).map(() => Array(gridSize).fill(false));
    initializePattern();
}

pixelSizeSlider.addEventListener('input', (e) => {
    setPixelSize(parseInt(e.target.value, 10));
});

// Initialize base pattern (symmetrical pixel art)
function initializePattern() {
    const center = gridSize / 2;
    
    // Clear grid
    grid = Array(gridSize).fill(null).map(() => Array(gridSize).fill(false));
    
    // Create symmetrical pattern
    function setPixel(x, y) {
        if (x >= 0 && x < gridSize && y >= 0 && y < gridSize) {
            grid[y][x] = true;
        }
    }
    
    // Helper to set pixels with 4-fold symmetry (rotational and reflectional)
    function setSymmetrical(x, y) {
        const centerX = center;
        const centerY = center;
        const dx = x - centerX;
        const dy = y - centerY;
        
        // Set all 4 rotations (90-degree symmetry)
        setPixel(centerX + dx, centerY + dy);
        setPixel(centerX - dy, centerY + dx);
        setPixel(centerX - dx, centerY - dy);
        setPixel(centerX + dy, centerY - dx);
        
        // Also set reflections for full 8-fold symmetry
        setPixel(centerX - dx, centerY + dy);
        setPixel(centerX + dx, centerY - dy);
        setPixel(centerX + dy, centerY + dx);
        setPixel(centerX - dy, centerY - dx);
    }
    
    // Center sparse pattern
    setSymmetrical(center, center);
    setSymmetrical(center + 1, center);
    setSymmetrical(center, center + 1);
    setSymmetrical(center - 1, center);
    setSymmetrical(center, center - 1);
    
    // Radial elements - structured pattern
    const patterns = [
        // Small dots and lines along axes
        {x: 0, y: 8}, {x: 0, y: 12}, {x: 0, y: 16},
        {x: 8, y: 0}, {x: 12, y: 0}, {x: 16, y: 0},
        // L-shapes
        {x: 5, y: 5}, {x: 6, y: 5}, {x: 5, y: 6},
        {x: 8, y: 8}, {x: 9, y: 8}, {x: 8, y: 9},
        // Diagonal segments
        {x: 10, y: 3}, {x: 11, y: 4}, {x: 12, y: 5},
        {x: 3, y: 10}, {x: 4, y: 11}, {x: 5, y: 12},
        // Corner patterns - curved elements
        {x: 15, y: 10}, {x: 16, y: 11}, {x: 17, y: 12},
        {x: 18, y: 13}, {x: 19, y: 14},
        {x: 10, y: 15}, {x: 11, y: 16}, {x: 12, y: 17},
        {x: 13, y: 18}, {x: 14, y: 19},
        // Staircase patterns
        {x: 20, y: 5}, {x: 21, y: 6}, {x: 22, y: 7},
        {x: 5, y: 20}, {x: 6, y: 21}, {x: 7, y: 22},
        // Horizontal and vertical lines
        {x: 25, y: 8}, {x: 26, y: 8}, {x: 27, y: 8},
        {x: 8, y: 25}, {x: 8, y: 26}, {x: 8, y: 27},
        // Dense corner clusters
        {x: 30, y: 12}, {x: 31, y: 12}, {x: 32, y: 12},
        {x: 30, y: 13}, {x: 31, y: 13}, {x: 32, y: 13},
        {x: 12, y: 30}, {x: 12, y: 31}, {x: 12, y: 32},
        {x: 13, y: 30}, {x: 13, y: 31}, {x: 13, y: 32},
        // Outer edge elements
        {x: 35, y: 8}, {x: 36, y: 9}, {x: 37, y: 10},
        {x: 8, y: 35}, {x: 9, y: 36}, {x: 10, y: 37},
        // Additional scattered pixels
        {x: 18, y: 18}, {x: 20, y: 20}, {x: 22, y: 22},
        {x: 15, y: 20}, {x: 20, y: 15},
    ];
    
    const scale = gridSize / 100;
    patterns.forEach(pattern => {
        const px = Math.round(center + pattern.x * scale);
        const py = Math.round(center + pattern.y * scale);
        setSymmetrical(px, py);
    });
    
    // Add some random scattered pixels for texture
    for (let i = 0; i < 50; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 10 + Math.random() * (gridSize / 2 - 20);
        const x = Math.round(center + radius * Math.cos(angle));
        const y = Math.round(center + radius * Math.sin(angle));
        if (Math.random() > 0.7) {
            setSymmetrical(x, y);
        }
    }
}

// Draw the grid
function drawGrid() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SIZE, SIZE);
    
    ctx.fillStyle = '#000000';
    
    // Draw static pattern
    for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
            if (grid[y][x]) {
                ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
            }
        }
    }
}

// Update animated pixels based on time
function updateAnimatedPixels() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    
    // Update time display
    timeDisplay.textContent = 
        String(hours).padStart(2, '0') + ':' + 
        String(minutes).padStart(2, '0') + ':' + 
        String(seconds).padStart(2, '0');
    
    // Clear previous animated pixels
    animatedPixels = [];
    
    const center = gridSize / 2;
    const maxRadius = gridSize / 2 - 5;
    
    // Hours indicator - pixels move in outer ring
    const hourAngle = (hours % 12) * (Math.PI * 2 / 12) - Math.PI / 2;
    const hourRadius = maxRadius * 0.85;
    for (let i = 0; i < 8; i++) {
        const angle = hourAngle + (i - 4) * 0.1;
        const x = Math.round(center + hourRadius * Math.cos(angle));
        const y = Math.round(center + hourRadius * Math.sin(angle));
        animatedPixels.push({x, y, intensity: 1.0});
    }
    
    // Minutes indicator - pixels move in middle ring
    const minuteAngle = minutes * (Math.PI * 2 / 60) - Math.PI / 2;
    const minuteRadius = maxRadius * 0.65;
    for (let i = 0; i < 6; i++) {
        const angle = minuteAngle + (i - 3) * 0.15;
        const x = Math.round(center + minuteRadius * Math.cos(angle));
        const y = Math.round(center + minuteRadius * Math.sin(angle));
        animatedPixels.push({x, y, intensity: 0.8});
    }
    
    // Seconds indicator - pixels pulse and move
    const secondAngle = seconds * (Math.PI * 2 / 60) - Math.PI / 2;
    const secondRadius = maxRadius * 0.45;
    const pulse = Math.sin(seconds * Math.PI / 30) * 0.3 + 0.7;
    
    for (let i = 0; i < 4; i++) {
        const angle = secondAngle + (i - 2) * 0.2;
        const x = Math.round(center + secondRadius * Math.cos(angle));
        const y = Math.round(center + secondRadius * Math.sin(angle));
        animatedPixels.push({x, y, intensity: pulse});
    }
    
    // Add trailing pixels for smooth movement
    for (let trail = 1; trail <= 3; trail++) {
        const trailSeconds = (seconds - trail * 0.2 + 60) % 60;
        const trailAngle = trailSeconds * (Math.PI * 2 / 60) - Math.PI / 2;
        const trailRadius = secondRadius;
        const trailIntensity = (1 - trail * 0.2) * pulse;
        
        for (let i = 0; i < 2; i++) {
            const angle = trailAngle + (i - 1) * 0.2;
            const x = Math.round(center + trailRadius * Math.cos(angle));
            const y = Math.round(center + trailRadius * Math.sin(angle));
            animatedPixels.push({x, y, intensity: trailIntensity});
        }
    }
}

// Draw animated pixels
function drawAnimatedPixels() {
    animatedPixels.forEach(pixel => {
        if (pixel.x >= 0 && pixel.x < gridSize && pixel.y >= 0 && pixel.y < gridSize) {
            // Draw with varying intensity
            const alpha = pixel.intensity;
            ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
            ctx.fillRect(
                pixel.x * pixelSize, 
                pixel.y * pixelSize, 
                pixelSize, 
                pixelSize
            );
            
            // Add glow effect for moving pixels
            if (pixel.intensity > 0.7) {
                ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.3})`;
                ctx.fillRect(
                    (pixel.x - 1) * pixelSize, 
                    pixel.y * pixelSize, 
                    pixelSize, 
                    pixelSize
                );
                ctx.fillRect(
                    (pixel.x + 1) * pixelSize, 
                    pixel.y * pixelSize, 
                    pixelSize, 
                    pixelSize
                );
                ctx.fillRect(
                    pixel.x * pixelSize, 
                    (pixel.y - 1) * pixelSize, 
                    pixelSize, 
                    pixelSize
                );
                ctx.fillRect(
                    pixel.x * pixelSize, 
                    (pixel.y + 1) * pixelSize, 
                    pixelSize, 
                    pixelSize
                );
            }
        }
    });
}

// Animation loop
function animate() {
    drawGrid();
    updateAnimatedPixels();
    drawAnimatedPixels();
    requestAnimationFrame(animate);
}

// Initialize
initializePattern();
animate();
