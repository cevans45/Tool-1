/* Pearls design tool — controls drive the generative raster
 * https://www.fxhash.xyz/generative/slug/pearls
 */

let directions = [[1, 0], [0, 1], [-1,0], [0,-1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
let raster = [];
let rows = 5;
let cols = 5;
let radius = 10;
let margin = 5;
let w;

// Design tool params (synced from control panel)
let params = {
  rows: 5,
  cols: 5,
  density: 0.25,
  marginPct: 0.1,
  bg: '#e8e4d9',
  colors: ['#F1E9DA', '#2E294E', '#541388', '#FFD400', '#D90368'],
  strokeWeight: 0,
  seed: 123456789
};

function fxrand() { return Math.random(); }

function setup() {
  w = min(windowWidth - 320, windowHeight - 48);
  w = max(w, 300);
  const canvas = createCanvas(w, w);
  canvas.parent('sketch-container');

  rectMode(RADIUS);
  angleMode(DEGREES);

  bindControls();
  noLoop();
  redraw();
}

function bindControls() {
  const rng = (id, valueId, fmt) => {
    const el = document.getElementById(id);
    const val = document.getElementById(valueId);
    if (!el) return;
    el.addEventListener('input', () => {
      params[id.replace('param-', '')] = fmt ? fmt(el) : parseFloat(el.value);
      if (val) val.textContent = el.value + (id === 'param-density' ? '%' : '');
      redraw();
    });
  };

  const rowsEl = document.getElementById('param-rows');
  const colsEl = document.getElementById('param-cols');
  const densityEl = document.getElementById('param-density');
  const marginEl = document.getElementById('param-margin');
  const strokeEl = document.getElementById('param-stroke');
  const seedEl = document.getElementById('param-seed');
  const bgEl = document.getElementById('param-bg');
  const colorEls = ['param-color1','param-color2','param-color3','param-color4','param-color5'];

  if (rowsEl) {
    rowsEl.addEventListener('input', () => {
      params.rows = parseInt(rowsEl.value, 10);
      document.getElementById('value-rows').textContent = rowsEl.value;
      redraw();
    });
  }
  if (colsEl) {
    colsEl.addEventListener('input', () => {
      params.cols = parseInt(colsEl.value, 10);
      document.getElementById('value-cols').textContent = colsEl.value;
      redraw();
    });
  }
  if (densityEl) {
    densityEl.addEventListener('input', () => {
      params.density = parseInt(densityEl.value, 10) / 100;
      document.getElementById('value-density').textContent = densityEl.value + '%';
      redraw();
    });
  }
  if (marginEl) {
    marginEl.addEventListener('input', () => {
      params.marginPct = parseInt(marginEl.value, 10) / 100;
      document.getElementById('value-margin').textContent = marginEl.value + '%';
      redraw();
    });
  }
  if (strokeEl) {
    strokeEl.addEventListener('input', () => {
      params.strokeWeight = parseInt(strokeEl.value, 10);
      document.getElementById('value-stroke').textContent = strokeEl.value;
      redraw();
    });
  }
  if (seedEl) {
    seedEl.addEventListener('input', () => {
      params.seed = parseInt(seedEl.value, 10) || 0;
      redraw();
    });
  }
  if (bgEl) {
    bgEl.addEventListener('input', () => {
      params.bg = bgEl.value;
      redraw();
    });
  }
  colorEls.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        params.colors[i] = el.value;
        redraw();
      });
    }
  });
}

function draw() {
  rows = params.rows;
  cols = params.cols;
  margin = width * params.marginPct;
  radius = (width - 2 * margin) / cols / 2;

  randomSeed(int(params.seed));

  background(params.bg);
  if (params.strokeWeight > 0) {
    strokeWeight(params.strokeWeight);
  } else {
    noStroke();
  }

  const palette = params.colors.map(hex => color(hex));

  for (let c of palette) {
    fill(c);
    stroke(c);
    raster = create_raster();
    draw_raster(raster);
  }
}

function draw_raster(raster) {
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let x = margin + radius + col * 2 * radius;
      let y = margin + radius + row * 2 * radius;

      if (raster[row][col] == 1) {
        circle(x, y, 2 * radius);

        if (col + 1 < cols) {
          if (raster[row][col + 1] == 1) {
            rect(x + radius, y, radius);
          }
        }

        if (row + 1 < rows) {
          if (raster[row + 1][col] == 1) {
            rect(x, y + radius, radius);
          }
        }

        if ((row + 1 < rows) && (col + 1 < cols)) {
          if (raster[row + 1][col + 1] == 1) {
            push();
            translate(x, y);
            beginShape();
            vertex(0, radius);
            for (let angle = -90; angle <= 0; angle += 1) {
              vertex(radius * cos(angle), radius * (2 + sin(angle)));
            }
            vertex(radius, 2 * radius);
            vertex(2 * radius, radius);
            for (let angle = 90; angle <= 180; angle += 1) {
              vertex(radius * (2 + cos(angle)), radius * (0 + sin(angle)));
            }
            vertex(radius, 0);
            endShape();
            pop();
          }
        }
        if ((row + 1 < rows) && (col - 1 >= 0)) {
          if (raster[row + 1][col - 1] == 1) {
            push();
            translate(x, y);
            beginShape();
            vertex(-radius, 0);
            for (let angle = 0; angle <= 90; angle += 1) {
              vertex(radius * (-2 + cos(angle)), radius * (0 + sin(angle)));
            }
            vertex(-2 * radius, radius);
            vertex(-radius, 2 * radius);
            for (let angle = 180; angle <= 270; angle += 1) {
              vertex(radius * (0 + cos(angle)), radius * (2 + sin(angle)));
            }
            vertex(0, radius);
            endShape();
            pop();
          }
        }
      }
    }
  }
}

function create_raster() {
  var raster = new Array(rows);
  for (var i = 0; i < raster.length; i++) {
    raster[i] = new Array(cols);
  }

  for (let row = 0; row < raster.length; row++) {
    for (let col = 0; col < raster[row].length; col++) {
      raster[row][col] = 0;
    }
  }

  const numFilled = max(1, floor(rows * cols * params.density));
  for (let i = 0; i < numFilled; i++) {
    let r = Math.floor(fxrand() * rows);
    let c = Math.floor(fxrand() * cols);
    raster[r][c] = 1;
  }

  return raster;
}
