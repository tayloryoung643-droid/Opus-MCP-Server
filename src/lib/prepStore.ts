type Sections = {
  snapshot: string;
  lastContact: string[];
  priorities: string[];
  risks: { risk: string; counter: string }[];
  questions: string[];
  agenda: string[];
  notes?: string;
};

type Prep = { 
  id: string; 
  userId: string; 
  eventId: string; 
  sections: Sections; 
  createdAt: number;
};

const db = new Map<string, Prep>();

export function savePrep(p: Omit<Prep, "id" | "createdAt">): Prep {
  const id = `${p.userId}_${p.eventId}_${Date.now()}`;
  const prep: Prep = { id, createdAt: Date.now(), ...p };
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
