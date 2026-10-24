// lib/pipeline/lutGl.js
// ─────────────────────────────────────────────────────────────
// The look at frame rate: one WebGL pass that takes the composed picture
// (a canvas or video), applies the per-camera colour match for the layer
// each pixel belongs to, then the 3D LUT (trilinear, the LUT packed as a
// 2D texture of `size` tiles), mixed by `strength`. Runs where the
// compositor runs: the browser preview and the egress's headless Chrome.
// Nothing here touches a phone. The CPU reference is lut.js applyLut;
// tests/lut.test.mjs checks the shader text and the packing against it.
//
// Usage:
//   const pass = createLutPass(glCanvas);        // a canvas the pass owns
//   pass.setLook(lookPlan({...}));                // uploads the LUT when it changes
//   pass.apply(composedCanvas, layout);           // draws the graded frame on glCanvas
//   ctx2d.drawImage(pass.canvas, 0, 0);           // back onto the frame before the logo
//
// PRD rows 15, 16, 139. S&I: Real-time media.
// ─────────────────────────────────────────────────────────────

export const VERTEX_SHADER = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/** The fragment shader: colour match by layer rect (up to 2), then the 3D LUT. */
export const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_frame;
uniform sampler2D u_lut;
uniform float u_size;        // LUT size N (tiles of N x N laid along x, N of them)
uniform float u_strength;    // 0 = untouched, 1 = the look in full
uniform int u_hasLut;
uniform vec4 u_rect0;        // x, y, w, h in 0..1 of the frame; layer 0
uniform vec4 u_rect1;        // layer 1 (w = 0 when absent)
uniform vec3 u_gain0;        // colour match for layer 0 (r, g, b multipliers)
uniform vec3 u_gain1;
uniform vec3 u_gainDefault;  // outside any rect

bool inRect(vec4 r, vec2 p) { return r.z > 0.0 && p.x >= r.x && p.x < r.x + r.z && p.y >= r.y && p.y < r.y + r.w; }

vec3 lutSample(vec3 c) {
  float n = u_size;
  float blue = c.b * (n - 1.0);
  float b0 = floor(blue);
  float b1 = min(b0 + 1.0, n - 1.0);
  float fb = blue - b0;
  // inside a tile: half-texel inset so the sampler's bilinear does the red/green interpolation
  vec2 inner = (c.rg * (n - 1.0) + 0.5) / n;
  vec2 uv0 = vec2((b0 + inner.x) / n, inner.y);
  vec2 uv1 = vec2((b1 + inner.x) / n, inner.y);
  vec3 s0 = texture2D(u_lut, uv0).rgb;
  vec3 s1 = texture2D(u_lut, uv1).rgb;
  return mix(s0, s1, fb);
}

void main() {
  vec4 px = texture2D(u_frame, v_uv);
  vec3 gain = u_gainDefault;
  if (inRect(u_rect0, v_uv)) gain = u_gain0;
  else if (inRect(u_rect1, v_uv)) gain = u_gain1;
  vec3 c = clamp(px.rgb * gain, 0.0, 1.0);
  if (u_hasLut == 1 && u_strength > 0.0) {
    vec3 graded = lutSample(c);
    c = mix(c, graded, u_strength);
  }
  gl_FragColor = vec4(c, px.a);
}`;

/**
 * Pack a LUT as RGBA8 bytes for a 2D texture of (size*size) x size: tile k
 * (blue index) sits at x = k*size, red along x inside the tile, green
 * along y. Pure data, so the test can check it against sampleLut.
 */
export function packLutTexture(lut) {
  const n = lut.size; const t = lut.table;
  const w = n * n; const h = n;
  const out = new Uint8Array(w * h * 4);
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const src = ((k * n + j) * n + i) * 3;
    const dst = (j * w + (k * n + i)) * 4;
    out[dst] = Math.round(t[src] * 255); out[dst + 1] = Math.round(t[src + 1] * 255); out[dst + 2] = Math.round(t[src + 2] * 255); out[dst + 3] = 255;
  }
  return { width: w, height: h, data: out };
}

/** Rects as 0..1 fractions of the frame, for the uniforms: at most two layers carry a colour match. */
export function rectUniforms(layout, colourMatch = {}) {
  const w = layout?.w || 1; const h = layout?.h || 1;
  const layers = (layout?.layers || []).filter((l) => colourMatch[l.slot]).slice(0, 2);
  const rect = (l) => (l ? [l.rect.x / w, l.rect.y / h, l.rect.w / w, l.rect.h / h] : [0, 0, 0, 0]);
  const gain = (l) => (l ? colourMatch[l.slot] : [1, 1, 1]);
  return { rect0: rect(layers[0]), rect1: rect(layers[1]), gain0: gain(layers[0]), gain1: gain(layers[1]) };
}

function compile(gl, type, src) {
  const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`LUT shader: ${gl.getShaderInfoLog(sh)}`);
  return sh;
}

/**
 * Create the pass on a canvas (the pass sizes it to each frame). Returns
 * null when WebGL is unavailable, so the caller falls back to the CPU path.
 */
export function createLutPass(canvas) {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true }) || canvas.getContext('experimental-webgl');
  if (!gl) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`LUT program: ${gl.getProgramInfoLog(prog)}`);
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos'); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const u = (name) => gl.getUniformLocation(prog, name);
  const loc = { frame: u('u_frame'), lut: u('u_lut'), size: u('u_size'), strength: u('u_strength'), hasLut: u('u_hasLut'), rect0: u('u_rect0'), rect1: u('u_rect1'), gain0: u('u_gain0'), gain1: u('u_gain1'), gainDefault: u('u_gainDefault') };
  const makeTex = (unit, { linear }) => {
    const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    return tex;
  };
  const frameTex = makeTex(0, { linear: true });
  const lutTex = makeTex(1, { linear: true });
  gl.uniform1i(loc.frame, 0); gl.uniform1i(loc.lut, 1);
  let look = null; let lutKey = null;

  return {
    canvas, gl,
    /** A lookPlan() result; the LUT texture is re-uploaded only when its id changes. */
    setLook(plan) {
      look = plan;
      const key = plan?.lutId ?? null;
      if (key !== lutKey) {
        lutKey = key;
        if (plan?.lut) {
          const packed = packLutTexture(plan.lut);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lutTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, packed.width, packed.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, packed.data);
          gl.uniform1f(loc.size, plan.lut.size);
        }
      }
      gl.uniform1i(loc.hasLut, plan?.lut ? 1 : 0);
      gl.uniform1f(loc.strength, plan?.strength ?? 0);
    },
    /** Grade `source` (canvas/video/image) into this pass's canvas, using the layout's rects for the per-camera match. */
    apply(source, layout) {
      const w = source.videoWidth || source.width; const h = source.videoHeight || source.height;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      const r = rectUniforms(layout, look?.colourMatch || {});
      gl.uniform4fv(loc.rect0, r.rect0); gl.uniform4fv(loc.rect1, r.rect1);
      gl.uniform3fv(loc.gain0, r.gain0); gl.uniform3fv(loc.gain1, r.gain1); gl.uniform3fv(loc.gainDefault, [1, 1, 1]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, frameTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return canvas;
    },
    /** Is there anything to draw? (no look and no colour match → the caller skips the pass) */
    active() { return Boolean(look && (look.lut || Object.keys(look.colourMatch || {}).length)); },
  };
}
