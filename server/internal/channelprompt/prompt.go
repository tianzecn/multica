package channelprompt

import (
	"strings"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type Message struct {
	Author  string
	Content string
}

func Build(channel db.Channel, session db.ChannelSession, content string, recent []Message) string {
	return BuildWithInstruction(channel, session, content, recent, "")
}

func BuildWithInstruction(channel db.Channel, session db.ChannelSession, content string, recent []Message, instruction string) string {
	var builder strings.Builder
	builder.WriteString("You are participating as an AI teammate in a Multica channel.\n")
	builder.WriteString("Reply directly to the channel conversation. Your final answer will be mirrored back into the channel.\n")
	builder.WriteString("Do not assume this is an issue unless the user explicitly asks to create or link one.\n")
	builder.WriteString("If this prompt includes recent channel messages, use them as already-spoken context. Do not say you are waiting for another teammate whose message is already shown there.\n\n")
	builder.WriteString("Channel: #")
	builder.WriteString(channel.Slug)
	builder.WriteString(" (")
	builder.WriteString(channel.Name)
	builder.WriteString(")\n")
	builder.WriteString("Channel session: ")
	builder.WriteString(session.Title)
	builder.WriteString("\n")
	if strings.TrimSpace(channel.Description) != "" {
		builder.WriteString("Channel description: ")
		builder.WriteString(strings.TrimSpace(channel.Description))
		builder.WriteString("\n")
	}
	if strings.TrimSpace(channel.Instructions) != "" {
		builder.WriteString("Channel instructions:\n")
		builder.WriteString(strings.TrimSpace(channel.Instructions))
		builder.WriteString("\n")
	}
	if strings.TrimSpace(channel.Summary) != "" {
		builder.WriteString("Channel summary:\n")
		builder.WriteString(strings.TrimSpace(channel.Summary))
		builder.WriteString("\n")
	}
	if strings.TrimSpace(session.Summary) != "" {
		builder.WriteString("Session summary:\n")
		builder.WriteString(strings.TrimSpace(session.Summary))
		builder.WriteString("\n")
	}
	if len(recent) > 0 {
		builder.WriteString("\nRecent channel messages:\n")
		for _, message := range recent {
			text := strings.TrimSpace(message.Content)
			if text == "" {
				continue
			}
			author := strings.TrimSpace(message.Author)
			if author == "" {
				author = "Unknown"
			}
			builder.WriteString("- ")
			builder.WriteString(author)
			builder.WriteString(": ")
			builder.WriteString(text)
			builder.WriteString("\n")
		}
	}
	if strings.TrimSpace(instruction) != "" {
		builder.WriteString("\nDispatch step instruction:\n")
		builder.WriteString(strings.TrimSpace(instruction))
		builder.WriteString("\n")
	}
	builder.WriteString("\nUser message:\n")
	builder.WriteString(content)
	return builder.String()
}
