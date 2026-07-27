import {
  handleEngineRequest,
  runBookDeepening,
  type EngineLogMessage,
  type EngineProgressMessage,
  type EngineRequest,
  type EngineResponse,
} from "./engineProtocol.ts";
import { logger } from "../utils/logger.ts";

interface WorkerScope {
  onmessage: ((event: MessageEvent<EngineRequest>) => void) | null;
  postMessage(message: EngineResponse | EngineProgressMessage | EngineLogMessage): void;
}

const scope = self as unknown as WorkerScope;

// Search runs here; forward every log to the main thread so console order
// matches arrival order across parallel workers (main prints via logger.write).
logger.setDebug(__DEBUG__);
logger.setSink((level, args) => {
  scope.postMessage({ type: "log", level, args: [...args] });
});

scope.onmessage = (event: MessageEvent<EngineRequest>): void => {
  const request = event.data;
  if (request.bookDeepening) {
    void runBookDeepening(request).then(response => scope.postMessage(response));
    return;
  }
  const response = handleEngineRequest(request, progressEvent => {
    scope.postMessage({
      id: request.id,
      type: "progress",
      event: progressEvent,
    });
  });
  scope.postMessage(response);
};
