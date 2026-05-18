'use client';

import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { getServerOrigin } from '@/lib/api';

export interface AccessibilityJobDonePayload {
  jobId: string;
  jobType: 'stt' | 'tts';
  lessonId: number;
  status: 'completed' | 'failed';
  url?: string;
  error?: string;
}

type Handler = (payload: AccessibilityJobDonePayload) => void;

/**
 * Connects a teacher to the backend Socket.io server and subscribes to
 * accessibility:job_done events. Automatically disconnects on unmount.
 *
 * @param userId  The logged-in teacher's user ID (join room "teacher:<userId>")
 * @param onJobDone  Called whenever a job finishes (success or failure)
 */
export function useAccessibilitySocket(userId: number | undefined, onJobDone: Handler) {
  const socketRef = useRef<Socket | null>(null);
  const handlerRef = useRef<Handler>(onJobDone);
  handlerRef.current = onJobDone; // always latest without re-connecting

  const connect = useCallback(() => {
    if (!userId) return;
    if (socketRef.current?.connected) return;

    const socket = io(getServerOrigin(), {
      path: '/socket.io',
      auth: { userId },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socket.on('accessibility:job_done', (payload: AccessibilityJobDonePayload) => {
      handlerRef.current(payload);
    });

    socketRef.current = socket;
  }, [userId]);

  useEffect(() => {
    connect();
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [connect]);
}
