import { handleEngineRequest, type EngineRequest } from './engineProtocol.ts';

interface WorkerScope {
  onmessage: ((event: MessageEvent<EngineRequest>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent<EngineRequest>): void => {
  scope.postMessage(handleEngineRequest(event.data));
};
