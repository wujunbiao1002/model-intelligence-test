export type Effort = 'default' | 'low' | 'medium' | 'high' | 'xhigh';
export type ArtifactType = 'svg' | 'html';

export interface Artifact {
  type: ArtifactType;
  content: string;
}

export interface StatusRun {
  id: string;
  round: number;
  status: 'ok' | 'failed';
  model: string;
  effort: Effort;
  startedAt: string;
  durationMs: number;
  type?: ArtifactType;
  file?: string;
  chars?: number;
  error?: string;
  usage?: { prompt?: number; completion?: number };
}

export interface StatusGroup {
  id: string;
  name: string;
  model: string;
  effort: Effort;
  state: 'idle' | 'running' | 'ok' | 'failed';
  round: number;
  updatedAt: string | null;
  runs: StatusRun[];
}

export interface StatusData {
  version: number;
  title: string;
  notice: string;
  prompt: string;
  intervalMinutes: number;
  historySize: number;
  updatedAt: string;
  nextUpdateAt: string;
  groups: StatusGroup[];
}

export interface Sub2ApiUser {
  id: number;
  username?: string;
  email?: string;
}

export interface Sub2ApiKeyOption {
  id: number;
  name: string;
  maskedKey: string;
  groupName?: string;
}

export interface Sub2ApiModelOption {
  id: string;
  owned_by?: string;
}

export interface WorkRecord {
  id: string;
  userId: number;
  model: string;
  groupName?: string;
  keyName: string;
  effort: Effort;
  prompt: string;
  type: ArtifactType;
  content: string;
  durationMs: number;
  createdAt: number;
}
