package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
)

var channelCmd = &cobra.Command{
	Use:   "channel",
	Short: "Work with channels",
}

var channelListCmd = &cobra.Command{
	Use:   "list",
	Short: "List channels in the workspace",
	Args:  cobra.NoArgs,
	RunE:  runChannelList,
}

var channelGetCmd = &cobra.Command{
	Use:   "get <channel-id-or-slug>",
	Short: "Get channel details",
	Args:  exactArgs(1),
	RunE:  runChannelGet,
}

var channelCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a channel",
	Args:  cobra.NoArgs,
	RunE:  runChannelCreate,
}

var channelUpdateCmd = &cobra.Command{
	Use:   "update <channel-id-or-slug>",
	Short: "Update a channel",
	Args:  exactArgs(1),
	RunE:  runChannelUpdate,
}

var channelDeleteCmd = &cobra.Command{
	Use:     "delete <channel-id-or-slug>",
	Aliases: []string{"archive"},
	Short:   "Archive a channel",
	Args:    exactArgs(1),
	RunE:    runChannelDelete,
}

var channelSessionCmd = &cobra.Command{
	Use:   "session",
	Short: "Work with channel sessions",
}

var channelSessionListCmd = &cobra.Command{
	Use:   "list <channel-id-or-slug>",
	Short: "List sessions in a channel",
	Args:  exactArgs(1),
	RunE:  runChannelSessionList,
}

var channelSessionCreateCmd = &cobra.Command{
	Use:   "create <channel-id-or-slug>",
	Short: "Create a session in a channel",
	Args:  exactArgs(1),
	RunE:  runChannelSessionCreate,
}

var channelMessageCmd = &cobra.Command{
	Use:   "message",
	Short: "Work with channel messages",
}

var channelMessageListCmd = &cobra.Command{
	Use:   "list <channel-id-or-slug> <session-id>",
	Short: "List messages in a channel session",
	Args:  exactArgs(2),
	RunE:  runChannelMessageList,
}

var channelMessageAddCmd = &cobra.Command{
	Use:   "add <channel-id-or-slug> <session-id>",
	Short: "Add a message to a channel session",
	Args:  exactArgs(2),
	RunE:  runChannelMessageAdd,
}

var channelLinkIssueCmd = &cobra.Command{
	Use:   "link-issue <channel-id-or-slug> <issue-id-or-key>",
	Short: "Link an issue to a channel",
	Args:  exactArgs(2),
	RunE:  runChannelLinkIssue,
}

var channelApprovalCmd = &cobra.Command{
	Use:   "approval",
	Short: "Work with channel approval requests",
}

var channelApprovalListCmd = &cobra.Command{
	Use:   "list <channel-id-or-slug>",
	Short: "List channel approval requests",
	Args:  exactArgs(1),
	RunE:  runChannelApprovalList,
}

var channelApprovalApproveCmd = &cobra.Command{
	Use:   "approve <channel-id-or-slug> <approval-id>",
	Short: "Approve a channel approval request",
	Args:  exactArgs(2),
	RunE:  runChannelApprovalApprove,
}

var channelApprovalRejectCmd = &cobra.Command{
	Use:   "reject <channel-id-or-slug> <approval-id>",
	Short: "Reject a channel approval request",
	Args:  exactArgs(2),
	RunE:  runChannelApprovalReject,
}

func init() {
	channelCmd.AddCommand(channelListCmd)
	channelCmd.AddCommand(channelGetCmd)
	channelCmd.AddCommand(channelCreateCmd)
	channelCmd.AddCommand(channelUpdateCmd)
	channelCmd.AddCommand(channelDeleteCmd)
	channelCmd.AddCommand(channelSessionCmd)
	channelCmd.AddCommand(channelMessageCmd)
	channelCmd.AddCommand(channelLinkIssueCmd)
	channelCmd.AddCommand(channelApprovalCmd)

	channelSessionCmd.AddCommand(channelSessionListCmd)
	channelSessionCmd.AddCommand(channelSessionCreateCmd)
	channelMessageCmd.AddCommand(channelMessageListCmd)
	channelMessageCmd.AddCommand(channelMessageAddCmd)
	channelApprovalCmd.AddCommand(channelApprovalListCmd)
	channelApprovalCmd.AddCommand(channelApprovalApproveCmd)
	channelApprovalCmd.AddCommand(channelApprovalRejectCmd)

	channelListCmd.Flags().String("output", "table", "Output format: table or json")
	channelListCmd.Flags().Bool("full-id", false, "Show full UUIDs in table output")

	channelGetCmd.Flags().String("output", "json", "Output format: table or json")

	channelCreateCmd.Flags().String("name", "", "Channel name (required)")
	channelCreateCmd.Flags().String("slug", "", "Lowercase channel slug")
	channelCreateCmd.Flags().String("description", "", "Channel description")
	channelCreateCmd.Flags().String("visibility", "private", "Visibility: private or public")
	channelCreateCmd.Flags().String("instructions", "", "Channel instructions")
	channelCreateCmd.Flags().String("output", "json", "Output format: table or json")

	channelUpdateCmd.Flags().String("name", "", "Channel name")
	channelUpdateCmd.Flags().String("description", "", "Channel description")
	channelUpdateCmd.Flags().String("visibility", "", "Visibility: private or public")
	channelUpdateCmd.Flags().String("instructions", "", "Channel instructions")
	channelUpdateCmd.Flags().String("summary", "", "Channel summary")
	channelUpdateCmd.Flags().String("output", "json", "Output format: table or json")
	channelDeleteCmd.Flags().String("output", "table", "Output format: table or json")

	channelSessionListCmd.Flags().String("output", "table", "Output format: table or json")
	channelSessionCreateCmd.Flags().String("title", "", "Session title (required)")
	channelSessionCreateCmd.Flags().String("summary", "", "Session summary")
	channelSessionCreateCmd.Flags().String("output", "json", "Output format: table or json")

	channelMessageListCmd.Flags().String("output", "table", "Output format: table or json")
	channelMessageAddCmd.Flags().String("content", "", "Message content")
	channelMessageAddCmd.Flags().Bool("content-stdin", false, "Read message content from stdin")
	channelMessageAddCmd.Flags().String("content-file", "", "Read message content from a UTF-8 file")
	channelMessageAddCmd.Flags().String("output", "json", "Output format: table or json")

	channelLinkIssueCmd.Flags().String("session", "", "Optional channel session ID")
	channelLinkIssueCmd.Flags().String("output", "json", "Output format: table or json")

	channelApprovalListCmd.Flags().String("output", "table", "Output format: table or json")
	channelApprovalApproveCmd.Flags().String("note", "", "Resolution note")
	channelApprovalApproveCmd.Flags().String("output", "json", "Output format: table or json")
	channelApprovalRejectCmd.Flags().String("note", "", "Resolution note")
	channelApprovalRejectCmd.Flags().String("output", "json", "Output format: table or json")
}

func runChannelList(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var channels []map[string]any
	if err := client.GetJSON(ctx, "/api/channels", &channels); err != nil {
		return fmt.Errorf("list channels: %w", err)
	}
	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, channels)
	}
	fullID, _ := cmd.Flags().GetBool("full-id")
	rows := make([][]string, 0, len(channels))
	for _, channel := range channels {
		rows = append(rows, []string{
			displayID(strVal(channel, "id"), fullID),
			strVal(channel, "name"),
			"#" + strVal(channel, "slug"),
			strVal(channel, "visibility"),
		})
	}
	cli.PrintTable(os.Stdout, []string{"ID", "NAME", "SLUG", "VISIBILITY"}, rows)
	return nil
}

func runChannelGet(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var channel map[string]any
	if err := client.GetJSON(ctx, "/api/channels/"+args[0], &channel); err != nil {
		return fmt.Errorf("get channel: %w", err)
	}
	output, _ := cmd.Flags().GetString("output")
	if output == "table" {
		cli.PrintTable(os.Stdout, []string{"ID", "NAME", "SLUG", "VISIBILITY"}, [][]string{{
			strVal(channel, "id"),
			strVal(channel, "name"),
			"#" + strVal(channel, "slug"),
			strVal(channel, "visibility"),
		}})
		return nil
	}
	return cli.PrintJSON(os.Stdout, channel)
}

func runChannelCreate(cmd *cobra.Command, _ []string) error {
	name, _ := cmd.Flags().GetString("name")
	if name == "" {
		return fmt.Errorf("--name is required")
	}
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	body := map[string]any{"name": name}
	for _, flag := range []string{"slug", "description", "visibility", "instructions"} {
		if cmd.Flags().Changed(flag) {
			value, _ := cmd.Flags().GetString(flag)
			body[flag] = value
		}
	}

	var result map[string]any
	if err := client.PostJSON(ctx, "/api/channels", body, &result); err != nil {
		return fmt.Errorf("create channel: %w", err)
	}
	output, _ := cmd.Flags().GetString("output")
	if output == "table" {
		fmt.Printf("Channel created: %s (#%s)\n", strVal(result, "name"), strVal(result, "slug"))
		return nil
	}
	return cli.PrintJSON(os.Stdout, result)
}

func runChannelUpdate(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	body := map[string]any{}
	for _, flag := range []string{"name", "description", "visibility", "instructions", "summary"} {
		if cmd.Flags().Changed(flag) {
			value, _ := cmd.Flags().GetString(flag)
			body[flag] = value
		}
	}
	if len(body) == 0 {
		return fmt.Errorf("at least one update flag is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var result map[string]any
	if err := client.PatchJSON(ctx, "/api/channels/"+args[0], body, &result); err != nil {
		return fmt.Errorf("update channel: %w", err)
	}
	output, _ := cmd.Flags().GetString("output")
	if output == "table" {
		fmt.Printf("Channel updated: %s (#%s)\n", strVal(result, "name"), strVal(result, "slug"))
		return nil
	}
	return cli.PrintJSON(os.Stdout, result)
}

func runChannelDelete(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := client.DeleteJSON(ctx, "/api/channels/"+args[0]); err != nil {
		return fmt.Errorf("archive channel: %w", err)
	}
	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, map[string]any{"archived": true, "channel": args[0]})
	}
	fmt.Printf("Channel archived: %s\n", args[0])
	return nil
}

func runChannelSessionList(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var sessions []map[string]any
	if err := client.GetJSON(ctx, "/api/channels/"+args[0]+"/sessions", &sessions); err != nil {
		return fmt.Errorf("list channel sessions: %w", err)
	}
	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, sessions)
	}
	rows := make([][]string, 0, len(sessions))
	for _, session := range sessions {
		rows = append(rows, []string{strVal(session, "id"), strVal(session, "title"), strVal(session, "status")})
	}
	cli.PrintTable(os.Stdout, []string{"ID", "TITLE", "STATUS"}, rows)
	return nil
}

func runChannelSessionCreate(cmd *cobra.Command, args []string) error {
	title, _ := cmd.Flags().GetString("title")
	if title == "" {
		return fmt.Errorf("--title is required")
	}
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	body := map[string]any{"title": title}
	if summary, _ := cmd.Flags().GetString("summary"); summary != "" {
		body["summary"] = summary
	}
	var result map[string]any
	if err := client.PostJSON(ctx, "/api/channels/"+args[0]+"/sessions", body, &result); err != nil {
		return fmt.Errorf("create channel session: %w", err)
	}
	output, _ := cmd.Flags().GetString("output")
	if output == "table" {
		fmt.Printf("Session created: %s (%s)\n", strVal(result, "title"), strVal(result, "id"))
		return nil
	}
	return cli.PrintJSON(os.Stdout, result)
}

func runChannelMessageList(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var messages []map[string]any
	if err := client.GetJSON(ctx, "/api/channels/"+args[0]+"/sessions/"+args[1]+"/messages", &messages); err != nil {
		return fmt.Errorf("list channel messages: %w", err)
	}
	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, messages)
	}
	rows := make([][]string, 0, len(messages))
	for _, message := range messages {
		rows = append(rows, []string{strVal(message, "created_at"), strVal(message, "author_type"), strVal(message, "content")})
	}
	cli.PrintTable(os.Stdout, []string{"CREATED", "AUTHOR", "CONTENT"}, rows)
	return nil
}

func runChannelMessageAdd(cmd *cobra.Command, args []string) error {
	content, ok, err := resolveTextFlag(cmd, "content")
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("--content, --content-stdin, or --content-file is required")
	}
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var result map[string]any
	if err := client.PostJSON(ctx, "/api/channels/"+args[0]+"/sessions/"+args[1]+"/messages", map[string]any{"content": content}, &result); err != nil {
		return fmt.Errorf("add channel message: %w", err)
	}
	output, _ := cmd.Flags().GetString("output")
	if output == "table" {
		fmt.Printf("Message created: %s\n", strVal(result, "id"))
		return nil
	}
	return cli.PrintJSON(os.Stdout, result)
}

func runChannelLinkIssue(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	body := map[string]any{"issue_id": args[1]}
	if session, _ := cmd.Flags().GetString("session"); session != "" {
		body["session_id"] = session
	}
	var result map[string]any
	if err := client.PostJSON(ctx, "/api/channels/"+args[0]+"/issues", body, &result); err != nil {
		return fmt.Errorf("link issue to channel: %w", err)
	}
	output, _ := cmd.Flags().GetString("output")
	if output == "table" {
		fmt.Printf("Issue linked: %s -> %s\n", args[1], args[0])
		return nil
	}
	return cli.PrintJSON(os.Stdout, result)
}

func runChannelApprovalList(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var approvals []map[string]any
	if err := client.GetJSON(ctx, "/api/channels/"+args[0]+"/approvals", &approvals); err != nil {
		return fmt.Errorf("list channel approvals: %w", err)
	}
	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, approvals)
	}
	rows := make([][]string, 0, len(approvals))
	for _, approval := range approvals {
		rows = append(rows, []string{strVal(approval, "id"), strVal(approval, "action_type"), strVal(approval, "status")})
	}
	cli.PrintTable(os.Stdout, []string{"ID", "ACTION", "STATUS"}, rows)
	return nil
}

func runChannelApprovalApprove(cmd *cobra.Command, args []string) error {
	return resolveChannelApproval(cmd, args, "approve")
}

func runChannelApprovalReject(cmd *cobra.Command, args []string) error {
	return resolveChannelApproval(cmd, args, "reject")
}

func resolveChannelApproval(cmd *cobra.Command, args []string, action string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	body := map[string]any{}
	if note, _ := cmd.Flags().GetString("note"); note != "" {
		body["resolution_note"] = note
	}
	var result map[string]any
	if err := client.PostJSON(ctx, "/api/channels/"+args[0]+"/approvals/"+args[1]+"/"+action, body, &result); err != nil {
		return fmt.Errorf("%s channel approval: %w", action, err)
	}
	output, _ := cmd.Flags().GetString("output")
	if output == "table" {
		fmt.Printf("Approval %s: %s\n", action, strVal(result, "id"))
		return nil
	}
	return cli.PrintJSON(os.Stdout, result)
}
