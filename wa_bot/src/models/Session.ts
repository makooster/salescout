import { Schema, model, Document } from "mongoose";
import { Client } from "whatsapp-web.js";

interface ISession extends Document {
  sessionId: string;
  status: "pending" | "authenticated" | "ready";
  phoneNumber?: string;
  qrCode?: string;
  lastActive: Date;
}

const sessionSchema = new Schema<ISession>({
    sessionId: { type: String, required: true, unique: true },
    status: { type: String, required: true, enum: ["pending", "authenticated", "ready"] },
    phoneNumber: String,
    qrCode: String,
    clientId: { type: String, required: true },
    lastActive: { type: Date, default: Date.now }
  }, {
    timestamps: true
  });
  
  export const Session = model<ISession>("Session", sessionSchema);