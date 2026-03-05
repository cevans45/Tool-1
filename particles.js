// Particle ring tool — simple, fully editable moving rings

let prParticles = [];
let prSelected = -1;

const prParams = {
  outerCount: 16,
  innerCount: 5,
  outerRadiusPct: 35,
  innerRadiusPct: 14,
  outerSpeed: 0.6,
  innerSpeed: -1.2,
  bg: '#000000',
  outerColor: '#007a4a',
  innerColor: '#8b1a10',
};

function prSetupCommon(p) {
  const container = document.getElementById('particle-canvas');
  const w = Math.max(320, Math.min(window.innerWidth - 420, window.innerHeight - 120));
  const canvas = p.createCanvas(w, w);
  if (container) canvas.parent('particle-canvas');
  prInitParticles(p);
  prBindControls(p);
}

function prInitParticles(p) {
  prParticles = [];
  const outerR = (prParams.outerRadiusPct / 100) * (p.width / 2);
  const innerR = (prParams.innerRadiusPct / 100) * (p.width / 2);

  for (let i = 0; i < prParams.outerCount; i++) {
    const angle = (p.TWO_PI * i) / prParams.outerCount;
    prParticles.push({
      ring: 'outer',
      baseRadius: outerR,
      angle,
      size: 48,
      speedFactor: 1,
      shape: 'circle',
    });
  }

  for (let i = 0; i < prParams.innerCount; i++) {
    const angle = (p.TWO_PI * i) / Math.max(1, prParams.innerCount);
    prParticles.push({
      ring: 'inner',
      baseRadius: innerR,
      angle,
      size: 32,
      speedFactor: 1,
      shape: 'square',
    });
  }

  prSelected = prParticles.length ? 0 : -1;
}

function prBindControls(p) {
  const id = (x) => document.getElementById(x);
  const outerCountEl = id('pr-outer-count');
  const innerCountEl = id('pr-inner-count');
  const outerRadiusEl = id('pr-outer-radius');
  const innerRadiusEl = id('pr-inner-radius');
  const outerSpeedEl = id('pr-outer-speed');
  const innerSpeedEl = id('pr-inner-speed');
  const bgEl = id('pr-bg');
  const outerColorEl = id('pr-outer-color');
  const innerColorEl = id('pr-inner-color');
  const selLabel = id('pr-selected-label');
  const selSizeEl = id('pr-selected-size');
  const selSpeedEl = id('pr-selected-speed');
  const selShapeEl = id('pr-selected-shape');

  const setVal = (labelId, text) => {
    const el = id(labelId);
    if (el) el.textContent = text;
  };

  if (outerCountEl) {
    outerCountEl.addEventListener('input', () => {
      prParams.outerCount = parseInt(outerCountEl.value, 10);
      setVal('val-pr-outer-count', outerCountEl.value);
      prInitParticles(p);
    });
  }

  if (innerCountEl) {
    innerCountEl.addEventListener('input', () => {
      prParams.innerCount = parseInt(innerCountEl.value, 10);
      setVal('val-pr-inner-count', innerCountEl.value);
      prInitParticles(p);
    });
  }

  if (outerRadiusEl) {
    outerRadiusEl.addEventListener('input', () => {
      prParams.outerRadiusPct = parseInt(outerRadiusEl.value, 10);
      setVal('val-pr-outer-radius', prParams.outerRadiusPct + '%');
      prInitParticles(p);
    });
  }

  if (innerRadiusEl) {
    innerRadiusEl.addEventListener('input', () => {
      prParams.innerRadiusPct = parseInt(innerRadiusEl.value, 10);
      setVal('val-pr-inner-radius', prParams.innerRadiusPct + '%');
      prInitParticles(p);
    });
  }

  if (outerSpeedEl) {
    outerSpeedEl.addEventListener('input', () => {
      prParams.outerSpeed = parseInt(outerSpeedEl.value, 10) / 100;
      setVal('val-pr-outer-speed', prParams.outerSpeed.toFixed(2) + 'x');
    });
  }

  if (innerSpeedEl) {
    innerSpeedEl.addEventListener('input', () => {
      prParams.innerSpeed = parseInt(innerSpeedEl.value, 10) / 100;
      setVal('val-pr-inner-speed', prParams.innerSpeed.toFixed(2) + 'x');
    });
  }

  if (bgEl) {
    bgEl.addEventListener('input', () => {
      prParams.bg = bgEl.value;
    });
  }

  if (outerColorEl) {
    outerColorEl.addEventListener('input', () => {
      prParams.outerColor = outerColorEl.value;
    });
  }

  if (innerColorEl) {
    innerColorEl.addEventListener('input', () => {
      prParams.innerColor = innerColorEl.value;
    });
  }

  const syncSelected = () => {
    if (!selLabel) return;
    if (prSelected < 0 || prSelected >= prParticles.length) {
      selLabel.textContent = 'None';
      return;
    }
    const ptn = prParticles[prSelected];
    selLabel.textContent = `${ptn.ring === 'outer' ? 'Outer' : 'Inner'} #${prSelected + 1}`;
    if (selSizeEl) {
      selSizeEl.value = ptn.size;
      setVal('val-pr-selected-size', String(ptn.size));
    }
    if (selSpeedEl) {
      selSpeedEl.value = Math.round(ptn.speedFactor * 100);
      setVal('val-pr-selected-speed', ptn.speedFactor.toFixed(2) + 'x');
    }
    if (selShapeEl) {
      selShapeEl.value = ptn.shape;
    }
  };

  if (selSizeEl) {
    selSizeEl.addEventListener('input', () => {
      const ptn = prParticles[prSelected];
      if (!ptn) return;
      ptn.size = parseInt(selSizeEl.value, 10);
      setVal('val-pr-selected-size', selSizeEl.value);
    });
  }

  if (selSpeedEl) {
    selSpeedEl.addEventListener('input', () => {
      const ptn = prParticles[prSelected];
      if (!ptn) return;
      ptn.speedFactor = parseInt(selSpeedEl.value, 10) / 100;
      setVal('val-pr-selected-speed', ptn.speedFactor.toFixed(2) + 'x');
    });
  }

  if (selShapeEl) {
    selShapeEl.addEventListener('change', () => {
      const ptn = prParticles[prSelected];
      if (!ptn) return;
      ptn.shape = selShapeEl.value;
    });
  }

  syncSelected();
}

const particleSketch = (p) => {
  p.setup = () => {
    prSetupCommon(p);
  };

  p.windowResized = () => {
    const container = document.getElementById('particle-canvas');
    if (!container) return;
    const w = Math.max(320, Math.min(window.innerWidth - 420, window.innerHeight - 120));
    p.resizeCanvas(w, w);
  };

  p.mousePressed = () => {
    const mx = p.mouseX;
    const my = p.mouseY;
    if (mx < 0 || my < 0 || mx > p.width || my > p.height) return;
    let hit = -1;
    let best = Infinity;
    const cx = p.width / 2;
    const cy = p.height / 2;
    for (let i = 0; i < prParticles.length; i++) {
      const pt = prParticles[i];
      const radius = pt.baseRadius;
      const x = cx + Math.cos(pt.angle) * radius;
      const y = cy + Math.sin(pt.angle) * radius;
      const d = p.dist(mx, my, x, y);
      if (d < pt.size * 0.6 && d < best) {
        best = d;
        hit = i;
      }
    }
    if (hit !== -1) {
      prSelected = hit;
      const label = document.getElementById('pr-selected-label');
      if (label) {
        const pt = prParticles[prSelected];
        label.textContent = `${pt.ring === 'outer' ? 'Outer' : 'Inner'} #${prSelected + 1}`;
      }
    }
  };

  p.draw = () => {
    p.background(prParams.bg);
    const cx = p.width / 2;
    const cy = p.height / 2;
    const t = p.millis() / 1000;

    // artboard stroke
    p.push();
    p.noFill();
    p.stroke(255);
    p.strokeWeight(1);
    p.rectMode(p.CORNER);
    p.rect(0.5, 0.5, p.width - 1, p.height - 1);
    p.pop();

    for (let i = 0; i < prParticles.length; i++) {
      const pt = prParticles[i];
      const baseSpeed = pt.ring === 'outer' ? prParams.outerSpeed : prParams.innerSpeed;
      const speed = baseSpeed * pt.speedFactor;
      pt.angle += speed * 0.01;

      const radius = pt.baseRadius;
      const x = cx + Math.cos(pt.angle) * radius;
      const y = cy + Math.sin(pt.angle) * radius;
      const col = pt.ring === 'outer' ? prParams.outerColor : prParams.innerColor;

      p.push();
      p.translate(x, y);
      p.noStroke();
      p.fill(col);
      if (pt.shape === 'square') {
        p.rectMode(p.CENTER);
        p.rect(0, 0, pt.size, pt.size);
      } else {
        p.circle(0, 0, pt.size);
      }
      p.pop();
    }
  };
};

new p5(particleSketch);

