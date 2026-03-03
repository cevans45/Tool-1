// Hero p5 sketch: animated, interactive OVERT typography

const heroSketch = (p) => {
  let amp = 24;

  function resizeCanvas() {
    const container = document.getElementById('hero-canvas');
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const w = Math.max(480, Math.min(window.innerWidth - 64, 1040));
    const h = 260;
    if (p.width !== w || p.height !== h) {
      p.resizeCanvas(w, h);
    }
  }

  p.setup = () => {
    const container = document.getElementById('hero-canvas');
    if (!container) return;
    const w = Math.max(480, Math.min(window.innerWidth - 64, 1040));
    const h = 260;
    const canvas = p.createCanvas(w, h);
    canvas.parent(container);
    p.textFont('ABC Diatype Mono');
    p.textAlign(p.CENTER, p.CENTER);
    p.noStroke();
  };

  p.windowResized = () => {
    resizeCanvas();
  };

  p.mouseMoved = () => {
    const container = document.getElementById('hero-canvas');
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    if (
      p.mouseX >= 0 &&
      p.mouseX <= p.width &&
      p.mouseY >= 0 &&
      p.mouseY <= p.height &&
      p.mouseX + bounds.left >= 0 &&
      p.mouseX + bounds.left <= window.innerWidth
    ) {
      amp = p.map(p.mouseX, 0, p.width, 10, 42);
    }
  };

  p.draw = () => {
    p.push();
    p.clear();
    p.background(8, 8, 8);
    p.fill(246, 246, 244);

    const baseSize = p.map(p.mouseY || p.height / 2, 0, p.height, 56, 96);
    p.textSize(baseSize);

    const t = p.millis() * 0.0005;
    const cols = 5;
    const colW = p.width / cols;

    for (let i = 0; i < cols; i++) {
      const xCenter = colW * (i + 0.5);
      const phase = t + i * 0.35;
      const offsetY = p.sin(phase) * amp;
      const skew = p.cos(phase * 1.7) * 0.08;

      p.push();
      p.translate(xCenter, p.height / 2 + offsetY);
      p.shearX(skew);
      p.text('OVERT', 0, 0);
      p.pop();
    }

    // subtle scanline overlay
    p.stroke(20, 20, 20, 180);
    p.strokeWeight(1);
    for (let y = 0; y < p.height; y += 3) {
      p.line(0, y + 0.5, p.width, y + 0.5);
    }

    p.pop();
  };
};

new p5(heroSketch);

