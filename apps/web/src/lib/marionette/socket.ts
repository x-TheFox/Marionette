'use client';

/**
 * Shared socket.io connection to the marionette-engine realtime service.
 * The gateway requires the port as an XTransformPort query param on a
 * relative path — never an absolute URL or a port in the path.
 */
import { io, type Socket } from 'socket.io-client';

const REALTIME_PORT = 3031;
let socket: Socket | null = null;

export function getRealtimeSocket(): Socket {
  if (!socket) {
    socket = io('/?XTransformPort=3031', {
      transports: ['websocket', 'polling'],
      forceNew: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 10000,
    });
    socket.on('connect_error', (err) => {
      console.warn('[marionette] realtime connect error:', err.message);
    });
  }
  return socket;
}
