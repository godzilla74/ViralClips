import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import { medianRect, type Rect } from './layout';

let detector: Promise<FaceDetector> | null = null;

function getDetector() {
  detector ??= FilesetResolver.forVisionTasks('/mediapipe').then((fileset) =>
    FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/models/blaze_face_short_range.tflite', delegate: 'CPU' },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.5,
    }));
  detector.catch(() => { detector = null; }); // allow a retry after a failed load
  return detector;
}

const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Could not load a video frame'));
  img.src = url;
});

/** Runs the face detector (in the browser, WASM) over frames; returns the median face box and how many frames had one. */
export async function detectFace(urls: string[], onProgress?: (done: number) => void): Promise<{ face: Rect | null; hits: number; total: number }> {
  const det = await getDetector();
  const boxes: Rect[] = [];
  let done = 0;
  for (const url of urls) {
    try {
      const img = await load(url);
      const faces = det.detect(img).detections
        .map((d) => d.boundingBox).filter((b): b is NonNullable<typeof b> => !!b)
        .sort((a, b) => b.width * b.height - a.width * a.height); // the biggest face is the speaker
      const b = faces[0];
      if (b) boxes.push({ x: b.originX / img.naturalWidth, y: b.originY / img.naturalHeight, w: b.width / img.naturalWidth, h: b.height / img.naturalHeight });
    } catch { /* skip an unreadable frame */ }
    onProgress?.(++done);
  }
  return { face: medianRect(boxes), hits: boxes.length, total: urls.length };
}
