import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('node_modules/@mediapipe/tasks-vision');
const files = {
  '/vision_bundle.mjs': ['vision_bundle.mjs', 'text/javascript'],
  '/wasm/vision_wasm_internal.js': ['wasm/vision_wasm_internal.js', 'text/javascript'],
  '/wasm/vision_wasm_internal.wasm': ['wasm/vision_wasm_internal.wasm', 'application/wasm'],
  '/wasm/vision_wasm_nosimd_internal.js': ['wasm/vision_wasm_nosimd_internal.js', 'text/javascript'],
  '/wasm/vision_wasm_nosimd_internal.wasm': ['wasm/vision_wasm_nosimd_internal.wasm', 'application/wasm'],
};
const server = createServer(async (request, response) => {
  const entry = files[request.url];
  if (!entry) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', entry[1]);
  response.end(await readFile(resolve(root, entry[0])));
});
await new Promise(resolveReady => server.listen(3219, '127.0.0.1', resolveReady));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:3219/vision_bundle.mjs').catch(() => {});
  const result = await page.evaluate(async () => {
    const { FilesetResolver, PoseLandmarker } = await import('/vision_bundle.mjs');
    const initStarted = performance.now();
    const fileset = await FilesetResolver.forVisionTasks('/wasm');
    const detector = await PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', delegate: 'CPU' }, runningMode: 'VIDEO', numPoses: 1 });
    const initMs = performance.now() - initStarted;
    const canvas = new OffscreenCanvas(256, 144);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#777'; ctx.fillRect(0, 0, 256, 144);
    const samples = [];
    for (let i = 0; i < 10; i += 1) { const start = performance.now(); detector.detectForVideo(canvas, 1000 + i * 2000); samples.push(performance.now() - start); }
    detector.close();
    return { initMs, firstInferenceMs: samples[0], warmMeanMs: samples.slice(1).reduce((a, b) => a + b, 0) / 9, maxMs: Math.max(...samples), detections: 0 };
  });
  console.log(JSON.stringify(result));
} finally {
  await browser.close(); server.close();
}
