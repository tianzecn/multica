package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/channelprompt"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

const (
	channelDispatchModeSingle     = "single"
	channelDispatchModeParallel   = "parallel"
	channelDispatchModeSerial     = "serial"
	channelDispatchModeRoundtable = "roundtable"
)

type channelDispatchAgent struct {
	Agent db.Agent
	Name  string
}

type channelDispatchDraft struct {
	Mode          string
	Confidence    float64
	PlannerSource string
	Reason        string
	Steps         []channelDispatchStepDraft
}

type channelDispatchStepDraft struct {
	AgentID       pgtype.UUID
	Role          string
	Instruction   string
	DependsOn     []pgtype.UUID
	Status        string
	SkipReason    string
	SourceStepKey string
}

func (h *Handler) createAndDispatchChannelPlan(
	ctx context.Context,
	channel db.Channel,
	session db.ChannelSession,
	message db.ChannelMessage,
	workspaceID string,
	requesterID pgtype.UUID,
) {
	if h.TaskService == nil {
		return
	}
	agents, targetIDs, reason, ok := h.resolveChannelDispatchTargets(ctx, channel, message)
	if !ok {
		h.createChannelSystemMessage(ctx, channel, session.ID, message.ID, workspaceID, reason)
		return
	}
	draft := buildChannelDispatchDraft(channel, message.Content, targetIDs, agents, reason)
	plan, err := h.Queries.CreateChannelDispatchPlan(ctx, db.CreateChannelDispatchPlanParams{
		ChannelID:        channel.ID,
		ChannelSessionID: session.ID,
		TriggerMessageID: message.ID,
		Mode:             draft.Mode,
		Status:           "queued",
		Confidence:       draft.Confidence,
		PlannerSource:    draft.PlannerSource,
		Reason:           draft.Reason,
		ParticipantCount: int32(len(draft.Steps)),
	})
	if err != nil {
		slog.Warn("failed to create channel dispatch plan", "channel_id", uuidToString(channel.ID), "message_id", uuidToString(message.ID), "error", err)
		h.createChannelSystemMessage(ctx, channel, session.ID, message.ID, workspaceID, "无法生成频道协作计划，请稍后重试。")
		return
	}

	createdParticipantStepIDs := make([]pgtype.UUID, 0, len(draft.Steps))
	var previousStepID pgtype.UUID
	for i, stepDraft := range draft.Steps {
		dependsOn := make([]pgtype.UUID, 0, len(stepDraft.DependsOn))
		dependsOn = append(dependsOn, stepDraft.DependsOn...)
		if draft.Mode == channelDispatchModeSerial && i > 0 && previousStepID.Valid {
			dependsOn = []pgtype.UUID{previousStepID}
		}
		if draft.Mode == channelDispatchModeRoundtable && stepDraft.Role == "summarizer" {
			dependsOn = append([]pgtype.UUID{}, createdParticipantStepIDs...)
		}
		step, err := h.Queries.CreateChannelDispatchStep(ctx, db.CreateChannelDispatchStepParams{
			PlanID:           plan.ID,
			ChannelID:        channel.ID,
			ChannelSessionID: session.ID,
			TriggerMessageID: message.ID,
			AgentID:          stepDraft.AgentID,
			Position:         int32(i + 1),
			Role:             stepDraft.Role,
			Status:           stepDraft.Status,
			Instruction:      stepDraft.Instruction,
			DependsOnStepIds: dependsOn,
			SkipReason:       stepDraft.SkipReason,
		})
		if err != nil {
			slog.Warn("failed to create channel dispatch step", "plan_id", uuidToString(plan.ID), "agent_id", uuidToString(stepDraft.AgentID), "error", err)
			continue
		}
		if step.Status != "skipped" {
			previousStepID = step.ID
		}
		if step.Role == "participant" && step.Status != "skipped" {
			createdParticipantStepIDs = append(createdParticipantStepIDs, step.ID)
		}
	}
	h.publishChannelDispatchPlan(ctx, workspaceID, plan.ID)
	h.dispatchReadyChannelDispatchSteps(ctx, channel, session, plan.ID, message, requesterID, workspaceID)
}

func (h *Handler) resolveChannelDispatchTargets(ctx context.Context, channel db.Channel, message db.ChannelMessage) (map[string]channelDispatchAgent, []pgtype.UUID, string, bool) {
	members, err := h.Queries.ListChannelMembers(ctx, channel.ID)
	if err != nil {
		slog.Warn("failed to list channel members for dispatch planning", "channel_id", uuidToString(channel.ID), "error", err)
		return nil, nil, "无法读取频道成员，暂时不能派发 AI。", false
	}
	agents := make(map[string]channelDispatchAgent)
	orderedAgentIDs := make([]pgtype.UUID, 0, len(members))
	for _, member := range members {
		if member.MemberType != "agent" {
			continue
		}
		key := uuidToString(member.MemberID)
		if key == "" {
			continue
		}
		if _, exists := agents[key]; exists {
			continue
		}
		agent, err := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{
			ID:          member.MemberID,
			WorkspaceID: channel.WorkspaceID,
		})
		if err != nil {
			continue
		}
		agents[key] = channelDispatchAgent{Agent: agent, Name: channelDispatchAgentName(agent)}
		orderedAgentIDs = append(orderedAgentIDs, member.MemberID)
	}
	if len(orderedAgentIDs) == 0 {
		return agents, nil, "这个频道还没有 AI 同事。请先在频道成员里加入智能体。", false
	}

	mentions := util.ParseMentions(message.Content)
	targets := make([]pgtype.UUID, 0, len(orderedAgentIDs))
	seen := map[string]struct{}{}
	addTarget := func(id pgtype.UUID) {
		key := uuidToString(id)
		if key == "" {
			return
		}
		if _, exists := agents[key]; !exists {
			return
		}
		if _, exists := seen[key]; exists {
			return
		}
		seen[key] = struct{}{}
		targets = append(targets, id)
	}
	if util.HasMentionAll(mentions) {
		for _, id := range orderedAgentIDs {
			addTarget(id)
		}
		return agents, targets, "@all 触发，频道内 AI 同事并行参与。", true
	}
	for _, mention := range mentions {
		if mention.Type != "agent" {
			continue
		}
		if _, exists := agents[mention.ID]; exists {
			id, err := util.ParseUUID(mention.ID)
			if err == nil {
				addTarget(id)
			}
		}
	}
	if len(targets) > 0 {
		return agents, targets, "根据 @ 提及选择频道 AI 同事。", true
	}

	switch channel.Proactivity {
	case "quiet":
		return agents, nil, "这个频道处于安静档。请 @具体智能体，或 @all 让 AI 同事参与。", false
	case "standard":
		if len(orderedAgentIDs) == 1 {
			addTarget(orderedAgentIDs[0])
			return agents, targets, "标准档：频道只有一位 AI 同事，自动派发。", true
		}
		return agents, nil, "这个频道有多个 AI 同事。请 @具体智能体，或 @all 让全部 AI 同事参与。", false
	default:
		for _, id := range orderedAgentIDs {
			addTarget(id)
		}
		return agents, targets, "主动档：未 @AI 时自动选择频道内相关 AI 同事。", true
	}
}

func buildChannelDispatchDraft(channel db.Channel, content string, targetIDs []pgtype.UUID, agents map[string]channelDispatchAgent, reason string) channelDispatchDraft {
	mode, confidence := inferChannelDispatchMode(content, len(targetIDs))
	plannerSource := "rules"
	if confidence < 0.7 {
		plannerSource = "fallback"
	}
	draft := channelDispatchDraft{
		Mode:          mode,
		Confidence:    confidence,
		PlannerSource: plannerSource,
		Reason:        reason + " " + channelDispatchModeReason(mode, confidence),
	}
	validTargets := make([]pgtype.UUID, 0, len(targetIDs))
	for _, id := range targetIDs {
		agent := agents[uuidToString(id)]
		status, skipReason := channelDispatchAgentInitialStatus(agent.Agent)
		if status == "skipped" {
			draft.Steps = append(draft.Steps, channelDispatchStepDraft{
				AgentID:     id,
				Role:        "participant",
				Status:      "skipped",
				SkipReason:  skipReason,
				Instruction: "Skipped before dispatch.",
			})
			continue
		}
		validTargets = append(validTargets, id)
	}
	if len(validTargets) == 0 {
		draft.Mode = channelDispatchModeSingle
		draft.Confidence = 0.5
		return draft
	}
	if len(validTargets) == 1 {
		draft.Mode = channelDispatchModeSingle
	}
	switch draft.Mode {
	case channelDispatchModeSerial:
		var previous pgtype.UUID
		for i, id := range validTargets {
			key := fmt.Sprintf("serial:%d", i)
			deps := []pgtype.UUID{}
			if previous.Valid {
				deps = append(deps, previous)
			}
			draft.Steps = append(draft.Steps, channelDispatchStepDraft{
				AgentID:       id,
				Role:          "participant",
				Status:        "pending",
				DependsOn:     deps,
				SourceStepKey: key,
				Instruction:   serialStepInstruction(i, agentNameByID(agents, id)),
			})
			previous = pgtype.UUID{}
		}
	case channelDispatchModeRoundtable:
		summarizer := chooseRoundtableSummarizer(validTargets, agents)
		for i, id := range validTargets {
			if uuidToString(id) == uuidToString(summarizer) {
				continue
			}
			key := fmt.Sprintf("roundtable:%d", i)
			draft.Steps = append(draft.Steps, channelDispatchStepDraft{
				AgentID:       id,
				Role:          "participant",
				Status:        "pending",
				SourceStepKey: key,
				Instruction:   "先独立给出你的专业判断，避免替其他 AI 下结论。",
			})
		}
		if len(draft.Steps) == 0 {
			draft.Mode = channelDispatchModeSingle
			draft.Steps = append(draft.Steps, singleStepDraft(summarizer))
			break
		}
		draft.Steps = append(draft.Steps, channelDispatchStepDraft{
			AgentID:     summarizer,
			Role:        "summarizer",
			Status:      "pending",
			Instruction: "等待前面 AI 的真实发言后再总结，明确分歧、共识、风险和下一步。",
		})
	default:
		for _, id := range validTargets {
			instruction := "独立给出你的专业判断；如果已有其他 AI 发言，只引用当前计划相关内容。"
			if draft.Mode == channelDispatchModeSingle {
				instruction = "直接回应用户，并说明你能推进的下一步。"
			}
			draft.Steps = append(draft.Steps, channelDispatchStepDraft{
				AgentID:     id,
				Role:        "participant",
				Status:      "pending",
				Instruction: instruction,
			})
		}
	}
	if len(draft.Steps) == 0 {
		draft.Steps = append(draft.Steps, singleStepDraft(validTargets[0]))
	}
	return draft
}

func singleStepDraft(agentID pgtype.UUID) channelDispatchStepDraft {
	return channelDispatchStepDraft{
		AgentID:     agentID,
		Role:        "participant",
		Status:      "pending",
		Instruction: "直接回应用户，并说明你能推进的下一步。",
	}
}

func inferChannelDispatchMode(content string, targetCount int) (string, float64) {
	if targetCount <= 1 {
		return channelDispatchModeSingle, 0.95
	}
	normalized := strings.ToLower(strings.TrimSpace(content))
	hasParallel := containsAny(normalized, "分别", "各自", "同时", "并行", "一起", "都说", "都发", "parallel", "in parallel", "@all")
	hasSummary := containsAny(normalized, "总结", "汇总", "收口", "归纳", "最终意见", "最后结论", "summarize", "summary")
	if hasParallel && hasSummary {
		return channelDispatchModeRoundtable, 0.9
	}
	if containsAny(normalized, "你先", "先说", "先发言", "先回答", "先讲", "先来", "然后", "之后", "接着", "随后", "轮流", "依次", "反驳", "回应", "根据", "基于", "等待", "等他", "等她", "after", "then", "respond to", "reply to", "argue") {
		return channelDispatchModeSerial, 0.86
	}
	if hasSummary {
		return channelDispatchModeRoundtable, 0.78
	}
	if hasParallel {
		return channelDispatchModeParallel, 0.88
	}
	return channelDispatchModeParallel, 0.62
}

func channelDispatchModeReason(mode string, confidence float64) string {
	switch mode {
	case channelDispatchModeSingle:
		return "Planner 判断为 single：单个 AI 直接响应。"
	case channelDispatchModeSerial:
		return "Planner 判断为 serial：后续 AI 等依赖发言后再启动。"
	case channelDispatchModeRoundtable:
		return "Planner 判断为 roundtable：先多人发言，再由总结 AI 收口。"
	default:
		if confidence < 0.7 {
			return "Planner 低置信度降级为 parallel：先让相关 AI 各自发言。"
		}
		return "Planner 判断为 parallel：相关 AI 并行发言。"
	}
}

func containsAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(value, needle) {
			return true
		}
	}
	return false
}

func channelDispatchAgentInitialStatus(agent db.Agent) (string, string) {
	if agent.ArchivedAt.Valid {
		return "skipped", channelDispatchAgentName(agent) + " 已归档。"
	}
	if !agent.RuntimeID.Valid {
		return "skipped", channelDispatchAgentName(agent) + " 未绑定运行时。"
	}
	return "pending", ""
}

func channelDispatchAgentName(agent db.Agent) string {
	name := strings.TrimSpace(agent.Name)
	if name != "" {
		return name
	}
	return uuidToString(agent.ID)
}

func agentNameByID(agents map[string]channelDispatchAgent, id pgtype.UUID) string {
	if agent, ok := agents[uuidToString(id)]; ok {
		return agent.Name
	}
	return uuidToString(id)
}

func serialStepInstruction(index int, name string) string {
	if index == 0 {
		return "你先发言，给出自己的专业判断。"
	}
	return "等待前面 AI 的真实发言后再回应；必须基于已经出现的发言，不要提前假设。"
}

func chooseRoundtableSummarizer(targetIDs []pgtype.UUID, agents map[string]channelDispatchAgent) pgtype.UUID {
	for _, id := range targetIDs {
		name := strings.ToLower(agentNameByID(agents, id))
		if strings.Contains(name, "技术负责人") || strings.Contains(name, "负责人") || strings.Contains(name, "lead") || strings.Contains(name, "manager") || strings.Contains(name, "产品经理") {
			return id
		}
	}
	return targetIDs[len(targetIDs)-1]
}

func (h *Handler) dispatchReadyChannelDispatchSteps(
	ctx context.Context,
	channel db.Channel,
	session db.ChannelSession,
	planID pgtype.UUID,
	message db.ChannelMessage,
	requesterID pgtype.UUID,
	workspaceID string,
) {
	if h.TaskService == nil {
		return
	}
	ready, err := h.Queries.ListReadyChannelDispatchSteps(ctx, planID)
	if err != nil {
		slog.Warn("failed to list ready channel dispatch steps", "plan_id", uuidToString(planID), "error", err)
		return
	}
	dispatched := 0
	for _, step := range ready {
		if h.dispatchChannelDispatchStep(ctx, channel, session, message, step, requesterID, workspaceID) {
			dispatched++
		}
	}
	if dispatched > 0 {
		_, _ = h.Queries.UpdateChannelDispatchPlanStatus(ctx, db.UpdateChannelDispatchPlanStatusParams{
			ID:     planID,
			Status: "running",
		})
	}
	if len(ready) > 0 {
		nextReady, err := h.Queries.ListReadyChannelDispatchSteps(ctx, planID)
		if err == nil && len(nextReady) > 0 {
			h.dispatchReadyChannelDispatchSteps(ctx, channel, session, planID, message, requesterID, workspaceID)
			return
		}
	}
	h.refreshChannelDispatchPlanStatus(ctx, planID, workspaceID)
}

func (h *Handler) dispatchChannelDispatchStep(
	ctx context.Context,
	channel db.Channel,
	session db.ChannelSession,
	message db.ChannelMessage,
	step db.ChannelDispatchStep,
	requesterID pgtype.UUID,
	workspaceID string,
) bool {
	agent, err := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{
		ID:          step.AgentID,
		WorkspaceID: channel.WorkspaceID,
	})
	if err != nil {
		h.markChannelDispatchStep(ctx, step.ID, "failed", "无法读取 AI 同事。", "")
		h.publishChannelDispatchStep(ctx, workspaceID, step.PlanID)
		return false
	}
	if status, skipReason := channelDispatchAgentInitialStatus(agent); status == "skipped" {
		h.markChannelDispatchStep(ctx, step.ID, "skipped", "", skipReason)
		h.publishChannelDispatchStep(ctx, workspaceID, step.PlanID)
		return false
	}
	chatSession, err := h.getOrCreateChannelAgentChatSession(ctx, channel, session, requesterID, agent.ID)
	if err != nil {
		h.markChannelDispatchStep(ctx, step.ID, "failed", "无法准备 AI 会话。", "")
		h.publishChannelDispatchStep(ctx, workspaceID, step.PlanID)
		return false
	}
	recentMessages := h.recentChannelPromptMessages(ctx, channel.ID, session.ID, message)
	promptContent := h.channelMessagePromptContent(ctx, workspaceID, message)
	prompt := channelprompt.BuildWithInstruction(channel, session, promptContent, recentMessages, step.Instruction)
	chatMessage, err := h.Queries.CreateChatMessage(ctx, db.CreateChatMessageParams{
		ChatSessionID: chatSession.ID,
		Role:          "user",
		Content:       prompt,
	})
	if err != nil {
		h.markChannelDispatchStep(ctx, step.ID, "failed", "无法创建 AI 会话消息。", "")
		h.publishChannelDispatchStep(ctx, workspaceID, step.PlanID)
		return false
	}
	task, err := h.TaskService.EnqueueChatTask(ctx, chatSession, requesterID, false)
	if err != nil {
		h.markChannelDispatchStep(ctx, step.ID, "failed", "无法派发给 AI 运行时。", "")
		h.publishChannelDispatchStep(ctx, workspaceID, step.PlanID)
		return false
	}
	if _, err := h.Queries.CreateChannelAgentRun(ctx, db.CreateChannelAgentRunParams{
		ChannelID:         channel.ID,
		ChannelSessionID:  session.ID,
		UserMessageID:     message.ID,
		AgentID:           agent.ID,
		ChatSessionID:     chatSession.ID,
		ChatUserMessageID: chatMessage.ID,
		TaskID:            task.ID,
		DispatchStepID:    step.ID,
	}); err != nil {
		slog.Warn("failed to link channel dispatch step to agent run", "step_id", uuidToString(step.ID), "task_id", uuidToString(task.ID), "error", err)
		h.markChannelDispatchStep(ctx, step.ID, "failed", "无法记录 AI 派发状态。", "")
		h.publishChannelDispatchStep(ctx, workspaceID, step.PlanID)
		return false
	}
	h.markChannelDispatchStep(ctx, step.ID, "queued", "", "")
	h.publishChannelDispatchStep(ctx, workspaceID, step.PlanID)
	return true
}

func (h *Handler) channelMessagePromptContent(ctx context.Context, workspaceID string, message db.ChannelMessage) string {
	attachments, err := h.Queries.ListAttachmentsByChannelMessage(ctx, db.ListAttachmentsByChannelMessageParams{
		ChannelMessageID: message.ID,
		WorkspaceID:      parseUUID(workspaceID),
	})
	if err != nil || len(attachments) == 0 {
		return message.Content
	}

	var builder strings.Builder
	builder.WriteString(message.Content)
	builder.WriteString("\n\nAttached files available through Multica CLI:\n")
	for _, attachment := range attachments {
		builder.WriteString("- ")
		builder.WriteString(uuidToString(attachment.ID))
		builder.WriteString(" ")
		builder.WriteString(attachment.Filename)
		if attachment.ContentType != "" {
			builder.WriteString(" (")
			builder.WriteString(attachment.ContentType)
			builder.WriteString(")")
		}
		builder.WriteString("\n")
	}
	builder.WriteString("Use `multica attachment download <id>` before analyzing any attached file.\n")
	return builder.String()
}

func (h *Handler) markChannelDispatchStep(ctx context.Context, stepID pgtype.UUID, status, errText, skipReason string) {
	_, err := h.Queries.UpdateChannelDispatchStepStatus(ctx, db.UpdateChannelDispatchStepStatusParams{
		ID:         stepID,
		Status:     status,
		Error:      optionalText(errText),
		SkipReason: optionalText(skipReason),
	})
	if err != nil {
		slog.Warn("failed to update channel dispatch step status", "step_id", uuidToString(stepID), "status", status, "error", err)
	}
}

func (h *Handler) recentChannelPromptMessages(ctx context.Context, channelID, sessionID pgtype.UUID, original db.ChannelMessage) []channelprompt.Message {
	rows, err := h.Queries.ListChannelMessagesBySession(ctx, db.ListChannelMessagesBySessionParams{
		ChannelID: channelID,
		SessionID: sessionID,
		Limit:     30,
	})
	if err != nil {
		slog.Warn("failed to load recent channel messages for dispatch prompt", "channel_id", uuidToString(channelID), "session_id", uuidToString(sessionID), "error", err)
		return nil
	}
	messages := make([]channelprompt.Message, 0, len(rows))
	for i := len(rows) - 1; i >= 0; i-- {
		message := rows[i]
		if uuidToString(message.ID) == uuidToString(original.ID) {
			continue
		}
		if message.CreatedAt.Valid && original.CreatedAt.Valid && message.CreatedAt.Time.Before(original.CreatedAt.Time) {
			continue
		}
		if message.AuthorType == "system" || message.Type == "system" {
			continue
		}
		content := strings.TrimSpace(message.Content)
		if content == "" {
			continue
		}
		messages = append(messages, channelprompt.Message{
			Author:  h.channelMessageAuthorLabel(ctx, message),
			Content: content,
		})
	}
	return messages
}

func (h *Handler) channelMessageAuthorLabel(ctx context.Context, message db.ChannelMessage) string {
	switch message.AuthorType {
	case "agent":
		if message.AuthorID.Valid {
			if agent, err := h.Queries.GetAgent(ctx, message.AuthorID); err == nil && strings.TrimSpace(agent.Name) != "" {
				return agent.Name
			}
		}
		return "AI teammate"
	case "member":
		return "User"
	default:
		return "System"
	}
}

func (h *Handler) refreshChannelDispatchPlanStatus(ctx context.Context, planID pgtype.UUID, workspaceID string) {
	steps, err := h.Queries.ListChannelDispatchStepsByPlan(ctx, planID)
	if err != nil {
		return
	}
	incomplete := 0
	completed := 0
	failed := 0
	for _, step := range steps {
		status := step.TaskStatus
		if status == "" {
			status = step.Status
		}
		switch status {
		case "pending", "queued", "dispatched", "running":
			incomplete++
		case "completed", "skipped":
			completed++
		case "failed":
			failed++
		}
	}
	if incomplete > 0 {
		_, _ = h.Queries.RefreshChannelDispatchPlanStats(ctx, planID)
		h.publishChannelDispatchPlan(ctx, workspaceID, planID)
		return
	}
	status := "completed"
	if failed > 0 && completed == 0 {
		status = "failed"
	} else if failed > 0 {
		status = "paused"
	}
	_, _ = h.Queries.UpdateChannelDispatchPlanStatus(ctx, db.UpdateChannelDispatchPlanStatusParams{ID: planID, Status: status})
	_, _ = h.Queries.RefreshChannelDispatchPlanStats(ctx, planID)
	h.publishChannelDispatchPlan(ctx, workspaceID, planID)
}

func (h *Handler) publishChannelDispatchPlan(ctx context.Context, workspaceID string, planID pgtype.UUID) {
	plan, err := h.Queries.GetChannelDispatchPlanByID(ctx, planID)
	if err != nil {
		return
	}
	h.publishChannelDispatchPlanPayload(ctx, workspaceID, plan)
}

func (h *Handler) publishChannelDispatchStep(ctx context.Context, workspaceID string, planID pgtype.UUID) {
	h.publishChannelDispatchPlan(ctx, workspaceID, planID)
}

func (h *Handler) publishChannelDispatchPlanPayload(ctx context.Context, workspaceID string, plan db.ChannelDispatchPlan) {
	steps, _ := h.channelDispatchStepResponses(ctx, plan.ID)
	h.publish(protocol.EventChannelDispatchPlanUpdated, workspaceID, "system", "", map[string]any{
		"channel_id": uuidToString(plan.ChannelID),
		"session_id": uuidToString(plan.ChannelSessionID),
		"plan":       channelDispatchPlanToResponse(plan, steps),
	})
}

func (h *Handler) channelDispatchStepResponses(ctx context.Context, planID pgtype.UUID) ([]ChannelDispatchStepResponse, error) {
	rows, err := h.Queries.ListChannelDispatchStepsByPlan(ctx, planID)
	if err != nil {
		return nil, err
	}
	steps := make([]ChannelDispatchStepResponse, len(rows))
	for i, row := range rows {
		steps[i] = channelDispatchStepToResponse(row)
	}
	return steps, nil
}

func (h *Handler) ListChannelDispatchPlans(w http.ResponseWriter, r *http.Request) {
	channel, _, workspaceID, ok := h.loadChannelInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	sessionID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "sessionId"), "session id")
	if !ok {
		return
	}
	if _, err := h.Queries.GetChannelSession(r.Context(), db.GetChannelSessionParams{
		ID:          sessionID,
		ChannelID:   channel.ID,
		WorkspaceID: channel.WorkspaceID,
	}); err != nil {
		writeError(w, http.StatusNotFound, "channel session not found")
		return
	}
	resp, err := h.listChannelDispatchPlanResponses(r.Context(), channel.ID, sessionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list channel dispatch plans")
		return
	}
	_ = workspaceID
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) GetChannelDispatchPlan(w http.ResponseWriter, r *http.Request) {
	plan, ok := h.loadChannelDispatchPlan(w, r)
	if !ok {
		return
	}
	steps, err := h.channelDispatchStepResponses(r.Context(), plan.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list channel dispatch steps")
		return
	}
	writeJSON(w, http.StatusOK, channelDispatchPlanToResponse(plan, steps))
}

func (h *Handler) CancelChannelDispatchPlan(w http.ResponseWriter, r *http.Request) {
	channel, _, workspaceID, plan, ok := h.loadChannelDispatchPlanWithChannel(w, r)
	if !ok {
		return
	}
	steps, _ := h.Queries.ListChannelDispatchStepsByPlan(r.Context(), plan.ID)
	if h.TaskService != nil {
		for _, step := range steps {
			if step.TaskID.Valid && (step.TaskStatus == "queued" || step.TaskStatus == "dispatched" || step.TaskStatus == "running") {
				_, _ = h.TaskService.CancelTask(r.Context(), step.TaskID)
			}
		}
	}
	_, _ = h.Queries.CancelPendingChannelDispatchSteps(r.Context(), plan.ID)
	updated, err := h.Queries.UpdateChannelDispatchPlanStatus(r.Context(), db.UpdateChannelDispatchPlanStatusParams{
		ID:     plan.ID,
		Status: "cancelled",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to cancel channel dispatch plan")
		return
	}
	h.recordChannelDispatchFeedback(r.Context(), plan.ID, pgtype.UUID{}, "cancel", plan.Mode, plan.Mode, r, nil)
	h.publishChannelDispatchPlanPayload(r.Context(), workspaceID, updated)
	_ = channel
	stepsResp, _ := h.channelDispatchStepResponses(r.Context(), updated.ID)
	writeJSON(w, http.StatusOK, channelDispatchPlanToResponse(updated, stepsResp))
}

func (h *Handler) RetryChannelDispatchStep(w http.ResponseWriter, r *http.Request) {
	channel, session, workspaceID, plan, step, ok := h.loadChannelDispatchStepContext(w, r)
	if !ok {
		return
	}
	_, err := h.Queries.ResetChannelDispatchStepForRetry(r.Context(), step.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to retry channel dispatch step")
		return
	}
	message, err := h.Queries.GetChannelMessage(r.Context(), step.TriggerMessageID)
	if err != nil {
		writeError(w, http.StatusNotFound, "trigger message not found")
		return
	}
	requesterID := message.AuthorID
	if !requesterID.Valid {
		requesterID = channel.CreatedBy
	}
	h.recordChannelDispatchFeedback(r.Context(), plan.ID, step.ID, "retry", plan.Mode, plan.Mode, r, nil)
	h.dispatchReadyChannelDispatchSteps(r.Context(), channel, session, plan.ID, message, requesterID, workspaceID)
	updated, _ := h.Queries.RefreshChannelDispatchPlanStats(r.Context(), plan.ID)
	steps, _ := h.channelDispatchStepResponses(r.Context(), plan.ID)
	writeJSON(w, http.StatusOK, channelDispatchPlanToResponse(updated, steps))
}

func (h *Handler) SkipChannelDispatchStep(w http.ResponseWriter, r *http.Request) {
	channel, session, workspaceID, plan, step, ok := h.loadChannelDispatchStepContext(w, r)
	if !ok {
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if strings.TrimSpace(req.Reason) == "" {
		req.Reason = "Skipped by user."
	}
	h.markChannelDispatchStep(r.Context(), step.ID, "skipped", "", req.Reason)
	h.recordChannelDispatchFeedback(r.Context(), plan.ID, step.ID, "skip", plan.Mode, plan.Mode, r, map[string]any{"reason": req.Reason})
	if message, err := h.Queries.GetChannelMessage(r.Context(), step.TriggerMessageID); err == nil {
		requesterID := message.AuthorID
		if !requesterID.Valid {
			requesterID = channel.CreatedBy
		}
		h.dispatchReadyChannelDispatchSteps(r.Context(), channel, session, plan.ID, message, requesterID, workspaceID)
	} else {
		h.publishChannelDispatchStep(r.Context(), workspaceID, plan.ID)
	}
	updated, _ := h.Queries.RefreshChannelDispatchPlanStats(r.Context(), plan.ID)
	steps, _ := h.channelDispatchStepResponses(r.Context(), plan.ID)
	writeJSON(w, http.StatusOK, channelDispatchPlanToResponse(updated, steps))
}

func (h *Handler) AddAgentToChannelDispatchPlan(w http.ResponseWriter, r *http.Request) {
	channel, session, workspaceID, plan, ok := h.loadChannelDispatchPlanWithSession(w, r)
	if !ok {
		return
	}
	var req struct {
		AgentID string `json:"agent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	agentID, ok := parseUUIDOrBadRequest(w, req.AgentID, "agent_id")
	if !ok {
		return
	}
	if _, err := h.Queries.GetChannelMember(r.Context(), db.GetChannelMemberParams{
		ChannelID:  channel.ID,
		MemberType: "agent",
		MemberID:   agentID,
	}); err != nil {
		writeError(w, http.StatusBadRequest, "agent is not a channel member")
		return
	}
	message, err := h.Queries.GetChannelMessage(r.Context(), plan.TriggerMessageID)
	if err != nil {
		writeError(w, http.StatusNotFound, "trigger message not found")
		return
	}
	_, err = h.Queries.CreateChannelDispatchStep(r.Context(), db.CreateChannelDispatchStepParams{
		PlanID:           plan.ID,
		ChannelID:        channel.ID,
		ChannelSessionID: session.ID,
		TriggerMessageID: plan.TriggerMessageID,
		AgentID:          agentID,
		Position:         int32(plan.ParticipantCount + 1),
		Role:             "participant",
		Status:           "pending",
		Instruction:      "追加参与：独立给出你的专业判断，并结合当前计划相关发言。",
		DependsOnStepIds: []pgtype.UUID{},
		SkipReason:       "",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add agent to channel dispatch plan")
		return
	}
	h.recordChannelDispatchFeedback(r.Context(), plan.ID, pgtype.UUID{}, "add-agent", plan.Mode, plan.Mode, r, map[string]any{"agent_id": req.AgentID})
	requesterID := message.AuthorID
	if !requesterID.Valid {
		requesterID = channel.CreatedBy
	}
	h.dispatchReadyChannelDispatchSteps(r.Context(), channel, session, plan.ID, message, requesterID, workspaceID)
	updated, _ := h.Queries.RefreshChannelDispatchPlanStats(r.Context(), plan.ID)
	steps, _ := h.channelDispatchStepResponses(r.Context(), plan.ID)
	writeJSON(w, http.StatusOK, channelDispatchPlanToResponse(updated, steps))
}

func (h *Handler) ChangeChannelDispatchPlanMode(w http.ResponseWriter, r *http.Request) {
	channel, _, workspaceID, plan, ok := h.loadChannelDispatchPlanWithChannel(w, r)
	if !ok {
		return
	}
	var req struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !isValidChannelDispatchMode(req.Mode) {
		writeError(w, http.StatusBadRequest, "mode must be 'single', 'parallel', 'serial', or 'roundtable'")
		return
	}
	updated, err := h.Queries.ChangeChannelDispatchPlanMode(r.Context(), db.ChangeChannelDispatchPlanModeParams{
		ID:        plan.ID,
		ChannelID: channel.ID,
		Mode:      req.Mode,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to change channel dispatch plan mode")
		return
	}
	h.recordChannelDispatchFeedback(r.Context(), plan.ID, pgtype.UUID{}, "change-mode", plan.Mode, req.Mode, r, nil)
	h.publishChannelDispatchPlanPayload(r.Context(), workspaceID, updated)
	steps, _ := h.channelDispatchStepResponses(r.Context(), updated.ID)
	writeJSON(w, http.StatusOK, channelDispatchPlanToResponse(updated, steps))
}

func isValidChannelDispatchMode(mode string) bool {
	return mode == channelDispatchModeSingle || mode == channelDispatchModeParallel || mode == channelDispatchModeSerial || mode == channelDispatchModeRoundtable
}

func (h *Handler) listChannelDispatchPlanResponses(ctx context.Context, channelID, sessionID pgtype.UUID) ([]ChannelDispatchPlanResponse, error) {
	plans, err := h.Queries.ListChannelDispatchPlansBySession(ctx, db.ListChannelDispatchPlansBySessionParams{
		ChannelID:        channelID,
		ChannelSessionID: sessionID,
	})
	if err != nil {
		return nil, err
	}
	resp := make([]ChannelDispatchPlanResponse, len(plans))
	for i, plan := range plans {
		steps, err := h.channelDispatchStepResponses(ctx, plan.ID)
		if err != nil {
			return nil, err
		}
		resp[i] = channelDispatchPlanToResponse(plan, steps)
	}
	return resp, nil
}

func (h *Handler) loadChannelDispatchPlan(w http.ResponseWriter, r *http.Request) (db.ChannelDispatchPlan, bool) {
	_, _, _, plan, ok := h.loadChannelDispatchPlanWithChannel(w, r)
	return plan, ok
}

func (h *Handler) loadChannelDispatchPlanWithChannel(w http.ResponseWriter, r *http.Request) (db.Channel, db.Member, string, db.ChannelDispatchPlan, bool) {
	channel, member, workspaceID, ok := h.loadChannelInWorkspace(w, r, chi.URLParam(r, "id"))
	if !ok {
		return db.Channel{}, db.Member{}, "", db.ChannelDispatchPlan{}, false
	}
	planID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "planId"), "plan id")
	if !ok {
		return db.Channel{}, db.Member{}, "", db.ChannelDispatchPlan{}, false
	}
	plan, err := h.Queries.GetChannelDispatchPlanInChannel(r.Context(), db.GetChannelDispatchPlanInChannelParams{
		ID:        planID,
		ChannelID: channel.ID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "channel dispatch plan not found")
		return db.Channel{}, db.Member{}, "", db.ChannelDispatchPlan{}, false
	}
	return channel, member, workspaceID, plan, true
}

func (h *Handler) loadChannelDispatchPlanWithSession(w http.ResponseWriter, r *http.Request) (db.Channel, db.ChannelSession, string, db.ChannelDispatchPlan, bool) {
	channel, _, workspaceID, plan, ok := h.loadChannelDispatchPlanWithChannel(w, r)
	if !ok {
		return db.Channel{}, db.ChannelSession{}, "", db.ChannelDispatchPlan{}, false
	}
	session, err := h.Queries.GetChannelSessionByID(r.Context(), plan.ChannelSessionID)
	if err != nil {
		writeError(w, http.StatusNotFound, "channel session not found")
		return db.Channel{}, db.ChannelSession{}, "", db.ChannelDispatchPlan{}, false
	}
	return channel, session, workspaceID, plan, true
}

func (h *Handler) loadChannelDispatchStepContext(w http.ResponseWriter, r *http.Request) (db.Channel, db.ChannelSession, string, db.ChannelDispatchPlan, db.ChannelDispatchStep, bool) {
	channel, session, workspaceID, plan, ok := h.loadChannelDispatchPlanWithSession(w, r)
	if !ok {
		return db.Channel{}, db.ChannelSession{}, "", db.ChannelDispatchPlan{}, db.ChannelDispatchStep{}, false
	}
	stepID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "stepId"), "step id")
	if !ok {
		return db.Channel{}, db.ChannelSession{}, "", db.ChannelDispatchPlan{}, db.ChannelDispatchStep{}, false
	}
	step, err := h.Queries.GetChannelDispatchStepInChannel(r.Context(), db.GetChannelDispatchStepInChannelParams{
		ID:        stepID,
		ChannelID: channel.ID,
	})
	if err != nil || uuidToString(step.PlanID) != uuidToString(plan.ID) {
		writeError(w, http.StatusNotFound, "channel dispatch step not found")
		return db.Channel{}, db.ChannelSession{}, "", db.ChannelDispatchPlan{}, db.ChannelDispatchStep{}, false
	}
	return channel, session, workspaceID, plan, step, true
}

func (h *Handler) recordChannelDispatchFeedback(ctx context.Context, planID, stepID pgtype.UUID, action, beforeMode, afterMode string, r *http.Request, payload map[string]any) {
	if payload == nil {
		payload = map[string]any{}
	}
	raw, _ := json.Marshal(payload)
	userID := requestUserID(r)
	actorType, actorID := h.resolveActor(r, userID, workspaceIDFromURL(r, "workspaceId"))
	actorUUID := pgtype.UUID{}
	if strings.TrimSpace(actorID) != "" {
		if parsed, err := util.ParseUUID(actorID); err == nil {
			actorUUID = parsed
		}
	}
	_, err := h.Queries.CreateChannelDispatchFeedback(ctx, db.CreateChannelDispatchFeedbackParams{
		PlanID:     planID,
		StepID:     stepID,
		ActorType:  actorType,
		ActorID:    actorUUID,
		Action:     action,
		BeforeMode: optionalText(beforeMode),
		AfterMode:  optionalText(afterMode),
		Payload:    raw,
	})
	if err != nil {
		slog.Warn("failed to record channel dispatch feedback", "plan_id", uuidToString(planID), "action", action, "error", err)
	}
}
