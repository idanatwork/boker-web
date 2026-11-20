// טעינה עצלה של MediaPipe Pose Landmarker (נטען מ-CDN ונשמר במטמון על ידי ה-service worker).
const VER = '0.10.14';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
let promise = null;

export function loadPose() {
  return (promise ||= (async () => {
    const mod = await import(`${BASE}/vision_bundle.mjs`);
    const fileset = await mod.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    const make = (delegate) => mod.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numPoses: 1,
    });
    try { return await make('GPU'); } catch { return await make('CPU'); }
  })().catch((e) => { promise = null; throw e; }));
}
