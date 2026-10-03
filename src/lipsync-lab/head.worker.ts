import { vocalVisemes } from "../audio/vocals/visemes";
import { vocalEnvelope } from "../audio/vocals/envelope";

const scope = self as unknown as { onmessage: (event: MessageEvent) => void; postMessage: (data: unknown, transfers?: Transferable[]) => void };
scope.onmessage = async ({ data }) => {
  try {
    const started = performance.now();
    const visemes = await vocalVisemes(data.left, data.right);
    const headElapsedMs = performance.now() - started;
    const frames = vocalEnvelope(data.left, data.right, data.left, data.right);
    scope.postMessage({ type: "result", visemes, frames, headElapsedMs }, [visemes.buffer, frames.buffer]);
  } catch (error) {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
