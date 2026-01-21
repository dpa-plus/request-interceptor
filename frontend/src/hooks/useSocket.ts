import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

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

interface UseSocketOptions {
  onRequestStart?: (event: RequestStartEvent) => void;
  onRequestComplete?: (event: RequestCompleteEvent) => void;
  onOpenRouterEnriched?: (event: OpenRouterEnrichedEvent) => void;
}

export function useSocket(options: UseSocketOptions = {}) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const optionsRef = useRef(options);

  // Keep options ref up to date
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    // Connect to the admin server (same origin in production)
    const socket = io({
      path: '/socket.io',
      // In development, connect to the admin server port
      // In production, same origin
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Socket.IO connected');
      setConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('Socket.IO disconnected');
      setConnected(false);
    });

    socket.on('request:start', (event: RequestStartEvent) => {
      optionsRef.current.onRequestStart?.(event);
    });

    socket.on('request:complete', (event: RequestCompleteEvent) => {
      optionsRef.current.onRequestComplete?.(event);
    });

    socket.on('openrouter:enriched', (event: OpenRouterEnrichedEvent) => {
      optionsRef.current.onOpenRouterEnriched?.(event);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return { connected, socket: socketRef.current };
}
