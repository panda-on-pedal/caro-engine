import {
  handleEngineRequest,
  runBookDeepening,
  type EngineProgressMessage,
  type EngineRequest,
  type EngineResponse,
} from "./engineProtocol.ts";

interface WorkerScope {
  onmessage: ((event: MessageEvent<EngineRequest>) => void) | null;
  postMessage(message: EngineResponse | EngineProgressMessage): void;
}

const scope = self as unknown as WorkerScope;

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
