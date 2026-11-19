import fs from 'node:fs'; import crypto from 'node:crypto';
const [inputPath, outputPath = 'artifacts/camera-ranking-dataset.json'] = process.argv.slice(2);
if (!inputPath) { console.error('usage: npm run prepare:camera-dataset -- <events.jsonl> [output.json]'); process.exit(2); }
const events = fs.readFileSync(inputPath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)).sort((a, b) => +new Date(a.at || a.created_at) - +new Date(b.at || b.created_at));
const frames = events.filter(event => event.type === 'visual_camera_assessment' || event.event_type === 'visual_camera_assessment');
const humanCuts = events.filter(event => (event.type === 'shot_command' || event.event_type === 'shot_command') && (event.decisionSource || event.decision_source || event.detail?.decisionSource) === 'human');
const examples = [];
for (const cut of humanCuts) {
  const at = +new Date(cut.at || cut.created_at); const sessionId = cut.sessionId || cut.show_id || cut.showId; const chosen = cut.targetSourceKey || cut.detail?.targetSourceKey;
  const candidates = frames.filter(frame => (frame.sessionId || frame.show_id || frame.showId) === sessionId && at - +new Date(frame.at || frame.created_at) >= 0 && at - +new Date(frame.at || frame.created_at) <= 5000).map(frame => frame.feature || frame.detail || frame);
  const latest = [...new Map(candidates.map(item => [item.cameraId, item])).values()];
  if (chosen && latest.some(item => item.cameraId === chosen) && latest.length > 1) examples.push({ sessionId, performerId: cut.performerId || cut.artist_id || 'unknown', at, chosenCameraId: chosen, candidates: latest });
}
const groupSplit = example => Number.parseInt(crypto.createHash('sha256').update(`${example.performerId}:${example.sessionId}`).digest('hex').slice(0, 8), 16) % 10 < 8 ? 'train' : 'test';
const dataset = { schemaVersion: 'exp-vd-002.dataset.v1', createdAt: new Date().toISOString(), source: inputPath, examples: examples.map(example => ({ ...example, split: groupSplit(example) })) };
fs.mkdirSync(new URL('../artifacts/', import.meta.url), { recursive: true }); fs.writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);
const groups = new Set(examples.map(item => `${item.performerId}:${item.sessionId}`)); console.log(JSON.stringify({ examples: examples.length, groups: groups.size, suitable: examples.length >= 500 && groups.size >= 10 }, null, 2));
