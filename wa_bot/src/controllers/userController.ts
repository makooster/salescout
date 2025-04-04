import { validateSessionIds } from '../services/sessionValidation';
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
    
    // Cleanup in WhatsAppService
    whatsappService.cleanupSession(sessionId);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' });
  }
};

export const getAllSessions = async (req: Request, res: Response) => {
  try {
    const sessions = await Session.find().sort({ lastActive: -1 });
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
};

export const getSessionById = async (req: Request, res: Response) => {
  try {
    const session = await Session.findOne({ sessionId: req.params.id });
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch session' });
  }
};

export const deleteSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    
    await Session.deleteOne({ sessionId });
    
    whatsappService.cleanupSession(sessionId);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete session' });
  }
};


export const validateSessions = async (req: Request, res: Response) => {
  try {
    const { sessionIds } = req.body;
    const validSessions = await validateSessionIds(sessionIds);
    res.json({ validSessions });
  } catch (error) {
    res.status(500).json({ error: 'Validation failed' });
  }
};