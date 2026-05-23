package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/channelprompt"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

var channelSlugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,62}$`)

type ChannelGroupResponse struct {
	ID          string  `json:"id"`
	WorkspaceID string  `json:"workspace_id"`
	Name        string  `json:"name"`
	Position    float64 `json:"position"`
	CreatedBy   *string `json:"created_by"`
	ArchivedAt  *string `json:"archived_at"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
}

type ChannelResponse struct {
	ID                  string  `json:"id"`
	WorkspaceID         string  `json:"workspace_id"`
	GroupID             *string `json:"group_id"`
	Slug                string  `json:"slug"`
	Name                string  `json:"name"`
	Description         string  `json:"description"`
	Visibility          string  `json:"visibility"`
	Proactivity         string  `json:"proactivity"`
	Instructions        string  `json:"instructions"`
	Summary             string  `json:"summary"`
	DefaultProjectID    *string `json:"default_project_id"`
	DefaultAssigneeType *string `json:"default_assignee_type"`
	DefaultAssigneeID   *string `json:"default_assignee_id"`
	Position            float64 `json:"position"`
	CreatedBy           string  `json:"created_by"`
	ArchivedAt          *string `json:"archived_at"`
	CreatedAt           string  `json:"created_at"`
	UpdatedAt           string  `json:"updated_at"`
}

type ChannelMemberResponse struct {
	ID         string `json:"id"`
	ChannelID  string `json:"channel_id"`
	MemberType string `json:"member_type"`
	MemberID   string `json:"member_id"`
	Role       string `json:"role"`
	CreatedAt  string `json:"created_at"`
}

type ChannelSessionResponse struct {
	ID            string  `json:"id"`
	ChannelID     string  `json:"channel_id"`
	Title         string  `json:"title"`
	Summary       string  `json:"summary"`
	Status        string  `json:"status"`
	CreatedByType string  `json:"created_by_type"`
	CreatedByID   *string `json:"created_by_id"`
	ArchivedAt    *string `json:"archived_at"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
}

type ChannelMessageResponse struct {
	ID         string  `json:"id"`
	ChannelID  string  `json:"channel_id"`
	SessionID  string  `json:"session_id"`
	AuthorType string  `json:"author_type"`
	AuthorID   *string `json:"author_id"`
	Content    string  `json:"content"`
	Type       string  `json:"type"`
	ParentID   *string `json:"parent_id"`
	IssueID    *string `json:"issue_id"`
	CreatedAt  string  `json:"created_at"`
	UpdatedAt  string  `json:"updated_at"`
}

type ChannelAgentRunResponse struct {
	ID                string  `json:"id"`
	ChannelID         string  `json:"channel_id"`
	SessionID         string  `json:"session_id"`
	UserMessageID     string  `json:"user_message_id"`
	DispatchStepID    string  `json:"dispatch_step_id"`
	AgentID           string  `json:"agent_id"`
	ChatSessionID     string  `json:"chat_session_id"`
	ChatUserMessageID string  `json:"chat_user_message_id"`
	TaskID            string  `json:"task_id"`
	Status            string  `json:"status"`
	TaskStatus        string  `json:"task_status"`
	CreatedAt         string  `json:"created_at"`
	CompletedAt       *string `json:"completed_at"`
	TaskCreatedAt     *string `json:"task_created_at"`
	TaskStartedAt     *string `json:"task_started_at"`
	TaskCompletedAt   *string `json:"task_completed_at"`
}

type ChannelDispatchPlanResponse struct {
	ID                    string                        `json:"id"`
	ChannelID             string                        `json:"channel_id"`
	SessionID             string                        `json:"session_id"`
	TriggerMessageID      string                        `json:"trigger_message_id"`
	Mode                  string                        `json:"mode"`
	Status                string                        `json:"status"`
	Confidence            float64                       `json:"confidence"`
	PlannerSource         string                        `json:"planner_source"`
	Reason                string                        `json:"reason"`
	ParticipantCount      int32                         `json:"participant_count"`
	RunCount              int32                         `json:"run_count"`
	TotalInputTokens      int64                         `json:"total_input_tokens"`
	TotalOutputTokens     int64                         `json:"total_output_tokens"`
	TotalCacheReadTokens  int64                         `json:"total_cache_read_tokens"`
	TotalCacheWriteTokens int64                         `json:"total_cache_write_tokens"`
	ElapsedMs             int64                         `json:"elapsed_ms"`
	StartedAt             *string                       `json:"started_at"`
	CompletedAt           *string                       `json:"completed_at"`
	CreatedAt             string                        `json:"created_at"`
	UpdatedAt             string                        `json:"updated_at"`
	Steps                 []ChannelDispatchStepResponse `json:"steps,omitempty"`
}

type ChannelDispatchStepResponse struct {
	ID                string   `json:"id"`
	PlanID            string   `json:"plan_id"`
	ChannelID         string   `json:"channel_id"`
	SessionID         string   `json:"session_id"`
	TriggerMessageID  string   `json:"trigger_message_id"`
	AgentID           string   `json:"agent_id"`
	Position          int32    `json:"position"`
	Role              string   `json:"role"`
	Status            string   `json:"status"`
	Instruction       string   `json:"instruction"`
	DependsOnStepIDs  []string `json:"depends_on_step_ids"`
	SkipReason        string   `json:"skip_reason"`
	Error             string   `json:"error"`
	ChannelAgentRunID string   `json:"channel_agent_run_id"`
	ChatSessionID     string   `json:"chat_session_id"`
	ChatUserMessageID string   `json:"chat_user_message_id"`
	TaskID            string   `json:"task_id"`
	TaskStatus        string   `json:"task_status"`
	StartedAt         *string  `json:"started_at"`
	CompletedAt       *string  `json:"completed_at"`
	CreatedAt         string   `json:"created_at"`
	UpdatedAt         string   `json:"updated_at"`
	TaskCreatedAt     *string  `json:"task_created_at"`
	TaskStartedAt     *string  `json:"task_started_at"`
	TaskCompletedAt   *string  `json:"task_completed_at"`
}

type ChannelIssueResponse struct {
	IssueID      string  `json:"issue_id"`
	ChannelID    string  `json:"channel_id"`
	SessionID    *string `json:"session_id"`
	LinkedByType string  `json:"linked_by_type"`
	LinkedByID   *string `json:"linked_by_id"`
	Identifier   string  `json:"identifier"`
	Number       int32   `json:"number"`
	Title        string  `json:"title"`
	Status       string  `json:"status"`
	Priority     string  `json:"priority"`
	CreatedAt    string  `json:"created_at"`
}

type channelMemberRequest struct {
	MemberType string `json:"member_type"`
	MemberID   string `json:"member_id"`
	Role       string `json:"role"`
}

type normalizedChannelMember struct {
	MemberType string
	MemberID   pgtype.UUID
	Role       string
}

type ApprovalRequestResponse struct {
	ID              string          `json:"id"`
	WorkspaceID     string          `json:"workspace_id"`
	ChannelID       *string         `json:"channel_id"`
	SessionID       *string         `json:"session_id"`
	IssueID         *string         `json:"issue_id"`
	RequestedByType string          `json:"requested_by_type"`
	RequestedByID   *string         `json:"requested_by_id"`
	ActionType      string          `json:"action_type"`
	ActionPayload   json.RawMessage `json:"action_payload"`
	Status          string          `json:"status"`
	ResolutionNote  *string         `json:"resolution_note"`
	ResolvedBy      *string         `json:"resolved_by"`
	ResolvedAt      *string         `json:"resolved_at"`
	CreatedAt       string          `json:"created_at"`
	UpdatedAt       string          `json:"updated_at"`
}

func channelGroupToResponse(group db.ChannelGroup) ChannelGroupResponse {
	return ChannelGroupResponse{
		ID:          uuidToString(group.ID),
		WorkspaceID: uuidToString(group.WorkspaceID),
		Name:        group.Name,
		Position:    group.Position,
		CreatedBy:   uuidToPtr(group.CreatedBy),
		ArchivedAt:  timestampToPtr(group.ArchivedAt),
		CreatedAt:   timestampToString(group.CreatedAt),
		UpdatedAt:   timestampToString(group.UpdatedAt),
	}
}

func channelToResponse(channel db.Channel) ChannelResponse {
	return ChannelResponse{
		ID:                  uuidToString(channel.ID),
		WorkspaceID:         uuidToString(channel.WorkspaceID),
		GroupID:             uuidToPtr(channel.GroupID),
		Slug:                channel.Slug,
		Name:                channel.Name,
		Description:         channel.Description,
		Visibility:          channel.Visibility,
		Proactivity:         channel.Proactivity,
		Instructions:        channel.Instructions,
		Summary:             channel.Summary,
		DefaultProjectID:    uuidToPtr(channel.DefaultProjectID),
		DefaultAssigneeType: textToPtr(channel.DefaultAssigneeType),
		DefaultAssigneeID:   uuidToPtr(channel.DefaultAssigneeID),
		Position:            channel.Position,
		CreatedBy:           uuidToString(channel.CreatedBy),
		ArchivedAt:          timestampToPtr(channel.ArchivedAt),
		CreatedAt:           timestampToString(channel.CreatedAt),
		UpdatedAt:           timestampToString(channel.UpdatedAt),
	}
}

func channelMemberToResponse(member db.ChannelMember) ChannelMemberResponse {
	return ChannelMemberResponse{
		ID:         uuidToString(member.ID),
		ChannelID:  uuidToString(member.ChannelID),
		MemberType: member.MemberType,
		MemberID:   uuidToString(member.MemberID),
		Role:       member.Role,
		CreatedAt:  timestampToString(member.CreatedAt),
	}
}

func channelSessionToResponse(session db.ChannelSession) ChannelSessionResponse {
	return ChannelSessionResponse{
		ID:            uuidToString(session.ID),
		ChannelID:     uuidToString(session.ChannelID),
		Title:         session.Title,
		Summary:       session.Summary,
		Status:        session.Status,
		CreatedByType: session.CreatedByType,
		CreatedByID:   uuidToPtr(session.CreatedByID),
		ArchivedAt:    timestampToPtr(session.ArchivedAt),
		CreatedAt:     timestampToString(session.CreatedAt),
		UpdatedAt:     timestampToString(session.UpdatedAt),
	}
}

func channelMessageToResponse(message db.ChannelMessage) ChannelMessageResponse {
	return ChannelMessageResponse{
		ID:         uuidToString(message.ID),
		ChannelID:  uuidToString(message.ChannelID),
		SessionID:  uuidToString(message.SessionID),
		AuthorType: message.AuthorType,
		AuthorID:   uuidToPtr(message.AuthorID),
		Content:    message.Content,
		Type:       message.Type,
		ParentID:   uuidToPtr(message.ParentID),
		IssueID:    uuidToPtr(message.IssueID),
		CreatedAt:  timestampToString(message.CreatedAt),
		UpdatedAt:  timestampToString(message.UpdatedAt),
	}
}

func channelAgentRunToResponse(run db.ListChannelAgentRunsBySessionRow) ChannelAgentRunResponse {
	return ChannelAgentRunResponse{
		ID:                uuidToString(run.ID),
		ChannelID:         uuidToString(run.ChannelID),
		SessionID:         uuidToString(run.ChannelSessionID),
		UserMessageID:     uuidToString(run.UserMessageID),
		DispatchStepID:    uuidToString(run.DispatchStepID),
		AgentID:           uuidToString(run.AgentID),
		ChatSessionID:     uuidToString(run.ChatSessionID),
		ChatUserMessageID: uuidToString(run.ChatUserMessageID),
		TaskID:            uuidToString(run.TaskID),
		Status:            run.Status,
		TaskStatus:        run.TaskStatus,
		CreatedAt:         timestampToString(run.CreatedAt),
		CompletedAt:       timestampToPtr(run.CompletedAt),
		TaskCreatedAt:     timestampToPtr(run.TaskCreatedAt),
		TaskStartedAt:     timestampToPtr(run.TaskStartedAt),
		TaskCompletedAt:   timestampToPtr(run.TaskCompletedAt),
	}
}

func channelDispatchPlanToResponse(plan db.ChannelDispatchPlan, steps []ChannelDispatchStepResponse) ChannelDispatchPlanResponse {
	return ChannelDispatchPlanResponse{
		ID:                    uuidToString(plan.ID),
		ChannelID:             uuidToString(plan.ChannelID),
		SessionID:             uuidToString(plan.ChannelSessionID),
		TriggerMessageID:      uuidToString(plan.TriggerMessageID),
		Mode:                  plan.Mode,
		Status:                plan.Status,
		Confidence:            plan.Confidence,
		PlannerSource:         plan.PlannerSource,
		Reason:                plan.Reason,
		ParticipantCount:      plan.ParticipantCount,
		RunCount:              plan.RunCount,
		TotalInputTokens:      plan.TotalInputTokens,
		TotalOutputTokens:     plan.TotalOutputTokens,
		TotalCacheReadTokens:  plan.TotalCacheReadTokens,
		TotalCacheWriteTokens: plan.TotalCacheWriteTokens,
		ElapsedMs:             plan.ElapsedMs,
		StartedAt:             timestampToPtr(plan.StartedAt),
		CompletedAt:           timestampToPtr(plan.CompletedAt),
		CreatedAt:             timestampToString(plan.CreatedAt),
		UpdatedAt:             timestampToString(plan.UpdatedAt),
		Steps:                 steps,
	}
}

func channelDispatchStepToResponse(step db.ListChannelDispatchStepsByPlanRow) ChannelDispatchStepResponse {
	return ChannelDispatchStepResponse{
		ID:                uuidToString(step.ID),
		PlanID:            uuidToString(step.PlanID),
		ChannelID:         uuidToString(step.ChannelID),
		SessionID:         uuidToString(step.ChannelSessionID),
		TriggerMessageID:  uuidToString(step.TriggerMessageID),
		AgentID:           uuidToString(step.AgentID),
		Position:          step.Position,
		Role:              step.Role,
		Status:            step.Status,
		Instruction:       step.Instruction,
		DependsOnStepIDs:  uuidSliceToStrings(step.DependsOnStepIds),
		SkipReason:        step.SkipReason,
		Error:             step.Error,
		ChannelAgentRunID: uuidToString(step.ChannelAgentRunID),
		ChatSessionID:     uuidToString(step.ChatSessionID),
		ChatUserMessageID: uuidToString(step.ChatUserMessageID),
		TaskID:            uuidToString(step.TaskID),
		TaskStatus:        step.TaskStatus,
		StartedAt:         timestampToPtr(step.StartedAt),
		CompletedAt:       timestampToPtr(step.CompletedAt),
		CreatedAt:         timestampToString(step.CreatedAt),
		UpdatedAt:         timestampToString(step.UpdatedAt),
		TaskCreatedAt:     timestampToPtr(step.TaskCreatedAt),
		TaskStartedAt:     timestampToPtr(step.TaskStartedAt),
		TaskCompletedAt:   timestampToPtr(step.TaskCompletedAt),
	}
}

func uuidSliceToStrings(values []pgtype.UUID) []string {
	if len(values) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if text := uuidToString(value); text != "" {
			out = append(out, text)
		}
	}
	return out
}

func approvalRequestToResponse(approval db.ApprovalRequest) ApprovalRequestResponse {
	payload := json.RawMessage(approval.ActionPayload)
	if len(payload) == 0 {
		payload = json.RawMessage(`{}`)
	}
	return ApprovalRequestResponse{
		ID:              uuidToString(approval.ID),
		WorkspaceID:     uuidToString(approval.WorkspaceID),
		ChannelID:       uuidToPtr(approval.ChannelID),
		SessionID:       uuidToPtr(approval.SessionID),
		IssueID:         uuidToPtr(approval.IssueID),
		RequestedByType: approval.RequestedByType,
		RequestedByID:   uuidToPtr(approval.RequestedByID),
		ActionType:      approval.ActionType,
		ActionPayload:   payload,
		Status:          approval.Status,
		ResolutionNote:  textToPtr(approval.ResolutionNote),
		ResolvedBy:      uuidToPtr(approval.ResolvedBy),
		ResolvedAt:      timestampToPtr(approval.ResolvedAt),
		CreatedAt:       timestampToString(approval.CreatedAt),
		UpdatedAt:       timestampToString(approval.UpdatedAt),
	}
}

func slugifyChannelName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	lastSeparator := false
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
			lastSeparator = false
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
			lastSeparator = false
		case r == '-' || r == '_' || r == ' ' || r == '\t':
			if builder.Len() > 0 && !lastSeparator {
				builder.WriteRune('-')
				lastSeparator = true
			}
		}
	}
	slug := strings.Trim(builder.String(), "-_")
	if slug == "" {
		return "channel"
	}
	if len(slug) > 63 {
		slug = strings.Trim(slug[:63], "-_")
	}
	return slug
}

func normalizeChannelSlug(name, slug string) string {
	slug = strings.TrimSpace(strings.ToLower(slug))
	if slug == "" {
		slug = slugifyChannelName(name)
	}
	return slug
}

func isValidChannelVisibility(visibility string) bool {
	return visibility == "public" || visibility == "private"
}

func isValidChannelProactivity(proactivity string) bool {
	return proactivity == "quiet" || proactivity == "standard" || proactivity == "active"
}

func isValidChannelMemberType(memberType string) bool {
	return memberType == "member" || memberType == "agent" || memberType == "squad"
}

func isValidChannelMemberRole(role string) bool {
	return role == "owner" || role == "admin" || role == "member"
}

func nullableUUIDFromString(w http.ResponseWriter, value, fieldName string) (pgtype.UUID, bool) {
	if strings.TrimSpace(value) == "" {
		return pgtype.UUID{}, true
	}
	return parseUUIDOrBadRequest(w, value, fieldName)
}

func optionalText(value string) pgtype.Text {
	if strings.TrimSpace(value) == "" {
		return pgtype.Text{}
	}
	return strToText(value)
}

func optionalTextPtr(value *string) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	return strToText(strings.TrimSpace(*value))
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func (h *Handler) channelHasHumanMember(ctx http.ResponseWriter, r *http.Request, channel db.Channel, userID string) bool {
	userUUID, ok := parseUUIDOrBadRequest(ctx, userID, "user_id")
	if !ok {
		return false
	}
	isMember, err := h.Queries.IsChannelMember(r.Context(), db.IsChannelMemberParams{
		ChannelID:  channel.ID,
		MemberType: "member",
		MemberID:   userUUID,
	})
	return err == nil && isMember
}

func (h *Handler) canReadChannel(w http.ResponseWriter, r *http.Request, channel db.Channel, member db.Member) bool {
	if channel.Visibility == "public" || member.Role == "owner" || member.Role == "admin" {
		return true
	}
	return h.channelHasHumanMember(w, r, channel, uuidToString(member.UserID))
}

func (h *Handler) canManageChannel(r *http.Request, channel db.Channel, member db.Member) bool {
	if member.Role == "owner" || member.Role == "admin" {
		return true
	}
	channelMember, err := h.Queries.GetChannelMember(r.Context(), db.GetChannelMemberParams{
		ChannelID:  channel.ID,
		MemberType: "member",
		MemberID:   member.UserID,
	})
	return err == nil && (channelMember.Role == "owner" || channelMember.Role == "admin")
}

func (h *Handler) loadChannelInWorkspace(w http.ResponseWriter, r *http.Request, idOrSlug string) (db.Channel, db.Member, string, bool) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return db.Channel{}, db.Member{}, "", false
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
	if !ok {
		return db.Channel{}, db.Member{}, "", false
	}

	var channel db.Channel
	var err error
	if idUUID, parseErr := util.ParseUUID(idOrSlug); parseErr == nil {
		channel, err = h.Queries.GetChannelInWorkspace(r.Context(), db.GetChannelInWorkspaceParams{
			ID:          idUUID,
			WorkspaceID: wsUUID,
		})
	} else {
		channel, err = h.Queries.GetChannelBySlugInWorkspace(r.Context(), db.GetChannelBySlugInWorkspaceParams{
			Slug:        strings.ToLower(idOrSlug),
			WorkspaceID: wsUUID,
		})
	}
	if err != nil {
		writeError(w, http.StatusNotFound, "channel not found")
		return db.Channel{}, db.Member{}, "", false
	}
	if !h.canReadChannel(w, r, channel, member) {
		writeError(w, http.StatusNotFound, "channel not found")
		return db.Channel{}, db.Member{}, "", false
	}
	return channel, member, workspaceID, true
}

func (h *Handler) validateChannelEntity(w http.ResponseWriter, r *http.Request, workspaceID pgtype.UUID, memberType string, memberID pgtype.UUID) bool {
	switch memberType {
	case "member":
		_, err := h.Queries.GetMemberByUserAndWorkspace(r.Context(), db.GetMemberByUserAndWorkspaceParams{
			UserID:      memberID,
			WorkspaceID: workspaceID,
		})
		if err != nil {
			writeError(w, http.StatusBadRequest, "member not found in this workspace")
			return false
		}
	case "agent":
		if _, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
			ID:          memberID,
			WorkspaceID: workspaceID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "agent not found in this workspace")
			return false
		}
	case "squad":
		if _, err := h.Queries.GetSquadInWorkspace(r.Context(), db.GetSquadInWorkspaceParams{
			ID:          memberID,
			WorkspaceID: workspaceID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "squad not found in this workspace")
			return false
		}
	default:
		writeError(w, http.StatusBadRequest, "member_type must be 'member', 'agent', or 'squad'")
		return false
	}
	return true
}

func (h *Handler) normalizeChannelMembers(
	w http.ResponseWriter,
	r *http.Request,
	workspaceID pgtype.UUID,
	requests []channelMemberRequest,
) ([]normalizedChannelMember, bool) {
	members := make([]normalizedChannelMember, 0, len(requests))
	seen := make(map[string]struct{}, len(requests))
	for _, req := range requests {
		req.MemberType = strings.TrimSpace(req.MemberType)
		req.MemberID = strings.TrimSpace(req.MemberID)
		req.Role = strings.TrimSpace(req.Role)
		if req.Role == "" {
			req.Role = "member"
		}
		if !isValidChannelMemberType(req.MemberType) {
			writeError(w, http.StatusBadRequest, "member_type must be 'member', 'agent', or 'squad'")
			return nil, false
		}
		if !isValidChannelMemberRole(req.Role) {
			writeError(w, http.StatusBadRequest, "role must be 'owner', 'admin', or 'member'")
			return nil, false
		}
		memberID, ok := parseUUIDOrBadRequest(w, req.MemberID, "member_id")
		if !ok {
			return nil, false
		}
		if !h.validateChannelEntity(w, r, workspaceID, req.MemberType, memberID) {
			return nil, false
		}
		key := req.MemberType + ":" + uuidToString(memberID)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		members = append(members, normalizedChannelMember{
			MemberType: req.MemberType,
			MemberID:   memberID,
			Role:       req.Role,
		})
	}
	return members, true
}

func (h *Handler) ListChannelGroups(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	if _, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found"); !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
	if !ok {
		return
	}

	groups, err := h.Queries.ListChannelGroups(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list channel groups")
		return
	}
	resp := make([]ChannelGroupResponse, len(groups))
	for i, group := range groups {
		resp[i] = channelGroupToResponse(group)
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) CreateChannelGroup(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
	if !ok {
		return
	}

	var req struct {
		Name     string  `json:"name"`
		Position float64 `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	group, err := h.Queries.CreateChannelGroup(r.Context(), db.CreateChannelGroupParams{
		WorkspaceID: wsUUID,
		Name:        req.Name,
		Position:    req.Position,
		CreatedBy:   member.UserID,
	})
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "channel group already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create channel group")
		return
	}
	writeJSON(w, http.StatusCreated, channelGroupToResponse(group))
}

func (h *Handler) ListChannels(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
	if !ok {
		return
	}
	channels, err := h.Queries.ListVisibleChannels(r.Context(), db.ListVisibleChannelsParams{
		WorkspaceID:    wsUUID,
		MemberID:       member.UserID,
		IncludePrivate: member.Role == "owner" || member.Role == "admin",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list channels")
		return
	}
	resp := make([]ChannelResponse, len(channels))
	for i, channel := range channels {
		resp[i] = channelToResponse(channel)
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) CreateChannel(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
	if !ok {
		return
	}

	var req struct {
		GroupID             string                 `json:"group_id"`
		Slug                string                 `json:"slug"`
		Name                string                 `json:"name"`
		Description         string                 `json:"description"`
		Visibility          string                 `json:"visibility"`
		Proactivity         string                 `json:"proactivity"`
		Instructions        string                 `json:"instructions"`
		Summary             string                 `json:"summary"`
		DefaultProjectID    string                 `json:"default_project_id"`
		DefaultAssigneeType string                 `json:"default_assignee_type"`
		DefaultAssigneeID   string                 `json:"default_assignee_id"`
		Position            float64                `json:"position"`
		Members             []channelMemberRequest `json:"members"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	req.Visibility = strings.TrimSpace(req.Visibility)
	if req.Visibility == "" {
		req.Visibility = "private"
	}
	if !isValidChannelVisibility(req.Visibility) {
		writeError(w, http.StatusBadRequest, "visibility must be 'public' or 'private'")
		return
	}
	req.Proactivity = strings.TrimSpace(req.Proactivity)
	if req.Proactivity == "" {
		req.Proactivity = "active"
	}
	if !isValidChannelProactivity(req.Proactivity) {
		writeError(w, http.StatusBadRequest, "proactivity must be 'quiet', 'standard', or 'active'")
		return
	}
	slug := normalizeChannelSlug(req.Name, req.Slug)
	if !channelSlugPattern.MatchString(slug) {
		writeError(w, http.StatusBadRequest, "slug must use lowercase letters, numbers, hyphen, or underscore")
		return
	}
	groupID, ok := nullableUUIDFromString(w, req.GroupID, "group_id")
	if !ok {
		return
	}
	if groupID.Valid {
		if _, err := h.Queries.GetChannelGroupInWorkspace(r.Context(), db.GetChannelGroupInWorkspaceParams{
			ID:          groupID,
			WorkspaceID: wsUUID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "channel group not found in this workspace")
			return
		}
	}
	defaultProjectID, ok := nullableUUIDFromString(w, req.DefaultProjectID, "default_project_id")
	if !ok {
		return
	}
	if defaultProjectID.Valid {
		if _, err := h.Queries.GetProjectInWorkspace(r.Context(), db.GetProjectInWorkspaceParams{
			ID:          defaultProjectID,
			WorkspaceID: wsUUID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "default project not found in this workspace")
			return
		}
	}
	defaultAssigneeID, ok := nullableUUIDFromString(w, req.DefaultAssigneeID, "default_assignee_id")
	if !ok {
		return
	}
	defaultAssigneeType := optionalText(req.DefaultAssigneeType)
	if defaultAssigneeType.Valid {
		if !isValidChannelMemberType(defaultAssigneeType.String) {
			writeError(w, http.StatusBadRequest, "default_assignee_type must be 'member', 'agent', or 'squad'")
			return
		}
		if !defaultAssigneeID.Valid {
			writeError(w, http.StatusBadRequest, "default_assignee_id is required when default_assignee_type is set")
			return
		}
		if !h.validateChannelEntity(w, r, wsUUID, defaultAssigneeType.String, defaultAssigneeID) {
			return
		}
	}
	members, ok := h.normalizeChannelMembers(w, r, wsUUID, req.Members)
	if !ok {
		return
	}

	channel, err := h.Queries.CreateChannel(r.Context(), db.CreateChannelParams{
		WorkspaceID:         wsUUID,
		GroupID:             groupID,
		Slug:                slug,
		Name:                req.Name,
		Description:         req.Description,
		Visibility:          req.Visibility,
		Proactivity:         req.Proactivity,
		Instructions:        req.Instructions,
		Summary:             req.Summary,
		DefaultProjectID:    defaultProjectID,
		DefaultAssigneeType: defaultAssigneeType,
		DefaultAssigneeID:   defaultAssigneeID,
		Position:            req.Position,
		CreatedBy:           member.UserID,
	})
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "channel slug already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to create channel")
		return
	}

	for _, item := range members {
		if _, err := h.Queries.UpsertChannelMember(r.Context(), db.UpsertChannelMemberParams{
			ChannelID:  channel.ID,
			MemberType: item.MemberType,
			MemberID:   item.MemberID,
			Role:       item.Role,
		}); err != nil {
			slog.Warn("failed to add requested channel member", "channel_id", uuidToString(channel.ID), "member_type", item.MemberType, "member_id", uuidToString(item.MemberID), "error", err)
			writeError(w, http.StatusInternalServerError, "failed to add channel members")
			return
		}
	}
	_, _ = h.Queries.UpsertChannelMember(r.Context(), db.UpsertChannelMemberParams{
		ChannelID:  channel.ID,
		MemberType: "member",
		MemberID:   member.UserID,
		Role:       "owner",
	})

	resp := channelToResponse(channel)
	h.publish(protocol.EventChannelCreated, workspaceID, "member", uuidToString(member.UserID), map[string]any{"channel": resp})
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) GetChannel(w http.ResponseWriter, r *http.Request) {
	channel, _, _, ok := h.loadChannelInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, channelToResponse(channel))
}

func (h *Handler) UpdateChannel(w http.ResponseWriter, r *http.Request) {
	channel, member, workspaceID, ok := h.loadChannelInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	if !h.canManageChannel(r, channel, member) {
		writeError(w, http.StatusForbidden, "insufficient permissions")
		return
	}

	var req struct {
		GroupID             *string  `json:"group_id"`
		Name                *string  `json:"name"`
		Description         *string  `json:"description"`
		Visibility          *string  `json:"visibility"`
		Proactivity         *string  `json:"proactivity"`
		Instructions        *string  `json:"instructions"`
		Summary             *string  `json:"summary"`
		DefaultProjectID    *string  `json:"default_project_id"`
		DefaultAssigneeType *string  `json:"default_assignee_type"`
		DefaultAssigneeID   *string  `json:"default_assignee_id"`
		Position            *float64 `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name != nil {
		*req.Name = strings.TrimSpace(*req.Name)
		if *req.Name == "" {
			writeError(w, http.StatusBadRequest, "name cannot be empty")
			return
		}
	}
	if req.Visibility != nil && !isValidChannelVisibility(*req.Visibility) {
		writeError(w, http.StatusBadRequest, "visibility must be 'public' or 'private'")
		return
	}
	if req.Proactivity != nil && !isValidChannelProactivity(*req.Proactivity) {
		writeError(w, http.StatusBadRequest, "proactivity must be 'quiet', 'standard', or 'active'")
		return
	}
	if req.DefaultAssigneeType != nil && !isValidChannelMemberType(*req.DefaultAssigneeType) {
		writeError(w, http.StatusBadRequest, "default_assignee_type must be 'member', 'agent', or 'squad'")
		return
	}

	groupID, ok := nullableUUIDFromString(w, stringValue(req.GroupID), "group_id")
	if !ok {
		return
	}
	defaultProjectID, ok := nullableUUIDFromString(w, stringValue(req.DefaultProjectID), "default_project_id")
	if !ok {
		return
	}
	defaultAssigneeID, ok := nullableUUIDFromString(w, stringValue(req.DefaultAssigneeID), "default_assignee_id")
	if !ok {
		return
	}
	if req.DefaultAssigneeType != nil && defaultAssigneeID.Valid {
		if !h.validateChannelEntity(w, r, channel.WorkspaceID, *req.DefaultAssigneeType, defaultAssigneeID) {
			return
		}
	}

	position := pgtype.Float8{}
	if req.Position != nil {
		position = pgtype.Float8{Float64: *req.Position, Valid: true}
	}
	updated, err := h.Queries.UpdateChannel(r.Context(), db.UpdateChannelParams{
		ID:                  channel.ID,
		WorkspaceID:         channel.WorkspaceID,
		GroupID:             groupID,
		Name:                optionalTextPtr(req.Name),
		Description:         optionalTextPtr(req.Description),
		Visibility:          optionalTextPtr(req.Visibility),
		Proactivity:         optionalTextPtr(req.Proactivity),
		Instructions:        optionalTextPtr(req.Instructions),
		Summary:             optionalTextPtr(req.Summary),
		DefaultProjectID:    defaultProjectID,
		DefaultAssigneeType: optionalTextPtr(req.DefaultAssigneeType),
		DefaultAssigneeID:   defaultAssigneeID,
		Position:            position,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update channel")
		return
	}
	resp := channelToResponse(updated)
	h.publish(protocol.EventChannelUpdated, workspaceID, "member", uuidToString(member.UserID), map[string]any{"channel": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) ArchiveChannel(w http.ResponseWriter, r *http.Request) {
	channel, member, workspaceID, ok := h.loadChannelInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	if !h.canManageChannel(r, channel, member) {
		writeError(w, http.StatusForbidden, "insufficient permissions")
		return
	}
	archived, err := h.Queries.ArchiveChannel(r.Context(), db.ArchiveChannelParams{
		ID:          channel.ID,
		WorkspaceID: channel.WorkspaceID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to archive channel")
		return
	}
	resp := channelToResponse(archived)
	h.publish(protocol.EventChannelUpdated, workspaceID, "member", uuidToString(member.UserID), map[string]any{"channel": resp})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) JoinChannel(w http.ResponseWriter, r *http.Request) {
	channel, member, workspaceID, ok := h.loadChannelInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	if channel.Visibility != "public" && member.Role != "owner" && member.Role != "admin" {
		writeError(w, http.StatusForbidden, "only invited members can join private channels")
		return
	}
	channelMember, err := h.Queries.UpsertChannelMember(r.Context(), db.UpsertChannelMemberParams{
		ChannelID:  channel.ID,
		MemberType: "member",
		MemberID:   member.UserID,
		Role:       "member",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to join channel")
		return
	}
	h.publish(protocol.EventChannelUpdated, workspaceID, "member", uuidToString(member.UserID), map[string]any{
		"channel_id": uuidToString(channel.ID),
	})
	writeJSON(w, http.StatusOK, channelMemberToResponse(channelMember))
}

func (h *Handler) ListChannelMembers(w http.ResponseWriter, r *http.Request) {
	channel, _, _, ok := h.loadChannelInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	members, err := h.Queries.ListChannelMembers(r.Context(), channel.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list channel members")
		return
	}
	resp := make([]ChannelMemberResponse, len(members))
	for i, member := range members {
		resp[i] = channelMemberToResponse(member)
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) AddChannelMember(w http.ResponseWriter, r *http.Request) {
	channel, member, workspaceID, ok := h.loadChannelInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	if !h.canManageChannel(r, channel, member) {
		writeError(w, http.StatusForbidden, "insufficient permissions")
		return
	}
	wsUUID := channel.WorkspaceID

	var req struct {
		MemberType string `json:"member_type"`
		MemberID   string `json:"member_id"`
		Role       string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !isValidChannelMemberType(req.MemberType) {
		writeError(w, http.StatusBadRequest, "member_type must be 'member', 'agent', or 'squad'")
		return
	}
	if req.Role == "" {
		req.Role = "member"
	}
	if !isValidChannelMemberRole(req.Role) {
		writeError(w, http.StatusBadRequest, "role must be 'owner', 'admin', or 'member'")
		return
	}
	memberID, ok := parseUUIDOrBadRequest(w, req.MemberID, "member_id")
	if !ok {
		return
	}
	if !h.validateChannelEntity(w, r, wsUUID, req.MemberType, memberID) {
		return
	}

	channelMember, err := h.Queries.UpsertChannelMember(r.Context(), db.UpsertChannelMemberParams{
		ChannelID:  channel.ID,
		MemberType: req.MemberType,
		MemberID:   memberID,
		Role:       req.Role,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add channel member")
		return
	}
	h.publish(protocol.EventChannelUpdated, workspaceID, "member", requestUserID(r), map[string]any{
		"channel_id": uuidToString(channel.ID),
	})
	writeJSON(w, http.StatusCreated, channelMemberToResponse(channelMember))
}

func (h *Handler) ListChannelSessions(w http.ResponseWriter, r *http.Request) {
	channel, _, _, ok := h.loadChannelInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	sessions, err := h.Queries.ListChannelSessions(r.Context(), channel.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list channel sessions")
		return
	}
	resp := make([]ChannelSessionResponse, len(sessions))
	for i, session := range sessions {
		resp[i] = channelSessionToResponse(session)
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) CreateChannelSession(w http.ResponseWriter, r *http.Request) {
	channel, _, workspaceID, ok := h.loadChannelInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var req struct {
		Title   string `json:"title"`
		Summary string `json:"summary"`
		Status  string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	if req.Status == "" {
		req.Status = "active"
	}
	if req.Status != "active" && req.Status != "resolved" && req.Status != "archived" {
		writeError(w, http.StatusBadRequest, "status must be 'active', 'resolved', or 'archived'")
		return
	}

	userID := requestUserID(r)
	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	actorUUID, ok := nullableUUIDFromString(w, actorID, "actor_id")
	if !ok {
		return
	}
	session, err := h.Queries.CreateChannelSession(r.Context(), db.CreateChannelSessionParams{
		ChannelID:     channel.ID,
		Title:         req.Title,
		Summary:       req.Summary,
		Status:        req.Status,
		CreatedByType: actorType,
		CreatedByID:   actorUUID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create channel session")
		return
	}
	resp := channelSessionToResponse(session)
	h.publish(protocol.EventChannelSessionCreated, workspaceID, actorType, actorID, map[string]any{
		"channel_id": uuidToString(channel.ID),
		"session":    resp,
	})
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) ListChannelMessages(w http.ResponseWriter, r *http.Request) {
	channel, _, workspaceID, ok := h.loadChannelInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	sessionID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "sessionId"), "session id")
	if !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
	if !ok {
		return
	}
	if _, err := h.Queries.GetChannelSession(r.Context(), db.GetChannelSessionParams{
		ID:          sessionID,
		ChannelID:   channel.ID,
		WorkspaceID: wsUUID,
	}); err != nil {
		writeError(w, http.StatusNotFound, "channel session not found")
		return
	}

	limit := int32(80)
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			if parsed > 200 {
				parsed = 200
			}
			limit = int32(parsed)
		}
	}
	messages, err := h.Queries.ListChannelMessagesBySession(r.Context(), db.ListChannelMessagesBySessionParams{
		ChannelID: channel.ID,
		SessionID: sessionID,
		Limit:     limit,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list channel messages")
		return
	}
	resp := make([]ChannelMessageResponse, len(messages))
	for i := range messages {
		resp[len(messages)-1-i] = channelMessageToResponse(messages[i])
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) ListChannelAgentRuns(w http.ResponseWriter, r *http.Request) {
	channel, _, workspaceID, ok := h.loadChannelInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	sessionID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "sessionId"), "session id")
	if !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
	if !ok {
		return
	}
	if _, err := h.Queries.GetChannelSession(r.Context(), db.GetChannelSessionParams{
		ID:          sessionID,
		ChannelID:   channel.ID,
		WorkspaceID: wsUUID,
	}); err != nil {
		writeError(w, http.StatusNotFound, "channel session not found")
		return
	}
	rows, err := h.Queries.ListChannelAgentRunsBySession(r.Context(), db.ListChannelAgentRunsBySessionParams{
		ChannelID:        channel.ID,
		ChannelSessionID: sessionID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list channel agent runs")
		return
	}
	resp := make([]ChannelAgentRunResponse, len(rows))
	for i := range rows {
		resp[i] = channelAgentRunToResponse(rows[i])
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) CreateChannelMessage(w http.ResponseWriter, r *http.Request) {
	channel, _, workspaceID, ok := h.loadChannelInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	sessionID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "sessionId"), "session id")
	if !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
	if !ok {
		return
	}
	session, err := h.Queries.GetChannelSession(r.Context(), db.GetChannelSessionParams{
		ID:          sessionID,
		ChannelID:   channel.ID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "channel session not found")
		return
	}

	var req struct {
		Content  string `json:"content"`
		Type     string `json:"type"`
		ParentID string `json:"parent_id"`
		IssueID  string `json:"issue_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Content = strings.TrimSpace(req.Content)
	if req.Content == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}
	if req.Type == "" {
		req.Type = "message"
	}
	if req.Type != "message" && req.Type != "system" && req.Type != "suggestion" && req.Type != "approval" {
		writeError(w, http.StatusBadRequest, "type must be 'message', 'system', 'suggestion', or 'approval'")
		return
	}
	parentID, ok := nullableUUIDFromString(w, req.ParentID, "parent_id")
	if !ok {
		return
	}
	issueID, ok := nullableUUIDFromString(w, req.IssueID, "issue_id")
	if !ok {
		return
	}
	if issueID.Valid {
		if _, err := h.Queries.GetIssueInWorkspace(r.Context(), db.GetIssueInWorkspaceParams{
			ID:          issueID,
			WorkspaceID: wsUUID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "issue not found in this workspace")
			return
		}
	}

	userID := requestUserID(r)
	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	actorUUID, ok := nullableUUIDFromString(w, actorID, "actor_id")
	if !ok {
		return
	}
	message, err := h.Queries.CreateChannelMessage(r.Context(), db.CreateChannelMessageParams{
		ChannelID:  channel.ID,
		SessionID:  sessionID,
		AuthorType: actorType,
		AuthorID:   actorUUID,
		Content:    req.Content,
		Type:       req.Type,
		ParentID:   parentID,
		IssueID:    issueID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create channel message")
		return
	}
	_ = h.Queries.TouchChannelSession(r.Context(), sessionID)
	resp := channelMessageToResponse(message)
	h.publish(protocol.EventChannelMessageCreated, workspaceID, actorType, actorID, map[string]any{
		"channel_id": uuidToString(channel.ID),
		"session_id": uuidToString(sessionID),
		"message":    resp,
	})
	if req.Type == "message" && actorType == "member" {
		h.dispatchChannelMessageToAgents(r.Context(), channel, session, message, workspaceID, actorUUID)
	}
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) dispatchChannelMessageToAgents(
	ctx context.Context,
	channel db.Channel,
	session db.ChannelSession,
	message db.ChannelMessage,
	workspaceID string,
	requesterID pgtype.UUID,
) {
	h.createAndDispatchChannelPlan(ctx, channel, session, message, workspaceID, requesterID)
}

func (h *Handler) getOrCreateChannelAgentChatSession(
	ctx context.Context,
	channel db.Channel,
	channelSession db.ChannelSession,
	requesterID pgtype.UUID,
	agentID pgtype.UUID,
) (db.ChatSession, error) {
	thread, err := h.Queries.GetChannelAgentThread(ctx, db.GetChannelAgentThreadParams{
		ChannelSessionID: channelSession.ID,
		AgentID:          agentID,
	})
	if err == nil {
		return h.Queries.GetChatSession(ctx, thread.ChatSessionID)
	}
	if !isNotFound(err) {
		return db.ChatSession{}, err
	}

	title := fmt.Sprintf("#%s / %s", channel.Slug, channelSession.Title)
	chatSession, err := h.Queries.CreateChatSession(ctx, db.CreateChatSessionParams{
		WorkspaceID: channel.WorkspaceID,
		AgentID:     agentID,
		CreatorID:   requesterID,
		Title:       title,
	})
	if err != nil {
		return db.ChatSession{}, err
	}
	thread, err = h.Queries.CreateChannelAgentThread(ctx, db.CreateChannelAgentThreadParams{
		ChannelID:        channel.ID,
		ChannelSessionID: channelSession.ID,
		AgentID:          agentID,
		ChatSessionID:    chatSession.ID,
	})
	if err == nil {
		return chatSession, nil
	}
	if isUniqueViolation(err) {
		thread, err = h.Queries.GetChannelAgentThread(ctx, db.GetChannelAgentThreadParams{
			ChannelSessionID: channelSession.ID,
			AgentID:          agentID,
		})
		if err == nil {
			return h.Queries.GetChatSession(ctx, thread.ChatSessionID)
		}
	}
	return db.ChatSession{}, err
}

func (h *Handler) buildChannelChatPrompt(channel db.Channel, session db.ChannelSession, content string) string {
	return channelprompt.Build(channel, session, content, nil)
}

func (h *Handler) createChannelSystemMessage(
	ctx context.Context,
	channel db.Channel,
	sessionID pgtype.UUID,
	parentID pgtype.UUID,
	workspaceID string,
	content string,
) {
	message, err := h.Queries.CreateChannelMessage(ctx, db.CreateChannelMessageParams{
		ChannelID:  channel.ID,
		SessionID:  sessionID,
		AuthorType: "system",
		AuthorID:   pgtype.UUID{},
		Content:    content,
		Type:       "system",
		ParentID:   parentID,
		IssueID:    pgtype.UUID{},
	})
	if err != nil {
		slog.Warn("failed to create channel system message", "channel_id", uuidToString(channel.ID), "session_id", uuidToString(sessionID), "error", err)
		return
	}
	_ = h.Queries.TouchChannelSession(ctx, sessionID)
	h.publish(protocol.EventChannelMessageCreated, workspaceID, "system", "", map[string]any{
		"channel_id": uuidToString(channel.ID),
		"session_id": uuidToString(sessionID),
		"message":    channelMessageToResponse(message),
	})
}

func (h *Handler) ListChannelIssues(w http.ResponseWriter, r *http.Request) {
	channel, _, _, ok := h.loadChannelInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	rows, err := h.Queries.ListChannelIssues(r.Context(), channel.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list channel issues")
		return
	}
	prefix := h.getIssuePrefix(r.Context(), channel.WorkspaceID)
	resp := make([]ChannelIssueResponse, len(rows))
	for i, row := range rows {
		resp[i] = ChannelIssueResponse{
			IssueID:      uuidToString(row.IssueID),
			ChannelID:    uuidToString(row.ChannelID),
			SessionID:    uuidToPtr(row.SessionID),
			LinkedByType: row.LinkedByType,
			LinkedByID:   uuidToPtr(row.LinkedByID),
			Identifier:   strconv.Itoa(int(row.Number)),
			Number:       row.Number,
			Title:        row.Title,
			Status:       row.Status,
			Priority:     row.Priority,
			CreatedAt:    timestampToString(row.CreatedAt),
		}
		if prefix != "" {
			resp[i].Identifier = prefix + "-" + strconv.Itoa(int(row.Number))
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) LinkIssueToChannel(w http.ResponseWriter, r *http.Request) {
	channel, _, workspaceID, ok := h.loadChannelInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var req struct {
		IssueID   string `json:"issue_id"`
		SessionID string `json:"session_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.IssueID == "" {
		writeError(w, http.StatusBadRequest, "issue_id is required")
		return
	}
	issue, ok := h.loadIssueForUser(w, r, req.IssueID)
	if !ok {
		return
	}
	sessionID, ok := nullableUUIDFromString(w, req.SessionID, "session_id")
	if !ok {
		return
	}
	if sessionID.Valid {
		if _, err := h.Queries.GetChannelSession(r.Context(), db.GetChannelSessionParams{
			ID:          sessionID,
			ChannelID:   channel.ID,
			WorkspaceID: channel.WorkspaceID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "session not found in this channel")
			return
		}
	}
	userID := requestUserID(r)
	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	actorUUID, ok := nullableUUIDFromString(w, actorID, "actor_id")
	if !ok {
		return
	}
	link, err := h.Queries.LinkIssueToChannel(r.Context(), db.LinkIssueToChannelParams{
		IssueID:      issue.ID,
		ChannelID:    channel.ID,
		SessionID:    sessionID,
		LinkedByType: actorType,
		LinkedByID:   actorUUID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to link issue to channel")
		return
	}
	h.publish(protocol.EventChannelIssueLinked, workspaceID, actorType, actorID, map[string]any{
		"channel_id": uuidToString(channel.ID),
		"issue_id":   uuidToString(issue.ID),
	})
	writeJSON(w, http.StatusCreated, map[string]any{
		"issue_id":   uuidToString(link.IssueID),
		"channel_id": uuidToString(link.ChannelID),
		"session_id": uuidToPtr(link.SessionID),
	})
}

func (h *Handler) ListChannelApprovals(w http.ResponseWriter, r *http.Request) {
	channel, _, _, ok := h.loadChannelInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	approvals, err := h.Queries.ListApprovalRequestsForChannel(r.Context(), channel.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list approval requests")
		return
	}
	resp := make([]ApprovalRequestResponse, len(approvals))
	for i, approval := range approvals {
		resp[i] = approvalRequestToResponse(approval)
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) CreateChannelApproval(w http.ResponseWriter, r *http.Request) {
	channel, _, workspaceID, ok := h.loadChannelInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var req struct {
		SessionID     string          `json:"session_id"`
		IssueID       string          `json:"issue_id"`
		ActionType    string          `json:"action_type"`
		ActionPayload json.RawMessage `json:"action_payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.ActionType = strings.TrimSpace(req.ActionType)
	if req.ActionType == "" {
		writeError(w, http.StatusBadRequest, "action_type is required")
		return
	}
	sessionID, ok := nullableUUIDFromString(w, req.SessionID, "session_id")
	if !ok {
		return
	}
	if sessionID.Valid {
		if _, err := h.Queries.GetChannelSession(r.Context(), db.GetChannelSessionParams{
			ID:          sessionID,
			ChannelID:   channel.ID,
			WorkspaceID: channel.WorkspaceID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "session not found in this channel")
			return
		}
	}
	issueID, ok := nullableUUIDFromString(w, req.IssueID, "issue_id")
	if !ok {
		return
	}
	if issueID.Valid {
		if _, err := h.Queries.GetIssueInWorkspace(r.Context(), db.GetIssueInWorkspaceParams{
			ID:          issueID,
			WorkspaceID: channel.WorkspaceID,
		}); err != nil {
			writeError(w, http.StatusBadRequest, "issue not found in this workspace")
			return
		}
	}
	if len(req.ActionPayload) == 0 {
		req.ActionPayload = json.RawMessage(`{}`)
	}
	if !json.Valid(req.ActionPayload) {
		writeError(w, http.StatusBadRequest, "action_payload must be valid JSON")
		return
	}
	userID := requestUserID(r)
	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	actorUUID, ok := nullableUUIDFromString(w, actorID, "actor_id")
	if !ok {
		return
	}
	approval, err := h.Queries.CreateApprovalRequest(r.Context(), db.CreateApprovalRequestParams{
		WorkspaceID:     channel.WorkspaceID,
		ChannelID:       channel.ID,
		SessionID:       sessionID,
		IssueID:         issueID,
		RequestedByType: actorType,
		RequestedByID:   actorUUID,
		ActionType:      req.ActionType,
		ActionPayload:   []byte(req.ActionPayload),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create approval request")
		return
	}
	resp := approvalRequestToResponse(approval)
	h.publish(protocol.EventChannelApprovalUpdated, workspaceID, actorType, actorID, map[string]any{
		"channel_id": uuidToString(channel.ID),
		"approval":   resp,
	})
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) ResolveChannelApproval(w http.ResponseWriter, r *http.Request, status string) {
	channel, _, workspaceID, ok := h.loadChannelInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	approvalID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "approvalId"), "approval id")
	if !ok {
		return
	}
	if _, err := h.Queries.GetApprovalRequestInChannel(r.Context(), db.GetApprovalRequestInChannelParams{
		ID:          approvalID,
		WorkspaceID: channel.WorkspaceID,
		ChannelID:   channel.ID,
	}); err != nil {
		writeError(w, http.StatusNotFound, "approval request not found")
		return
	}
	var req struct {
		ResolutionNote string `json:"resolution_note"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	userID := requestUserID(r)
	userUUID, ok := parseUUIDOrBadRequest(w, userID, "user_id")
	if !ok {
		return
	}
	approval, err := h.Queries.ResolveApprovalRequest(r.Context(), db.ResolveApprovalRequestParams{
		ID:             approvalID,
		WorkspaceID:    channel.WorkspaceID,
		Status:         status,
		ResolutionNote: optionalText(req.ResolutionNote),
		ResolvedBy:     userUUID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to resolve approval request")
		return
	}
	resp := approvalRequestToResponse(approval)
	h.publish(protocol.EventChannelApprovalUpdated, workspaceID, "member", userID, map[string]any{
		"channel_id": uuidToString(channel.ID),
		"approval":   resp,
	})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) ApproveChannelApproval(w http.ResponseWriter, r *http.Request) {
	h.ResolveChannelApproval(w, r, "approved")
}

func (h *Handler) RejectChannelApproval(w http.ResponseWriter, r *http.Request) {
	h.ResolveChannelApproval(w, r, "rejected")
}
