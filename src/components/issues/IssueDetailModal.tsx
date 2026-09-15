"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  X,
  Clock,
  User,
  Calendar,
  Tag,
  CheckSquare,
  MessageSquare,
  Activity,
  Play,
  Square,
  Plus,
  Send,
  Trash2,
  Paperclip,
  GitBranch,
  Eye,
  EyeOff,
  Link2,
  ListFilter,
  Check,
  ArrowRight,
  History,
  Users,
  UploadCloud,
  File,
  FileText,
  Download,
  ExternalLink,
  Edit2,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Sparkles,
  AlertCircle,
  Zap,
} from "lucide-react";
import { showSuccess, showError } from "@/lib/toast";
import { isUserOnLeave, doesLeaveOverlap, formatLeaveRange } from "@/lib/leave-engine";
import { isDelegationActive } from "@/lib/delegation-engine";
import { isIssueDone } from "@/lib/designSystem";
import { sanitizeUrl } from "@/lib/sanitize";


interface IssueDetailModalProps {
  issueId: string | null;
  projectId?: string;
  currentUser?: any;
  initialStatusId?: string | null;
  onClose: () => void;
  onIssueUpdated: () => void;
}

export function IssueDetailModal({ issueId, projectId, currentUser: propCurrentUser, initialStatusId, onClose, onIssueUpdated }: IssueDetailModalProps) {
  const isCreateMode = issueId === "new" || issueId === "create";
  const [issue, setIssue] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "subtasks" | "attachments" | "comments" | "activity" | "time" | "deps" | "custom" | "delegation">("details");

  // Draft edit states for Issue properties
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftStatusId, setDraftStatusId] = useState("");
  const [draftPriority, setDraftPriority] = useState("MEDIUM");
  const [draftIssueType, setDraftIssueType] = useState("TASK");
  const [projectTypes, setProjectTypes] = useState<any[]>([
    { name: "Task", value: "TASK", color: "#0ea5e9", description: "Standard actionable work item" },
    { name: "Bug", value: "BUG", color: "#f43f5e", description: "Defect, error or problem in functionality" },
    { name: "Story", value: "STORY", color: "#10b981", description: "User requirement or scenario" },
    { name: "Epic", value: "EPIC", color: "#a855f7", description: "Large body of work encompassing multiple tasks" },
    { name: "Feature", value: "FEATURE", color: "#6366f1", description: "New functionality or capability" },
    { name: "Incident", value: "INCIDENT", color: "#ef4444", description: "Urgent outage or critical problem" },
    { name: "Improvement", value: "IMPROVEMENT", color: "#f59e0b", description: "Optimization or enhancement" },
  ]);
  const [showAddTypeModal, setShowAddTypeModal] = useState(false);
  const [typeModalTab, setTypeModalTab] = useState<"ADD" | "MANAGE">("ADD");
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeColor, setNewTypeColor] = useState("#6366f1");
  const [newTypeDescription, setNewTypeDescription] = useState("");
  const [editingType, setEditingType] = useState<any | null>(null);
  const [editTypeName, setEditTypeName] = useState("");
  const [editTypeColor, setEditTypeColor] = useState("#6366f1");
  const [editTypeDescription, setEditTypeDescription] = useState("");
  const [isSubmittingType, setIsSubmittingType] = useState(false);
  const [draftAssigneeId, setDraftAssigneeId] = useState<string | null>(null);
  const [draftTeamId, setDraftTeamId] = useState<string | null>(null);
  const [draftPoints, setDraftPoints] = useState<string | number>("");
  const [draftStartDate, setDraftStartDate] = useState("");
  const [draftDueDate, setDraftDueDate] = useState("");
  const [draftSprintId, setDraftSprintId] = useState<string | null>(null);
  const [projectSprints, setProjectSprints] = useState<any[]>([]);
  const [draftEpicId, setDraftEpicId] = useState<string | null>(null);
  const [projectEpics, setProjectEpics] = useState<any[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Subtask creation and details state
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskAssigneeId, setSubtaskAssigneeId] = useState("");
  const [subtaskPriority, setSubtaskPriority] = useState("MEDIUM");
  const [subtaskEstimateHours, setSubtaskEstimateHours] = useState("");
  const [subtaskDueDate, setSubtaskDueDate] = useState("");
  const [showSubtaskFormDetails, setShowSubtaskFormDetails] = useState(false);

  // Subtask inline editing state
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [editSubtaskTitle, setEditSubtaskTitle] = useState("");
  const [editSubtaskAssigneeId, setEditSubtaskAssigneeId] = useState("");
  const [editSubtaskPriority, setEditSubtaskPriority] = useState("MEDIUM");
  const [editSubtaskEstimateHours, setEditSubtaskEstimateHours] = useState("");
  const [editSubtaskDueDate, setEditSubtaskDueDate] = useState("");
  const [editSubtaskStatus, setEditSubtaskStatus] = useState("TO_DO");

  // Attachments state
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Comment creation state
  const [commentContent, setCommentContent] = useState("");
  // Time entry state
  const [timeMinutes, setTimeMinutes] = useState("");
  const [timeNotes, setTimeNotes] = useState("");
  // Active Timer state
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);

  // Dependency creation state
  const [depTargetKey, setDepTargetKey] = useState("");
  const [depType, setDepType] = useState("BLOCKS");
  const [depError, setDepError] = useState("");

  // Custom fields state
  const [customFields, setCustomFields] = useState<any[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, any>>({});
  const [showCreateFieldModal, setShowCreateFieldModal] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<"TEXT" | "NUMBER" | "DATE" | "DROPDOWN" | "CHECKBOX" | "URL">("TEXT");
  const [newFieldOptions, setNewFieldOptions] = useState("");
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [creatingField, setCreatingField] = useState(false);

  // Project context state (members, statuses, current user, teams, leaves)
  const [projectMembers, setProjectMembers] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [projectStatuses, setProjectStatuses] = useState<any[]>([]);

  const assigneeLeaveDetails = React.useMemo(() => {
    if (!draftAssigneeId) return null;
    const userLeaves = leaves.filter((l) => l.userId === draftAssigneeId);
    if (userLeaves.length === 0) return null;

    const firstLeave = userLeaves[0];
    const formattedRange = formatLeaveRange(firstLeave.startDate, firstLeave.endDate);
    
    // Check if issue dates overlap
    const start = draftStartDate || draftDueDate || new Date().toISOString().split("T")[0];
    const end = draftDueDate || draftStartDate || start;
    const res = doesLeaveOverlap(userLeaves, start, end);

    // Extract delegate user info
    let delegateName = "";
    let delegateEmail = "";
    const delUser = (firstLeave as any).delegations?.[0]?.delegateUser || (firstLeave as any).delegateUser;
    if (delUser) {
      delegateName = delUser.firstName ? `${delUser.firstName} ${delUser.lastName || ""}`.trim() : (delUser.email || "");
      delegateEmail = delUser.email || "";
    }

    return {
      formattedRange,
      leaveType: firstLeave.leaveType || "Leave",
      note: firstLeave.note || null,
      hasOverlap: res.hasOverlap,
      delegateName,
      delegateEmail,
    };
  }, [draftAssigneeId, draftStartDate, draftDueDate, leaves]);

  const activeDelegation = React.useMemo(() => {
    if (!issue?.delegations || !Array.isArray(issue.delegations)) return null;
    return issue.delegations.find((d: any) => isDelegationActive(d) && d.status === "ACTIVE") || null;
  }, [issue?.delegations]);

  const [projectWorkflowId, setProjectWorkflowId] = useState<string | null>(null);
  const [projectPriorities, setProjectPriorities] = useState<any[]>([
    { name: "Critical", value: "CRITICAL", color: "#f43f5e" },
    { name: "Highest", value: "HIGHEST", color: "#f97316" },
    { name: "High", value: "HIGH", color: "#f59e0b" },
    { name: "Medium", value: "MEDIUM", color: "#3b82f6" },
    { name: "Low", value: "LOW", color: "#10b981" },
    { name: "Lowest", value: "LOWEST", color: "#64748b" },
  ]);
  const [teams, setTeams] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(propCurrentUser || null);

  useEffect(() => {
    if (propCurrentUser) {
      setCurrentUser(propCurrentUser);
    }
  }, [propCurrentUser]);

  // New Project Status Modal state
  const [showAddStatusModal, setShowAddStatusModal] = useState(false);
  const [newStatusName, setNewStatusName] = useState("");
  const [newStatusCategory, setNewStatusCategory] = useState("IN_PROGRESS");
  const [newStatusColor, setNewStatusColor] = useState("#3b82f6");
  const [isCreatingStatus, setIsCreatingStatus] = useState(false);

  // New Project Priority Modal state
  const [showAddPriorityModal, setShowAddPriorityModal] = useState(false);
  const [newPriorityName, setNewPriorityName] = useState("");
  const [newPriorityColor, setNewPriorityColor] = useState("#8b5cf6");
  const [isCreatingPriority, setIsCreatingPriority] = useState(false);

  // New Project Epic Modal state
  const [showAddEpicModal, setShowAddEpicModal] = useState(false);
  const [epicModalTab, setEpicModalTab] = useState<"CREATE" | "MANAGE">("CREATE");
  const [newEpicName, setNewEpicName] = useState("");
  const [newEpicSummary, setNewEpicSummary] = useState("");
  const [newEpicColor, setNewEpicColor] = useState("#8b5cf6");
  const [newEpicStatus, setNewEpicStatus] = useState("ACTIVE");
  const [newEpicTargetDate, setNewEpicTargetDate] = useState("");
  const [isCreatingEpic, setIsCreatingEpic] = useState(false);
  const [deletingEpicId, setDeletingEpicId] = useState<string | null>(null);

  // Activity filter state
  const [activityFilter, setActivityFilter] = useState<"ALL" | "CHANGES" | "COMMENTS">("ALL");

  // PBAC & Role Evaluation
  const currentUserMembership = projectMembers.find((m) => m.userId === currentUser?.id);
  const userProjectRole = currentUser?.isSuperAdmin
    ? "SUPER_ADMIN"
    : currentUserMembership?.role || "MEMBER";

  const isViewer = userProjectRole === "VIEWER";
  const canDelete =
    Boolean(currentUser?.isSuperAdmin) ||
    userProjectRole === "SUPER_ADMIN" ||
    userProjectRole === "PROJECT_ADMIN" ||
    userProjectRole === "ADMIN" ||
    userProjectRole === "OWNER" ||
    Boolean(currentUser?.capabilities?.includes("issues:delete"));
  const canEdit = !isViewer;

  const loadProjectContext = useCallback(async (pId: string) => {
    if (!pId) return;
    try {
      const [sRes, cfRes, mRes, aRes, wfRes, tRes, pRes, tmRes, epRes] = await Promise.all([
        fetch(`/api/sprints?projectId=${pId}`),
        fetch(`/api/custom-fields?projectId=${pId}`),
        fetch(`/api/projects/${pId}/members`),
        fetch(`/api/projects/${pId}/availability`),
        fetch(`/api/workflows?projectId=${pId}`),
        fetch(`/api/projects/${pId}/types`),
        fetch(`/api/projects/${pId}/priorities`),
        fetch(`/api/teams?projectId=${pId}`),
        fetch(`/api/epics?projectId=${pId}`),
      ]);

      if (sRes.ok) {
        const sData = await sRes.json();
        const sps = Array.isArray(sData.sprints) ? sData.sprints : Array.isArray(sData) ? sData : [];
        setProjectSprints(sps);
        if (sps.length > 0) {
          const activeS = sps.find((s: any) => s.status === "ACTIVE") || sps[0];
          setDraftSprintId((prev) => prev || activeS?.id || null);
        }
      }

      if (cfRes.ok) {
        const cfData = await cfRes.json();
        if (Array.isArray(cfData.customFields)) setCustomFields(cfData.customFields);
      }

      if (mRes.ok) {
        const mList = await mRes.json();
        if (Array.isArray(mList)) setProjectMembers(mList);
      }

      if (aRes.ok) {
        const aData = await aRes.json();
        if (Array.isArray(aData.leaves)) setLeaves(aData.leaves);
      }

      if (wfRes.ok) {
        const wfList = await wfRes.json();
        if (Array.isArray(wfList) && wfList.length > 0) {
          setProjectWorkflowId(wfList[0].id);
          const stList = wfList[0].statuses || [];
          setProjectStatuses(stList);
          if (stList.length > 0) {
            setDraftStatusId((prev) => prev || stList[0].id);
          }
        }
      }

      if (tRes.ok) {
        const tData = await tRes.json();
        if (Array.isArray(tData.types) && tData.types.length > 0) setProjectTypes(tData.types);
      }

      if (pRes.ok) {
        const pData = await pRes.json();
        if (Array.isArray(pData.priorities) && pData.priorities.length > 0) setProjectPriorities(pData.priorities);
      }

      if (tmRes.ok) {
        const tmData = await tmRes.json();
        if (Array.isArray(tmData.teams)) setTeams(tmData.teams);
        else if (Array.isArray(tmData)) setTeams(tmData);
      }

      if (epRes && epRes.ok) {
        const epData = await epRes.json();
        if (Array.isArray(epData)) setProjectEpics(epData);
      }
    } catch (e) {
      console.error("Error loading project context for issue creation", e);
    }
  }, []);

  useEffect(() => {
    if (isCreateMode) {
      const targetProjId = projectId || issue?.projectId || "";
      setIssue({
        id: "new",
        issueKey: "NEW TASK",
        title: "",
        description: "",
        projectId: targetProjId,
        customFieldValues: [],
      });
      setActiveTab("details");
      setDraftTitle("");
      setDraftDescription("");
      setDraftStatusId(initialStatusId || "");
      setDraftPriority("MEDIUM");
      setDraftIssueType("TASK");
      setDraftAssigneeId(null);
      setDraftTeamId(null);
      setDraftSprintId(null);
      setDraftEpicId(null);
      setDraftPoints("");
      const today = new Date().toISOString().split("T")[0];
      const defaultDue = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
      setDraftStartDate(today);
      setDraftDueDate(defaultDue);
      setHasChanges(false);

      if (targetProjId) {
        loadProjectContext(targetProjId);
      }
    } else if (issueId) {
      fetchIssueDetails();
    } else {
      setIssue(null);
    }
  }, [issueId, projectId, isCreateMode]);

  useEffect(() => {
    let interval: any = null;
    if (isTimerRunning) {
      interval = setInterval(() => {
        setTimerSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning]);

  const fetchIssueDetails = async () => {
    if (!issueId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/issues/${issueId}`);
      if (res.ok) {
        const data = await res.json();
        setIssue(data.issue);

        // Initialize draft states for issue fields
        setDraftTitle(data.issue?.title || "");
        setDraftDescription(data.issue?.description || "");
        setDraftStatusId(data.issue?.statusId || data.issue?.status?.id || "");
        setDraftPriority(data.issue?.priority || "MEDIUM");
        setDraftIssueType(data.issue?.issueType || "TASK");
        setDraftAssigneeId(data.issue?.assigneeId || data.issue?.assignee?.id || null);
        setDraftTeamId(data.issue?.teamId || data.issue?.team?.id || null);
        setDraftSprintId(data.issue?.sprintId || data.issue?.sprint?.id || null);
        setDraftEpicId(data.issue?.epicId || data.issue?.epic?.id || null);
        setDraftPoints(
          data.issue?.estimatePoints !== null && data.issue?.estimatePoints !== undefined
            ? String(data.issue.estimatePoints)
            : ""
        );
        setDraftStartDate(
          data.issue?.startDate ? new Date(data.issue.startDate).toISOString().split("T")[0] : ""
        );
        setDraftDueDate(
          data.issue?.dueDate ? new Date(data.issue.dueDate).toISOString().split("T")[0] : ""
        );
        setHasChanges(false);

        // Map existing custom field values
        if (data.issue?.customFieldValues) {
          const valMap: Record<string, any> = {};
          data.issue.customFieldValues.forEach((cfv: any) => {
            valMap[cfv.customFieldId] = cfv.valueString || cfv.valueNumber || cfv.valueDate || cfv.valueJson;
          });
          setCustomFieldValues(valMap);
        }

        // Fetch project custom fields, members, workflow statuses, teams, and sprints
        if (data.issue?.projectId) {
          fetch(`/api/sprints?projectId=${data.issue.projectId}`)
            .then((r) => r.json())
            .then((sData) => {
              if (Array.isArray(sData.sprints)) {
                setProjectSprints(sData.sprints);
              } else if (Array.isArray(sData)) {
                setProjectSprints(sData);
              }
            })
            .catch(() => {});

          fetch(`/api/custom-fields?projectId=${data.issue.projectId}`)
            .then((r) => r.json())
            .then((cfData) => {
              if (Array.isArray(cfData.customFields)) {
                setCustomFields(cfData.customFields);
              }
            })
            .catch(() => {});

          fetch(`/api/projects/${data.issue.projectId}/members`)
            .then((r) => r.json())
            .then((mList) => {
              if (Array.isArray(mList)) {
                setProjectMembers(mList);
              }
            })
            .catch(() => {});

          fetch(`/api/projects/${data.issue.projectId}/availability`)
            .then((r) => r.json())
            .then((aData) => {
              if (Array.isArray(aData.leaves)) {
                setLeaves(aData.leaves);
              }
            })
            .catch(() => {});


          fetch(`/api/workflows?projectId=${data.issue.projectId}`)
            .then((r) => r.json())
            .then((wfList) => {
              if (Array.isArray(wfList) && wfList.length > 0) {
                setProjectWorkflowId(wfList[0].id);
                const statuses = wfList[0].statuses || [];
                setProjectStatuses(statuses);
              }
            })
            .catch(() => {});

          fetch(`/api/projects/${data.issue.projectId}/types`)
            .then((r) => r.json())
            .then((tData) => {
              if (Array.isArray(tData.types) && tData.types.length > 0) {
                setProjectTypes(tData.types);
              }
            })
            .catch(() => {});

          fetch(`/api/projects/${data.issue.projectId}/priorities`)
            .then((r) => r.json())
            .then((pData) => {
              if (Array.isArray(pData.priorities) && pData.priorities.length > 0) {
                setProjectPriorities(pData.priorities);
              }
            })
            .catch(() => {});

          fetch(`/api/teams?projectId=${data.issue.projectId}`)
            .then((r) => r.json())
            .then((tList) => {
              if (Array.isArray(tList)) {
                setTeams(tList);
              }
            })
            .catch(() => {});

          fetch(`/api/epics?projectId=${data.issue.projectId}`)
            .then((r) => r.json())
            .then((epList) => {
              if (Array.isArray(epList)) {
                setProjectEpics(epList);
              }
            })
            .catch(() => {});

          fetch(`/api/auth/me`)
            .then((r) => r.json())
            .then((uData) => {
              if (uData.user) {
                setCurrentUser(uData.user);
              }
            })
            .catch(() => {});
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleWatcher = async () => {
    if (!issueId) return;
    try {
      const res = await fetch(`/api/issues/${issueId}/watchers`, {
        method: "POST",
      });
      if (res.ok) {
        fetchIssueDetails();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddDependency = async (e: React.FormEvent) => {
    e.preventDefault();
    setDepError("");
    if (!depTargetKey.trim() || !issueId) return;

    try {
      // Find issue by key first
      const searchRes = await fetch(`/api/search?q=${encodeURIComponent(depTargetKey.trim())}&type=issues`);
      const searchData = await searchRes.json();
      const targetIssue = searchData.issues?.find(
        (i: any) => i.issueKey.toUpperCase() === depTargetKey.trim().toUpperCase()
      );

      if (!targetIssue) {
        setDepError(`Issue "${depTargetKey}" not found`);
        return;
      }

      if (targetIssue.id === issueId) {
        setDepError("An issue cannot depend on itself");
        return;
      }

      const res = await fetch(`/api/issues/${issueId}/dependencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetIssueId: targetIssue.id,
          type: depType,
        }),
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to create dependency");
      }

      setDepTargetKey("");
      fetchIssueDetails();
      onIssueUpdated();
    } catch (err: any) {
      setDepError(err.message || "Failed to link issue");
    }
  };

  const handleRemoveDependency = async (dependencyId: string) => {
    if (!issueId) return;
    try {
      await fetch(`/api/issues/${issueId}/dependencies`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dependencyId }),
      });
      fetchIssueDetails();
      onIssueUpdated();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateCustomField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFieldName.trim() || !issue?.projectId) return;

    setCreatingField(true);
    try {
      let optionsJson = null;
      if (newFieldType === "DROPDOWN" && newFieldOptions.trim()) {
        const opts = newFieldOptions
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        optionsJson = JSON.stringify(opts);
      }

      const res = await fetch("/api/custom-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scopeType: "PROJECT",
          scopeId: issue.projectId,
          name: newFieldName.trim(),
          fieldType: newFieldType,
          optionsJson,
          isRequired: newFieldRequired,
        }),
      });

      if (res.ok) {
        setNewFieldName("");
        setNewFieldOptions("");
        setNewFieldRequired(false);
        setShowCreateFieldModal(false);

        // Reload project custom fields
        const cfRes = await fetch(`/api/custom-fields?projectId=${issue.projectId}`);
        const cfData = await cfRes.json();
        if (Array.isArray(cfData.customFields)) {
          setCustomFields(cfData.customFields);
        } else if (Array.isArray(cfData.fields)) {
          setCustomFields(cfData.fields);
        } else if (Array.isArray(cfData)) {
          setCustomFields(cfData);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCreatingField(false);
    }
  };

  const handleDeleteCustomField = async (fieldId: string) => {
    if (!confirm("Are you sure you want to delete this custom field? Associated values across issues will be removed.")) return;
    try {
      const res = await fetch(`/api/custom-fields/${fieldId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setCustomFields((prev) => prev.filter((f) => f.id !== fieldId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateProjectType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTypeName.trim() || !issue?.projectId) return;

    setIsSubmittingType(true);
    try {
      const res = await fetch(`/api/projects/${issue.projectId}/types`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newTypeName.trim(),
          color: newTypeColor,
          description: newTypeDescription.trim(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.types)) {
          setProjectTypes(data.types);
        }
        if (data.created) {
          setDraftIssueType(data.created.value);
          setHasChanges(true);
        }
        setShowAddTypeModal(false);
        setNewTypeName("");
        setNewTypeDescription("");
        showSuccess(`Added type "${newTypeName.trim()}" to this project!`);
        onIssueUpdated();
      } else {
        const err = await res.json();
        showError(err.error || "Failed to create type");
      }
    } catch (err: any) {
      showError(err.message || "Failed to create project type");
    } finally {
      setIsSubmittingType(false);
    }
  };

  const handleUpdateProjectType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingType || !editTypeName.trim() || !issue?.projectId) return;

    setIsSubmittingType(true);
    try {
      const res = await fetch(`/api/projects/${issue.projectId}/types`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalValue: editingType.value,
          name: editTypeName.trim(),
          color: editTypeColor,
          description: editTypeDescription.trim(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.types)) {
          setProjectTypes(data.types);
        }
        if (draftIssueType === editingType.value && data.updated?.value) {
          setDraftIssueType(data.updated.value);
        }
        setEditingType(null);
        showSuccess(`Updated type "${editTypeName.trim()}"!`);
        onIssueUpdated();
      } else {
        const err = await res.json();
        showError(err.error || "Failed to update type");
      }
    } catch (err: any) {
      showError(err.message || "Failed to update project type");
    } finally {
      setIsSubmittingType(false);
    }
  };

  const handleDeleteProjectType = async (typeValue: string) => {
    if (!issue?.projectId) return;
    if (["TASK", "BUG", "STORY", "EPIC"].includes(typeValue.toUpperCase())) {
      if (!confirm(`Are you sure you want to remove "${typeValue}"? Any issues using this type will be converted to TASK.`)) {
        return;
      }
    } else {
      if (!confirm(`Delete type "${typeValue}"? Any issues using this type will be automatically converted to TASK.`)) {
        return;
      }
    }

    setIsSubmittingType(true);
    try {
      const res = await fetch(`/api/projects/${issue.projectId}/types?value=${encodeURIComponent(typeValue)}`, {
        method: "DELETE",
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.types)) {
          setProjectTypes(data.types);
        } else {
          setProjectTypes((prev) => prev.filter((t) => t.value !== typeValue));
        }
        if (draftIssueType === typeValue) {
          setDraftIssueType("TASK");
          setHasChanges(true);
        }
        showSuccess(`Deleted type "${typeValue}"`);
        onIssueUpdated();
      } else {
        const err = await res.json();
        showError(err.error || "Failed to delete type");
      }
    } catch (err: any) {
      showError(err.message || "Failed to delete project type");
    } finally {
      setIsSubmittingType(false);
    }
  };

  const handleCreateProjectStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStatusName.trim() || !issue?.projectId) return;

    setIsCreatingStatus(true);
    try {
      let targetWfId = projectWorkflowId;
      if (!targetWfId) {
        const wfRes = await fetch(`/api/workflows?projectId=${issue.projectId}`);
        const wfData = await wfRes.json();
        if (Array.isArray(wfData) && wfData.length > 0) {
          targetWfId = wfData[0].id;
          setProjectWorkflowId(wfData[0].id);
        } else {
          const createWfRes = await fetch(`/api/workflows`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: issue.projectId, name: "Default Workflow" }),
          });
          if (createWfRes.ok) {
            const newWf = await createWfRes.json();
            targetWfId = newWf.id;
            setProjectWorkflowId(newWf.id);
          }
        }
      }

      if (!targetWfId) {
        throw new Error("Unable to resolve project workflow");
      }

      const res = await fetch(`/api/workflows/${targetWfId}/statuses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newStatusName.trim(),
          category: newStatusCategory,
          color: newStatusColor,
          position: projectStatuses.length,
        }),
      });

      if (res.ok) {
        const createdStatus = await res.json();
        setProjectStatuses((prev) => [...prev, createdStatus]);
        setDraftStatusId(createdStatus.id);
        setHasChanges(true);
        setShowAddStatusModal(false);
        setNewStatusName("");
        showSuccess(`Added "${createdStatus.name}" status to this project!`);
        onIssueUpdated();
      } else {
        const err = await res.json();
        showError(err.error || "Failed to create status");
      }
    } catch (err: any) {
      console.error(err);
      showError(err.message || "Failed to create project status");
    } finally {
      setIsCreatingStatus(false);
    }
  };

  const handleCreateProjectPriority = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPriorityName.trim() || !issue?.projectId) return;

    setIsCreatingPriority(true);
    try {
      const res = await fetch(`/api/projects/${issue.projectId}/priorities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newPriorityName.trim(),
          color: newPriorityColor,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.priorities)) {
          setProjectPriorities(data.priorities);
        }
        if (data.created) {
          setDraftPriority(data.created.value);
          setHasChanges(true);
        }
        setShowAddPriorityModal(false);
        setNewPriorityName("");
        showSuccess(`Added priority "${newPriorityName.trim()}" to this project!`);
        onIssueUpdated();
      } else {
        const err = await res.json();
        showError(err.error || "Failed to create priority");
      }
    } catch (err: any) {
      console.error(err);
      showError(err.message || "Failed to create project priority");
    } finally {
      setIsCreatingPriority(false);
    }
  };

  const handleCreateProjectEpic = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetProjId = issue?.projectId || projectId;
    if (!newEpicName.trim() || !targetProjId) return;

    setIsCreatingEpic(true);
    try {
      const res = await fetch("/api/epics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: targetProjId,
          name: newEpicName.trim(),
          summary: newEpicSummary.trim() || undefined,
          color: newEpicColor,
          status: newEpicStatus,
          targetDate: newEpicTargetDate || undefined,
        }),
      });

      if (res.ok) {
        const created = await res.json();
        setProjectEpics((prev) => [...prev, created]);
        setDraftEpicId(created.id);
        setHasChanges(true);
        setShowAddEpicModal(false);
        setNewEpicName("");
        setNewEpicSummary("");
        setNewEpicColor("#8b5cf6");
        setNewEpicStatus("ACTIVE");
        setNewEpicTargetDate("");
        showSuccess(`Epic "${created.name}" created and linked!`);
        onIssueUpdated();
      } else {
        const err = await res.json();
        showError(err.error || "Failed to create epic");
      }
    } catch (err: any) {
      console.error(err);
      showError(err.message || "Failed to create project epic");
    } finally {
      setIsCreatingEpic(false);
    }
  };

  const handleDeleteProjectEpic = async (epicId: string, epicName: string) => {
    if (!confirm(`Are you sure you want to delete Epic "${epicName}"? All linked issues will be unlinked.`)) return;
    setDeletingEpicId(epicId);
    try {
      const res = await fetch(`/api/epics/${epicId}`, { method: "DELETE" });
      if (res.ok) {
        setProjectEpics((prev) => prev.filter((e) => e.id !== epicId));
        if (draftEpicId === epicId) {
          setDraftEpicId(null);
          setHasChanges(true);
        }
        showSuccess(`Epic "${epicName}" deleted successfully`);
        onIssueUpdated();
      } else {
        const err = await res.json();
        showError(err.error || "Failed to delete epic");
      }
    } catch (err: any) {
      console.error(err);
      showError(err.message || "Failed to delete epic");
    } finally {
      setDeletingEpicId(null);
    }
  };

  const handleSaveCustomFieldValue = async (customFieldId: string, value: any, fieldType: string) => {
    if (!issueId) return;
    try {
      const payload: any = { customFieldId };
      if (fieldType === "NUMBER") payload.valueNumber = Number(value);
      else if (fieldType === "DATE") payload.valueDate = value;
      else payload.valueString = String(value);

      await fetch(`/api/issues/${issueId}/custom-fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: [payload] }),
      });

      setCustomFieldValues((prev) => ({ ...prev, [customFieldId]: value }));
      showSuccess("Custom field updated");
      fetchIssueDetails();
      onIssueUpdated();
    } catch (err) {
      console.error(err);
      showError("Failed to update custom field");
    }
  };

  const handleUpdateField = async (fields: any) => {
    if (!issueId) return;
    try {
      const res = await fetch(`/api/issues/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (res.ok) {
        fetchIssueDetails();
        onIssueUpdated();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveAndClose = async () => {
    if (!issueId) return;

    const finalTitle = draftTitle?.trim();
    if (!finalTitle) {
      showError("Issue Title is mandatory");
      return;
    }
    const finalStatusId = draftStatusId || (projectStatuses.length > 0 ? projectStatuses[0].id : "");
    if (!finalStatusId) {
      showError("Status is a mandatory field");
      return;
    }
    const finalPriority = draftPriority?.trim() || "MEDIUM";
    const finalStartDate = draftStartDate || new Date().toISOString().split("T")[0];
    const finalDueDate = draftDueDate || new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

    if (new Date(finalDueDate) < new Date(finalStartDate)) {
      showError("Due Date cannot be earlier than Start Date");
      return;
    }

    if (isCreateMode) {
      const targetProjId = projectId || issue?.projectId;
      if (!targetProjId) {
        showError("Project ID missing for task creation");
        return;
      }

      setIsSaving(true);
      try {
        const payload: any = {
          projectId: targetProjId,
          title: finalTitle,
          description: draftDescription || null,
          statusId: finalStatusId,
          priority: finalPriority,
          issueType: draftIssueType || "TASK",
          assigneeId: draftAssigneeId || null,
          teamId: draftTeamId || null,
          sprintId: draftSprintId || null,
          epicId: draftEpicId || null,
          estimatePoints: draftPoints !== "" ? Number(draftPoints) : null,
          startDate: new Date(finalStartDate).toISOString(),
          dueDate: new Date(finalDueDate).toISOString(),
        };

        const res = await fetch(`/api/projects/${targetProjId}/issues`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          showSuccess("Task created successfully!");
          setHasChanges(false);
          if (typeof onIssueUpdated === "function") {
            onIssueUpdated();
          }
          onClose();
        } else {
          const d = await res.json().catch(() => ({}));
          showError(d.error || "Failed to create task");
        }
      } catch (err: any) {
        console.error(err);
        showError("Error creating task");
      } finally {
        setIsSaving(false);
      }
      return;
    }

    setIsSaving(true);
    try {
      const payload: any = {
        title: draftTitle.trim() || issue?.title,
        description: draftDescription,
        statusId: draftStatusId || undefined,
        priority: draftPriority,
        issueType: draftIssueType,
        assigneeId: draftAssigneeId || null,
        teamId: draftTeamId || null,
        sprintId: draftSprintId || null,
        epicId: draftEpicId || null,
        estimatePoints: draftPoints !== "" ? Number(draftPoints) : null,
        startDate: draftStartDate ? new Date(draftStartDate).toISOString() : null,
        dueDate: draftDueDate ? new Date(draftDueDate).toISOString() : null,
      };

      const res = await fetch(`/api/issues/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        showSuccess("Issue updated successfully");
        setHasChanges(false);
        onIssueUpdated();
        onClose(); // Automatically close window on save
      } else {
        const d = await res.json();
        showError(d.error || "Failed to update issue");
      }
    } catch (err: any) {
      console.error(err);
      showError("Error saving issue");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelAndClose = () => {
    setHasChanges(false);
    onClose(); // Automatically close window on cancel
  };

  const handleDeleteIssue = async () => {
    if (!issueId) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/issues/${issueId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        showSuccess(`Issue ${issue?.issueKey || ""} deleted successfully`);
        setShowDeleteConfirm(false);
        onIssueUpdated();
        onClose();
      } else {
        const d = await res.json();
        showError(d.error || "Failed to delete issue");
      }
    } catch (err: any) {
      console.error("Delete issue error:", err);
      showError("Error deleting issue");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subtaskTitle.trim() || !issueId) return;
    try {
      const res = await fetch(`/api/issues/${issueId}/subtasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: subtaskTitle.trim(),
          assigneeId: subtaskAssigneeId || undefined,
          priority: subtaskPriority,
          estimateHours: subtaskEstimateHours ? Number(subtaskEstimateHours) : undefined,
          dueDate: subtaskDueDate ? new Date(subtaskDueDate).toISOString() : undefined,
        }),
      });
      if (res.ok) {
        setSubtaskTitle("");
        setSubtaskAssigneeId("");
        setSubtaskPriority("MEDIUM");
        setSubtaskEstimateHours("");
        setSubtaskDueDate("");
        setShowSubtaskFormDetails(false);
        showSuccess("Subtask added");
        fetchIssueDetails();
        onIssueUpdated();
      } else {
        const d = await res.json();
        showError(d.error || "Failed to add subtask");
      }
    } catch (e) {
      showError("Error creating subtask");
    }
  };

  const handleToggleSubtask = async (subtaskId: string, isCompleted: boolean) => {
    try {
      await fetch(`/api/subtasks/${subtaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCompleted }),
      });
      fetchIssueDetails();
      onIssueUpdated();
    } catch (e) {
      console.error(e);
    }
  };

  const handleStartEditSubtask = (sub: any) => {
    setEditingSubtaskId(sub.id);
    setEditSubtaskTitle(sub.title || "");
    setEditSubtaskAssigneeId(sub.assigneeId || "");
    setEditSubtaskPriority(sub.priority || "MEDIUM");
    setEditSubtaskEstimateHours(sub.estimateHours ? String(sub.estimateHours) : "");
    setEditSubtaskDueDate(sub.dueDate ? new Date(sub.dueDate).toISOString().split("T")[0] : "");
    setEditSubtaskStatus(sub.status || (sub.isCompleted ? "DONE" : "TO_DO"));
  };

  const handleSaveEditSubtask = async (subtaskId: string) => {
    try {
      const res = await fetch(`/api/subtasks/${subtaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editSubtaskTitle.trim(),
          assigneeId: editSubtaskAssigneeId || null,
          priority: editSubtaskPriority,
          estimateHours: editSubtaskEstimateHours ? Number(editSubtaskEstimateHours) : null,
          dueDate: editSubtaskDueDate ? new Date(editSubtaskDueDate).toISOString() : null,
          status: editSubtaskStatus,
          isCompleted: editSubtaskStatus === "DONE",
        }),
      });
      if (res.ok) {
        setEditingSubtaskId(null);
        showSuccess("Subtask updated");
        fetchIssueDetails();
        onIssueUpdated();
      } else {
        const d = await res.json();
        showError(d.error || "Failed to update subtask");
      }
    } catch (err) {
      showError("Error updating subtask");
    }
  };

  const handleDeleteSubtask = async (subtaskId: string) => {
    if (!confirm("Are you sure you want to delete this subtask?")) return;
    try {
      const res = await fetch(`/api/subtasks/${subtaskId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        showSuccess("Subtask deleted");
        fetchIssueDetails();
        onIssueUpdated();
      }
    } catch (err) {
      showError("Error deleting subtask");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !issueId) return;

    if (file.size > 15 * 1024 * 1024) {
      showError("File size exceeds 15MB limit");
      return;
    }

    setIsUploadingAttachment(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result as string;
        const res = await fetch(`/api/issues/${issueId}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || "application/octet-stream",
            fileUrl: base64Data,
          }),
        });
        if (res.ok) {
          showSuccess("Attachment uploaded successfully");
          fetchIssueDetails();
          onIssueUpdated();
        } else {
          const err = await res.json();
          showError(err.error || "Failed to upload attachment");
        }
        setIsUploadingAttachment(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      showError("Failed to read file");
      setIsUploadingAttachment(false);
    }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!confirm("Are you sure you want to delete this attachment?")) return;
    try {
      const res = await fetch(`/api/attachments/${attachmentId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        showSuccess("Attachment deleted");
        fetchIssueDetails();
        onIssueUpdated();
      } else {
        showError("Failed to delete attachment");
      }
    } catch (err) {
      showError("Error deleting attachment");
    }
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentContent.trim() || !issueId) return;
    try {
      const res = await fetch(`/api/issues/${issueId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: commentContent }),
      });
      if (res.ok) {
        setCommentContent("");
        fetchIssueDetails();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogTime = async (minutes: number, desc?: string) => {
    if (!issueId || minutes <= 0) return;
    try {
      const res = await fetch(`/api/issues/${issueId}/time-entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationMinutes: minutes, description: desc }),
      });
      if (res.ok) {
        setTimeMinutes("");
        setTimeNotes("");
        setTimerSeconds(0);
        setIsTimerRunning(false);
        fetchIssueDetails();
        onIssueUpdated();
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCancelAndClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!issueId) return null;

  if (!issue) {
    return (
      <div 
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex justify-end z-50 animate-in fade-in duration-100"
        role="dialog"
        aria-modal="true"
        onClick={(e) => {
          if (e.target === e.currentTarget) handleCancelAndClose();
        }}
      >
        <div className="w-full max-w-3xl bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col items-center justify-center p-6 border-l border-slate-300 dark:border-white/[0.08]">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-xs font-semibold text-slate-500">Preparing task form...</p>
        </div>
      </div>
    );
  }

  const currentIssue = issue || (isCreateMode ? {
    id: "new",
    issueKey: "NEW TASK",
    title: draftTitle,
    description: draftDescription,
    projectId: projectId || "",
    customFieldValues: [],
    subtasks: [],
    attachments: [],
    comments: [],
    incomingDeps: [],
    outgoingDeps: [],
    activityLogs: [],
    delegations: [],
    watchers: [],
  } : null);

  if (!currentIssue) {
    return (
      <div 
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex justify-end z-50 animate-in fade-in duration-100"
        role="dialog"
        aria-modal="true"
        onClick={(e) => {
          if (e.target === e.currentTarget) handleCancelAndClose();
        }}
      >
        <div className="w-full max-w-3xl bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col items-center justify-center p-6 border-l border-slate-300 dark:border-white/[0.08]">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-xs font-semibold text-slate-500">Loading task details...</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex justify-end z-50 animate-in fade-in duration-100"
      role="dialog"
      aria-modal="true"
      aria-labelledby="issue-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancelAndClose();
      }}
    >
      <div className="w-full max-w-3xl md:max-w-4xl xl:max-w-5xl bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col border-l border-slate-300 dark:border-white/[0.08] animate-in slide-in-from-right duration-200">
        {/* Modal Header */}
        <div className="min-h-[56px] h-14 border-b border-slate-300 dark:border-white/[0.08] bg-white/80 dark:bg-slate-900/80 backdrop-blur-md flex items-center justify-between px-3 sm:px-6 shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1 mr-3">
            <span
              className={`font-mono text-xs font-bold px-2.5 py-1 rounded-lg border shadow-2xs transition-all shrink-0 ${
                !isCreateMode && isIssueDone(issue, projectStatuses)
                  ? "line-through text-blue-600/75 dark:text-blue-400/75 decoration-blue-600 dark:decoration-blue-400 decoration-2 bg-blue-50/50 dark:bg-blue-950/40 border-blue-200/50 dark:border-blue-800/50"
                  : "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/70 border-blue-200/80 dark:border-blue-800/80"
              }`}
            >
              {isCreateMode ? "NEW TASK" : issue?.issueKey || "..."}
            </span>
            <button
              type="button"
              onClick={() => {
                setTypeModalTab("MANAGE");
                setShowAddTypeModal(true);
              }}
              title="Click to change, add, edit, or delete issue types"
              className="group flex items-center gap-1.5 px-2.5 py-1 rounded-lg border uppercase tracking-wider text-[10px] font-bold shadow-2xs hover:scale-105 transition-all cursor-pointer shrink-0"
              style={{
                backgroundColor: `${projectTypes.find((t) => t.value === (draftIssueType || issue?.issueType))?.color || "#0ea5e9"}18`,
                borderColor: `${projectTypes.find((t) => t.value === (draftIssueType || issue?.issueType))?.color || "#0ea5e9"}40`,
                color: projectTypes.find((t) => t.value === (draftIssueType || issue?.issueType))?.color || "#0ea5e9",
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  backgroundColor:
                    projectTypes.find((t) => t.value === (draftIssueType || issue?.issueType))?.color || "#0ea5e9",
                }}
              />
              <span>{draftIssueType || issue?.issueType || "TASK"}</span>
              <ChevronDown className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100 shrink-0" />
            </button>
            {issue?.sprint && (
              <span
                className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-900/60 shadow-2xs min-w-0 max-w-[130px] lg:max-w-[170px] shrink truncate"
                title={`Sprint: ${issue?.sprint?.name}`}
              >
                <GitBranch className="w-3 h-3 text-indigo-500 shrink-0" />
                <span className="truncate">{issue?.sprint?.name}</span>
              </span>
            )}
            {(draftEpicId || issue?.epic || issue?.epicId) && (() => {
              const currentEpic = projectEpics.find((e) => e.id === (draftEpicId || issue?.epicId)) || issue?.epic;
              if (!currentEpic) return null;
              return (
                <div
                  className="hidden md:inline-flex items-center gap-1.5 min-w-0 max-w-[150px] lg:max-w-[220px] shrink"
                  title={`Epic: ${currentEpic.name}${currentEpic.status ? ` (${currentEpic.status})` : ""}`}
                >
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg text-white shadow-2xs truncate min-w-0 max-w-full"
                    style={{ backgroundColor: currentEpic.color || "#8b5cf6" }}
                  >
                    <Zap className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">{currentEpic.name}</span>
                  </span>
                  {currentEpic.status && (
                    <span
                      className="hidden xl:inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-purple-100/90 text-purple-700 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-200 dark:border-purple-800 shadow-2xs shrink-0 whitespace-nowrap"
                    >
                      {currentEpic.status}
                    </span>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {canDelete && !isCreateMode && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/60 rounded-xl text-rose-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer border border-rose-200/70 dark:border-rose-900/60 shadow-2xs shrink-0"
                title="Delete issue permanently"
                aria-label="Delete issue"
              >
                <Trash2 className="w-4 h-4 text-rose-500" />
              </button>
            )}
            <button
              type="button"
              onClick={handleCancelAndClose}
              className="hidden lg:inline-flex btn-secondary px-3 py-1.5 text-xs font-semibold rounded-xl cursor-pointer shrink-0"
              title="Cancel changes and close window"
            >
              Cancel
            </button>
            {isViewer ? (
              <span className="px-3 py-1 text-[11px] font-bold rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800/80 shrink-0">
                Read-Only
              </span>
            ) : (
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSaveAndClose}
                className="btn-primary flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-xl disabled:opacity-50 cursor-pointer shadow-xs shadow-blue-500/20 shrink-0"
                title="Save changes and close window"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{isSaving ? "Saving..." : isCreateMode ? "Save & Close" : "Save"}</span>
              </button>
            )}
            {!isCreateMode && (
              <button
                onClick={handleToggleWatcher}
                className="btn-secondary flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-xl cursor-pointer shrink-0"
                title={issue?.watchers?.some((w: any) => w.userId === currentUser?.id) ? "Unwatch issue" : "Watch issue"}
              >
                <Eye className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span className="hidden xl:inline">Watch</span>
                {issue?.watchers?.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 font-bold text-[10px]">
                    {issue?.watchers?.length}
                  </span>
                )}
              </button>
            )}
            <button onClick={handleCancelAndClose} aria-label="Close modal" className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer shrink-0 ml-0.5">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {isViewer && (
          <div className="mx-6 mt-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 flex items-center gap-2.5 text-xs text-amber-800 dark:text-amber-300">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span><strong>Read-Only Mode:</strong> You are viewing this issue as a Viewer. Editing fields, updating status, creating subtasks, and deleting are restricted.</span>
          </div>
        )}

        {loading || (!issue && !isCreateMode) ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400">Loading issue details...</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
            {/* Title & Status */}
            <div>
              <label htmlFor="issue-modal-title" className="block text-[11px] font-semibold text-slate-400 mb-1">
                Issue Title
              </label>
              <input
                id="issue-modal-title"
                type="text"
                disabled={isViewer}
                value={draftTitle}
                onChange={(e) => {
                  setDraftTitle(e.target.value);
                  setHasChanges(true);
                }}
                placeholder="Issue title..."
                className={`w-full text-xl font-bold text-slate-900 dark:text-white bg-transparent border-b border-slate-300/80 dark:border-slate-800 hover:border-slate-300 focus:border-blue-500 outline-none pb-1 transition-colors ${
                  isViewer ? "cursor-not-allowed opacity-90" : ""
                }`}
              />
            </div>

            {/* Quick Meta Grid */}
            {(() => {
              const activeTeam = teams.find((t) => t.id === draftTeamId) || (draftTeamId === issue?.teamId ? issue?.team : null);

              const assigneeLeaveDetails = (() => {
                if (!draftAssigneeId) return null;
                const userLeaves = leaves.filter((l: any) => l.userId === draftAssigneeId && l.status !== "CANCELLED");
                if (userLeaves.length === 0) return null;

                const now = new Date();
                const activeLeave = userLeaves.find((l: any) => {
                  const s = new Date(l.startDate);
                  const e = new Date(l.endDate);
                  return now >= s && now <= e;
                }) || userLeaves[0];

                if (!activeLeave) return null;

                const formattedRange = formatLeaveRange(activeLeave.startDate, activeLeave.endDate);
                const delegateUser = (activeLeave as any).delegations?.[0]?.delegateUser || (activeLeave as any).delegateUser;
                let delegateName = "";
                let delegateEmail = "";
                if (delegateUser) {
                  delegateName = delegateUser.firstName ? `${delegateUser.firstName} ${delegateUser.lastName || ""}`.trim() : (delegateUser.email || "");
                  delegateEmail = delegateUser.email || "";
                }

                let hasOverlap = false;
                if (draftStartDate || draftDueDate) {
                  const overlapRes = doesLeaveOverlap(userLeaves, draftStartDate || now, draftDueDate || draftStartDate || now);
                  hasOverlap = overlapRes.hasOverlap;
                }

                return {
                  formattedRange,
                  leaveType: activeLeave.leaveType || "Leave",
                  delegateName,
                  delegateEmail,
                  hasOverlap,
                  activeLeave,
                };
              })();

              const activeDelegation = (() => {
                if (!assigneeLeaveDetails?.activeLeave) return null;
                const del = (assigneeLeaveDetails.activeLeave as any).delegations?.[0];
                if (!del) return null;
                return {
                  startDate: del.startDate || assigneeLeaveDetails.activeLeave.startDate,
                  endDate: del.endDate || assigneeLeaveDetails.activeLeave.endDate,
                  originalAssignee: (assigneeLeaveDetails.activeLeave as any).user || issue?.assignee,
                  delegateUser: del.delegateUser,
                };
              })();

              return (
                <>
                  <div className="bg-slate-50/70 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-4 text-xs shadow-2xs">
                    {/* Row 1: Workflow Attributes, Team & Epic (5 Columns) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5">
                      {/* Type Field */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-full shrink-0 shadow-xs"
                              style={{
                                backgroundColor:
                                  projectTypes.find((t) => t.value === draftIssueType)?.color || "#0ea5e9",
                              }}
                            />
                            <label className="block text-slate-500 dark:text-slate-400 font-bold text-[11px]">
                              Type <span className="text-rose-500 font-bold">*</span>
                            </label>
                          </div>
                          {!isViewer && (
                            <button
                              type="button"
                              onClick={() => {
                                setTypeModalTab("ADD");
                                setShowAddTypeModal(true);
                              }}
                              className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer flex items-center gap-0.5"
                              title="Add, edit, or delete issue types for this project"
                            >
                              <Plus className="w-2.5 h-2.5" />
                              <span>Add</span>
                            </button>
                          )}
                        </div>
                        <select
                          disabled={isViewer}
                          value={draftIssueType}
                          onChange={(e) => {
                            if (e.target.value === "__ADD_TYPE__") {
                              setTypeModalTab("ADD");
                              setShowAddTypeModal(true);
                              return;
                            }
                            setDraftIssueType(e.target.value);
                            setHasChanges(true);
                          }}
                          className={`w-full bg-white dark:bg-slate-900 font-semibold text-slate-800 dark:text-slate-200 p-2 rounded-xl border border-slate-300 dark:border-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-2xs text-xs ${
                            isViewer ? "cursor-not-allowed opacity-80" : "cursor-pointer"
                          }`}
                        >
                          {projectTypes.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.name || t.value}
                            </option>
                          ))}
                          {draftIssueType && !projectTypes.some((t) => t.value === draftIssueType) && (
                            <option value={draftIssueType}>{draftIssueType}</option>
                          )}
                          <option value="__ADD_TYPE__" className="text-blue-600 font-bold">
                            + Add & manage types...
                          </option>
                        </select>
                      </div>

                      {/* Status Field */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-full shrink-0 shadow-xs ring-1 ring-current/20"
                              style={{
                                backgroundColor: projectStatuses.find((s) => s.id === draftStatusId)?.color || "#3b82f6",
                                color: projectStatuses.find((s) => s.id === draftStatusId)?.color || "#3b82f6",
                              }}
                            />
                            <label className="block text-slate-500 dark:text-slate-400 font-bold text-[11px]">
                              Status <span className="text-rose-500 font-bold">*</span>
                            </label>
                          </div>
                          {!isViewer && (
                            <button
                              type="button"
                              onClick={() => setShowAddStatusModal(true)}
                              className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer flex items-center gap-0.5"
                              title="Add custom status to this project (applicable to all tasks)"
                            >
                              <Plus className="w-2.5 h-2.5" />
                              <span>Add</span>
                            </button>
                          )}
                        </div>
                        {projectStatuses.length > 0 ? (
                          <select
                            disabled={isViewer}
                            value={draftStatusId}
                            onChange={(e) => {
                              if (e.target.value === "__ADD_STATUS__") {
                                setShowAddStatusModal(true);
                                return;
                              }
                              setDraftStatusId(e.target.value);
                              setHasChanges(true);
                            }}
                            className={`w-full bg-white dark:bg-slate-900 font-semibold text-slate-800 dark:text-slate-200 p-2 rounded-xl border border-slate-300 dark:border-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-2xs text-xs ${
                              isViewer ? "cursor-not-allowed opacity-80" : "cursor-pointer"
                            }`}
                          >
                            {projectStatuses.map((st) => (
                              <option key={st.id} value={st.id}>
                                {st.name}
                              </option>
                            ))}
                            <option value="__ADD_STATUS__" className="text-blue-600 font-bold">
                              + Add more options (project-wise)...
                            </option>
                          </select>
                        ) : (
                          <span className="inline-block font-semibold px-2 py-1 rounded text-[11px]" style={{ backgroundColor: `${issue?.status?.color || "#3b82f6"}20`, color: issue?.status?.color || "#3b82f6" }}>
                            {issue?.status?.name || "Status"}
                          </span>
                        )}
                      </div>

                      {/* Priority Field */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-full shrink-0 shadow-xs"
                              style={{
                                backgroundColor:
                                  projectPriorities.find((p) => p.value === draftPriority)?.color ||
                                  (draftPriority === "CRITICAL"
                                    ? "#f43f5e"
                                    : draftPriority === "HIGHEST"
                                    ? "#f97316"
                                    : draftPriority === "HIGH"
                                    ? "#f59e0b"
                                    : draftPriority === "MEDIUM"
                                    ? "#3b82f6"
                                    : draftPriority === "LOW"
                                    ? "#10b981"
                                    : "#64748b"),
                              }}
                            />
                            <label className="block text-slate-500 dark:text-slate-400 font-bold text-[11px]">
                              Priority <span className="text-rose-500 font-bold">*</span>
                            </label>
                          </div>
                          {!isViewer && (
                            <button
                              type="button"
                              onClick={() => setShowAddPriorityModal(true)}
                              className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer flex items-center gap-0.5"
                              title="Add custom priority to this project (applicable to all tasks)"
                            >
                              <Plus className="w-2.5 h-2.5" />
                              <span>Add</span>
                            </button>
                          )}
                        </div>
                        <select
                          disabled={isViewer}
                          value={draftPriority}
                          onChange={(e) => {
                            if (e.target.value === "__ADD_PRIORITY__") {
                              setShowAddPriorityModal(true);
                              return;
                            }
                            setDraftPriority(e.target.value);
                            setHasChanges(true);
                          }}
                          className={`w-full bg-white dark:bg-slate-900 font-semibold text-slate-800 dark:text-slate-200 p-2 rounded-xl border border-slate-300 dark:border-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-2xs text-xs ${
                            isViewer ? "cursor-not-allowed opacity-80" : "cursor-pointer"
                          }`}
                        >
                          {projectPriorities.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.name}
                            </option>
                          ))}
                          {draftPriority && !projectPriorities.some((p) => p.value === draftPriority) && (
                            <option value={draftPriority}>{draftPriority}</option>
                          )}
                          <option value="__ADD_PRIORITY__" className="text-blue-600 font-bold">
                            + Add more options (project-wise)...
                          </option>
                        </select>
                      </div>

                      {/* Team Field */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-slate-500 dark:text-slate-400 font-bold text-[11px]">Team</label>
                          {activeTeam && (
                            <span
                              className="text-[10px] text-blue-600 dark:text-blue-400 font-bold"
                              title="All team members receive automatic notifications"
                            >
                              🔔 {activeTeam.members?.length || activeTeam._count?.members || 0}
                            </span>
                          )}
                        </div>
                        <select
                          disabled={isViewer}
                          value={draftTeamId || ""}
                          onChange={(e) => {
                            setDraftTeamId(e.target.value || null);
                            setHasChanges(true);
                          }}
                          className={`w-full bg-white dark:bg-slate-900 font-semibold text-slate-800 dark:text-slate-200 p-2 rounded-xl border border-slate-300 dark:border-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-2xs text-xs ${
                            isViewer ? "cursor-not-allowed opacity-80" : "cursor-pointer"
                          }`}
                        >
                          <option value="">No Team</option>
                          {teams.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({t._count?.members ?? t.members?.length ?? 0})
                            </option>
                          ))}
                          {issue?.team && !teams.some((t) => t.id === issue?.team?.id) && (
                            <option value={issue?.team?.id}>{issue?.team?.name}</option>
                          )}
                        </select>
                      </div>

                      {/* Epic Field */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <Zap className="w-3 h-3 text-purple-500 shrink-0" />
                            <label className="block text-slate-500 dark:text-slate-400 font-bold text-[11px]">Epic</label>
                          </div>
                          <div className="flex items-center gap-2">
                            {draftEpicId && (
                              <span
                                className="w-2 h-2 rounded-full shadow-xs shrink-0"
                                style={{ backgroundColor: projectEpics.find((e) => e.id === draftEpicId)?.color || "#8b5cf6" }}
                                title="Epic color indicator"
                              />
                            )}
                            {!isViewer && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEpicModalTab("CREATE");
                                  setShowAddEpicModal(true);
                                }}
                                className="text-[10px] font-bold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 hover:underline flex items-center gap-0.5 cursor-pointer"
                                title="Add more Epic option (project-wise)"
                              >
                                <Plus className="w-2.5 h-2.5" />
                                <span>Add</span>
                              </button>
                            )}
                          </div>
                        </div>
                        <select
                          disabled={isViewer}
                          value={draftEpicId || ""}
                          onChange={(e) => {
                            if (e.target.value === "__ADD_EPIC__") {
                              setEpicModalTab("CREATE");
                              setShowAddEpicModal(true);
                              return;
                            }
                            if (e.target.value === "__MANAGE_EPICS__") {
                              setEpicModalTab("MANAGE");
                              setShowAddEpicModal(true);
                              return;
                            }
                            setDraftEpicId(e.target.value || null);
                            setHasChanges(true);
                          }}
                          title={projectEpics.find((e) => e.id === draftEpicId)?.name || "Select Epic"}
                          className={`w-full bg-white dark:bg-slate-900 font-semibold text-slate-800 dark:text-slate-200 p-2 pr-7 rounded-xl border border-slate-300 dark:border-slate-700 outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all shadow-2xs text-xs truncate ${
                            isViewer ? "cursor-not-allowed opacity-80" : "cursor-pointer"
                          }`}
                        >
                          <option value="">None (No Epic)</option>
                          {projectEpics.map((ep) => (
                            <option key={ep.id} value={ep.id}>
                              {ep.name} {ep.status ? `(${ep.status})` : ""}
                            </option>
                          ))}
                          {issue?.epic && !projectEpics.some((e) => e.id === issue?.epic?.id) && (
                            <option value={issue?.epic?.id}>
                              {issue?.epic?.name} {issue?.epic?.status ? `(${issue?.epic?.status})` : ""}
                            </option>
                          )}
                          <option value="__ADD_EPIC__" className="text-purple-600 font-bold">
                            + Add more options (project-wise)...
                          </option>
                          {projectEpics.length > 0 && (
                            <option value="__MANAGE_EPICS__" className="text-slate-600 dark:text-slate-400">
                              ⚙ Manage project epics ({projectEpics.length})...
                            </option>
                          )}
                        </select>

                        {(() => {
                          const selectedEpic = projectEpics.find((e) => e.id === draftEpicId) || (draftEpicId === issue?.epicId ? issue?.epic : null);
                          if (!selectedEpic) return null;
                          return (
                            <div className="mt-1.5 flex items-center justify-between text-[11px] px-2.5 py-1.5 bg-purple-50/70 dark:bg-purple-950/30 rounded-xl border border-purple-200/80 dark:border-purple-900/50">
                              <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-1">
                                <span className="w-2 h-2 rounded-full shrink-0 shadow-xs" style={{ backgroundColor: selectedEpic.color || "#8b5cf6" }} />
                                <span className="font-semibold text-purple-950 dark:text-purple-200 truncate" title={selectedEpic.name}>{selectedEpic.name}</span>
                                {selectedEpic.status && (
                                  <span className="font-bold text-[9px] uppercase tracking-wider px-1.5 py-0.2 rounded bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 shrink-0">
                                    {selectedEpic.status}
                                  </span>
                                )}
                              </div>
                              {!isViewer && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDraftEpicId(null);
                                    setHasChanges(true);
                                  }}
                                  className="text-purple-400 hover:text-rose-500 p-0.5 rounded cursor-pointer shrink-0 transition-colors"
                                  title="Unlink epic from this issue"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="h-px bg-slate-200/70 dark:bg-slate-800/80" />

                    {/* Row 2: Ownership & Task Delegation (2 Columns) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      {/* Assignee (Original) */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-slate-500 dark:text-slate-400 font-bold text-[11px]">Assignee (Original)</label>
                          {!isViewer && currentUser && (draftAssigneeId !== currentUser.id) && (
                            <button
                              type="button"
                              onClick={() => {
                                setDraftAssigneeId(currentUser.id);
                                setHasChanges(true);
                              }}
                              className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer"
                            >
                              Assign to me
                            </button>
                          )}
                        </div>
                        <select
                          disabled={isViewer}
                          value={draftAssigneeId || ""}
                          onChange={(e) => {
                            setDraftAssigneeId(e.target.value || null);
                            setHasChanges(true);
                          }}
                          className={`w-full bg-white dark:bg-slate-900 font-semibold text-slate-800 dark:text-slate-200 p-2 rounded-xl border border-slate-300 dark:border-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-2xs text-xs ${
                            isViewer ? "cursor-not-allowed opacity-80" : "cursor-pointer"
                          }`}
                        >
                          <option value="">Unassigned</option>
                          {projectMembers.map((pm) => {
                            const u = pm.user || pm;
                            const uId = u.id || pm.userId;
                            const uName = u.firstName ? `${u.firstName} ${u.lastName || ""}`.trim() : (u.email || "Member");
                            const uLeaves = leaves.filter((l) => l.userId === uId && l.status !== "CANCELLED");

                            const overlapCheck = (draftStartDate || draftDueDate)
                              ? doesLeaveOverlap(uLeaves, draftStartDate || draftDueDate, draftDueDate || draftStartDate)
                              : { hasOverlap: false, overlappingLeaves: [] };

                            const todayCheck = isUserOnLeave(uLeaves, new Date());

                            const targetLeave = overlapCheck.hasOverlap && overlapCheck.overlappingLeaves[0]
                              ? overlapCheck.overlappingLeaves[0]
                              : todayCheck.onLeave && todayCheck.leave
                              ? todayCheck.leave
                              : uLeaves.length > 0
                              ? uLeaves[0]
                              : null;

                            let delegateBadge = "";
                            if (targetLeave) {
                              const dUser = (targetLeave as any).delegations?.[0]?.delegateUser || (targetLeave as any).delegateUser;
                              if (dUser) {
                                const dName = dUser.firstName ? `${dUser.firstName} ${dUser.lastName || ""}`.trim() : (dUser.email || "");
                                if (dName) delegateBadge = ` ➔ Delegated to: ${dName}`;
                              }
                            }
                            return (
                              <option key={uId} value={uId}>
                                {uName} {targetLeave ? `🔴 (On Leave${delegateBadge})` : ""}
                              </option>
                            );
                          })}
                          {issue?.assignee && !projectMembers.some(pm => (pm.user?.id || pm.userId || pm.id) === issue?.assignee?.id) && (
                            <option value={issue?.assignee?.id}>
                              {`${issue?.assignee?.firstName || ""} ${issue?.assignee?.lastName || ""}`.trim()}
                            </option>
                          )}
                        </select>
                      </div>

                      {/* Delegate User (Temporary) Field */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-slate-500 dark:text-slate-400 font-bold text-[11px]">
                            Delegate User (Temporary)
                          </label>
                          {assigneeLeaveDetails?.delegateName && (
                            <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold flex items-center gap-0.5">
                              ↗ Active
                            </span>
                          )}
                        </div>
                        <div className={`w-full bg-white dark:bg-slate-900 font-semibold p-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs flex items-center justify-between shadow-2xs ${
                          assigneeLeaveDetails?.delegateName ? "text-indigo-900 dark:text-indigo-200 border-indigo-300 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/30" : "text-slate-500 dark:text-slate-400"
                        }`}>
                          <span className="truncate font-semibold">
                            {assigneeLeaveDetails?.delegateName
                              ? assigneeLeaveDetails.delegateName
                              : activeDelegation?.delegateUser
                              ? `${activeDelegation.delegateUser.firstName} ${activeDelegation.delegateUser.lastName || ""}`.trim()
                              : "No Delegate"}
                          </span>
                          {assigneeLeaveDetails?.delegateName ? (
                            <span className="px-2 py-0.5 rounded-lg bg-indigo-600 text-white text-[10px] font-bold shrink-0 ml-2 shadow-2xs">
                              ↗ Active
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400 italic shrink-0 ml-2">None</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Leave Alert Banner (Full-Width Row below Assignee & Delegate) */}
                    {assigneeLeaveDetails && (
                      <div className="p-3 bg-amber-50/90 dark:bg-amber-950/40 border border-amber-300/80 dark:border-amber-800/60 rounded-xl text-amber-900 dark:text-amber-200 text-xs font-semibold space-y-2 animate-in fade-in duration-150">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                            <span className="font-bold">
                              On Leave: {assigneeLeaveDetails.formattedRange}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-amber-200/90 dark:bg-amber-900/70 text-amber-900 dark:text-amber-200 text-[10px] font-bold">
                              {assigneeLeaveDetails.leaveType}
                            </span>
                          </div>
                          {assigneeLeaveDetails.hasOverlap && (
                            <span className="px-2.5 py-0.5 rounded-lg bg-rose-600 text-white text-[10px] font-extrabold uppercase tracking-wide shadow-2xs">
                              Date Overlap
                            </span>
                          )}
                        </div>

                        {assigneeLeaveDetails.delegateName && (
                          <div className="pt-2 border-t border-amber-200/80 dark:border-amber-800/50 flex flex-wrap items-center justify-between gap-2 text-xs text-indigo-950 dark:text-indigo-200 font-medium">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] font-bold">
                                ↗ Task Delegate
                              </span>
                              <span className="font-bold text-indigo-800 dark:text-indigo-200">
                                {assigneeLeaveDetails.delegateName}
                              </span>
                              {assigneeLeaveDetails.delegateEmail && (
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                  ({assigneeLeaveDetails.delegateEmail})
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 font-semibold uppercase tracking-wider">
                              Active Task Delegation
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="h-px bg-slate-200/60 dark:bg-slate-800/80" />

                    {/* Row 2: Sprint, Estimation & Schedule */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-slate-500 dark:text-slate-400 font-bold text-[11px]">Sprint</label>
                          {draftSprintId && (
                            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                              {projectSprints.find((s) => s.id === draftSprintId)?.status === "ACTIVE"
                                ? "🟢 Active"
                                : projectSprints.find((s) => s.id === draftSprintId)?.status === "COMPLETED"
                                ? "✓ Done"
                                : "Planned"}
                            </span>
                          )}
                        </div>
                        <select
                          disabled={isViewer}
                          value={draftSprintId || ""}
                          onChange={(e) => {
                            setDraftSprintId(e.target.value || null);
                            setHasChanges(true);
                          }}
                          className={`w-full bg-white dark:bg-slate-900 font-semibold text-slate-800 dark:text-slate-200 p-2 rounded-xl border border-slate-300 dark:border-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-2xs text-xs ${
                            isViewer ? "cursor-not-allowed opacity-80" : "cursor-pointer"
                          }`}
                        >
                          <option value="">None (Product Backlog)</option>
                          {projectSprints.map((sp) => (
                            <option key={sp.id} value={sp.id}>
                              {sp.status === "ACTIVE" ? "🟢 " : sp.status === "COMPLETED" ? "✓ " : "⏳ "}
                              {sp.name} {sp.status === "ACTIVE" ? "(Active)" : sp.status === "COMPLETED" ? "(Completed)" : "(Planned)"}
                            </option>
                          ))}
                          {issue?.sprint && !projectSprints.some((s) => s.id === issue?.sprint?.id) && (
                            <option value={issue?.sprint?.id}>{issue?.sprint?.name}</option>
                          )}
                        </select>
                      </div>

                      <div>
                        <label className="block text-slate-500 dark:text-slate-400 font-bold text-[11px] mb-1.5">Story Points</label>
                        <input
                          type="number"
                          disabled={isViewer}
                          value={draftPoints}
                          placeholder="e.g. 3, 5, 8"
                          onChange={(e) => {
                            setDraftPoints(e.target.value);
                            setHasChanges(true);
                          }}
                          className={`w-full bg-white dark:bg-slate-900 font-semibold text-slate-800 dark:text-slate-200 p-2 rounded-xl border border-slate-300 dark:border-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-2xs text-xs ${
                            isViewer ? "cursor-not-allowed opacity-80" : ""
                          }`}
                        />
                      </div>

                      <div>
                        <label className="block text-slate-500 dark:text-slate-400 font-bold text-[11px] mb-1.5">
                          Start Date <span className="text-rose-500 font-bold">*</span>
                        </label>
                        <input
                          type="date"
                          required
                          disabled={isViewer}
                          value={draftStartDate}
                          onChange={(e) => {
                            setDraftStartDate(e.target.value);
                            setHasChanges(true);
                          }}
                          className={`w-full bg-white dark:bg-slate-900 font-semibold text-slate-800 dark:text-slate-200 p-2 rounded-xl border ${
                            !draftStartDate
                              ? "border-rose-400 dark:border-rose-600 ring-1 ring-rose-400/30"
                              : "border-slate-300 dark:border-slate-700"
                          } outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-2xs text-xs ${
                            isViewer ? "cursor-not-allowed opacity-80" : ""
                          }`}
                        />
                      </div>

                      <div>
                        <label className="block text-slate-500 dark:text-slate-400 font-bold text-[11px] mb-1.5">
                          Due Date <span className="text-rose-500 font-bold">*</span>
                        </label>
                        <input
                          type="date"
                          required
                          disabled={isViewer}
                          value={draftDueDate}
                          onChange={(e) => {
                            setDraftDueDate(e.target.value);
                            setHasChanges(true);
                          }}
                          className={`w-full bg-white dark:bg-slate-900 font-semibold text-slate-800 dark:text-slate-200 p-2 rounded-xl border ${
                            !draftDueDate || (draftStartDate && draftDueDate && draftDueDate < draftStartDate)
                              ? "border-rose-400 dark:border-rose-600 ring-1 ring-rose-400/30"
                              : "border-slate-300 dark:border-slate-700"
                          } outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-2xs text-xs ${
                            isViewer ? "cursor-not-allowed opacity-80" : ""
                          }`}
                        />
                        {draftStartDate && draftDueDate && draftDueDate < draftStartDate && (
                          <p className="text-[10px] text-rose-500 font-semibold mt-1">Due date cannot be earlier than start date</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Team assignment banner */}
                  {activeTeam && (
                    <div className="px-3.5 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/30 border border-blue-200/70 dark:border-blue-800/60 rounded-xl flex items-center justify-between text-xs text-blue-900 dark:text-blue-200 shadow-2xs">
                      <div className="flex items-center gap-2">
                        <div className="p-1 rounded-md bg-blue-600 text-white">
                          <Users className="w-3.5 h-3.5" />
                        </div>
                        <span>
                          Assigned to team <strong className="font-bold">{activeTeam.name}</strong>
                          {(activeTeam.members?.length || activeTeam._count?.members) > 0 && (
                            <span className="text-slate-500 dark:text-slate-400 ml-1">
                              ({activeTeam.members?.length || activeTeam._count?.members} {(activeTeam.members?.length || activeTeam._count?.members) === 1 ? "member" : "members"})
                            </span>
                          )}
                        </span>
                      </div>
                      <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1 bg-white dark:bg-slate-900 px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-800">
                        🔔 All members notified
                      </span>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Navigation Tabs */}
            <div className="flex border-b border-slate-300 dark:border-slate-800 gap-4 md:gap-6 text-xs font-semibold overflow-x-auto">
              <button
                onClick={() => setActiveTab("details")}
                className={`pb-2 transition-colors cursor-pointer shrink-0 ${
                  activeTab === "details" ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-400 hover:text-slate-700"
                }`}
              >
                Description
              </button>
              <button
                onClick={() => setActiveTab("subtasks")}
                className={`pb-2 transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === "subtasks" ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-400 hover:text-slate-700"
                }`}
              >
                <span>Subtasks</span>
                <span className="px-1.5 py-0.2 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px]">
                  {issue?.subtasks?.length || 0}
                </span>
              </button>
              <button
                onClick={() => setActiveTab("attachments")}
                className={`pb-2 transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === "attachments" ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-400 hover:text-slate-700"
                }`}
              >
                <span>Attachments</span>
                <span className="px-1.5 py-0.2 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px]">
                  {issue?.attachments?.length || 0}
                </span>
              </button>
              <button
                onClick={() => setActiveTab("deps")}
                className={`pb-2 transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === "deps" ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-400 hover:text-slate-700"
                }`}
              >
                <span>Dependencies</span>
                <span className="px-1.5 py-0.2 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px]">
                  {(issue?.incomingDeps?.length || 0) + (issue?.outgoingDeps?.length || 0)}
                </span>
              </button>
              <button
                onClick={() => setActiveTab("custom")}
                className={`pb-2 transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === "custom" ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-400 hover:text-slate-700"
                }`}
              >
                <span>Custom Fields</span>
                {customFields.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px]">
                    {customFields.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab("comments")}
                className={`pb-2 transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === "comments" ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-400 hover:text-slate-700"
                }`}
              >
                <span>Comments</span>
                <span className="px-1.5 py-0.2 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px]">
                  {issue?.comments?.length || 0}
                </span>
              </button>
              <button
                onClick={() => setActiveTab("time")}
                className={`pb-2 transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === "time" ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-400 hover:text-slate-700"
                }`}
              >
                <span>Time Tracking ({issue?.timeSpentHours || 0}h)</span>
              </button>
              <button
                onClick={() => setActiveTab("activity")}
                className={`pb-2 transition-colors cursor-pointer shrink-0 ${
                  activeTab === "activity" ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-400 hover:text-slate-700"
                }`}
              >
                History
              </button>
              <button
                onClick={() => setActiveTab("delegation")}
                className={`pb-2 transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === "delegation" ? "border-b-2 border-indigo-600 text-indigo-600 font-bold" : "text-slate-400 hover:text-slate-700"
                }`}
              >
                <span>Delegation</span>
                {issue?.delegations && issue.delegations.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold">
                    {issue?.delegations?.length || 0}
                  </span>
                )}
              </button>
            </div>

            {/* Create Mode Helper for child entity tabs */}
            {isCreateMode && activeTab !== "details" && (
              <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-2xl p-6 text-center space-y-3 my-4">
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/60 flex items-center justify-center mx-auto text-blue-600 dark:text-blue-400">
                  <CheckSquare className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">New Task in Progress</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">
                    Please fill in the task details on the <strong>Description</strong> tab and click <strong>Create Issue</strong> below. Once the task is created, subtasks, attachments, comments, dependencies, and time tracking will be active.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab("details")}
                  className="btn-primary px-4 py-2 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  Return to Description
                </button>
              </div>
            )}

            {/* TAB: Description */}
            {activeTab === "details" && (
              <div className="space-y-4">
                <textarea
                  value={draftDescription}
                  placeholder="Add a detailed description (supports Markdown headings, lists, checklists, and code)..."
                  onChange={(e) => {
                    setDraftDescription(e.target.value);
                    setHasChanges(true);
                  }}
                  rows={8}
                  className="w-full text-xs text-slate-800 dark:text-slate-200 bg-slate-50/50 dark:bg-slate-800/40 p-3 rounded-lg border border-slate-300 dark:border-slate-800 outline-none focus:border-blue-500 font-mono"
                />

                {/* Description helper text */}
                <div className="pt-1 text-[11px] text-slate-400">
                  Supports Markdown formatting, checklists, and code
                </div>

                {/* Git Integration & References section */}
                <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-lg border border-slate-300 dark:border-slate-800 text-xs">
                  <div className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200 mb-2">
                    <GitBranch className="w-4 h-4 text-purple-500" />
                    <span>Git Integration</span>
                  </div>
                  <p className="text-slate-500 text-[11px]">
                    Reference <code className="bg-slate-200 dark:bg-slate-700 px-1 py-0.5 rounded text-blue-600">{issue?.issueKey || "NEW TASK"}</code> in your commits, branches, or PRs to auto-link development activity.
                  </p>
                </div>
              </div>
            )}

            {/* TAB: Subtasks with Full Details */}
            {!isCreateMode && activeTab === "subtasks" && (
              <div className="space-y-4">
                {/* Subtask Progress Bar */}
                {issue?.subtasks && issue.subtasks.length > 0 && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-800 rounded-xl space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <CheckSquare className="w-3.5 h-3.5 text-blue-500" />
                        <span>Subtask Completion</span>
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">
                        {issue?.subtasks?.filter((s: any) => s.isCompleted).length} of {issue.subtasks.length} done (
                        {Math.round((issue.subtasks.filter((s: any) => s.isCompleted).length / issue.subtasks.length) * 100)}%)
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-300 rounded-full"
                        style={{
                          width: `${(issue.subtasks.filter((s: any) => s.isCompleted).length / issue.subtasks.length) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Add Subtask Form with optional details */}
                <form onSubmit={handleAddSubtask} className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-300 dark:border-slate-800 rounded-xl space-y-2.5">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={subtaskTitle}
                      onChange={(e) => setSubtaskTitle(e.target.value)}
                      placeholder="Add a new subtask..."
                      className="flex-1 text-xs px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSubtaskFormDetails(!showSubtaskFormDetails)}
                      className={`px-2.5 py-2 text-xs rounded-xl border flex items-center gap-1 transition-colors cursor-pointer ${
                        showSubtaskFormDetails
                          ? "bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-950/60 dark:border-blue-800 dark:text-blue-400 font-bold"
                          : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100"
                      }`}
                      title="Add details: Assignee, Priority, Estimate, Due Date"
                    >
                      <span>Details</span>
                      {showSubtaskFormDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                    <button type="submit" className="px-3.5 py-2 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-colors cursor-pointer shrink-0">
                      Add Subtask
                    </button>
                  </div>

                  {/* Expanded Subtask Fields */}
                  {showSubtaskFormDetails && (
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-300 dark:border-slate-700">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 block mb-1">Assignee</label>
                        <select
                          value={subtaskAssigneeId}
                          onChange={(e) => setSubtaskAssigneeId(e.target.value)}
                          className="w-full text-xs px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none"
                        >
                          <option value="">👤 Unassigned</option>
                          {projectMembers.map((m: any) => {
                            const u = m.user || m;
                            const name = `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email;
                            return (
                              <option key={u.id} value={u.id}>
                                {name}
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-400 block mb-1">Priority</label>
                        <select
                          value={subtaskPriority}
                          onChange={(e) => setSubtaskPriority(e.target.value)}
                          className="w-full text-xs px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none font-semibold"
                        >
                          <option value="CRITICAL">Critical</option>
                          <option value="HIGH">High</option>
                          <option value="MEDIUM">Medium</option>
                          <option value="LOW">Low</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-400 block mb-1">Estimate (Hours)</label>
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          placeholder="e.g. 2.5"
                          value={subtaskEstimateHours}
                          onChange={(e) => setSubtaskEstimateHours(e.target.value)}
                          className="w-full text-xs px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-400 block mb-1">Due Date</label>
                        <input
                          type="date"
                          value={subtaskDueDate}
                          onChange={(e) => setSubtaskDueDate(e.target.value)}
                          className="w-full text-xs px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none"
                        />
                      </div>
                    </div>
                  )}
                </form>

                {/* Subtask Items List */}
                <div className="space-y-2">
                  {(!issue?.subtasks || issue.subtasks.length === 0) ? (
                    <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-300 dark:border-slate-800 rounded-xl">
                      No subtasks added yet. Break this task into smaller actionable units above.
                    </div>
                  ) : (
                    issue?.subtasks?.map((sub: any) => {
                      const isEditing = editingSubtaskId === sub.id;

                      if (isEditing) {
                        return (
                          <div key={sub.id} className="p-3 bg-blue-50/40 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl space-y-2.5">
                            <input
                              type="text"
                              value={editSubtaskTitle}
                              onChange={(e) => setEditSubtaskTitle(e.target.value)}
                              className="w-full text-xs px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none font-semibold"
                            />
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              <div>
                                <label className="text-[10px] font-bold text-slate-400 block mb-0.5">Assignee</label>
                                <select
                                  value={editSubtaskAssigneeId}
                                  onChange={(e) => setEditSubtaskAssigneeId(e.target.value)}
                                  className="w-full text-xs px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none"
                                >
                                  <option value="">👤 Unassigned</option>
                                  {projectMembers.map((m: any) => {
                                    const u = m.user || m;
                                    const name = `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email;
                                    return (
                                      <option key={u.id} value={u.id}>{name}</option>
                                    );
                                  })}
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] font-bold text-slate-400 block mb-0.5">Priority</label>
                                <select
                                  value={editSubtaskPriority}
                                  onChange={(e) => setEditSubtaskPriority(e.target.value)}
                                  className="w-full text-xs px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none"
                                >
                                  <option value="CRITICAL">Critical</option>
                                  <option value="HIGH">High</option>
                                  <option value="MEDIUM">Medium</option>
                                  <option value="LOW">Low</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] font-bold text-slate-400 block mb-0.5">Hours</label>
                                <input
                                  type="number"
                                  step="0.5"
                                  value={editSubtaskEstimateHours}
                                  onChange={(e) => setEditSubtaskEstimateHours(e.target.value)}
                                  className="w-full text-xs px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-bold text-slate-400 block mb-0.5">Status</label>
                                <select
                                  value={editSubtaskStatus}
                                  onChange={(e) => setEditSubtaskStatus(e.target.value)}
                                  className="w-full text-xs px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none font-bold"
                                >
                                  <option value="TO_DO">TO_DO</option>
                                  <option value="IN_PROGRESS">IN_PROGRESS</option>
                                  <option value="DONE">DONE</option>
                                </select>
                              </div>
                            </div>
                            <div className="flex items-center justify-end gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => setEditingSubtaskId(null)}
                                className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveEditSubtask(sub.id)}
                                className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg cursor-pointer"
                              >
                                Save Details
                              </button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={sub.id}
                          className={`p-2.5 border rounded-xl flex items-center justify-between gap-3 transition-colors group ${
                            sub.isCompleted
                              ? "bg-slate-50/50 dark:bg-slate-900/30 border-slate-300 dark:border-slate-800/60"
                              : "bg-white dark:bg-slate-800/40 border-slate-300 dark:border-slate-700/80 hover:border-blue-400 dark:hover:border-blue-600"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 flex-1 min-w-0">
                            <input
                              type="checkbox"
                              checked={sub.isCompleted}
                              onChange={(e) => handleToggleSubtask(sub.id, e.target.checked)}
                              className="rounded text-blue-600 cursor-pointer w-4 h-4"
                            />
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-semibold truncate ${sub.isCompleted ? "line-through text-slate-400" : "text-slate-800 dark:text-slate-100"}`}>
                                {sub.title}
                              </p>
                              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                                {sub.assignee && (
                                  <span className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.2 rounded-md">
                                    <User className="w-2.5 h-2.5 text-blue-500" />
                                    <span>{sub.assignee.firstName || sub.assignee.email}</span>
                                  </span>
                                )}
                                {sub.priority && (
                                  <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-md ${
                                    sub.priority === "CRITICAL"
                                      ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                                      : sub.priority === "HIGH"
                                      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                                      : "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                                  }`}>
                                    {sub.priority}
                                  </span>
                                )}
                                {sub.estimateHours && (
                                  <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                                    <Clock className="w-2.5 h-2.5 text-slate-400" />
                                    <span>{sub.estimateHours}h</span>
                                  </span>
                                )}
                                {sub.dueDate && (
                                  <span className={`text-[10px] flex items-center gap-0.5 ${
                                    !sub.isCompleted && new Date(sub.dueDate) < new Date() ? "text-rose-600 font-bold" : "text-slate-400"
                                  }`}>
                                    <Calendar className="w-2.5 h-2.5" />
                                    <span>{new Date(sub.dueDate).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              sub.status === "DONE" || sub.isCompleted
                                ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
                                : sub.status === "IN_PROGRESS"
                                ? "bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300"
                                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                            }`}>
                              {sub.status || "TO_DO"}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleStartEditSubtask(sub)}
                              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-400 hover:text-blue-600 cursor-pointer"
                              title="Edit subtask details"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSubtask(sub.id)}
                              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-400 hover:text-rose-600 cursor-pointer"
                              title="Delete subtask"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* TAB: Attachments Upload & Preview */}
            {activeTab === "attachments" && (
              <div className="space-y-4">
                {/* Upload Zone */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 rounded-2xl p-6 text-center cursor-pointer bg-slate-50/50 dark:bg-slate-800/30 transition-all hover:bg-blue-50/30 dark:hover:bg-blue-950/20 group"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <div className="w-10 h-10 rounded-2xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform">
                    {isUploadingAttachment ? (
                      <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <UploadCloud className="w-5 h-5" />
                    )}
                  </div>
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    {isUploadingAttachment ? "Uploading Attachment..." : "Click to upload or drag & drop files"}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Images (PNG, JPG, SVG, WebP), PDFs, Documents, Archives up to 15MB
                  </p>
                </div>

                {/* Attachments List / Grid */}
                <div className="space-y-2">
                  {(!issue?.attachments || issue.attachments.length === 0) ? (
                    <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-300 dark:border-slate-800 rounded-xl">
                      No files attached to this task yet.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {issue?.attachments?.map((att: any) => {
                        const isImage = att.mimeType?.startsWith("image/") || att.fileUrl?.startsWith("data:image");
                        return (
                          <div
                            key={att.id}
                            className="p-3 bg-white dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700/80 rounded-2xl flex flex-col justify-between gap-2.5 shadow-2xs hover:shadow-md transition-all group"
                          >
                            <div className="flex items-start gap-3">
                              {/* Thumbnail / File Icon */}
                              {isImage ? (
                                <div
                                  onClick={() => setPreviewAttachment(att)}
                                  className="w-12 h-12 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-900 shrink-0 border border-slate-300 dark:border-slate-700 cursor-pointer relative group/img"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={att.fileUrl}
                                    alt={att.fileName}
                                    className="w-full h-full object-cover group-hover/img:scale-105 transition-transform"
                                  />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 flex items-center justify-center text-white transition-opacity">
                                    <Eye className="w-4 h-4" />
                                  </div>
                                </div>
                              ) : (
                                <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 border border-blue-200 dark:border-blue-900/60">
                                  {att.mimeType?.includes("pdf") ? (
                                    <FileText className="w-6 h-6 text-rose-500" />
                                  ) : (
                                    <File className="w-6 h-6 text-blue-500" />
                                  )}
                                </div>
                              )}

                              {/* Details */}
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate" title={att.fileName}>
                                  {att.fileName}
                                </p>
                                <p className="text-[10px] text-slate-400 mt-0.5">
                                  {formatFileSize(att.fileSize)} • {new Date(att.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                                </p>
                                {att.uploader && (
                                  <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                    by {att.uploader.firstName} {att.uploader.lastName || ""}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex items-center justify-between pt-2 border-t border-slate-300 dark:border-slate-700/60 text-xs">
                              {isImage ? (
                                <button
                                  type="button"
                                  onClick={() => setPreviewAttachment(att)}
                                  className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1 cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Preview</span>
                                </button>
                              ) : (
                                <a
                                  href={sanitizeUrl(att.fileUrl)}
                                  download={att.fileName}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1 cursor-pointer"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  <span>Open</span>
                                </a>
                              )}

                              <div className="flex items-center gap-1">
                                <a
                                  href={sanitizeUrl(att.fileUrl)}
                                  download={att.fileName}
                                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-400 hover:text-blue-600 cursor-pointer"
                                  title="Download file"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </a>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteAttachment(att.id)}
                                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-400 hover:text-rose-600 cursor-pointer"
                                  title="Delete attachment"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB: Comments */}
            {activeTab === "comments" && (
              <div className="space-y-4">
                <form onSubmit={handleAddComment} className="space-y-2">
                  <textarea
                    value={commentContent}
                    onChange={(e) => setCommentContent(e.target.value)}
                    placeholder="Write a comment... use @mention to notify teammates"
                    rows={3}
                    className="w-full text-xs p-3 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg outline-none"
                  />
                  <button type="submit" className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center gap-1.5">
                    <Send className="w-3.5 h-3.5" />
                    <span>Send Comment</span>
                  </button>
                </form>

                <div className="space-y-3 pt-2">
                  {issue?.comments?.map((c: any) => (
                    <div key={c.id} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-xs space-y-1 border border-slate-300 dark:border-slate-800">
                      <div className="flex items-center justify-between text-slate-400 text-[10px]">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {c.user?.firstName} {c.user?.lastName}
                        </span>
                        <span>{new Date(c.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{c.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB: Dependencies & Linked Issues */}
            {activeTab === "deps" && (
              <div className="space-y-5">
                {/* Add dependency form */}
                <form onSubmit={handleAddDependency} className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-300 dark:border-slate-800 space-y-3">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Link Related / Blocking Issue</span>
                  {depError && (
                    <div className="text-[11px] text-red-500 font-medium">{depError}</div>
                  )}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      value={depType}
                      onChange={(e) => setDepType(e.target.value)}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold"
                    >
                      <option value="BLOCKS">blocks</option>
                      <option value="BLOCKED_BY">is blocked by</option>
                      <option value="RELATES_TO">relates to</option>
                      <option value="DUPLICATES">duplicates</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Issue Key (e.g. CP-2)"
                      value={depTargetKey}
                      onChange={(e) => setDepTargetKey(e.target.value.toUpperCase())}
                      className="flex-1 text-xs px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none font-mono"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shrink-0"
                    >
                      Link Issue
                    </button>
                  </div>
                </form>

                {/* Outgoing Dependencies */}
                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Outgoing Links ({issue.outgoingDeps?.length || 0})</span>
                  {(!issue?.outgoingDeps || issue.outgoingDeps.length === 0) ? (
                    <p className="text-xs text-slate-400 italic">No outgoing dependencies</p>
                  ) : (
                    <div className="space-y-1.5">
                      {issue?.outgoingDeps?.map((dep: any) => (
                        <div key={dep.id} className="p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-300 dark:border-slate-800 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-mono font-bold text-[10px]">
                              {dep.type}
                            </span>
                            <span className={`font-mono font-semibold ${isIssueDone(dep.targetIssue) ? "line-through text-blue-600/70 dark:text-blue-400/70 decoration-blue-600" : "text-blue-600 dark:text-blue-400"}`}>{dep.targetIssue?.issueKey}</span>
                            <span className="text-slate-700 dark:text-slate-300 truncate max-w-xs">{dep.targetIssue?.title}</span>
                          </div>
                          <button
                            onClick={() => handleRemoveDependency(dep.id)}
                            className="p-1 text-slate-400 hover:text-red-500 rounded"
                            title="Remove link"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Incoming Dependencies */}
                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Incoming Links ({issue.incomingDeps?.length || 0})</span>
                  {(!issue?.incomingDeps || issue.incomingDeps.length === 0) ? (
                    <p className="text-xs text-slate-400 italic">No incoming dependencies</p>
                  ) : (
                    <div className="space-y-1.5">
                      {issue?.incomingDeps?.map((dep: any) => (
                        <div key={dep.id} className="p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-300 dark:border-slate-800 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-mono font-bold text-[10px]">
                              {dep.type}
                            </span>
                            <span className={`font-mono font-semibold ${isIssueDone(dep.sourceIssue) ? "line-through text-blue-600/70 dark:text-blue-400/70 decoration-blue-600" : "text-blue-600 dark:text-blue-400"}`}>{dep.sourceIssue?.issueKey}</span>
                            <span className="text-slate-700 dark:text-slate-300 truncate max-w-xs">{dep.sourceIssue?.title}</span>
                          </div>
                          <button
                            onClick={() => handleRemoveDependency(dep.id)}
                            className="p-1 text-slate-400 hover:text-red-500 rounded"
                            title="Remove link"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB: Custom Fields */}
            {activeTab === "custom" && (
              <div className="space-y-4">
                {/* Header & Add Button */}
                <div className="flex items-center justify-between pb-2 border-b border-slate-300 dark:border-slate-800">
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Project Custom Fields
                    </span>
                    <span className="text-[11px] text-slate-400 block">
                      Define project-wide attributes like client names, build versions, or custom metadata
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCreateFieldModal(!showCreateFieldModal)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{showCreateFieldModal ? "Close Form" : "Add Custom Field"}</span>
                  </button>
                </div>

                {/* Inline Field Creation Card */}
                {showCreateFieldModal && (
                  <form
                    onSubmit={handleCreateCustomField}
                    className="p-4 bg-blue-50/60 dark:bg-slate-800/80 border border-blue-200 dark:border-blue-900 rounded-xl space-y-3 animate-in fade-in zoom-in-95 duration-150"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">Create New Custom Field</span>
                      <span className="text-[10px] text-slate-400">Available across all issues in this project</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                          Field Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={newFieldName}
                          onChange={(e) => setNewFieldName(e.target.value)}
                          placeholder="e.g. Release Version, Client Name, QA URL"
                          className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                          Field Type
                        </label>
                        <select
                          value={newFieldType}
                          onChange={(e: any) => setNewFieldType(e.target.value)}
                          className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                        >
                          <option value="TEXT">Text (Single line / String)</option>
                          <option value="NUMBER">Number (Integer / Decimal)</option>
                          <option value="DATE">Date (Calendar picker)</option>
                          <option value="DROPDOWN">Dropdown (Select list)</option>
                          <option value="CHECKBOX">Checkbox (Yes / No)</option>
                          <option value="URL">URL / Web Link</option>
                        </select>
                      </div>
                    </div>

                    {newFieldType === "DROPDOWN" && (
                      <div>
                        <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                          Dropdown Options (Comma separated)
                        </label>
                        <input
                          type="text"
                          value={newFieldOptions}
                          onChange={(e) => setNewFieldOptions(e.target.value)}
                          placeholder="e.g. Alpha, Beta, RC1, Production"
                          className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={newFieldRequired}
                          onChange={(e) => setNewFieldRequired(e.target.checked)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span>Required field</span>
                      </label>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setShowCreateFieldModal(false)}
                          className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={creatingField || !newFieldName.trim()}
                          className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg text-xs shadow-xs"
                        >
                          {creatingField ? "Creating..." : "Save Field"}
                        </button>
                      </div>
                    </div>
                  </form>
                )}

                {/* Fields List */}
                {customFields.length === 0 ? (
                  <div className="py-12 border-2 border-dashed border-slate-300 dark:border-slate-800 rounded-2xl flex flex-col items-center justify-center text-center p-6 space-y-3">
                    <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-950 text-blue-600 flex items-center justify-center">
                      <Tag className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">No custom fields defined yet</p>
                      <p className="text-[11px] text-slate-400 max-w-sm mt-0.5">
                        Add custom fields to track extra metadata such as QA links, customer accounts, release tags, or budgets.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowCreateFieldModal(true)}
                      className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs"
                    >
                      + Create First Custom Field
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {customFields.map((cf) => {
                      const val = customFieldValues[cf.id] ?? "";
                      let options: any[] = [];
                      if (cf.optionsJson) {
                        try {
                          const parsed = JSON.parse(cf.optionsJson);
                          options = Array.isArray(parsed) ? parsed : [];
                        } catch (e) {}
                      }

                      return (
                        <div key={cf.id} className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-300 dark:border-slate-800 space-y-1.5 text-xs group relative">
                          <div className="flex items-center justify-between">
                            <label className="font-semibold text-slate-700 dark:text-slate-300 block">
                              {cf.name} {cf.isRequired && <span className="text-red-500">*</span>}
                              <span className="ml-1.5 text-[10px] text-slate-400 font-normal">({cf.fieldType.toLowerCase()})</span>
                            </label>
                            <button
                              type="button"
                              onClick={() => handleDeleteCustomField(cf.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-opacity rounded"
                              title="Delete custom field"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {cf.fieldType === "DROPDOWN" && options.length > 0 ? (
                            <select
                              value={val}
                              onChange={(e) => handleSaveCustomFieldValue(cf.id, e.target.value, cf.fieldType)}
                              className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-1 focus:ring-blue-500"
                            >
                              <option value="">Select option...</option>
                              {options.map((opt: any, idx: number) => {
                                const optValue = typeof opt === "object" && opt !== null ? (opt.value ?? opt.label ?? String(opt)) : String(opt);
                                const optLabel = typeof opt === "object" && opt !== null ? (opt.label ?? opt.value ?? String(opt)) : String(opt);
                                return (
                                  <option key={`${cf.id}-opt-${idx}-${optValue}`} value={optValue}>
                                    {optLabel}
                                  </option>
                                );
                              })}
                            </select>
                          ) : cf.fieldType === "NUMBER" ? (
                            <input
                              type="number"
                              defaultValue={val}
                              onBlur={(e) => handleSaveCustomFieldValue(cf.id, e.target.value, cf.fieldType)}
                              placeholder="Enter number..."
                              className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          ) : cf.fieldType === "DATE" ? (
                            <input
                              type="date"
                              defaultValue={val ? new Date(val).toISOString().split("T")[0] : ""}
                              onChange={(e) => handleSaveCustomFieldValue(cf.id, e.target.value, cf.fieldType)}
                              className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          ) : cf.fieldType === "CHECKBOX" ? (
                            <div className="pt-1">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={val === "true" || val === true}
                                  onChange={(e) => handleSaveCustomFieldValue(cf.id, e.target.checked, cf.fieldType)}
                                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-slate-600 dark:text-slate-300 text-xs">Enabled</span>
                              </label>
                            </div>
                          ) : (
                            <input
                              type={cf.fieldType === "URL" ? "url" : "text"}
                              defaultValue={val}
                              onBlur={(e) => handleSaveCustomFieldValue(cf.id, e.target.value, cf.fieldType)}
                              placeholder={cf.fieldType === "URL" ? "https://..." : `Enter ${cf.name}...`}
                              className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB: Time Tracking */}
            {activeTab === "time" && (
              <div className="space-y-5">
                {/* Live Timer Widget */}
                <div className="p-4 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold uppercase text-blue-600 dark:text-blue-400">Live Work Timer</span>
                    <p className="text-2xl font-mono font-bold text-slate-800 dark:text-white mt-0.5">
                      {Math.floor(timerSeconds / 3600).toString().padStart(2, "0")}:
                      {Math.floor((timerSeconds % 3600) / 60).toString().padStart(2, "0")}:
                      {(timerSeconds % 60).toString().padStart(2, "0")}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {!isTimerRunning ? (
                      <button
                        onClick={() => setIsTimerRunning(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Start</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setIsTimerRunning(false);
                          const mins = Math.max(1, Math.round(timerSeconds / 60));
                          handleLogTime(mins, "Logged from live timer");
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700"
                      >
                        <Square className="w-3.5 h-3.5 fill-current" />
                        <span>Stop & Save</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Manual Log */}
                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Log Time Manually</span>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={timeMinutes}
                      onChange={(e) => setTimeMinutes(e.target.value)}
                      placeholder="Minutes (e.g. 60)"
                      className="w-36 text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg outline-none"
                    />
                    <input
                      type="text"
                      value={timeNotes}
                      onChange={(e) => setTimeNotes(e.target.value)}
                      placeholder="Work description..."
                      className="flex-1 text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg outline-none"
                    />
                    <button
                      onClick={() => handleLogTime(Number(timeMinutes), timeNotes)}
                      className="px-3 py-2 bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 rounded-lg text-xs font-semibold hover:opacity-90"
                    >
                      Log
                    </button>
                  </div>
                </div>

                {/* Time log history */}
                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Time Entries</span>
                  <div className="space-y-1.5 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {issue?.timeEntries?.map((entry: any) => (
                      <div key={entry.id} className="pt-1.5 flex justify-between items-center text-slate-600 dark:text-slate-300">
                        <div>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{entry.user?.firstName}: </span>
                          <span>{entry.description || "Work logged"}</span>
                        </div>
                        <span className="font-mono font-bold text-blue-600">{(entry.durationMinutes / 60).toFixed(1)}h</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB: Activity History */}
            {activeTab === "activity" && (() => {
              const logs = (issue?.activityLogs || []).filter((act: any) => {
                const f = act.fieldChanged || act.field;
                if (activityFilter === "CHANGES") return f || act.actionType === "STATUS_CHANGED" || act.actionType === "ASSIGNED" || act.actionType === "PRIORITY_CHANGED";
                if (activityFilter === "COMMENTS") return act.actionType?.includes("COMMENT");
                return true;
              });

              return (
                <div className="space-y-4">
                  {/* Filter Sub-header */}
                  <div className="flex items-center justify-between pb-2 border-b border-slate-300 dark:border-slate-800">
                    <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-lg text-xs">
                      <button
                        onClick={() => setActivityFilter("ALL")}
                        className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                          activityFilter === "ALL"
                            ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs"
                            : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                        }`}
                      >
                        All History ({issue?.activityLogs?.length || 0})
                      </button>
                      <button
                        onClick={() => setActivityFilter("CHANGES")}
                        className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                          activityFilter === "CHANGES"
                            ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs"
                            : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                        }`}
                      >
                        Field Diffs
                      </button>
                      <button
                        onClick={() => setActivityFilter("COMMENTS")}
                        className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                          activityFilter === "COMMENTS"
                            ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs"
                            : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                        }`}
                      >
                        Comments
                      </button>
                    </div>

                    <span className="text-[11px] text-slate-400">
                      Audit Trail
                    </span>
                  </div>

                  {/* Changelog Timeline */}
                  {logs.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">
                      No activity recorded yet for this issue.
                    </div>
                  ) : (
                    <div className="space-y-3 relative before:absolute before:inset-0 before:left-3 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
                      {logs.map((act: any) => {
                        const actorInitials = act.actor?.firstName?.[0] || "U";
                        const rawField = act.fieldChanged || act.field;
                        const isFieldDiff = !!rawField;
                        const formattedField = rawField
                          ? rawField.charAt(0).toUpperCase() + rawField.slice(1).replace(/([A-Z])/g, " $1")
                          : null;

                        return (
                          <div key={act.id} className="flex items-start gap-3 relative z-10 text-xs">
                            <div className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-[10px] flex items-center justify-center shrink-0 ring-4 ring-white dark:ring-slate-900">
                              {actorInitials}
                            </div>
                            <div className="flex-1 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-300 dark:border-slate-800 space-y-1">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="font-semibold text-slate-900 dark:text-white">
                                  {act.actor?.firstName} {act.actor?.lastName || ""}
                                </span>
                                <span className="text-slate-400">
                                  {new Date(act.timestamp).toLocaleString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>

                              {isFieldDiff ? (
                                <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-slate-700 dark:text-slate-300">
                                  <span>updated</span>
                                  <span className="font-bold text-slate-900 dark:text-white bg-slate-200 dark:bg-slate-700 px-1.5 py-0.2 rounded text-[11px]">
                                    {formattedField}
                                  </span>
                                  {act.oldValue && (
                                    <>
                                      <span className="line-through text-slate-400 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 px-1.5 py-0.2 rounded text-[11px]">
                                        {act.oldValue}
                                      </span>
                                      <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                                    </>
                                  )}
                                  <span className="font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 dark:text-emerald-300 px-1.5 py-0.2 rounded text-[11px]">
                                    {act.newValue || "(empty)"}
                                  </span>
                                </div>
                              ) : (
                                <div className="text-slate-600 dark:text-slate-300 pt-0.5">
                                  <span>{act.actionType}</span>
                                  {act.newValue && (
                                    <span className="ml-1 font-medium text-blue-600 dark:text-blue-400">
                                      "{act.newValue}"
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* TAB: Task Delegation History & Details */}
            {activeTab === "delegation" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-300 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                      Task Delegation Audit & History
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    Permanent Record (Original Assignee Intact)
                  </span>
                </div>

                {!issue?.delegations || issue.delegations.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 text-xs italic bg-slate-50/50 dark:bg-slate-800/30 rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-6 space-y-2">
                    <div className="w-10 h-10 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-600 flex items-center justify-center mx-auto text-base">
                      ↗
                    </div>
                    <p className="font-semibold text-slate-700 dark:text-slate-300">No delegations recorded for this task</p>
                    <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                      When an assignee goes on leave and chooses to delegate work, temporary delegation records and audit history will appear here.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {issue?.delegations?.map((del: any) => {
                      const isActive = isDelegationActive(del) && del.status === "ACTIVE";
                      return (
                        <div
                          key={del.id}
                          className={`p-4 rounded-2xl border space-y-3 ${
                            isActive
                              ? "bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-800 ring-1 ring-indigo-500/20"
                              : "bg-slate-50/70 dark:bg-slate-800/40 border-slate-300 dark:border-slate-800"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                  isActive
                                    ? "bg-indigo-600 text-white"
                                    : del.status === "ENDED"
                                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300"
                                    : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                                }`}
                              >
                                {isActive ? "↗ Active Delegation" : del.status}
                              </span>
                              <span className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-400">
                                {new Date(del.startDate).toLocaleDateString()} — {new Date(del.endDate).toLocaleDateString()}
                              </span>
                            </div>

                            {del.leave && (
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                Leave: {del.leave.type || "Leave"}
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 block uppercase">Original Assignee</span>
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                {del.originalAssignee?.firstName} {del.originalAssignee?.lastName || ""}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 block uppercase">Temporary Delegate</span>
                              <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                                {del.delegateUser?.firstName} {del.delegateUser?.lastName || ""}
                              </span>
                            </div>
                          </div>

                          {del.notes && (
                            <p className="text-xs text-slate-600 dark:text-slate-300 italic bg-slate-100/70 dark:bg-slate-800/60 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                              "{del.notes}"
                            </p>
                          )}

                          {/* Audit Timeline */}
                          {del.histories && del.histories.length > 0 && (
                            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                                Audit Timeline ({del.histories.length})
                              </span>
                              <div className="space-y-1.5">
                                {del.histories.map((h: any) => (
                                  <div key={h.id} className="text-[11px] flex items-center justify-between text-slate-600 dark:text-slate-400 bg-white/60 dark:bg-slate-900/60 px-2.5 py-1.5 rounded-lg border border-slate-200/80 dark:border-slate-800">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-bold text-indigo-600 dark:text-indigo-400">{h.action}</span>
                                      <span>by {h.actor?.firstName || "System"}</span>
                                    </div>
                                    <span className="text-[10px] font-mono text-slate-400">
                                      {new Date(h.timestamp).toLocaleString()}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Sticky Modal Footer with Save and Cancel Auto-Close Options */}
        {issue && (
          <div className="border-t border-slate-300 dark:border-slate-800 px-6 py-3.5 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-xs flex items-center justify-between shrink-0 shadow-lg">
            <div className="flex items-center gap-2 text-xs">
              {isCreateMode ? (
                <span className="text-blue-600 dark:text-blue-400 font-semibold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  New task — fill in details
                </span>
              ) : hasChanges ? (
                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  Unsaved changes
                </span>
              ) : (
                <span className="text-slate-400 dark:text-slate-500 font-medium flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  All fields up to date
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 w-full justify-between">
              <div>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={isDeleting}
                    className="px-3.5 py-2 text-xs font-bold rounded-xl border border-rose-300 dark:border-rose-800/80 bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-900/70 text-rose-600 dark:text-rose-400 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    title="Permanently delete this issue"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                    <span>Delete Issue</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCancelAndClose}
                  className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-all shadow-xs cursor-pointer"
                >
                  Cancel
                </button>
                {isViewer ? (
                  <span className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-200 dark:border-slate-800">
                    Read Only (Viewer)
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={handleSaveAndClose}
                    className="px-5 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-500/25 disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>{isSaving ? "Saving..." : "Save & Close"}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Add Project Status Modal (Project-Wide Option) */}
        {showAddStatusModal && (
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[60] p-4 animate-in fade-in duration-150"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowAddStatusModal(false);
            }}
          >
            <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-slate-300 dark:border-slate-800 p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Add Project Status</h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                      Project-Wide
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Adds a new workflow status to this project. Applicable and selectable for all tasks on this project.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddStatusModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateProjectStatus} className="space-y-3.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    Status Name *
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={newStatusName}
                    onChange={(e) => setNewStatusName(e.target.value)}
                    placeholder="e.g. Blocked, Ready for Release, UAT, Review"
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      Workflow Category
                    </label>
                    <select
                      value={newStatusCategory}
                      onChange={(e) => setNewStatusCategory(e.target.value)}
                      className="w-full text-xs p-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                    >
                      <option value="BACKLOG">Backlog</option>
                      <option value="TO_DO">To Do</option>
                      <option value="IN_PROGRESS">In Progress</option>
                      <option value="REVIEW">Code Review</option>
                      <option value="TESTING">QA Testing</option>
                      <option value="DONE">Done</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      Status Color
                    </label>
                    <div className="flex items-center gap-1.5 pt-1">
                      {["#3b82f6", "#6366f1", "#8b5cf6", "#f59e0b", "#f43f5e", "#10b981", "#06b6d4", "#64748b"].map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setNewStatusColor(c)}
                          className={`w-5 h-5 rounded-full transition-transform cursor-pointer ${
                            newStatusColor === c ? "scale-125 ring-2 ring-offset-1 ring-blue-500" : "hover:scale-110"
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Live Preview */}
                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-300 dark:border-slate-800 flex items-center justify-between text-xs">
                  <span className="text-slate-400 text-[11px]">Badge Preview:</span>
                  <span
                    className="px-2.5 py-1 rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-2xs"
                    style={{ backgroundColor: `${newStatusColor}20`, color: newStatusColor }}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: newStatusColor }} />
                    {newStatusName.trim() || "Status Preview"}
                  </span>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddStatusModal(false)}
                    className="px-3.5 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreatingStatus || !newStatusName.trim()}
                    className="px-4 py-1.5 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 cursor-pointer shadow-xs shadow-blue-500/30"
                  >
                    {isCreatingStatus ? "Adding..." : "Add Status to Project"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Issue Types Management & CRUD Modal (Project-Wide) */}
        {showAddTypeModal && (
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[65] p-4 animate-in fade-in duration-150"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowAddTypeModal(false);
                setEditingType(null);
              }
            }}
          >
            <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl border border-slate-300 dark:border-slate-800 p-5 space-y-4 max-h-[90vh] flex flex-col">
              <div className="flex items-start justify-between shrink-0">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Issue Types Control Panel</h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                      Project-Wide
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Add custom types, update badge styling, and manage work item categories for this project.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddTypeModal(false);
                    setEditingType(null);
                  }}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Tabs */}
              <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setTypeModalTab("ADD");
                    setEditingType(null);
                  }}
                  className={`px-3 py-2 text-xs font-bold border-b-2 -mb-px transition-colors cursor-pointer ${
                    typeModalTab === "ADD" && !editingType
                      ? "border-blue-600 text-blue-600 dark:text-blue-400"
                      : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  + Add New Type
                </button>
                <button
                  type="button"
                  onClick={() => setTypeModalTab("MANAGE")}
                  className={`px-3 py-2 text-xs font-bold border-b-2 -mb-px transition-colors cursor-pointer ${
                    typeModalTab === "MANAGE" || editingType
                      ? "border-blue-600 text-blue-600 dark:text-blue-400"
                      : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  Manage & Edit Types ({projectTypes.length})
                </button>
              </div>

              {/* Tab 1: Add New Type */}
              {typeModalTab === "ADD" && !editingType && (
                <form onSubmit={handleCreateProjectType} className="space-y-3.5 overflow-y-auto pr-1">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      Type Name *
                    </label>
                    <input
                      type="text"
                      required
                      autoFocus
                      value={newTypeName}
                      onChange={(e) => setNewTypeName(e.target.value)}
                      placeholder="e.g. Research, Spike, Design, Maintenance, Security"
                      className="w-full text-xs p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      Color Badge Theme
                    </label>
                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      {["#6366f1", "#0ea5e9", "#f43f5e", "#10b981", "#a855f7", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#64748b"].map(
                        (c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setNewTypeColor(c)}
                            className={`w-6 h-6 rounded-full transition-transform cursor-pointer ${
                              newTypeColor === c ? "scale-125 ring-2 ring-offset-1 ring-blue-500" : "hover:scale-110"
                            }`}
                            style={{ backgroundColor: c }}
                          />
                        )
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      Description (Optional)
                    </label>
                    <input
                      type="text"
                      value={newTypeDescription}
                      onChange={(e) => setNewTypeDescription(e.target.value)}
                      placeholder="What work items does this type categorize?"
                      className="w-full text-xs p-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 outline-none"
                    />
                  </div>

                  {/* Live Preview */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-300 dark:border-slate-800 flex items-center justify-between text-xs">
                    <span className="text-slate-400 text-[11px]">Badge Preview:</span>
                    <span
                      className="px-2.5 py-1 rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-2xs uppercase tracking-wider"
                      style={{ backgroundColor: `${newTypeColor}20`, color: newTypeColor }}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: newTypeColor }} />
                      {newTypeName.trim() || "TYPE PREVIEW"}
                    </span>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowAddTypeModal(false)}
                      className="px-3.5 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingType || !newTypeName.trim()}
                      className="px-4 py-1.5 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 cursor-pointer shadow-xs shadow-blue-500/30"
                    >
                      {isSubmittingType ? "Creating..." : "Add Type to Project"}
                    </button>
                  </div>
                </form>
              )}

              {/* Tab 2: Manage / Edit & Delete Types */}
              {(typeModalTab === "MANAGE" || editingType) && (
                <div className="space-y-4 overflow-y-auto flex-1 pr-1">
                  {editingType ? (
                    <form onSubmit={handleUpdateProjectType} className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-blue-200 dark:border-blue-900 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-blue-600 dark:text-blue-400">
                          Editing Type: {editingType.name} ({editingType.value})
                        </h4>
                        <button
                          type="button"
                          onClick={() => setEditingType(null)}
                          className="text-[11px] text-slate-400 hover:underline"
                        >
                          Cancel Edit
                        </button>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">Display Name</label>
                        <input
                          type="text"
                          required
                          value={editTypeName}
                          onChange={(e) => setEditTypeName(e.target.value)}
                          className="w-full text-xs p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-300 dark:border-slate-700 outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">Badge Color</label>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {["#6366f1", "#0ea5e9", "#f43f5e", "#10b981", "#a855f7", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#64748b"].map(
                            (c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => setEditTypeColor(c)}
                                className={`w-5 h-5 rounded-full transition-transform cursor-pointer ${
                                  editTypeColor === c ? "scale-125 ring-2 ring-offset-1 ring-blue-500" : "hover:scale-110"
                                }`}
                                style={{ backgroundColor: c }}
                              />
                            )
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">Description</label>
                        <input
                          type="text"
                          value={editTypeDescription}
                          onChange={(e) => setEditTypeDescription(e.target.value)}
                          className="w-full text-xs p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-300 dark:border-slate-700 outline-none"
                        />
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setEditingType(null)}
                          className="px-3 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={isSubmittingType || !editTypeName.trim()}
                          className="px-3 py-1 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
                        >
                          {isSubmittingType ? "Saving..." : "Save Changes"}
                        </button>
                      </div>
                    </form>
                  ) : null}

                  <div className="space-y-2">
                    {projectTypes.map((t) => (
                      <div
                        key={t.value}
                        className="p-3 bg-white dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shadow-2xs hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shrink-0 flex items-center gap-1.5 shadow-2xs"
                            style={{ backgroundColor: `${t.color || "#6366f1"}20`, color: t.color || "#6366f1" }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: t.color || "#6366f1" }} />
                            {t.name || t.value}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                              {t.name || t.value}{" "}
                              <span className="font-mono text-[10px] text-slate-400">({t.value})</span>
                            </p>
                            {t.description && (
                              <p className="text-[11px] text-slate-400 truncate">{t.description}</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingType(t);
                              setEditTypeName(t.name || t.value);
                              setEditTypeColor(t.color || "#6366f1");
                              setEditTypeDescription(t.description || "");
                            }}
                            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 hover:text-blue-600 transition-colors cursor-pointer"
                            title="Edit Type"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteProjectType(t.value)}
                            className="p-1.5 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                            title="Delete Type (Migrates issues to TASK)"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Add Project Priority Modal (Project-Wide Option) */}
        {showAddPriorityModal && (
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[60] p-4 animate-in fade-in duration-150"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowAddPriorityModal(false);
            }}
          >
            <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-slate-300 dark:border-slate-800 p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Add Project Priority</h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300">
                      Project-Wide
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Adds a custom priority option to this project. Applicable and selectable for all tasks on this project.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddPriorityModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateProjectPriority} className="space-y-3.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    Priority Name *
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={newPriorityName}
                    onChange={(e) => setNewPriorityName(e.target.value)}
                    placeholder="e.g. Blocker, Urgent, P0 - Blocker, Nice to Have"
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    Priority Color
                  </label>
                  <div className="flex items-center gap-1.5 pt-1">
                    {["#f43f5e", "#f97316", "#f59e0b", "#8b5cf6", "#3b82f6", "#10b981", "#06b6d4", "#64748b"].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewPriorityColor(c)}
                        className={`w-5 h-5 rounded-full transition-transform cursor-pointer ${
                          newPriorityColor === c ? "scale-125 ring-2 ring-offset-1 ring-purple-500" : "hover:scale-110"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>

                {/* Live Preview */}
                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-300 dark:border-slate-800 flex items-center justify-between text-xs">
                  <span className="text-slate-400 text-[11px]">Badge Preview:</span>
                  <span
                    className="px-2.5 py-1 rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-2xs"
                    style={{ backgroundColor: `${newPriorityColor}20`, color: newPriorityColor }}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: newPriorityColor }} />
                    {newPriorityName.trim() || "Priority Preview"}
                  </span>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddPriorityModal(false)}
                    className="px-3.5 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreatingPriority || !newPriorityName.trim()}
                    className="px-4 py-1.5 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 cursor-pointer shadow-xs shadow-purple-500/30"
                  >
                    {isCreatingPriority ? "Adding..." : "Add Priority to Project"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Add / Manage Project Epic Modal (Project-Wide Option) */}
        {showAddEpicModal && (
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[60] p-4 animate-in fade-in duration-150"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowAddEpicModal(false);
            }}
          >
            <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl border border-slate-300 dark:border-slate-800 p-5 space-y-4 max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-150">
              <div className="flex items-start justify-between shrink-0">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-purple-100 dark:bg-purple-950/70 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                      <Zap className="w-3.5 h-3.5" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Project Epics</h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300">
                      Project-Wide
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Manage overarching initiatives and milestones. Epics are shared across all issues in this project.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddEpicModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Navigation Tabs */}
              <div className="flex border-b border-slate-200 dark:border-slate-800 gap-4 shrink-0 text-xs">
                <button
                  type="button"
                  onClick={() => setEpicModalTab("CREATE")}
                  className={`pb-2 font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                    epicModalTab === "CREATE"
                      ? "border-purple-600 text-purple-600 dark:text-purple-400"
                      : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Epic</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEpicModalTab("MANAGE")}
                  className={`pb-2 font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                    epicModalTab === "MANAGE"
                      ? "border-purple-600 text-purple-600 dark:text-purple-400"
                      : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  <span>Manage Epics</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono">
                    {projectEpics.length}
                  </span>
                </button>
              </div>

              {epicModalTab === "CREATE" ? (
                <form onSubmit={handleCreateProjectEpic} className="space-y-3.5 overflow-y-auto pr-1 flex-1">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      Epic Name *
                    </label>
                    <input
                      type="text"
                      required
                      autoFocus
                      value={newEpicName}
                      onChange={(e) => setNewEpicName(e.target.value)}
                      placeholder="e.g. Mobile Redesign, Core Data Architecture"
                      className="w-full text-xs p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      Summary / Goals (Optional)
                    </label>
                    <textarea
                      rows={2}
                      value={newEpicSummary}
                      onChange={(e) => setNewEpicSummary(e.target.value)}
                      placeholder="High-level objectives or deliverable description..."
                      className="w-full text-xs p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                        Status
                      </label>
                      <select
                        value={newEpicStatus}
                        onChange={(e) => setNewEpicStatus(e.target.value)}
                        className="w-full text-xs p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 font-semibold cursor-pointer"
                      >
                        <option value="PLANNING">Planning</option>
                        <option value="ACTIVE">Active</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="CANCELLED">Cancelled</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                        Target Date (Optional)
                      </label>
                      <input
                        type="date"
                        value={newEpicTargetDate}
                        onChange={(e) => setNewEpicTargetDate(e.target.value)}
                        className="w-full text-xs p-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      Theme Color
                    </label>
                    <div className="flex items-center gap-2 pt-1">
                      {["#8b5cf6", "#3b82f6", "#0ea5e9", "#10b981", "#f59e0b", "#f97316", "#f43f5e", "#ec4899"].map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setNewEpicColor(c)}
                          className={`w-5 h-5 rounded-full transition-transform cursor-pointer ${
                            newEpicColor === c ? "scale-125 ring-2 ring-offset-1 ring-purple-500" : "hover:scale-110"
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Live Preview */}
                  <div className="p-3 bg-purple-50/50 dark:bg-purple-950/20 rounded-xl border border-purple-200/60 dark:border-purple-900/40 flex items-center justify-between text-xs">
                    <span className="text-slate-400 text-[11px]">Badge Preview:</span>
                    <span
                      className="px-2.5 py-1 rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-2xs"
                      style={{ backgroundColor: `${newEpicColor}20`, color: newEpicColor }}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: newEpicColor }} />
                      <span className="truncate max-w-[160px]">{newEpicName.trim() || "Epic Preview"}</span>
                      <span className="text-[9px] uppercase px-1 rounded bg-black/10 dark:bg-white/10 ml-1">
                        {newEpicStatus}
                      </span>
                    </span>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowAddEpicModal(false)}
                      className="px-3.5 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isCreatingEpic || !newEpicName.trim()}
                      className="px-4 py-1.5 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 cursor-pointer shadow-xs shadow-purple-500/30 flex items-center gap-1.5"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>{isCreatingEpic ? "Creating..." : "Create & Link Epic"}</span>
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-2.5 overflow-y-auto max-h-[50vh] pr-1 flex-1">
                  {projectEpics.length === 0 ? (
                    <div className="text-center py-8 px-4 text-slate-400">
                      <Zap className="w-8 h-8 text-purple-400/50 mx-auto mb-2" />
                      <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">No epics created yet</p>
                      <p className="text-[11px] text-slate-400 mt-1">Switch to the Create tab to add your first project epic.</p>
                    </div>
                  ) : (
                    projectEpics.map((ep) => (
                      <div
                        key={ep.id}
                        className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
                          draftEpicId === ep.id
                            ? "bg-purple-50/70 dark:bg-purple-950/40 border-purple-300 dark:border-purple-800"
                            : "bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <span
                            className="w-3 h-3 rounded-full shrink-0 shadow-xs"
                            style={{ backgroundColor: ep.color || "#8b5cf6" }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-bold text-slate-900 dark:text-white truncate" title={ep.name}>
                                {ep.name}
                              </p>
                              {ep.status && (
                                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0">
                                  {ep.status}
                                </span>
                              )}
                              {draftEpicId === ep.id && (
                                <span className="text-[9px] font-bold text-purple-600 dark:text-purple-400 px-1.5 py-0.2 bg-purple-100 dark:bg-purple-950/80 rounded shrink-0">
                                  Selected
                                </span>
                              )}
                            </div>
                            {ep.summary && (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{ep.summary}</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setDraftEpicId(ep.id);
                              setHasChanges(true);
                              setShowAddEpicModal(false);
                              showSuccess(`Selected epic: ${ep.name}`);
                            }}
                            className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-100 hover:bg-purple-100 dark:bg-slate-800 dark:hover:bg-purple-950/60 text-slate-700 hover:text-purple-700 dark:text-slate-300 dark:hover:text-purple-300 transition-colors cursor-pointer"
                          >
                            {draftEpicId === ep.id ? "Keep" : "Select"}
                          </button>
                          <button
                            type="button"
                            disabled={deletingEpicId === ep.id}
                            onClick={() => handleDeleteProjectEpic(ep.id, ep.name)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            title="Delete Epic (Unlinks issues)"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Attachment Lightbox Modal */}
        {previewAttachment && (
          <div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-[70] p-4 animate-in fade-in duration-150"
            onClick={(e) => {
              if (e.target === e.currentTarget) setPreviewAttachment(null);
            }}
          >
            <div className="bg-white dark:bg-slate-900 max-w-4xl max-h-[90vh] w-full rounded-2xl shadow-2xl border border-slate-300 dark:border-slate-800 flex flex-col overflow-hidden">
              {/* Lightbox Header */}
              <div className="p-4 border-b border-slate-300 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/60">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center shrink-0">
                    <Eye className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {previewAttachment.fileName}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {formatFileSize(previewAttachment.fileSize)} • {previewAttachment.mimeType || "Attachment"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={sanitizeUrl(previewAttachment.fileUrl)}
                    download={previewAttachment.fileName}
                    className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => setPreviewAttachment(null)}
                    className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Lightbox Body */}
              <div className="p-6 flex-1 flex items-center justify-center overflow-auto bg-slate-950/20 dark:bg-black/40 min-h-[300px]">
                {previewAttachment.mimeType?.startsWith("image/") || previewAttachment.fileUrl?.startsWith("data:image") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewAttachment.fileUrl}
                    alt={previewAttachment.fileName}
                    className="max-h-[70vh] max-w-full object-contain rounded-xl shadow-lg"
                  />
                ) : (
                  <div className="text-center p-8">
                    <File className="w-16 h-16 text-blue-500 mx-auto mb-3 opacity-80" />
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{previewAttachment.fileName}</p>
                    <p className="text-xs text-slate-400 mt-1 mb-4">Preview not directly supported for this file type.</p>
                    <a
                      href={sanitizeUrl(previewAttachment.fileUrl)}
                      download={previewAttachment.fileName}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl"
                    >
                      <Download className="w-4 h-4" />
                      Download File
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Delete Issue Confirmation Modal */}
        {showDeleteConfirm && (
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[80] p-4 animate-in fade-in duration-150"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isDeleting) setShowDeleteConfirm(false);
            }}
          >
            <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-rose-200 dark:border-rose-900/60 p-6 space-y-4 animate-in zoom-in-95 duration-150">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0 border border-rose-200 dark:border-rose-900/50">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Delete Issue {issue?.issueKey}?
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    Are you sure you want to permanently delete <strong className="text-slate-800 dark:text-slate-200 font-semibold">&ldquo;{issue?.title}&rdquo;</strong>?
                  </p>
                </div>
              </div>

              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl text-xs text-rose-700 dark:text-rose-300 leading-relaxed space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
                  Warning: Permanent & Irreversible
                </p>
                <p className="text-[11px] text-rose-600/90 dark:text-rose-400/90">
                  All associated subtasks, comments, attachments, time tracking records, and dependencies will be permanently deleted. This operation is recorded in the platform audit ledger.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleDeleteIssue}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-700 text-white shadow-sm shadow-rose-600/30 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isDeleting ? "Deleting..." : "Permanently Delete Issue"}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
