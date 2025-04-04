import { Session } from "../models/Session";

export const validateSessionIds = async (sessionIds: string[]) => {
  const validSessions = await Promise.all(
    sessionIds.map(async (id: string) => {
      const session = await Session.findOne({ sessionId: id, status: 'ready' });
      return session ? { 
        id: session.sessionId,
        name: session.phoneNumber || 'Unknown',
        number: session.phoneNumber || 'Unknown',
        status: session.status,
        sessionId: session.sessionId
      } : null;
    })
  );
  return validSessions.filter(Boolean);
};