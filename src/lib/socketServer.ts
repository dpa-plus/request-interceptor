import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

let io: SocketIOServer | null = null;

export interface RequestStartEvent {
  id: string;
  method: string;
  url: string;
  path: string;
  targetUrl: string;
  routeSource: string;
  isAiRequest: boolean;
  createdAt: string;
}

export interface RequestCompleteEvent {
  id: string;
  statusCode: number | null;
  responseTime: number | null;
  responseSize: number | null;
  error: string | null;
  // AI-specific fields (if applicable)
  aiRequestId?: string | null;
  model?: string | null;
  totalTokens?: number | null;
  totalCostMicros?: number | null;
}

export interface OpenRouterEnrichedEvent {
  aiRequestId: string;
  openrouterProviderName: string | null;
  openrouterTotalCost: number | null;
  openrouterCacheDiscount: number | null;
}

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*', // In production, restrict this
      methods: ['GET', 'POST'],
    },
    path: '/socket.io',
  });

  io.on('connection', (socket) => {
    console.log(`Socket.IO client connected: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`Socket.IO client disconnected: ${socket.id}`);
    });
  });

  console.log('Socket.IO server initialized');
  return io;
}

export function getIO(): SocketIOServer | null {
  return io;
}

export function emitRequestStart(event: RequestStartEvent): void {
  if (io) {
    io.emit('request:start', event);
  }
}

export function emitRequestComplete(event: RequestCompleteEvent): void {
  if (io) {
    io.emit('request:complete', event);
  }
}

export function emitOpenRouterEnriched(event: OpenRouterEnrichedEvent): void {
  if (io) {
    io.emit('openrouter:enriched', event);
  }
}
