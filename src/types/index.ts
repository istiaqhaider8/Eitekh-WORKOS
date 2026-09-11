export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  company: string | null;
  timezone: string;
  language: string;
  isSuperAdmin: boolean;
  isSupportAdmin: boolean;
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_VERIFY';
  mfaEnabled: boolean;
  mfaSecret?: string | null;
  recoveryCodes?: string | null;
  emailVerifiedAt: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  
  orgMemberships?: OrganizationMember[];
  workspaceMemberships?: WorkspaceMember[];
  teamMemberships?: TeamMember[];
  projectMemberships?: ProjectMember[];
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  userAgent: string | null;
  ipAddress: string | null;
  os: string | null;
  browser: string | null;
  location: string | null;
  lastActiveAt: string | Date;
  expiresAt: string | Date;
  createdAt: string | Date;
  user?: User;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  domain: string | null;
  timezone: string;
  language: string;
  dateFormat: string;
  workingDays: string;
  workingHours: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  createdAt: string | Date;
  updatedAt: string | Date;
  
  members?: OrganizationMember[];
  workspaces?: Workspace[];
}

export interface OrganizationMember {
  id: string;
  orgId: string;
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';
  createdAt: string | Date;
  
  organization?: Organization;
  user?: User;
}

export interface Workspace {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description: string | null;
  isArchived: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
  
  organization?: Organization;
  members?: WorkspaceMember[];
  teams?: Team[];
  projects?: Project[];
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: 'WORKSPACE_ADMIN' | 'MEMBER' | 'VIEWER';
  createdAt: string | Date;
  
  workspace?: Workspace;
  user?: User;
}

export interface Team {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  leadId: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  
  workspace?: Workspace;
  members?: TeamMember[];
  projects?: Project[];
  sprints?: Sprint[];
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: 'LEAD' | 'MEMBER';
  createdAt: string | Date;
  
  team?: Team;
  user?: User;
}

export interface Project {
  id: string;
  workspaceId: string;
  teamId: string | null;
  name: string;
  key: string;
  description: string | null;
  ownerId: string;
  template: 'SCRUM' | 'KANBAN' | 'BUG_TRACKING' | 'GENERAL';
  status: 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';
  priority: string;
  issueCounter: number;
  startDate: string | Date | null;
  targetDate: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  
  workspace?: Workspace;
  team?: Team | null;
  members?: ProjectMember[];
  components?: Component[];
  epics?: Epic[];
  sprints?: Sprint[];
  workflows?: Workflow[];
  issues?: Issue[];
  labels?: Label[];
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: 'PROJECT_ADMIN' | 'PROJECT_MANAGER' | 'MEMBER' | 'VIEWER';
  createdAt: string | Date;
  
  project?: Project;
  user?: User;
}

export interface Component {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  createdAt: string | Date;
  
  project?: Project;
  issues?: Issue[];
}

export interface Epic {
  id: string;
  projectId: string;
  name: string;
  summary: string | null;
  color: string;
  ownerId: string | null;
  status: 'PLANNING' | 'ACTIVE' | 'DONE';
  startDate: string | Date | null;
  targetDate: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  
  project?: Project;
  issues?: Issue[];
}

export interface Sprint {
  id: string;
  projectId: string;
  teamId: string | null;
  name: string;
  goal: string | null;
  startDate: string | Date | null;
  endDate: string | Date | null;
  status: 'FUTURE' | 'ACTIVE' | 'COMPLETED';
  createdAt: string | Date;
  updatedAt: string | Date;
  
  project?: Project;
  team?: Team | null;
  issues?: Issue[];
}

export interface Workflow {
  id: string;
  projectId: string;
  name: string;
  isDefault: boolean;
  createdAt: string | Date;
  
  project?: Project;
  statuses?: WorkflowStatus[];
}

export interface WorkflowStatus {
  id: string;
  workflowId: string;
  name: string;
  category: string;
  color: string;
  position: number;
  wipLimit: number | null;
  
  workflow?: Workflow;
  issues?: Issue[];
}

export interface Issue {
  id: string;
  projectId: string;
  keyNumber: number;
  issueKey: string;
  title: string;
  description: string | null;
  issueType: 'TASK' | 'BUG' | 'STORY' | 'EPIC' | 'SUBTASK' | 'FEATURE' | 'INCIDENT';
  statusId: string;
  priority: 'CRITICAL' | 'HIGHEST' | 'HIGH' | 'MEDIUM' | 'LOW' | 'LOWEST';
  reporterId: string;
  assigneeId: string | null;
  epicId: string | null;
  sprintId: string | null;
  parentIssueId: string | null;
  componentId: string | null;
  estimatePoints: number | null;
  estimateHours: number | null;
  remainingHours: number | null;
  timeSpentHours: number;
  startDate: string | Date | null;
  dueDate: string | Date | null;
  securityLevel: string;
  position: number;
  createdAt: string | Date;
  updatedAt: string | Date;
  
  project?: Project;
  status?: WorkflowStatus;
  reporter?: User;
  assignee?: User | null;
  epic?: Epic | null;
  sprint?: Sprint | null;
  component?: Component | null;
  parentIssue?: Issue | null;
  subIssues?: Issue[];
  subtasks?: Subtask[];
  comments?: Comment[];
  attachments?: Attachment[];
  timeEntries?: TimeEntry[];
  watchers?: Watcher[];
  labels?: IssueLabel[];
  activityLogs?: ActivityLog[];
  customFieldValues?: CustomFieldValue[];
  outgoingDeps?: IssueDependency[];
  incomingDeps?: IssueDependency[];
  
  _count?: {
    comments: number;
    attachments: number;
    subtasks: number;
  };
}

export interface Subtask {
  id: string;
  parentIssueId: string;
  title: string;
  assigneeId: string | null;
  status: 'TO_DO' | 'IN_PROGRESS' | 'DONE';
  priority: string;
  estimateHours: number | null;
  dueDate: string | Date | null;
  isCompleted: boolean;
  createdAt: string | Date;
  
  parentIssue?: Issue;
  assignee?: User | null;
}

export interface IssueDependency {
  id: string;
  sourceIssueId: string;
  targetIssueId: string;
  type: 'BLOCKS' | 'BLOCKED_BY' | 'RELATES_TO' | 'DUPLICATES' | 'FINISH_TO_START' | 'START_TO_START';
  createdAt: string | Date;
  
  sourceIssue?: Issue;
  targetIssue?: Issue;
}

export interface Comment {
  id: string;
  issueId: string;
  userId: string;
  content: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  
  issue?: Issue;
  user?: User;
}

export interface Attachment {
  id: string;
  issueId: string;
  uploaderId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileUrl: string;
  createdAt: string | Date;
  
  issue?: Issue;
  uploader?: User;
}

export interface Watcher {
  id: string;
  issueId: string;
  userId: string;
  createdAt: string | Date;
  
  issue?: Issue;
  user?: User;
}

export interface Label {
  id: string;
  projectId: string;
  name: string;
  color: string;
  createdAt: string | Date;
  
  project?: Project;
  issues?: IssueLabel[];
}

export interface IssueLabel {
  id: string;
  issueId: string;
  labelId: string;
  
  issue?: Issue;
  label?: Label;
}

export interface ActivityLog {
  id: string;
  issueId: string;
  actorId: string;
  actionType: string;
  fieldChanged: string | null;
  oldValue: string | null;
  newValue: string | null;
  timestamp: string | Date;
  
  issue?: Issue;
  actor?: User;
}

export interface TimeEntry {
  id: string;
  issueId: string;
  userId: string;
  durationMinutes: number;
  workDate: string | Date;
  description: string | null;
  createdAt: string | Date;
  
  issue?: Issue;
  user?: User;
}

export interface CustomField {
  id: string;
  scopeType: 'ORG' | 'WORKSPACE' | 'PROJECT';
  scopeId: string;
  name: string;
  fieldType: 'TEXT' | 'NUMBER' | 'DATE' | 'DROPDOWN' | 'MULTISELECT' | 'CHECKBOX' | 'USER' | 'URL';
  optionsJson: string | null;
  isRequired: boolean;
  createdAt: string | Date;
  
  values?: CustomFieldValue[];
}

export interface CustomFieldValue {
  id: string;
  customFieldId: string;
  issueId: string;
  valueString: string | null;
  valueNumber: number | null;
  valueDate: string | Date | null;
  valueJson: string | null;
  
  customField?: CustomField;
  issue?: Issue;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  linkUrl: string | null;
  type: string;
  isRead: boolean;
  createdAt: string | Date;
  
  user?: User;
}

export interface FeatureFlag {
  id: string;
  key: string;
  description: string | null;
  isGlobalEnabled: boolean;
  orgOverrides: string | null;
  createdAt: string | Date;
}

export interface SystemAnnouncement {
  id: string;
  title: string;
  message: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  targetAudience: 'ALL' | 'ORGS' | 'USERS';
  isActive: boolean;
  startsAt: string | Date;
  expiresAt: string | Date | null;
  createdAt: string | Date;
}

export interface PlatformAuditLog {
  id: string;
  actorId: string;
  action: string;
  targetResource: string;
  orgId: string | null;
  details: string | null;
  ipAddress: string | null;
  createdAt: string | Date;
}
