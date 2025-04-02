import { whatsappService } from '../services/whatsappInstance';
import { Request, Response } from 'express';
import { Session } from "../models/Session";

export const getAuthorizedUsers = async (req: Request, res: Response) => {
  try {
    const activeSessions = whatsappService.getActiveSessions();
    res.json(activeSessions.map(session => ({
      id: session.id,
      number: session.phoneNumber || 'Unknown',
      status: session.status,
      lastActive: session.lastActive
    })));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
};


export const logoutUser = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;
    
    await Session.deleteOne({ sessionId });
  
    whatsappService.cleanupSession(sessionId);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' });
  }
};