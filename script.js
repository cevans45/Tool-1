const canvas = document.getElementById('clockCanvas');
const ctx = canvas.getContext('2d');
const timeDisplay = document.getElementById('timeDisplay');

// Set canvas size
const SIZE = 400;
const BASE_PIXEL_SIZE = 4; // Base size for pattern definition
let pixelSize = 4;
let gridSize = SIZE / pixelSize;

canvas.width = SIZE;
canvas.height = SIZE;

// Create grid to represent pixels
let grid = Array(gridSize).fill(null).map(() => Array(gridSize).fill(false));
let animatedPixels = [];

// Color for pixels
let pixelColor = { r: 0, g: 0, b: 0 };

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

// Color slider
const colorSlider = document.getElementById('colorSlider');
const colorValue = document.getElementById('colorValue');

function setColor(hue) {
    pixelColor = hslToRgb(hue / 360, 1, 0.5);
    const colorHex = rgbToHex(pixelColor.r, pixelColor.g, pixelColor.b);
    colorValue.textContent = colorHex;
    colorValue.style.color = colorHex;
}

function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255)
    };
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('');
}

colorSlider.addEventListener('input', (e) => {
    setColor(parseInt(e.target.value, 10));
});

// Initialize base pattern (symmetrical pixel art)
function initializePattern() {
    const center = SIZE / 2; // Use canvas pixel coordinates, not grid coordinates
    const centerGrid = gridSize / 2;
    
    // Clear grid
    grid = Array(gridSize).fill(null).map(() => Array(gridSize).fill(false));
    
    // Create symmetrical pattern
    function setPixel(gridX, gridY) {
        if (gridX >= 0 && gridX < gridSize && gridY >= 0 && gridY < gridSize) {
            grid[gridY][gridX] = true;
        }
    }
    
    // Helper to set pixels with 4-fold symmetry (rotational and reflectional)
    // Takes pixel coordinates (not grid coordinates)
    function setSymmetrical(pixelX, pixelY) {
        // Convert pixel coordinates to grid coordinates
        const gridX = Math.floor(pixelX / pixelSize);
        const gridY = Math.floor(pixelY / pixelSize);
        const centerGridX = centerGrid;
        const centerGridY = centerGrid;
        const dx = gridX - centerGridX;
        const dy = gridY - centerGridY;
        
        // Set all 4 rotations (90-degree symmetry)
        setPixel(centerGridX + dx, centerGridY + dy);
        setPixel(centerGridX - dy, centerGridY + dx);
        setPixel(centerGridX - dx, centerGridY - dy);
        setPixel(centerGridX + dy, centerGridY - dx);
        
        // Also set reflections for full 8-fold symmetry
        setPixel(centerGridX - dx, centerGridY + dy);
        setPixel(centerGridX + dx, centerGridY - dy);
        setPixel(centerGridX + dy, centerGridY + dx);
        setPixel(centerGridX - dy, centerGridY - dy);
    }
    
    // Center sparse pattern (in pixel coordinates)
    setSymmetrical(center, center);
    setSymmetrical(center + BASE_PIXEL_SIZE, center);
    setSymmetrical(center, center + BASE_PIXEL_SIZE);
    setSymmetrical(center - BASE_PIXEL_SIZE, center);
    setSymmetrical(center, center - BASE_PIXEL_SIZE);
    
    // Radial elements - structured pattern (in pixel coordinates relative to center)
    const patterns = [
        // Small dots and lines along axes
        {x: 0, y: 8 * BASE_PIXEL_SIZE}, {x: 0, y: 12 * BASE_PIXEL_SIZE}, {x: 0, y: 16 * BASE_PIXEL_SIZE},
        {x: 8 * BASE_PIXEL_SIZE, y: 0}, {x: 12 * BASE_PIXEL_SIZE, y: 0}, {x: 16 * BASE_PIXEL_SIZE, y: 0},
        // L-shapes
        {x: 5 * BASE_PIXEL_SIZE, y: 5 * BASE_PIXEL_SIZE}, {x: 6 * BASE_PIXEL_SIZE, y: 5 * BASE_PIXEL_SIZE}, {x: 5 * BASE_PIXEL_SIZE, y: 6 * BASE_PIXEL_SIZE},
        {x: 8 * BASE_PIXEL_SIZE, y: 8 * BASE_PIXEL_SIZE}, {x: 9 * BASE_PIXEL_SIZE, y: 8 * BASE_PIXEL_SIZE}, {x: 8 * BASE_PIXEL_SIZE, y: 9 * BASE_PIXEL_SIZE},
        // Diagonal segments
        {x: 10 * BASE_PIXEL_SIZE, y: 3 * BASE_PIXEL_SIZE}, {x: 11 * BASE_PIXEL_SIZE, y: 4 * BASE_PIXEL_SIZE}, {x: 12 * BASE_PIXEL_SIZE, y: 5 * BASE_PIXEL_SIZE},
        {x: 3 * BASE_PIXEL_SIZE, y: 10 * BASE_PIXEL_SIZE}, {x: 4 * BASE_PIXEL_SIZE, y: 11 * BASE_PIXEL_SIZE}, {x: 5 * BASE_PIXEL_SIZE, y: 12 * BASE_PIXEL_SIZE},
        // Corner patterns - curved elements
        {x: 15 * BASE_PIXEL_SIZE, y: 10 * BASE_PIXEL_SIZE}, {x: 16 * BASE_PIXEL_SIZE, y: 11 * BASE_PIXEL_SIZE}, {x: 17 * BASE_PIXEL_SIZE, y: 12 * BASE_PIXEL_SIZE},
        {x: 18 * BASE_PIXEL_SIZE, y: 13 * BASE_PIXEL_SIZE}, {x: 19 * BASE_PIXEL_SIZE, y: 14 * BASE_PIXEL_SIZE},
        {x: 10 * BASE_PIXEL_SIZE, y: 15 * BASE_PIXEL_SIZE}, {x: 11 * BASE_PIXEL_SIZE, y: 16 * BASE_PIXEL_SIZE}, {x: 12 * BASE_PIXEL_SIZE, y: 17 * BASE_PIXEL_SIZE},
        {x: 13 * BASE_PIXEL_SIZE, y: 18 * BASE_PIXEL_SIZE}, {x: 14 * BASE_PIXEL_SIZE, y: 19 * BASE_PIXEL_SIZE},
        // Staircase patterns
        {x: 20 * BASE_PIXEL_SIZE, y: 5 * BASE_PIXEL_SIZE}, {x: 21 * BASE_PIXEL_SIZE, y: 6 * BASE_PIXEL_SIZE}, {x: 22 * BASE_PIXEL_SIZE, y: 7 * BASE_PIXEL_SIZE},
        {x: 5 * BASE_PIXEL_SIZE, y: 20 * BASE_PIXEL_SIZE}, {x: 6 * BASE_PIXEL_SIZE, y: 21 * BASE_PIXEL_SIZE}, {x: 7 * BASE_PIXEL_SIZE, y: 22 * BASE_PIXEL_SIZE},
        // Horizontal and vertical lines
        {x: 25 * BASE_PIXEL_SIZE, y: 8 * BASE_PIXEL_SIZE}, {x: 26 * BASE_PIXEL_SIZE, y: 8 * BASE_PIXEL_SIZE}, {x: 27 * BASE_PIXEL_SIZE, y: 8 * BASE_PIXEL_SIZE},
        {x: 8 * BASE_PIXEL_SIZE, y: 25 * BASE_PIXEL_SIZE}, {x: 8 * BASE_PIXEL_SIZE, y: 26 * BASE_PIXEL_SIZE}, {x: 8 * BASE_PIXEL_SIZE, y: 27 * BASE_PIXEL_SIZE},
        // Dense corner clusters
        {x: 30 * BASE_PIXEL_SIZE, y: 12 * BASE_PIXEL_SIZE}, {x: 31 * BASE_PIXEL_SIZE, y: 12 * BASE_PIXEL_SIZE}, {x: 32 * BASE_PIXEL_SIZE, y: 12 * BASE_PIXEL_SIZE},
        {x: 30 * BASE_PIXEL_SIZE, y: 13 * BASE_PIXEL_SIZE}, {x: 31 * BASE_PIXEL_SIZE, y: 13 * BASE_PIXEL_SIZE}, {x: 32 * BASE_PIXEL_SIZE, y: 13 * BASE_PIXEL_SIZE},
        {x: 12 * BASE_PIXEL_SIZE, y: 30 * BASE_PIXEL_SIZE}, {x: 12 * BASE_PIXEL_SIZE, y: 31 * BASE_PIXEL_SIZE}, {x: 12 * BASE_PIXEL_SIZE, y: 32 * BASE_PIXEL_SIZE},
        {x: 13 * BASE_PIXEL_SIZE, y: 30 * BASE_PIXEL_SIZE}, {x: 13 * BASE_PIXEL_SIZE, y: 31 * BASE_PIXEL_SIZE}, {x: 13 * BASE_PIXEL_SIZE, y: 32 * BASE_PIXEL_SIZE},
        // Outer edge elements
        {x: 35 * BASE_PIXEL_SIZE, y: 8 * BASE_PIXEL_SIZE}, {x: 36 * BASE_PIXEL_SIZE, y: 9 * BASE_PIXEL_SIZE}, {x: 37 * BASE_PIXEL_SIZE, y: 10 * BASE_PIXEL_SIZE},
        {x: 8 * BASE_PIXEL_SIZE, y: 35 * BASE_PIXEL_SIZE}, {x: 9 * BASE_PIXEL_SIZE, y: 36 * BASE_PIXEL_SIZE}, {x: 10 * BASE_PIXEL_SIZE, y: 37 * BASE_PIXEL_SIZE},
        // Additional scattered pixels
        {x: 18 * BASE_PIXEL_SIZE, y: 18 * BASE_PIXEL_SIZE}, {x: 20 * BASE_PIXEL_SIZE, y: 20 * BASE_PIXEL_SIZE}, {x: 22 * BASE_PIXEL_SIZE, y: 22 * BASE_PIXEL_SIZE},
        {x: 15 * BASE_PIXEL_SIZE, y: 20 * BASE_PIXEL_SIZE}, {x: 20 * BASE_PIXEL_SIZE, y: 15 * BASE_PIXEL_SIZE},
    ];
    
    patterns.forEach(pattern => {
        setSymmetrical(center + pattern.x, center + pattern.y);
    });
    
    // Add some random scattered pixels for texture
    for (let i = 0; i < 50; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 10 * BASE_PIXEL_SIZE + Math.random() * (SIZE / 2 - 20 * BASE_PIXEL_SIZE);
        const x = center + radius * Math.cos(angle);
        const y = center + radius * Math.sin(angle);
        if (Math.random() > 0.7) {
            setSymmetrical(x, y);
        }
    }
}

// Draw the grid
function drawGrid() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SIZE, SIZE);
    
    const colorStr = `rgb(${pixelColor.r}, ${pixelColor.g}, ${pixelColor.b})`;
    ctx.fillStyle = colorStr;
    
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
            ctx.fillStyle = `rgba(${pixelColor.r}, ${pixelColor.g}, ${pixelColor.b}, ${alpha})`;
            ctx.fillRect(
                pixel.x * pixelSize, 
                pixel.y * pixelSize, 
                pixelSize, 
                pixelSize
            );
            
            // Add glow effect for moving pixels
            if (pixel.intensity > 0.7) {
                ctx.fillStyle = `rgba(${pixelColor.r}, ${pixelColor.g}, ${pixelColor.b}, ${alpha * 0.3})`;
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
setColor(0); // Initialize color to black (hue 0)
animate();
