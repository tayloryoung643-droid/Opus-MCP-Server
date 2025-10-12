import { MinimalPrepV1 } from '../contracts/index.js';

type Sections = {
  snapshot: string;
  lastContact: string[];
  priorities: string[];
  risks: { risk: string; counter: string }[];
  questions: string[];
  agenda: string[];
  notes?: string;
};

type FullPrep = { 
  id: string; 
  userId: string; 
  eventId: string; 
  sections: Sections; 
  createdAt: number;
};

type Prep = FullPrep | MinimalPrepV1;

const db = new Map<string, Prep>();

export function savePrep(p: Omit<FullPrep, "id" | "createdAt">): FullPrep {
  const id = `${p.userId}_${p.eventId}_${Date.now()}`;
  const prep: FullPrep = { id, createdAt: Date.now(), ...p };
  db.set(id, prep);
  return prep;
}

export function saveMinimalPrep(p: Omit<MinimalPrepV1, "id" | "createdAt">): MinimalPrepV1 {
  const id = `${p.userId}_${p.eventId}_${Date.now()}`;
  const prep: MinimalPrepV1 = { id, createdAt: Date.now(), ...p };
  db.set(id, prep);
  return prep;
}

export function getPrep(id: string) { 
  return db.get(id) || null; 
}

export function listPreps(userId: string) { 
  return [...db.values()]
    .filter(p => p.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt); 
}
